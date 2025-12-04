#!/usr/bin/env python3
"""
Gamma Exposure (GEX) Calculator - The Institutional Edge.

Dealers hedge options by trading the underlying. When they're short gamma,
they BUY dips and SELL rips (stabilizing). When long gamma, they do the opposite.

Key features:
1. Net GEX - Total dealer gamma exposure
2. Zero Gamma Level - Price where dealer hedging flips
3. Gamma Walls - Strikes with massive OI creating support/resistance
4. Call/Put Wall distances - How far to the walls

Data required: Options chain with strikes, OI, and Greeks (or we calculate Greeks).

Reference: GammaWallIntelligence.ts from option-machine
"""

import logging
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from enum import IntEnum

import numpy as np
import pandas as pd
from scipy.stats import norm

logger = logging.getLogger("AlphaFactory.Features.Gamma")


# ============================================================================
# BLACK-SCHOLES GREEKS (if not provided in data)
# ============================================================================

def black_scholes_greeks(
    spot: float,
    strike: float,
    tte: float,  # Time to expiry in years
    rate: float,  # Risk-free rate
    iv: float,    # Implied volatility
    is_call: bool = True
) -> Dict[str, float]:
    """
    Calculate Black-Scholes Greeks.

    Returns dict with: delta, gamma, theta, vega
    """
    # Validate inputs - all must be positive to avoid div/0 and log(negative)
    if spot <= 0 or strike <= 0 or tte <= 0 or iv <= 0:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}

    sqrt_t = np.sqrt(tte)
    d1 = (np.log(spot / strike) + (rate + 0.5 * iv**2) * tte) / (iv * sqrt_t)
    d2 = d1 - iv * sqrt_t

    # Gamma (same for calls and puts)
    gamma = norm.pdf(d1) / (spot * iv * sqrt_t)

    # Delta
    if is_call:
        delta = norm.cdf(d1)
    else:
        delta = norm.cdf(d1) - 1

    # Vega (same for calls and puts)
    # NOTE: Vega is normalized to per-1%-IV change (divided by 100)
    # This is different from gamma which is per-$1 move in underlying
    # If mixing Greeks, ensure consistent scaling. Gamma is NOT normalized.
    vega = spot * norm.pdf(d1) * sqrt_t / 100  # $ per 1% IV change

    # Theta
    theta_common = -(spot * norm.pdf(d1) * iv) / (2 * sqrt_t)
    if is_call:
        theta = theta_common - rate * strike * np.exp(-rate * tte) * norm.cdf(d2)
    else:
        theta = theta_common + rate * strike * np.exp(-rate * tte) * norm.cdf(-d2)
    theta = theta / 365  # Per day

    return {
        'delta': delta,
        'gamma': gamma,
        'theta': theta,
        'vega': vega
    }


# ============================================================================
# GEX CALCULATOR
# ============================================================================

@dataclass
class GammaExposure:
    """Gamma exposure calculation result."""
    net_gex: float                    # Net gamma exposure (notional $)
    call_gex: float                   # Call gamma exposure
    put_gex: float                    # Put gamma exposure
    zero_gamma_level: float           # Price where GEX flips sign
    max_call_wall: float              # Strike with highest call gamma
    max_put_wall: float               # Strike with highest put gamma
    dealer_position: str              # 'LONG_GAMMA' or 'SHORT_GAMMA'
    gex_by_strike: Dict[float, float] # GEX at each strike


