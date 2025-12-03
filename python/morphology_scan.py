#!/usr/bin/env python3
"""
Morphology Scan - Velocity Mandate
Calculates 30-day rolling Skewness and Kurtosis for SPY, QQQ, IWM
Classifies regimes based on distribution shape:
  - Skew < -0.5 → P-Shape (Short Squeeze potential)
  - Skew > 0.5 → b-Shape (Liquidation Risk)
  - Kurtosis < -1.0 → I-Shape (Trend/Vacuum)
  - Else → D-Shape (Stable)
"""

import yfinance as yf
import pandas as pd
import numpy as np
from scipy import stats
from datetime import datetime, timedelta
import json
import sys

# Configuration
SYMBOLS = ['SPY', 'QQQ', 'IWM']
ROLLING_WINDOW = 30  # 30 trading days

def fetch_data(symbols: list, days: int = 90) -> dict:
    """Fetch daily OHLCV data for regime analysis."""
    print(f"Fetching {days} days of data for {symbols}...")
    data = {}

    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_date, end=end_date, interval='1d')
            if len(df) > 0:
                df['returns'] = df['Close'].pct_change()
                df['log_returns'] = np.log(df['Close'] / df['Close'].shift(1))
                data[symbol] = df
                print(f"  {symbol}: {len(df)} bars fetched")
            else:
                print(f"  {symbol}: No data returned")
        except Exception as e:
            print(f"  {symbol}: Error - {e}")

    return data


def calculate_rolling_moments(df: pd.DataFrame, window: int = 30) -> pd.DataFrame:
    """Calculate rolling skewness and kurtosis of returns."""
    returns = df['returns'].dropna()

    rolling_skew = returns.rolling(window=window).apply(
        lambda x: stats.skew(x, nan_policy='omit'), raw=True
    )

    rolling_kurt = returns.rolling(window=window).apply(
        lambda x: stats.kurtosis(x, nan_policy='omit'), raw=True
    )

    df['rolling_skew'] = rolling_skew
    df['rolling_kurtosis'] = rolling_kurt

    return df


def classify_regime(skew: float, kurtosis: float) -> tuple:
    """
    Classify regime based on distribution morphology.
    Returns (shape, description, fragility_score)
    """
    if pd.isna(skew) or pd.isna(kurtosis):
        return ('Unknown', 'Insufficient data', 0)

    if skew < -0.5:
        fragility = abs(skew) * 2
        return ('P-Shape', 'Short Squeeze Potential', fragility)

    elif skew > 0.5:
        fragility = skew * 2.5
        if kurtosis > 1:
            fragility *= 1.5
        return ('b-Shape', 'Liquidation Risk', fragility)

    elif kurtosis < -1.0:
        fragility = abs(kurtosis) * 0.8
        return ('I-Shape', 'Trend/Vacuum', fragility)

    else:
        fragility = 0.3
        return ('D-Shape', 'Stable', fragility)


def analyze_symbol(symbol: str, df: pd.DataFrame) -> dict:
    """Full morphology analysis for a single symbol."""
    df = calculate_rolling_moments(df, ROLLING_WINDOW)

    latest = df.iloc[-1]
    current_skew = latest.get('rolling_skew', np.nan)
    current_kurt = latest.get('rolling_kurtosis', np.nan)

    shape, description, fragility = classify_regime(current_skew, current_kurt)

    regime_counts = {'P-Shape': 0, 'b-Shape': 0, 'I-Shape': 0, 'D-Shape': 0}
    recent_30 = df.tail(30)
    for _, row in recent_30.iterrows():
        s, _, _ = classify_regime(row.get('rolling_skew'), row.get('rolling_kurtosis'))
        if s in regime_counts:
            regime_counts[s] += 1

    skew_trend = 'stable'
    if len(df) >= 5:
        skew_5d = df['rolling_skew'].tail(5).mean()
        skew_10d = df['rolling_skew'].tail(10).head(5).mean()
        if not pd.isna(skew_5d) and not pd.isna(skew_10d):
            if skew_5d < skew_10d - 0.1:
                skew_trend = 'deteriorating (more negative)'
            elif skew_5d > skew_10d + 0.1:
                skew_trend = 'improving (less negative)'

    vol_20d = df['returns'].tail(20).std() * np.sqrt(252) * 100

    return {
        'symbol': symbol,
        'current_skew': round(current_skew, 3) if not pd.isna(current_skew) else None,
        'current_kurtosis': round(current_kurt, 3) if not pd.isna(current_kurt) else None,
        'shape': shape,
        'description': description,
        'fragility_score': round(fragility, 2),
        'regime_history_30d': regime_counts,
        'skew_trend': skew_trend,
        'annualized_vol': round(vol_20d, 1) if not pd.isna(vol_20d) else None,
        'last_close': round(latest['Close'], 2),
        'last_date': str(df.index[-1].date())
    }


