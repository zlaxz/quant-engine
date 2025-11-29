#!/usr/bin/env python3
"""
Rebuild Jan 2023 trades with minute bar data
See actual intraday peak timing, drawdowns, Greeks evolution
"""

import json
import pandas as pd
import gzip
from datetime import datetime, timedelta
from pathlib import Path
import sys

# Add src to path (if needed later)
# sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))


def load_minute_bars(date_str, data_dir="/Volumes/VelocityData/polygon_downloads/us_options_opra/minute_aggs_v1"):
    """Load minute bars for a specific date"""
    year, month = date_str[:4], date_str[5:7]
    file_path = Path(data_dir) / year / month / f"{date_str}.csv.gz"

    if not file_path.exists():
        print(f"Warning: {file_path} not found")
        return pd.DataFrame()

    with gzip.open(file_path, 'rt') as f:
        df = pd.read_csv(f)

    # Convert timestamp
    df['timestamp'] = pd.to_datetime(df['window_start'], unit='ns')
    df['date'] = df['timestamp'].dt.date
    df['time'] = df['timestamp'].dt.time

    return df


def get_trading_dates(start_date, end_date):
    """Get list of trading dates between start and end"""
    dates = pd.date_range(start_date, end_date, freq='B')  # Business days
    return [d.strftime('%Y-%m-%d') for d in dates]


def build_option_ticker(expiry, strike, option_type):
    """Build option ticker from components"""
    # Format: O:SPY{YYMMDD}{C|P}{strike*1000 with 8 digits}
    expiry_dt = pd.to_datetime(expiry)
    yymmdd = expiry_dt.strftime('%y%m%d')
    strike_padded = f"{int(strike * 1000):08d}"
    opt_letter = 'C' if option_type.lower() == 'call' else 'P'
    return f"O:SPY{yymmdd}{opt_letter}{strike_padded}"


def rebuild_trade_intraday(trade, profile_name):
    """Rebuild a single trade with minute bars"""
    entry_date = trade['entry']['entry_date']
    exit_date = trade['exit']['exit_date'] if 'exit' in trade else None

    if not exit_date:
        return None

    print(f"\nRebuilding {profile_name} trade: {entry_date} → {exit_date}")

    # Get all trading dates for this trade
    trading_dates = get_trading_dates(entry_date, exit_date)

    # Entry details
    expiry = trade['entry']['expiry']
    strike = trade['entry']['strike']
    legs = trade['entry']['legs']
    entry_prices = trade['entry']['entry_prices']
    entry_cost = trade['entry']['entry_cost']

    # Build tickers for each leg
    leg_data = []
    for leg in legs:
        option_type = leg['type']  # 'call' or 'put'
        qty = leg['qty']
        ticker = build_option_ticker(expiry, strike, option_type)
        entry_price = entry_prices[option_type]
        leg_data.append({
            'ticker': ticker,
            'type': option_type,
            'qty': qty,
            'entry_price': entry_price
        })

    print(f"  Entry: {strike} strike, {expiry} expiry")

    # Load minute bars for each day and track combined P&L
    all_minutes = []
    for date in trading_dates:
        minute_bars = load_minute_bars(date)
        if minute_bars.empty:
            continue

        # Track P&L for each leg at this timestamp
        daily_pnl_by_minute = {}

        for leg in leg_data:
            ticker = leg['ticker']
            entry_price = leg['entry_price']
            qty = leg['qty']

            # Get minute data for this leg
            leg_minutes = minute_bars[minute_bars['ticker'] == ticker].copy()

            if leg_minutes.empty:
                continue

            # Calculate P&L for this leg
            for _, row in leg_minutes.iterrows():
                timestamp = row['timestamp']
                close_price = row['close']
                leg_pnl = (close_price - entry_price) * qty * 100

                if timestamp not in daily_pnl_by_minute:
                    daily_pnl_by_minute[timestamp] = {
                        'timestamp': timestamp,
                        'total_pnl': 0,
                        'call_pnl': 0,
                        'put_pnl': 0,
                        'call_price': None,
                        'put_price': None
                    }

                daily_pnl_by_minute[timestamp]['total_pnl'] += leg_pnl

                # Track call/put separately
                if leg['type'] == 'call':
                    daily_pnl_by_minute[timestamp]['call_pnl'] = leg_pnl
                    daily_pnl_by_minute[timestamp]['call_price'] = close_price
                else:
                    daily_pnl_by_minute[timestamp]['put_pnl'] = leg_pnl
                    daily_pnl_by_minute[timestamp]['put_price'] = close_price

        # Convert to list
        if daily_pnl_by_minute:
            all_minutes.extend(daily_pnl_by_minute.values())

    if not all_minutes:
        tickers_str = ', '.join([leg['ticker'] for leg in leg_data])
        print(f"  Warning: No minute data found for {tickers_str}")
        return None

    # Convert to DataFrame
    intraday_path = pd.DataFrame(all_minutes)
    intraday_path = intraday_path.sort_values('timestamp').reset_index(drop=True)

    # Find peak
    peak_idx = intraday_path['total_pnl'].idxmax()
    peak_pnl = intraday_path.loc[peak_idx, 'total_pnl']
    peak_time = intraday_path.loc[peak_idx, 'timestamp']

    # Final P&L (last minute)
    final_pnl = intraday_path.iloc[-1]['total_pnl']
    final_time = intraday_path.iloc[-1]['timestamp']

    # Calculate days to peak
    entry_dt = pd.to_datetime(entry_date)
    days_to_peak = (peak_time - entry_dt).total_seconds() / 86400

    print(f"  Peak: ${peak_pnl:.0f} on {peak_time.strftime('%Y-%m-%d %H:%M')} (Day {days_to_peak:.2f})")
    print(f"  Final: ${final_pnl:.0f} on {final_time.strftime('%Y-%m-%d %H:%M')}")
    print(f"  Minutes tracked: {len(intraday_path)}")

    return {
        'profile': profile_name,
        'entry_date': entry_date,
        'exit_date': exit_date,
        'strike': strike,
        'expiry': expiry,
        'legs': leg_data,
        'entry_cost': entry_cost,
        'peak_pnl': float(peak_pnl),
        'peak_time': peak_time.isoformat(),
        'days_to_peak': float(days_to_peak),
        'final_pnl': float(final_pnl),
        'final_time': final_time.isoformat(),
        'minutes_tracked': len(intraday_path),
        'intraday_path': [{
            'timestamp': row['timestamp'].isoformat() if pd.notnull(row['timestamp']) else None,
            'total_pnl': float(row['total_pnl']) if pd.notnull(row['total_pnl']) else 0,
            'call_pnl': float(row['call_pnl']) if pd.notnull(row['call_pnl']) else 0,
            'put_pnl': float(row['put_pnl']) if pd.notnull(row['put_pnl']) else 0,
            'call_price': float(row['call_price']) if pd.notnull(row['call_price']) else None,
            'put_price': float(row['put_price']) if pd.notnull(row['put_price']) else None
        } for _, row in intraday_path.iterrows()]
    }


