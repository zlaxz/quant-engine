#!/usr/bin/env python3
"""
Regime Analyzer - Ported from option-machine TypeScript.

Classifies market regime based on:
1. VIX level (volatility environment)
2. SPY trend (bull/bear/neutral via MA crossovers)
3. Sector correlation (risk-on/risk-off)

Original: src/services/LiveRegimeAnalyzer.ts
Source: option-machine repo (untested, ported as design)

IMPORTANT: These features must be computed with a LAG to avoid lookahead bias.
The regime at time T should only use data available at T-1.
"""

import logging
from typing import Tuple, Optional
from enum import IntEnum

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.Regime")


class VIXRegime(IntEnum):
    """VIX-based volatility regime."""
    PAUSE = 0       # VIX > 35: Too dangerous, no new entries
    SUBOPTIMAL = 1  # VIX 28-35 or VIX < 15: Defensive
    OPTIMAL = 2     # VIX 15-28: Normal trading environment


class TrendRegime(IntEnum):
    """SPY trend regime based on MA alignment."""
    STRONG_DOWN = 0  # Price < SMA20 < SMA50 < SMA200, momentum < -2%
    DOWN = 1         # Price < SMA20 < SMA50 < SMA200
    NEUTRAL = 2      # Mixed MA alignment
    UP = 3           # Price > SMA20 > SMA50 > SMA200
    STRONG_UP = 4    # Price > SMA20 > SMA50 > SMA200, momentum > 2%


class CombinedRegime(IntEnum):
    """Combined regime classification (4 states for simplicity)."""
    BEAR_QUIET = 0      # Down trend, low vol
    BEAR_VOLATILE = 1   # Down trend, high vol
    BULL_QUIET = 2      # Up trend, low vol
    BULL_VOLATILE = 3   # Up trend, high vol