def generate_convexity_report(results: list) -> dict:
    """Identify most fragile asset and generate convexity positioning report."""
    sorted_results = sorted(results, key=lambda x: x['fragility_score'], reverse=True)
    most_fragile = sorted_results[0]

    report = {
        'scan_timestamp': datetime.now().isoformat(),
        'most_fragile_asset': most_fragile['symbol'],
        'fragility_score': most_fragile['fragility_score'],
        'shape': most_fragile['shape'],
        'risk_description': most_fragile['description'],
        'positioning_recommendation': '',
        'all_assets': sorted_results
    }

    if most_fragile['shape'] == 'b-Shape':
        report['positioning_recommendation'] = (
            f"HIGH ALERT: {most_fragile['symbol']} shows b-Shape (Liquidation Risk). "
            f"Skew={most_fragile['current_skew']}, suggesting fat right tail in losses. "
            "Consider: Long puts for convex downside exposure, or put spreads for defined risk. "
            "Avoid naked short premium positions."
        )
    elif most_fragile['shape'] == 'P-Shape':
        report['positioning_recommendation'] = (
            f"WATCH: {most_fragile['symbol']} shows P-Shape (Short Squeeze Potential). "
            f"Skew={most_fragile['current_skew']}, suggesting compressed upside. "
            "Consider: Long calls or call spreads for convex upside if squeeze triggers. "
            "Avoid short calls without protection."
        )
    elif most_fragile['shape'] == 'I-Shape':
        report['positioning_recommendation'] = (
            f"TREND ALERT: {most_fragile['symbol']} shows I-Shape (Trend/Vacuum). "
            f"Kurtosis={most_fragile['current_kurtosis']}, suggesting thin tails/trending. "
            "Consider: Trend-following strategies, avoid mean reversion. "
            "Long straddles may decay without catalysts."
        )
    else:
        report['positioning_recommendation'] = (
            f"STABLE: {most_fragile['symbol']} shows D-Shape (Stable distribution). "
            "All assets appear normally distributed. Standard volatility strategies appropriate. "
            "Consider: Premium selling with defined risk, or wait for regime shift."
        )

    return report


def main():
    print("=" * 60)
    print("MORPHOLOGY SCAN - Velocity Mandate")
    print("=" * 60)
    print()

    data = fetch_data(SYMBOLS, days=90)

    if not data:
        print("ERROR: No data fetched. Check network connection.")
        sys.exit(1)

    print("\nCalculating rolling moments (30-day window)...")
    results = []
    for symbol, df in data.items():
        result = analyze_symbol(symbol, df)
        results.append(result)
        print(f"\n{symbol}:")
        print(f"  Shape: {result['shape']} ({result['description']})")
        print(f"  Skewness: {result['current_skew']}")
        print(f"  Kurtosis: {result['current_kurtosis']}")
        print(f"  Fragility Score: {result['fragility_score']}")
        print(f"  20d Ann. Vol: {result['annualized_vol']}%")

    print("\n" + "=" * 60)
    print("CONVEXITY REPORT")
    print("=" * 60)

    report = generate_convexity_report(results)

    print(f"\n🎯 MOST FRAGILE ASSET: {report['most_fragile_asset']}")
    print(f"   Fragility Score: {report['fragility_score']}")
    print(f"   Shape: {report['shape']} - {report['risk_description']}")
    print(f"\n📊 POSITIONING RECOMMENDATION:")
    print(f"   {report['positioning_recommendation']}")

    print("\n" + "-" * 60)
    print("ALL ASSETS (sorted by fragility):")
    for asset in report['all_assets']:
        print(f"  {asset['symbol']}: {asset['shape']} (fragility={asset['fragility_score']})")

    return report


if __name__ == '__main__':
    report = main()
    print("\n" + "=" * 60)
    print("JSON OUTPUT:")
    print(json.dumps(report, indent=2, default=str))
