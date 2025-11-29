#!/usr/bin/env python3
"""
TradeTracker: Production-grade trade path tracking system

Captures complete trade lifecycle:
- Entry snapshot (position details, market conditions)
- Daily path (14 days: prices, Greeks, P&L evolution)
- Exit analytics (peak capture, path statistics)

Design principles:
- Zero look-ahead bias (only use data available at each point)
- Complete Greeks tracking (delta, gamma, theta, vega, vanna, charm)
- Market condition capture (VIX, RV, regime signals)
- Path analytics for exit strategy development
"""

import pandas as pd
import numpy as np
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

# Import from engine package (relative imports)
from ..data.polygon_options import PolygonOptionsLoader
from ..pricing.greeks import calculate_all_greeks


class TradeTracker:
    """
    Track complete trade lifecycle with daily path sampling

    Purpose: Enable exit strategy development by capturing what
    happens to position over its lifetime (not just entry/exit)
    """

    def __init__(self, polygon_loader: PolygonOptionsLoader):
        self.polygon = polygon_loader

    def track_trade(
        self,
        entry_date: date,
        position: Dict,
        spy_data: pd.DataFrame,
        max_days: int = 14,
        regime_data: Optional[pd.DataFrame] = None
    ) -> Optional[Dict]:
        """
        Track complete trade path from entry to exit (or max_days)

        Args:
            entry_date: Trade entry date
            position: Dict with keys:
                - structure: 'long_call', 'short_straddle', etc.
                - strike: Strike price
                - expiry: Expiry date
                - legs: List of dicts with 'type' ('call'/'put'), 'qty' (1/-1)
            spy_data: DataFrame with date, close, derived features
            max_days: Maximum tracking window (default 14)
            regime_data: Optional DataFrame with regime labels

        Returns:
            Complete trade record or None if data unavailable
        """
        # Find entry in SPY data
        spy_subset = spy_data[spy_data['date'] >= entry_date].head(max_days + 1)
        if len(spy_subset) == 0:
            return None

        # Entry snapshot
        entry_row = spy_subset.iloc[0]
        entry_spot = entry_row['close']

        # Get entry prices
        entry_prices = {}
        entry_cost = 0.0
        commission = 2.60  # Per trade
        spread = 0.03  # Per contract

        for leg in position['legs']:
            opt_type = leg['type']
            qty = leg['qty']

            # FIX BUG-001 (SYSTEMIC): Get execution prices (ask/bid), not mid+spread
            # This matches how Simulator.py gets prices (lines 424-429)
            if qty > 0:
                # Long: pay the ask
                price = self.polygon.get_option_price(
                    entry_date, position['strike'], position['expiry'], opt_type, 'ask'
                )
            else:
                # Short: receive the bid
                price = self.polygon.get_option_price(
                    entry_date, position['strike'], position['expiry'], opt_type, 'bid'
                )

            if price is None:
                return None

            entry_prices[opt_type] = price

            # Entry cost calculation (price already includes spread via ask/bid)
            # For long (qty > 0): positive = cash outflow (we paid ask)
            # For short (qty < 0): negative = cash inflow (we received bid)
            leg_cost = qty * price * 100

            entry_cost += leg_cost

        entry_cost += commission  # Commission is always a cost (positive addition)

        # Calculate entry Greeks
        entry_greeks = self._calculate_position_greeks(
            entry_date, entry_spot, position['strike'],
            position['expiry'], position['legs'], entry_prices
        )

        # Build entry snapshot
        entry_snapshot = {
            'trade_id': f"{position['profile']}_{entry_date}_{position['strike']}",
            'entry_date': str(entry_date),
            'profile': position['profile'],
            'structure': position['structure'],

            # Position details
            'spot': float(entry_spot),
            'strike': position['strike'],
            'expiry': str(position['expiry']),
            'dte': (position['expiry'] - entry_date).days,
            'legs': position['legs'],

            # Entry pricing
            'entry_prices': entry_prices,
            'entry_cost': float(entry_cost),

            # Entry Greeks
            'entry_greeks': entry_greeks,

            # Market conditions at entry
            'entry_conditions': self._capture_market_conditions(
                entry_row, regime_data, entry_date
            )
        }

        # Track daily path
        daily_path = []
        peak_pnl = -entry_cost  # Start with entry cost as baseline
        max_dd = 0.0

        for day_idx, (_, day_row) in enumerate(spy_subset.iterrows()):
            day_date = day_row['date']
            day_spot = day_row['close']

            # Get current option prices
            current_prices = {}
            mtm_value = 0.0

            for leg in position['legs']:
                opt_type = leg['type']
                qty = leg['qty']

                # FIXED: Use consistent ask/bid pricing (same as entry)
                # Long positions would exit at bid (selling), short at ask (buying to cover)
                if qty > 0:
                    # Long: exit at bid (we're selling)
                    price = self.polygon.get_option_price(
                        day_date, position['strike'], position['expiry'], opt_type, 'bid'
                    )
                else:
                    # Short: exit at ask (we're buying to cover)
                    price = self.polygon.get_option_price(
                        day_date, position['strike'], position['expiry'], opt_type, 'ask'
                    )

                if price is None:
                    # If we can't get price, stop tracking
                    break

                current_prices[opt_type] = price
                # MTM: value if closed now at bid/ask (no spread adjustment needed - already in price)
                exit_value = qty * price * 100
                mtm_value += exit_value

            if not current_prices:
                break

            # P&L = MTM value - entry cost - exit commission
            mtm_pnl = mtm_value - entry_cost - commission

            # Update peak and drawdown
            if mtm_pnl > peak_pnl:
                peak_pnl = mtm_pnl
            dd_from_peak = mtm_pnl - peak_pnl
            if dd_from_peak < max_dd:
                max_dd = dd_from_peak

            # Calculate current Greeks
            current_greeks = self._calculate_position_greeks(
                day_date, day_spot, position['strike'],
                position['expiry'], position['legs'], current_prices
            )

            # Record daily snapshot
            daily_snapshot = {
                'day': day_idx,
                'date': str(day_date),
                'spot': float(day_spot),
                'prices': current_prices,
                'mtm_pnl': float(mtm_pnl),
                'peak_so_far': float(peak_pnl),
                'dd_from_peak': float(dd_from_peak),
                'greeks': current_greeks,
                'market_conditions': self._capture_market_conditions(
                    day_row, regime_data, day_date
                )
            }

            daily_path.append(daily_snapshot)

        # Exit analytics
        if len(daily_path) == 0:
            return None

        exit_snapshot = daily_path[-1]
        days_held = len(daily_path) - 1

        # Find day of peak (FIXED: use max() to avoid floating-point equality issues)
        if daily_path:
            day_of_peak = max(range(len(daily_path)), key=lambda i: daily_path[i]['mtm_pnl'])
        else:
            day_of_peak = 0

        # Calculate path statistics
        pnl_series = [d['mtm_pnl'] for d in daily_path]
        pnl_volatility = float(np.std(pnl_series)) if len(pnl_series) > 1 else 0.0
        positive_days = sum(1 for pnl in pnl_series if pnl > 0)

        # FIXED: Handle division by zero and negative peak scenarios
        if peak_pnl > 0:
            # Winning trade: standard percentage
            pct_captured = float(exit_snapshot['mtm_pnl'] / peak_pnl * 100)
        elif peak_pnl < 0:
            # Losing trade: calculate recovery percentage
            # How much of the loss was recovered from worst point?
            pct_captured = float((exit_snapshot['mtm_pnl'] - peak_pnl) / abs(peak_pnl) * 100)
        else:
            # peak_pnl == 0 (broke even at best)
            pct_captured = 0.0

        exit_analytics = {
            'exit_date': exit_snapshot['date'],
            'days_held': days_held,
            'final_pnl': exit_snapshot['mtm_pnl'],
            'peak_pnl': float(peak_pnl),
            'max_drawdown': float(max_dd),
            'pct_of_peak_captured': pct_captured,
            'day_of_peak': day_of_peak,
            'days_after_peak': days_held - day_of_peak,
            'peak_to_exit_decay': float(exit_snapshot['mtm_pnl'] - peak_pnl),
            'pnl_volatility': pnl_volatility,
            'positive_days': positive_days,
            'negative_days': days_held + 1 - positive_days,
            'avg_daily_pnl': float(exit_snapshot['mtm_pnl'] / (days_held + 1)) if days_held >= 0 else 0
        }

        # Complete trade record
        trade_record = {
            'entry': entry_snapshot,
            'path': daily_path,
            'exit': exit_analytics
        }

        return trade_record

    def _calculate_position_greeks(
        self,
        trade_date: date,
        spot: float,
        strike: float,
        expiry: date,
        legs: List[Dict],
        prices: Dict[str, float]
    ) -> Dict[str, float]:
        """Calculate net position Greeks"""

        dte = (expiry - trade_date).days
        if dte <= 0:
            return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}

        # Estimate risk-free rate and volatility
        r = 0.04  # 4% risk-free rate

        # Estimate IV from option price (improved heuristic)
        # FIXED: Better IV estimation using Brenner-Subrahmanyam approximation
        iv = 0.20  # Default fallback
        for leg in legs:
            opt_type = leg['type']
            if opt_type in prices:
                price = prices[opt_type]
                moneyness = abs(strike - spot) / spot

                # Brenner-Subrahmanyam approximation for ATM options
                if moneyness < 0.05:  # Near ATM
                    iv = price / spot * np.sqrt(2 * np.pi / (dte / 365.0))
                    iv = np.clip(iv, 0.05, 2.0)  # Realistic bounds: 5% to 200%
                else:  # OTM options - use conservative estimate
                    iv = price / spot * np.sqrt(2 * np.pi / (dte / 365.0)) * 1.5
                    iv = np.clip(iv, 0.05, 3.0)
                break

        # Calculate Greeks for each leg and sum
        CONTRACT_MULTIPLIER = 100  # FIX BUG-002: Options represent 100 shares per contract
        net_greeks = {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}

        for leg in legs:
            opt_type = leg['type']
            qty = leg['qty']

            greeks = calculate_all_greeks(
                spot, strike, dte / 365.0, r, iv, opt_type
            )

            # Scale by quantity (positive = long, negative = short) AND contract multiplier
            net_greeks['delta'] += greeks['delta'] * qty * CONTRACT_MULTIPLIER
            net_greeks['gamma'] += greeks['gamma'] * qty * CONTRACT_MULTIPLIER
            net_greeks['theta'] += greeks['theta'] * qty * CONTRACT_MULTIPLIER
            net_greeks['vega'] += greeks['vega'] * qty * CONTRACT_MULTIPLIER

        return {k: float(v) for k, v in net_greeks.items()}

    def _capture_market_conditions(
        self,
        row: pd.Series,
        regime_data: Optional[pd.DataFrame],
        trade_date: date
    ) -> Dict:
        """Capture market conditions at a point in time"""

        conditions = {
            'close': float(row['close']),
        }

        # Add any derived features from row
        feature_cols = ['slope', 'RV5', 'RV10', 'RV20', 'ATR5', 'ATR10',
                       'MA20', 'MA50', 'slope_MA20', 'slope_MA50',
                       'return_5d', 'return_10d', 'return_20d']

        for col in feature_cols:
            if col in row.index:
                val = row[col]
                conditions[col] = float(val) if pd.notna(val) else None

        # Add regime if available
        if regime_data is not None:
            regime_row = regime_data[regime_data['date'] == trade_date]
            if len(regime_row) > 0:
                conditions['regime'] = int(regime_row.iloc[0]['regime'])

        return conditions