def main():
    """Rebuild all Jan 2023 trades with minute bars"""

    # Load daily backtest results
    results_file = Path('data/backtest_results/current/results.json')
    with open(results_file, 'r') as f:
        data = json.load(f)

    # Find Jan 2023 trades
    jan_2023_trades = []
    for profile_name, profile_data in data.items():
        if 'trades' not in profile_data:
            continue

        for trade in profile_data['trades']:
            entry_date = trade['entry']['entry_date']
            if entry_date.startswith('2023-01'):
                jan_2023_trades.append((profile_name, trade))

    print(f"Found {len(jan_2023_trades)} Jan 2023 trades")
    print("=" * 60)

    # Rebuild each trade
    intraday_results = []
    for profile_name, trade in jan_2023_trades:
        try:
            result = rebuild_trade_intraday(trade, profile_name)
            if result:
                intraday_results.append(result)
        except Exception as e:
            print(f"Error rebuilding trade: {e}")
            continue

    # Save results
    output_file = Path('data/backtest_results/jan2023_intraday_rebuild.json')
    with open(output_file, 'w') as f:
        json.dump(intraday_results, f, indent=2)

    print("\n" + "=" * 60)
    print(f"✅ Rebuilt {len(intraday_results)} trades with minute bars")
    print(f"✅ Saved to: {output_file}")

    # Summary stats
    if intraday_results:
        total_minutes = sum(r['minutes_tracked'] for r in intraday_results)
        avg_days_to_peak = sum(r['days_to_peak'] for r in intraday_results) / len(intraday_results)

        print(f"\nSummary:")
        print(f"  Total minutes tracked: {total_minutes:,}")
        print(f"  Avg days to peak: {avg_days_to_peak:.2f}")
        print(f"  Peak range: ${min(r['peak_pnl'] for r in intraday_results):.0f} to ${max(r['peak_pnl'] for r in intraday_results):.0f}")


if __name__ == '__main__':
    main()