class RegimeAnalyzer:
    """
    Analyzes market regime from SPY and VIX data.

    Features generated:
    - regime_vix: VIX-based regime (0=PAUSE, 1=SUBOPTIMAL, 2=OPTIMAL)
    - regime_trend: Trend regime (0=STRONG_DOWN to 4=STRONG_UP)
    - regime_combined: Combined 4-state regime
    - vix_level: Current VIX level
    - vix_percentile: VIX percentile over rolling window
    - spy_trend_strength: How aligned the MAs are (0-1)
    - position_size_mult: Suggested position sizing multiplier
    """

    # VIX thresholds (from LiveRegimeAnalyzer.ts)
    VIX_OPTIMAL_LOW = 15
    VIX_OPTIMAL_HIGH = 28
    VIX_PAUSE_THRESHOLD = 35

    # Trend thresholds
    MOMENTUM_STRONG_THRESHOLD = 0.02  # 2% above SMA20 for "strong"

    def __init__(
        self,
        sma_short: int = 20,
        sma_mid: int = 50,
        sma_long: int = 200,
        vix_lookback: int = 252  # 1 year for VIX percentile
    ):
        """
        Initialize regime analyzer.

        Args:
            sma_short: Short-term SMA period (default 20)
            sma_mid: Mid-term SMA period (default 50)
            sma_long: Long-term SMA period (default 200)
            vix_lookback: Lookback for VIX percentile (default 252)
        """
        self.sma_short = sma_short
        self.sma_mid = sma_mid
        self.sma_long = sma_long
        self.vix_lookback = vix_lookback

    def add_regime_features(
        self,
        df: pd.DataFrame,
        spy_col: str = 'close',
        vix_col: str = 'vix',
        lag: int = 1
    ) -> pd.DataFrame:
        """
        Add regime features to a DataFrame.

        Args:
            df: DataFrame with SPY price data
            spy_col: Column name for SPY close price
            vix_col: Column name for VIX level (optional, will skip if missing)
            lag: Lag period to avoid lookahead bias (default 1)

        Returns:
            DataFrame with regime features added
        """
        result = df.copy()

        # Calculate trend regime from SPY
        result = self._add_trend_features(result, spy_col, lag)

        # Calculate VIX regime if VIX data available
        if vix_col in result.columns:
            result = self._add_vix_features(result, vix_col, lag)
            result = self._add_combined_regime(result, lag)
        else:
            logger.warning(f"VIX column '{vix_col}' not found, skipping VIX features")

        return result

    def _add_trend_features(
        self,
        df: pd.DataFrame,
        price_col: str,
        lag: int
    ) -> pd.DataFrame:
        """Add trend-based regime features."""
        close = df[price_col]

        # Calculate SMAs
        sma_short = close.rolling(self.sma_short).mean()
        sma_mid = close.rolling(self.sma_mid).mean()
        sma_long = close.rolling(self.sma_long).mean()

        # Store SMAs (lagged)
        df['sma_20'] = sma_short.shift(lag)
        df['sma_50'] = sma_mid.shift(lag)
        df['sma_200'] = sma_long.shift(lag)

        # Momentum (distance from SMA20 as percentage)
        # Floor at 0.1% of close to prevent explosion during warm-up
        sma_floor = np.maximum(sma_short, close * 0.001)
        momentum = (close - sma_short) / sma_floor
        df['momentum_sma20'] = momentum.shift(lag)

        # Determine trend alignment (lagged)
        price_lagged = close.shift(lag)
        sma_short_lagged = sma_short.shift(lag)
        sma_mid_lagged = sma_mid.shift(lag)
        sma_long_lagged = sma_long.shift(lag)
        momentum_lagged = momentum.shift(lag)

        # Bull alignment: price > sma20 > sma50 > sma200
        bull_aligned = (
            (price_lagged > sma_short_lagged) &
            (sma_short_lagged > sma_mid_lagged) &
            (sma_mid_lagged > sma_long_lagged)
        )

        # Bear alignment: price < sma20 < sma50 < sma200
        bear_aligned = (
            (price_lagged < sma_short_lagged) &
            (sma_short_lagged < sma_mid_lagged) &
            (sma_mid_lagged < sma_long_lagged)
        )

        # Strong momentum
        strong_up = bull_aligned & (momentum_lagged > self.MOMENTUM_STRONG_THRESHOLD)
        strong_down = bear_aligned & (momentum_lagged < -self.MOMENTUM_STRONG_THRESHOLD)

        # Classify trend regime
        regime = pd.Series(TrendRegime.NEUTRAL, index=df.index)
        regime[bull_aligned] = TrendRegime.UP
        regime[bear_aligned] = TrendRegime.DOWN
        regime[strong_up] = TrendRegime.STRONG_UP
        regime[strong_down] = TrendRegime.STRONG_DOWN

        df['regime_trend'] = regime.astype(int)

        # Trend strength (0-1 based on how aligned MAs are)
        # Full alignment = 1, no alignment = 0
        align_score = (
            (price_lagged > sma_short_lagged).astype(int) +
            (sma_short_lagged > sma_mid_lagged).astype(int) +
            (sma_mid_lagged > sma_long_lagged).astype(int)
        ) / 3

        # For downtrends, flip the score
        df['trend_strength'] = np.where(
            price_lagged < sma_short_lagged,
            1 - align_score,  # Bear strength
            align_score       # Bull strength
        )

        # Binary trend indicator
        df['is_uptrend'] = (df['regime_trend'] >= TrendRegime.UP).astype(int)
        df['is_downtrend'] = (df['regime_trend'] <= TrendRegime.DOWN).astype(int)

        return df

    def _add_vix_features(
        self,
        df: pd.DataFrame,
        vix_col: str,
        lag: int
    ) -> pd.DataFrame:
        """Add VIX-based regime features."""
        vix = df[vix_col].shift(lag)  # Lag to avoid lookahead

        # VIX level
        df['vix_level'] = vix

        # VIX regime classification
        regime = pd.Series(VIXRegime.OPTIMAL, index=df.index)
        regime[vix >= self.VIX_PAUSE_THRESHOLD] = VIXRegime.PAUSE
        regime[(vix > self.VIX_OPTIMAL_HIGH) & (vix < self.VIX_PAUSE_THRESHOLD)] = VIXRegime.SUBOPTIMAL
        regime[vix < self.VIX_OPTIMAL_LOW] = VIXRegime.SUBOPTIMAL  # Complacency

        df['regime_vix'] = regime.astype(int)

        # VIX percentile (where does current VIX sit in recent history)
        df['vix_percentile'] = vix.rolling(self.vix_lookback).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
        )

        # VIX change (regime transition indicator)
        # Floor VIX at 1 to prevent div/0 in pct_change (VIX < 1 never happens in practice)
        vix_safe = np.maximum(vix, 1.0)
        df['vix_change_1d'] = vix_safe.pct_change()
        df['vix_change_5d'] = vix_safe.pct_change(5)

        # Position size multiplier based on VIX regime
        df['position_size_mult'] = pd.Series(1.0, index=df.index)
        df.loc[df['regime_vix'] == VIXRegime.SUBOPTIMAL, 'position_size_mult'] = 0.5
        df.loc[df['regime_vix'] == VIXRegime.PAUSE, 'position_size_mult'] = 0.0

        return df

    def _add_combined_regime(
        self,
        df: pd.DataFrame,
        lag: int
    ) -> pd.DataFrame:
        """Add combined 4-state regime classification."""
        # Check for NaN in underlying data - set combined regime to -1 (invalid) if data missing
        # During warm-up, SMAs are NaN but regime defaults to NEUTRAL - this is a false positive
        # We need to check if the actual SMA data is valid, not just the regime values
        sma_valid = df['sma_200'].notna()  # SMA200 is the slowest, so first to be valid
        vix_valid = df['vix_level'].notna()
        valid_mask = sma_valid & vix_valid

        # Combine trend and vol into 4 states
        # NEUTRAL should NOT be classified as bull - it's neutral
        is_bull = df['regime_trend'] > TrendRegime.NEUTRAL
        is_high_vol = df['regime_vix'] != VIXRegime.OPTIMAL

        # Initialize with -1 (invalid) for NaN rows
        regime = pd.Series(-1, index=df.index)

        # Only classify valid rows
        regime[valid_mask & is_bull & ~is_high_vol] = CombinedRegime.BULL_QUIET
        regime[valid_mask & is_bull & is_high_vol] = CombinedRegime.BULL_VOLATILE
        regime[valid_mask & ~is_bull & ~is_high_vol] = CombinedRegime.BEAR_QUIET
        regime[valid_mask & ~is_bull & is_high_vol] = CombinedRegime.BEAR_VOLATILE

        df['regime_combined'] = regime.astype(int)

        # One-hot encode for ML compatibility
        for r in CombinedRegime:
            df[f'regime_{r.name.lower()}'] = (regime == r).astype(int)

        return df

    def compute_sector_correlation(
        self,
        sector_returns: pd.DataFrame,
        window: int = 20
    ) -> pd.Series:
        """
        Compute average pairwise correlation among sector ETFs.

        High correlation (>0.7) indicates risk-off / correlated selloff.
        Low correlation indicates normal diversification.

        Args:
            sector_returns: DataFrame with sector ETF returns as columns
            window: Rolling window for correlation calculation

        Returns:
            Series with average pairwise correlation
        """
        n_sectors = len(sector_returns.columns)
        if n_sectors < 2:
            return pd.Series(0.5, index=sector_returns.index)

        # Validate window size
        if window > len(sector_returns):
            logger.warning(f"Window {window} > data length {len(sector_returns)}, returning NaN")
            return pd.Series(np.nan, index=sector_returns.index)

        # Rolling correlation matrix
        correlations = []

        for i in range(len(sector_returns) - window + 1):
            window_data = sector_returns.iloc[i:i + window]
            corr_matrix = window_data.corr()

            # Average of upper triangle (excluding diagonal)
            mask = np.triu(np.ones_like(corr_matrix, dtype=bool), k=1)
            avg_corr = corr_matrix.where(mask).stack().mean()
            correlations.append(avg_corr)

        # Pad beginning with NaN
        result = pd.Series(
            [np.nan] * (window - 1) + correlations,
            index=sector_returns.index
        )

        return result