class GammaCalculator:
    """
    Calculates Gamma Exposure (GEX) from options chain data.

    Dealer positioning logic:
    - Dealers are usually SHORT options (retail buys, dealers sell)
    - Short calls = short gamma (hedge by buying dips, selling rips)
    - Short puts = long gamma (hedge opposite)
    - Net GEX > 0 = dealers long gamma = stabilizing
    - Net GEX < 0 = dealers short gamma = amplifying
    """

    # Dealer gamma assumption: dealers are short what retail buys
    # Retail buys calls (bullish) and puts (hedging)
    # So dealers are short both, but calls dominate in bull markets
    DEALER_SHORT_CALLS = True  # Assume dealers short calls
    DEALER_SHORT_PUTS = True   # Assume dealers short puts

    def __init__(
        self,
        risk_free_rate: float = 0.05,
        min_oi_threshold: int = 100,
        max_dte_days: int = 45
    ):
        """
        Initialize gamma calculator.

        Args:
            risk_free_rate: Risk-free rate for BS calculation
            min_oi_threshold: Minimum OI to include strike
            max_dte_days: Maximum days to expiry to include
        """
        self.risk_free_rate = risk_free_rate
        self.min_oi_threshold = min_oi_threshold
        self.max_dte_days = max_dte_days

    def calculate_gex(
        self,
        options_df: pd.DataFrame,
        spot_price: float,
        current_date: pd.Timestamp = None
    ) -> GammaExposure:
        """
        Calculate total Gamma Exposure from options chain.

        Args:
            options_df: DataFrame with columns:
                - strike: Strike price
                - expiration: Expiration date
                - option_type: 'call' or 'put' (or 'C'/'P')
                - open_interest: Open interest
                - implied_volatility: IV (optional, will estimate if missing)
                - gamma: Gamma (optional, will calculate if missing)
            spot_price: Current underlying price
            current_date: Current date for TTE calculation

        Returns:
            GammaExposure object with all metrics
        """
        df = options_df.copy()
        current_date = current_date or pd.Timestamp.now()

        # Normalize option type
        if 'option_type' in df.columns:
            df['is_call'] = df['option_type'].str.upper().str.startswith('C')
        elif 'type' in df.columns:
            df['is_call'] = df['type'].str.upper().str.startswith('C')
        else:
            raise ValueError("Need 'option_type' or 'type' column")

        # Filter by OI threshold
        df = df[df['open_interest'] >= self.min_oi_threshold]

        # Calculate TTE if expiration provided
        if 'expiration' in df.columns:
            df['tte'] = (pd.to_datetime(df['expiration']) - current_date).dt.days / 365
            df = df[df['tte'] > 0]
            df = df[df['tte'] <= self.max_dte_days / 365]
        else:
            df['tte'] = 30 / 365  # Default 30 days

        # Calculate gamma if not provided
        if 'gamma' not in df.columns:
            iv_col = 'implied_volatility' if 'implied_volatility' in df.columns else None
            df['gamma'] = df.apply(
                lambda row: self._calc_gamma(
                    spot_price,
                    row['strike'],
                    row['tte'],
                    row.get(iv_col, 0.25) if iv_col else 0.25
                ),
                axis=1
            )

        # Calculate GEX per contract (Dollar Gamma)
        # GEX = Gamma * OI * 100 * Spot
        # Gamma already has 1/S in its formula, so we multiply by S once to get dollar terms
        df['gex_per_strike'] = (
            df['gamma'] *
            df['open_interest'] *
            100 *  # Shares per contract
            spot_price  # Dollar gamma (single Spot, NOT Spot²)
        )

        # Dealer positioning adjustment
        # Dealers are SHORT options, so their gamma is opposite sign
        # Short call = negative gamma for dealer
        # Short put = positive gamma for dealer
        df['dealer_gex'] = np.where(
            df['is_call'],
            -df['gex_per_strike'] if self.DEALER_SHORT_CALLS else df['gex_per_strike'],
            df['gex_per_strike'] if self.DEALER_SHORT_PUTS else -df['gex_per_strike']
        )

        # Aggregate by strike
        gex_by_strike = df.groupby('strike')['dealer_gex'].sum().to_dict()

        # Total GEX
        call_gex = df[df['is_call']]['dealer_gex'].sum()
        put_gex = df[~df['is_call']]['dealer_gex'].sum()
        net_gex = call_gex + put_gex

        # Find gamma walls (strikes with highest GEX)
        # Call wall = highest gamma strike ABOVE spot (resistance)
        # Put wall = highest gamma strike BELOW spot (support)
        # NOTE: This finds single max-gamma strikes. True "walls" are zones of
        # concentrated gamma across multiple strikes. For zone detection, would
        # need to bin strikes and find peak zones. TODO for future enhancement.
        call_strikes = df[df['is_call']].groupby('strike')['gex_per_strike'].sum()
        put_strikes = df[~df['is_call']].groupby('strike')['gex_per_strike'].sum()

        # Filter to relevant strikes (above/below spot)
        call_strikes_above = call_strikes[call_strikes.index > spot_price]
        put_strikes_below = put_strikes[put_strikes.index < spot_price]

        # Return NaN if no valid wall found (not spot - that's semantically wrong)
        if len(call_strikes_above) > 0:
            max_call_wall = call_strikes_above.idxmax()
        elif len(call_strikes) > 0:
            max_call_wall = call_strikes.idxmax()  # Fallback to any call
        else:
            max_call_wall = float('nan')

        if len(put_strikes_below) > 0:
            max_put_wall = put_strikes_below.idxmax()
        elif len(put_strikes) > 0:
            max_put_wall = put_strikes.idxmax()  # Fallback to any put
        else:
            max_put_wall = float('nan')

        # Find zero gamma level (where cumulative GEX flips)
        zero_gamma = self._find_zero_gamma(gex_by_strike, spot_price)

        # Dealer position
        dealer_position = 'LONG_GAMMA' if net_gex > 0 else 'SHORT_GAMMA'

        return GammaExposure(
            net_gex=net_gex,
            call_gex=call_gex,
            put_gex=put_gex,
            zero_gamma_level=zero_gamma,
            max_call_wall=max_call_wall,
            max_put_wall=max_put_wall,
            dealer_position=dealer_position,
            gex_by_strike=gex_by_strike
        )

    def _calc_gamma(
        self,
        spot: float,
        strike: float,
        tte: float,
        iv: float
    ) -> float:
        """Calculate gamma using Black-Scholes."""
        greeks = black_scholes_greeks(spot, strike, tte, self.risk_free_rate, iv)
        return greeks['gamma']

    def _find_zero_gamma(
        self,
        gex_by_strike: Dict[float, float],
        spot: float
    ) -> float:
        """Find the strike where cumulative GEX crosses zero."""
        if not gex_by_strike:
            # No data - return NaN, not spot (semantically different)
            return float('nan')

        strikes = sorted(gex_by_strike.keys())
        cumulative = 0.0
        prev_cumulative = 0.0

        for i, strike in enumerate(strikes):
            prev_cumulative = cumulative
            cumulative += gex_by_strike[strike]

            # Check for sign flip (including zero crossings)
            # prev_cumulative and cumulative have opposite signs OR one is zero
            if i > 0:
                # Sign flip: prev and current have opposite signs
                sign_flip = (prev_cumulative > 0 and cumulative < 0) or \
                           (prev_cumulative < 0 and cumulative > 0)
                # Also catch exact zero crossings
                exact_zero = abs(cumulative) < 1e-10

                if sign_flip or exact_zero:
                    prev_strike = strikes[i-1]
                    denominator = cumulative - prev_cumulative

                    if abs(denominator) < 1e-10:
                        # Denominator too small, use midpoint
                        zero_level = (prev_strike + strike) / 2
                    else:
                        # Linear interpolation
                        zero_level = prev_strike + (strike - prev_strike) * (
                            -prev_cumulative / denominator
                        )
                    return zero_level

        return float('nan')  # No flip found - return NaN, not spot


