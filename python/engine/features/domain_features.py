#!/usr/bin/env python3
"""
Domain Features - Institutional Logic Harvested from option-machine.

These features encode domain knowledge that isn't obvious from raw OHLCV:
1. VIX Term Structure (from VolatilityIntelligence.ts)
2. Volatility Regime Signals
3. Options-derived features

IMPORTANT: Features must be computed with LAG to avoid lookahead bias.
"""

import logging
from typing import Optional
from enum import IntEnum

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.Domain")


# ============================================================================
# VIX TERM STRUCTURE FEATURES (from VolatilityIntelligence.ts)
# ============================================================================

class VolTermShape(IntEnum):
    """VIX term structure shape."""
    BACKWARDATION = 0  # VIX > VIX3M: Fear mode, mean reversion expected
    FLAT = 1           # VIX ≈ VIX3M: Transition zone
    CONTANGO = 2       # VIX3M > VIX: Normal state, low fear


class VolatilityFeatures:
    """
    VIX term structure and volatility regime features.

    Ported from VolatilityIntelligence.ts:
    - Term structure shape (backwardation/contango)
    - Vol crush/spike signals
    - VIX percentiles and z-scores
    """

    # VIX thresholds from option-machine
    VIX_SPIKE_THRESHOLD = 12   # Below this = complacency, spike coming
    VIX_FEAR_THRESHOLD = 25    # Above this = fear mode
    VIX_PANIC_THRESHOLD = 35   # Above this = extreme fear

    def __init__(self, lag: int = 1):
        """
        Initialize volatility features.

        Args:
            lag: Lag period for lookahead bias prevention (default 1)
        """
        self.lag = lag

    def add_vix_term_structure(
        self,
        df: pd.DataFrame,
        vix_col: str = 'vix',
        vix3m_col: str = 'vix3m',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add VIX term structure features.

        Ported from VolatilityIntelligence.ts:
        ```typescript
        if (vixSpot > vix3m) termShape = 'BACKWARDATION';
        else if (vix3m > vixSpot * 1.02) termShape = 'CONTANGO';
        ```

        Args:
            df: DataFrame with VIX data
            vix_col: Column name for VIX spot
            vix3m_col: Column name for VIX 3-month
            lag: Override default lag

        Returns:
            DataFrame with term structure features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if vix_col not in result.columns:
            logger.warning(f"VIX column '{vix_col}' not found")
            return result

        # Lag VIX to avoid lookahead
        vix = result[vix_col].shift(lag)

        # Term structure features (if VIX3M available)
        if vix3m_col in result.columns:
            vix3m = result[vix3m_col].shift(lag)

            # 1. Backwardation signal (VIX > VIX3M = fear)
            result['vix_backwardation'] = np.where(vix > vix3m, 1, 0)

            # 2. Term spread (VIX - VIX3M)
            result['vix_term_spread'] = vix - vix3m
            # Floor at 1% of VIX to prevent explosion when VIX3M is near zero
            vix3m_floor = np.maximum(vix3m, vix * 0.01)
            result['vix_term_spread_pct'] = (vix - vix3m) / vix3m_floor

            # 3. Contango signal (VIX3M > VIX * 1.02)
            result['vix_contango'] = np.where(vix3m > vix * 1.02, 1, 0)

            # 4. Term structure shape classification
            term_shape = pd.Series(VolTermShape.FLAT, index=df.index)
            term_shape[result['vix_backwardation'] == 1] = VolTermShape.BACKWARDATION
            term_shape[result['vix_contango'] == 1] = VolTermShape.CONTANGO
            result['vix_term_shape'] = term_shape.astype(int)

        # VIX level-based signals (from TS logic)

        # 5. Vol crush signal: Backwardation AND VIX > 25
        # When VIX is elevated AND in backwardation, vol crush is likely
        if 'vix_backwardation' in result.columns:
            result['vol_crush_signal'] = np.where(
                (result['vix_backwardation'] == 1) & (vix > self.VIX_FEAR_THRESHOLD),
                1, 0
            )

        # 6. Vol spike signal: Contango AND VIX < 12
        # Complacent market is vulnerable to spike
        if 'vix_contango' in result.columns:
            result['vol_spike_signal'] = np.where(
                (result['vix_contango'] == 1) & (vix < self.VIX_SPIKE_THRESHOLD),
                1, 0
            )

        # 7. VIX level zones
        result['vix_zone_complacent'] = (vix < self.VIX_SPIKE_THRESHOLD).astype(int)
        result['vix_zone_normal'] = (
            (vix >= self.VIX_SPIKE_THRESHOLD) & (vix < self.VIX_FEAR_THRESHOLD)
        ).astype(int)
        result['vix_zone_fear'] = (
            (vix >= self.VIX_FEAR_THRESHOLD) & (vix < self.VIX_PANIC_THRESHOLD)
        ).astype(int)
        result['vix_zone_panic'] = (vix >= self.VIX_PANIC_THRESHOLD).astype(int)

        return result

    def add_vix_dynamics(
        self,
        df: pd.DataFrame,
        vix_col: str = 'vix',
        lookback: int = 252,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add VIX dynamics features (velocity, percentile, z-score).

        Args:
            df: DataFrame with VIX data
            vix_col: Column name for VIX
            lookback: Rolling window for percentile/z-score
            lag: Override default lag

        Returns:
            DataFrame with VIX dynamics features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if vix_col not in result.columns:
            logger.warning(f"VIX column '{vix_col}' not found")
            return result

        vix = result[vix_col].shift(lag)

        # Floor VIX at 1 to prevent div/0 in pct_change
        # VIX < 1 is essentially never seen in practice
        vix_safe = np.maximum(vix, 1.0)

        # VIX velocity (rate of change)
        result['vix_velocity_1d'] = vix_safe.pct_change(1)
        result['vix_velocity_5d'] = vix_safe.pct_change(5)

        # VIX acceleration
        result['vix_accel'] = result['vix_velocity_1d'].diff(1)

        # VIX percentile (where in distribution)
        result['vix_percentile'] = vix.rolling(lookback).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
        )

        # VIX z-score
        vix_mean = vix.rolling(lookback).mean()
        vix_std = vix.rolling(lookback).std()
        # Floor std at 1% of mean to prevent explosion during low-volatility periods
        vix_std_floor = np.maximum(vix_std, vix_mean.abs() * 0.01)
        result['vix_zscore'] = ((vix - vix_mean) / vix_std_floor).clip(-10, 10)

        # VIX relative to rolling max/min
        vix_max = vix.rolling(lookback).max()
        vix_min = vix.rolling(lookback).min()
        vix_range = vix_max - vix_min
        # Floor range at 1% of mean to prevent explosion when VIX is flat
        vix_range_floor = np.maximum(vix_range, vix_mean.abs() * 0.01)
        result['vix_range_position'] = (vix - vix_min) / vix_range_floor

        return result


# ============================================================================
# OPTIONS-DERIVED FEATURES
# ============================================================================

class OptionsFeatures:
    """
    Features derived from options market data.

    Requires: Options OI, Greeks, term structure data.
    """

    def __init__(self, lag: int = 1):
        self.lag = lag

    def add_put_call_features(
        self,
        df: pd.DataFrame,
        pc_ratio_col: str = 'put_call_ratio',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add put/call ratio features.

        Args:
            df: DataFrame with put/call data
            pc_ratio_col: Column name for P/C ratio
            lag: Override default lag

        Returns:
            DataFrame with P/C features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if pc_ratio_col not in result.columns:
            return result

        pcr = result[pc_ratio_col].shift(lag)

        # P/C ratio zones
        result['pcr_bullish'] = (pcr > 1.2).astype(int)  # High put buying = contrarian bullish
        result['pcr_bearish'] = (pcr < 0.7).astype(int)  # High call buying = contrarian bearish

        # P/C velocity
        result['pcr_velocity'] = pcr.pct_change(5)

        # P/C percentile
        result['pcr_percentile'] = pcr.rolling(252).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
        )

        return result


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def add_domain_features(
    df: pd.DataFrame,
    vix_col: str = 'vix',
    vix3m_col: str = 'vix3m',
    lag: int = 1
) -> pd.DataFrame:
    """
    Add all domain features to a DataFrame.

    Args:
        df: DataFrame with price and VIX data
        vix_col: Column name for VIX
        vix3m_col: Column name for VIX 3-month
        lag: Lag period for lookahead prevention

    Returns:
        DataFrame with domain features added
    """
    result = df.copy()

    vol_features = VolatilityFeatures(lag=lag)

    # Add VIX term structure
    result = vol_features.add_vix_term_structure(result, vix_col, vix3m_col)

    # Add VIX dynamics
    result = vol_features.add_vix_dynamics(result, vix_col)

    return result


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample VIX data
    np.random.seed(42)
    n = 500

    dates = pd.date_range('2024-01-01', periods=n, freq='D')

    # Simulate VIX with some regime changes
    vix_base = 20 + np.cumsum(np.random.randn(n) * 0.5)
    vix = np.clip(vix_base, 10, 50)

    # VIX3M is usually higher (contango) but flips during stress
    vix3m = vix + np.random.randn(n) * 2 + 2  # Usually 2 points higher
    vix3m = np.clip(vix3m, 10, 45)

    df = pd.DataFrame({
        'timestamp': dates,
        'vix': vix,
        'vix3m': vix3m
    })

    # Add domain features
    result = add_domain_features(df, lag=1)

    print("Domain feature columns added:")
    domain_cols = [c for c in result.columns if c not in ['timestamp', 'vix', 'vix3m']]
    for col in domain_cols:
        print(f"  {col}")

    print(f"\nTotal domain features: {len(domain_cols)}")

    print("\nBackwardation count:", result['vix_backwardation'].sum())
    print("Contango count:", result['vix_contango'].sum())
    print("Vol crush signals:", result['vol_crush_signal'].sum())
    print("Vol spike signals:", result['vol_spike_signal'].sum())

    print("\nSample data:")
    print(result[['timestamp', 'vix', 'vix3m', 'vix_term_shape', 'vol_crush_signal', 'vol_spike_signal']].tail(10))
