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
    Calculate Black-Scholes Greeks including second-order Greeks.

    Returns dict with: delta, gamma, theta, vega, vanna, charm

    Second-order Greeks:
    - Vanna: dDelta/dIV = dVega/dSpot - How delta changes with volatility
    - Charm: dDelta/dTime - How delta decays over time (delta bleed)

    These drive MECHANICAL dealer hedging flows:
    - When IV spikes, dealers must adjust delta hedges (vanna flow)
    - As time passes, delta changes and dealers must rebalance (charm flow)
    """
    # Validate inputs - all must be positive to avoid div/0 and log(negative)
    if spot <= 0 or strike <= 0 or tte <= 0 or iv <= 0:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0, 'vanna': 0, 'charm': 0}

    sqrt_t = np.sqrt(tte)
    # Avoid division by zero: check iv * sqrt_t > 0
    denominator = iv * sqrt_t
    if denominator <= 1e-12:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0, 'vanna': 0, 'charm': 0}

    d1 = (np.log(spot / strike) + (rate + 0.5 * iv**2) * tte) / denominator
    d2 = d1 - iv * sqrt_t
    phi_d1 = norm.pdf(d1)

    # Gamma (same for calls and puts)
    # Avoid division by zero: check spot * iv * sqrt_t > 0
    gamma_denominator = spot * iv * sqrt_t
    if gamma_denominator <= 1e-12:
        gamma = 0
    else:
        gamma = phi_d1 / gamma_denominator

    # Delta
    if is_call:
        delta = norm.cdf(d1)
    else:
        delta = norm.cdf(d1) - 1

    # Vega (same for calls and puts)
    # NOTE: Vega is normalized to per-1%-IV change (divided by 100)
    # This is different from gamma which is per-$1 move in underlying
    # If mixing Greeks, ensure consistent scaling. Gamma is NOT normalized.
    vega = spot * phi_d1 * sqrt_t / 100  # $ per 1% IV change

    # Theta
    theta_common = -(spot * phi_d1 * iv) / (2 * sqrt_t)
    if is_call:
        theta = theta_common - rate * strike * np.exp(-rate * tte) * norm.cdf(d2)
    else:
        theta = theta_common + rate * strike * np.exp(-rate * tte) * norm.cdf(-d2)
    theta = theta / 365  # Per day

    # ==========================================================================
    # SECOND-ORDER GREEKS - THE MECHANICAL EDGE
    # ==========================================================================

    # Vanna: dDelta/dIV = dVega/dSpot
    # Vanna = phi(d1) * sqrt(T) * (1 - d1 / (sigma * sqrt(T)))
    # Same for calls and puts
    # Measures how delta changes when IV changes - drives vol-spike hedging flows
    vanna = phi_d1 * sqrt_t * (1 - d1 / (iv * sqrt_t)) if iv * sqrt_t > 1e-12 else 0

    # Charm: dDelta/dTime (delta decay/bleed)
    # For calls: charm = -phi(d1) * (2*r*T - d2*sigma*sqrt(T)) / (2*T*sigma*sqrt(T))
    # For puts: charm_put = charm_call (same formula, different sign convention)
    # Measures daily delta decay - drives EOD and expiration hedging flows
    charm_denom = 2 * tte * iv * sqrt_t
    if abs(charm_denom) > 1e-12:
        charm = -phi_d1 * (2 * rate * tte - d2 * iv * sqrt_t) / charm_denom
    else:
        charm = 0
    charm = charm / 365  # Per day (like theta)

    return {
        'delta': delta,
        'gamma': gamma,
        'theta': theta,
        'vega': vega,
        'vanna': vanna,
        'charm': charm
    }


# ============================================================================
# GEX CALCULATOR
# ============================================================================

@dataclass
class GammaExposure:
    """
    Greeks exposure calculation result.

    Includes first-order (GEX) and second-order (VEX, CEX) exposures.

    GEX (Gamma Exposure): How much dealers must hedge for a $1 move
    VEX (Vanna Exposure): How much delta changes if IV moves 1%
    CEX (Charm Exposure): How much delta decays per day

    These drive MECHANICAL flows:
    - GEX: Dealers hedge gamma → mean reversion vs momentum
    - VEX: Vol spike → forced delta adjustment → predictable flow
    - CEX: Time decay → EOD/expiration flows → predictable rebalancing
    """
    # Gamma Exposure (first-order)
    net_gex: float                    # Net gamma exposure (notional $)
    call_gex: float                   # Call gamma exposure
    put_gex: float                    # Put gamma exposure
    zero_gamma_level: float           # Price where GEX flips sign
    max_call_wall: float              # Strike with highest call gamma
    max_put_wall: float               # Strike with highest put gamma
    dealer_position: str              # 'LONG_GAMMA' or 'SHORT_GAMMA'
    gex_by_strike: Dict[float, float] # GEX at each strike

    # Vanna Exposure (second-order) - NEW
    net_vex: float = 0.0              # Net vanna exposure (delta change per 1% IV)
    call_vex: float = 0.0             # Call vanna exposure
    put_vex: float = 0.0              # Put vanna exposure
    vex_by_strike: Dict[float, float] = None  # VEX at each strike

    # Charm Exposure (second-order) - NEW
    net_cex: float = 0.0              # Net charm exposure (delta decay per day)
    call_cex: float = 0.0             # Call charm exposure
    put_cex: float = 0.0              # Put charm exposure
    cex_by_strike: Dict[float, float] = None  # CEX at each strike

    def __post_init__(self):
        if self.vex_by_strike is None:
            self.vex_by_strike = {}
        if self.cex_by_strike is None:
            self.cex_by_strike = {}


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

        # Calculate Greeks if not provided
        iv_col = 'implied_volatility' if 'implied_volatility' in df.columns else None

        if 'gamma' not in df.columns or 'vanna' not in df.columns or 'charm' not in df.columns:
            # Calculate all Greeks at once for efficiency
            def calc_all_greeks(row):
                iv = row.get(iv_col, 0.25) if iv_col else 0.25
                return black_scholes_greeks(
                    spot_price,
                    row['strike'],
                    row['tte'],
                    self.risk_free_rate,
                    iv,
                    row['is_call']
                )

            greeks_df = df.apply(calc_all_greeks, axis=1, result_type='expand')

            if 'gamma' not in df.columns:
                df['gamma'] = greeks_df['gamma'].fillna(0)
            if 'vanna' not in df.columns:
                df['vanna'] = greeks_df['vanna'].fillna(0)
            if 'charm' not in df.columns:
                df['charm'] = greeks_df['charm'].fillna(0)

        # Ensure no NaN values
        df['gamma'] = df['gamma'].fillna(0)
        df['vanna'] = df['vanna'].fillna(0)
        df['charm'] = df['charm'].fillna(0)

        # Calculate GEX per contract (Dollar Gamma)
        # GEX = Gamma * OI * 100 * Spot
        # Gamma already has 1/S in its formula, so we multiply by S once to get dollar terms
        # Ensure spot_price is positive to avoid invalid calculations
        if spot_price <= 0:
            raise ValueError(f"spot_price must be positive, got {spot_price}")
        
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

        # ======================================================================
        # VEX (Vanna Exposure) - How delta changes if IV moves 1%
        # ======================================================================
        # VEX = Vanna * OI * 100
        # Vanna is dDelta/dIV, so VEX tells us: if IV moves 1%, how much
        # delta do dealers need to hedge?
        df['vex_per_strike'] = (
            df['vanna'] *
            df['open_interest'] *
            100  # Shares per contract
        )

        # Dealer VEX (same sign logic as GEX)
        df['dealer_vex'] = np.where(
            df['is_call'],
            -df['vex_per_strike'] if self.DEALER_SHORT_CALLS else df['vex_per_strike'],
            df['vex_per_strike'] if self.DEALER_SHORT_PUTS else -df['vex_per_strike']
        )

        vex_by_strike = df.groupby('strike')['dealer_vex'].sum().to_dict()
        call_vex = df[df['is_call']]['dealer_vex'].sum()
        put_vex = df[~df['is_call']]['dealer_vex'].sum()
        net_vex = call_vex + put_vex

        # ======================================================================
        # CEX (Charm Exposure) - How delta decays per day
        # ======================================================================
        # CEX = Charm * OI * 100
        # Charm is dDelta/dTime, so CEX tells us: how much delta decays
        # each day that dealers must rebalance?
        df['cex_per_strike'] = (
            df['charm'] *
            df['open_interest'] *
            100  # Shares per contract
        )

        # Dealer CEX (same sign logic as GEX)
        df['dealer_cex'] = np.where(
            df['is_call'],
            -df['cex_per_strike'] if self.DEALER_SHORT_CALLS else df['cex_per_strike'],
            df['cex_per_strike'] if self.DEALER_SHORT_PUTS else -df['cex_per_strike']
        )

        cex_by_strike = df.groupby('strike')['dealer_cex'].sum().to_dict()
        call_cex = df[df['is_call']]['dealer_cex'].sum()
        put_cex = df[~df['is_call']]['dealer_cex'].sum()
        net_cex = call_cex + put_cex

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
            # First-order (Gamma)
            net_gex=net_gex,
            call_gex=call_gex,
            put_gex=put_gex,
            zero_gamma_level=zero_gamma,
            max_call_wall=max_call_wall,
            max_put_wall=max_put_wall,
            dealer_position=dealer_position,
            gex_by_strike=gex_by_strike,
            # Second-order (Vanna)
            net_vex=net_vex,
            call_vex=call_vex,
            put_vex=put_vex,
            vex_by_strike=vex_by_strike,
            # Second-order (Charm)
            net_cex=net_cex,
            call_cex=call_cex,
            put_cex=put_cex,
            cex_by_strike=cex_by_strike
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
    Generate Greeks exposure features from options chain data.

    First-Order Features (Gamma):
    - net_gex: Net gamma exposure
    - gex_normalized: GEX as % of average daily volume
    - distance_to_call_wall: % distance to nearest call wall
    - distance_to_put_wall: % distance to nearest put wall
    - zero_gamma_distance: % distance to zero gamma level
    - dealer_position: 1 = long gamma (stable), 0 = short gamma (volatile)

    Second-Order Features (Vanna/Charm) - NEW:
    - net_vex: Net vanna exposure (delta change per 1% IV move)
    - vex_normalized: VEX as % of average daily volume
    - vex_zscore: How extreme is current VEX vs 20-day history
    - net_cex: Net charm exposure (delta decay per day)
    - cex_normalized: CEX as % of average daily volume
    - cex_zscore: How extreme is current CEX vs 20-day history

    Why these matter:
    - VEX predicts flows during vol spikes/drops (mechanical hedging)
    - CEX predicts EOD and expiration flows (time decay hedging)
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

        # Pre-compute spot prices for all dates (thread-safe lookup)
        unique_dates = options_chain_df['date'].unique()
        spot_by_date = {}
        for date in unique_dates:
            matches = result[result.index.date == date]
            if len(matches) > 0:
                spot_by_date[date] = matches[price_col].iloc[0]

        # Pre-group options data by date for parallel processing
        options_by_date = {date: options_chain_df[options_chain_df['date'] == date]
                          for date in unique_dates}

        def calc_gex_for_date(date):
            """Calculate GEX for a single date - designed for parallel execution."""
            spot = spot_by_date.get(date)
            if spot is None:
                return None
            date_chain = options_by_date[date]
            try:
                gex = self.calculator.calculate_gex(date_chain, spot, pd.Timestamp(date))
                return {
                    'date': date,
                    # First-order (Gamma)
                    'net_gex': gex.net_gex,
                    'call_gex': gex.call_gex,
                    'put_gex': gex.put_gex,
                    'zero_gamma_level': gex.zero_gamma_level,
                    'max_call_wall': gex.max_call_wall,
                    'max_put_wall': gex.max_put_wall,
                    'dealer_long_gamma': 1 if gex.dealer_position == 'LONG_GAMMA' else 0,
                    # Second-order (Vanna)
                    'net_vex': gex.net_vex,
                    'call_vex': gex.call_vex,
                    'put_vex': gex.put_vex,
                    # Second-order (Charm)
                    'net_cex': gex.net_cex,
                    'call_cex': gex.call_cex,
                    'put_cex': gex.put_cex,
                }
            except Exception as e:
                logger.warning(f"GEX calculation failed for {date}: {e}")
                return None

        # Parallel GEX calculation for M4 Pro (14 cores)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=12) as executor:
            gex_records = list(filter(None, executor.map(calc_gex_for_date, unique_dates)))

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

        # Apply lag to all exposure columns
        exposure_cols = [
            # First-order
            'net_gex', 'call_gex', 'put_gex', 'zero_gamma_level',
            'max_call_wall', 'max_put_wall', 'dealer_long_gamma',
            # Second-order
            'net_vex', 'call_vex', 'put_vex',
            'net_cex', 'call_cex', 'put_cex'
        ]
        for col in exposure_cols:
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

        # ======================================================================
        # VEX (Vanna Exposure) Features - NEW
        # ======================================================================
        if 'net_vex' in result.columns:
            # VEX normalized by volume
            if volume_col in result.columns:
                avg_vol = result[volume_col].rolling(20).mean()
                result['vex_normalized'] = result['net_vex'] / (avg_vol * spot + 1e-10)

            # VEX z-score (how extreme is current vanna exposure?)
            result['vex_zscore'] = (
                (result['net_vex'] - result['net_vex'].rolling(20).mean()) /
                (result['net_vex'].rolling(20).std() + 1e-10)
            )

            # VEX momentum
            result['vex_change_1d'] = result['net_vex'].pct_change()

        # ======================================================================
        # CEX (Charm Exposure) Features - NEW
        # ======================================================================
        if 'net_cex' in result.columns:
            # CEX normalized by volume
            if volume_col in result.columns:
                avg_vol = result[volume_col].rolling(20).mean()
                result['cex_normalized'] = result['net_cex'] / (avg_vol * spot + 1e-10)

            # CEX z-score (how extreme is current charm exposure?)
            result['cex_zscore'] = (
                (result['net_cex'] - result['net_cex'].rolling(20).mean()) /
                (result['net_cex'].rolling(20).std() + 1e-10)
            )

            # CEX momentum
            result['cex_change_1d'] = result['net_cex'].pct_change()

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

    print(f"\n=== GEX Results (First-Order: Gamma) ===")
    print(f"Net GEX:          ${gex.net_gex:,.0f}")
    print(f"Call GEX:         ${gex.call_gex:,.0f}")
    print(f"Put GEX:          ${gex.put_gex:,.0f}")
    print(f"Dealer Position:  {gex.dealer_position}")
    print(f"Zero Gamma Level: ${gex.zero_gamma_level:.2f}")
    print(f"Max Call Wall:    ${gex.max_call_wall:.0f}")
    print(f"Max Put Wall:     ${gex.max_put_wall:.0f}")

    print(f"\n=== VEX Results (Second-Order: Vanna) ===")
    print(f"Net VEX:          ${gex.net_vex:,.0f}")
    print(f"Call VEX:         ${gex.call_vex:,.0f}")
    print(f"Put VEX:          ${gex.put_vex:,.0f}")
    print("(VEX = Vanna * OI * 100 - predicts flows during IV changes)")

    print(f"\n=== CEX Results (Second-Order: Charm) ===")
    print(f"Net CEX:          ${gex.net_cex:,.0f}")
    print(f"Call CEX:         ${gex.call_cex:,.0f}")
    print(f"Put CEX:          ${gex.put_cex:,.0f}")
    print("(CEX = Charm * OI * 100 - predicts EOD/expiration flows)")

    print("\nGEX by strike (top 5):")
    sorted_gex = sorted(gex.gex_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)
    for strike, g in sorted_gex[:5]:
        print(f"  ${strike:.0f}: ${g:,.0f}")

    print("\nVEX by strike (top 5):")
    sorted_vex = sorted(gex.vex_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)
    for strike, v in sorted_vex[:5]:
        print(f"  ${strike:.0f}: ${v:,.0f}")

    print("\nCEX by strike (top 5):")
    sorted_cex = sorted(gex.cex_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)
    for strike, c in sorted_cex[:5]:
        print(f"  ${strike:.0f}: ${c:,.0f}")