# ============================================================================
# FEATURE GENERATOR
# ============================================================================

class GammaFeatures:
    """
    Generate gamma-based features from options chain data.

    Features:
    - net_gex: Net gamma exposure
    - gex_normalized: GEX as % of average daily volume
    - distance_to_call_wall: % distance to nearest call wall
    - distance_to_put_wall: % distance to nearest put wall
    - zero_gamma_distance: % distance to zero gamma level
    - dealer_position: 1 = long gamma (stable), 0 = short gamma (volatile)
    """

    def __init__(self, lag: int = 1):
        self.lag = lag
        self.calculator = GammaCalculator()

    def add_gamma_features(
        self,
        price_df: pd.DataFrame,
        options_chain_df: pd.DataFrame,
        price_col: str = 'close',
        volume_col: str = 'volume',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add gamma features to price DataFrame.

        Note: Options data is typically daily, so we forward-fill
        to match intraday price data frequency.

        Args:
            price_df: OHLCV DataFrame
            options_chain_df: Options chain with daily snapshots
            price_col: Price column name
            volume_col: Volume column name
            lag: Override default lag

        Returns:
            DataFrame with gamma features
        """
        result = price_df.copy()
        lag = lag if lag is not None else self.lag

        # Get unique dates in options data
        if 'date' not in options_chain_df.columns:
            if 'timestamp' in options_chain_df.columns:
                options_chain_df['date'] = pd.to_datetime(options_chain_df['timestamp']).dt.date
            else:
                logger.warning("Options data missing date column")
                return result

        # Calculate GEX for each date
        gex_records = []

        for date in options_chain_df['date'].unique():
            date_chain = options_chain_df[options_chain_df['date'] == date]

            # Get spot price for this date
            spot = result[result.index.date == date][price_col].iloc[0] if len(
                result[result.index.date == date]
            ) > 0 else None

            if spot is None:
                continue

            try:
                gex = self.calculator.calculate_gex(date_chain, spot, pd.Timestamp(date))
                gex_records.append({
                    'date': date,
                    'net_gex': gex.net_gex,
                    'call_gex': gex.call_gex,
                    'put_gex': gex.put_gex,
                    'zero_gamma_level': gex.zero_gamma_level,
                    'max_call_wall': gex.max_call_wall,
                    'max_put_wall': gex.max_put_wall,
                    'dealer_long_gamma': 1 if gex.dealer_position == 'LONG_GAMMA' else 0
                })
            except Exception as e:
                logger.warning(f"GEX calculation failed for {date}: {e}")

        if not gex_records:
            logger.warning("No GEX data calculated")
            return result

        gex_df = pd.DataFrame(gex_records)
        gex_df['date'] = pd.to_datetime(gex_df['date'])

        # Merge with price data (forward fill for intraday)
        # Handle both DatetimeIndex and non-datetime index cases
        if isinstance(result.index, pd.DatetimeIndex):
            result['date'] = result.index.date
            result['date'] = pd.to_datetime(result['date'])
        elif 'date' in result.columns:
            result['date'] = pd.to_datetime(result['date'])
        else:
            logger.warning("No datetime index or date column found, GEX merge may fail")
            result['date'] = pd.NaT

        result = result.merge(gex_df, on='date', how='left')
        result = result.ffill()  # Forward fill GEX values

        # Apply lag
        gex_cols = ['net_gex', 'call_gex', 'put_gex', 'zero_gamma_level',
                    'max_call_wall', 'max_put_wall', 'dealer_long_gamma']
        for col in gex_cols:
            if col in result.columns:
                result[col] = result[col].shift(lag)

        # Calculate derived features
        spot = result[price_col]
        # Floor spot at 0.01 to prevent division by zero (data corruption scenario)
        spot_safe = np.maximum(spot, 0.01)

        # Distance to walls (as % of spot)
        if 'max_call_wall' in result.columns:
            result['dist_to_call_wall'] = (result['max_call_wall'] - spot) / spot_safe
        if 'max_put_wall' in result.columns:
            result['dist_to_put_wall'] = (spot - result['max_put_wall']) / spot_safe
        if 'zero_gamma_level' in result.columns:
            result['dist_to_zero_gamma'] = (result['zero_gamma_level'] - spot) / spot_safe

        # GEX normalized by volume
        if volume_col in result.columns and 'net_gex' in result.columns:
            avg_vol = result[volume_col].rolling(20).mean()
            result['gex_normalized'] = result['net_gex'] / (avg_vol * spot + 1e-10)

        # GEX momentum (is dealer positioning changing?)
        if 'net_gex' in result.columns:
            result['gex_change_1d'] = result['net_gex'].pct_change()
            result['gex_zscore'] = (
                (result['net_gex'] - result['net_gex'].rolling(20).mean()) /
                (result['net_gex'].rolling(20).std() + 1e-10)
            )

        # Drop helper column
        if 'date' in result.columns:
            result = result.drop('date', axis=1)

        return result


# ============================================================================
# CONVENIENCE FUNCTION
# ============================================================================

def add_gamma_features(
    price_df: pd.DataFrame,
    options_chain_df: pd.DataFrame,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add gamma features to price data.

    Args:
        price_df: OHLCV price data
        options_chain_df: Options chain data with OI and Greeks
        lag: Lag for lookahead prevention

    Returns:
        DataFrame with gamma features
    """
    gamma_gen = GammaFeatures(lag=lag)
    return gamma_gen.add_gamma_features(price_df, options_chain_df)


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create synthetic options chain
    np.random.seed(42)
    spot = 450.0

    strikes = np.arange(400, 500, 5)

    options_data = []
    for strike in strikes:
        # Calls
        options_data.append({
            'strike': strike,
            'option_type': 'call',
            'open_interest': int(np.random.exponential(5000) * np.exp(-abs(strike - spot) / 20)),
            'implied_volatility': 0.20 + 0.1 * abs(strike - spot) / spot,
            'expiration': '2024-02-16'
        })
        # Puts
        options_data.append({
            'strike': strike,
            'option_type': 'put',
            'open_interest': int(np.random.exponential(3000) * np.exp(-abs(strike - spot) / 20)),
            'implied_volatility': 0.22 + 0.1 * abs(strike - spot) / spot,
            'expiration': '2024-02-16'
        })

    chain_df = pd.DataFrame(options_data)

    print("Sample options chain:")
    print(chain_df.head(10))

    # Calculate GEX
    calc = GammaCalculator()
    gex = calc.calculate_gex(chain_df, spot, pd.Timestamp('2024-01-15'))

    print(f"\n=== GEX Results ===")
    print(f"Net GEX:          ${gex.net_gex:,.0f}")
    print(f"Call GEX:         ${gex.call_gex:,.0f}")
    print(f"Put GEX:          ${gex.put_gex:,.0f}")
    print(f"Dealer Position:  {gex.dealer_position}")
    print(f"Zero Gamma Level: ${gex.zero_gamma_level:.2f}")
    print(f"Max Call Wall:    ${gex.max_call_wall:.0f}")
    print(f"Max Put Wall:     ${gex.max_put_wall:.0f}")

    print("\nGEX by strike (top 5):")
    sorted_gex = sorted(gex.gex_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)
    for strike, g in sorted_gex[:5]:
        print(f"  ${strike:.0f}: ${g:,.0f}")