# ============================================================================
# CONVENIENCE FUNCTION
# ============================================================================

def add_regime_features(
    df: pd.DataFrame,
    vix_data: Optional[pd.Series] = None,
    spy_col: str = 'close',
    lag: int = 1
) -> pd.DataFrame:
    """
    Convenience function to add regime features.

    Args:
        df: DataFrame with price data
        vix_data: Optional VIX series (will be joined by index)
        spy_col: Column name for SPY close price
        lag: Lag period for lookahead bias prevention

    Returns:
        DataFrame with regime features added
    """
    result = df.copy()

    if vix_data is not None:
        result['vix'] = vix_data

    analyzer = RegimeAnalyzer()
    return analyzer.add_regime_features(result, spy_col=spy_col, lag=lag)


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample SPY data
    np.random.seed(42)
    n = 500

    dates = pd.date_range('2024-01-01', periods=n, freq='D')

    # Simulate a trending market with some volatility regimes
    returns = np.random.randn(n) * 0.01 + 0.0002  # Slight upward drift
    close = 400 * np.exp(np.cumsum(returns))

    # Simulate VIX (inverse correlation with market)
    vix = 20 - returns * 500 + np.random.randn(n) * 2
    vix = np.clip(vix, 10, 50)

    df = pd.DataFrame({
        'timestamp': dates,
        'open': close * (1 - np.random.rand(n) * 0.005),
        'high': close * (1 + np.random.rand(n) * 0.01),
        'low': close * (1 - np.random.rand(n) * 0.01),
        'close': close,
        'volume': np.random.randint(100000, 1000000, n),
        'vix': vix
    })

    # Add regime features
    result = add_regime_features(df, lag=1)

    print("Regime feature columns added:")
    regime_cols = [c for c in result.columns if 'regime' in c or 'vix' in c or 'sma' in c or 'trend' in c]
    for col in regime_cols:
        print(f"  {col}")

    print("\nTrend regime distribution:")
    print(result['regime_trend'].value_counts().sort_index())

    print("\nVIX regime distribution:")
    print(result['regime_vix'].value_counts().sort_index())

    print("\nCombined regime distribution:")
    print(result['regime_combined'].value_counts().sort_index())

    print("\nSample data:")
    print(result[['timestamp', 'close', 'vix', 'regime_trend', 'regime_vix', 'regime_combined']].tail(10))
