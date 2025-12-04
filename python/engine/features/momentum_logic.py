#!/usr/bin/env python3
"""
Momentum Scoring Logic - Ported from MomentumScoringEngine.ts

Classifies assets into momentum states:
- ACCELERATING (strong momentum, score > 80)
- STEADY (moderate momentum, score 50-80)
- DYING (weak momentum, score < 50)

Original logic scored *positions*, we adapt to score *assets*.

IMPORTANT: Features must be computed with LAG to avoid lookahead bias.
"""

import logging
from typing import Optional
from enum import IntEnum

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.Momentum")


# ============================================================================
# MOMENTUM STATES (from MomentumScoringEngine.ts)
# ============================================================================

class TrendState(IntEnum):
    """Trend state classification from TS logic."""
    DYING = 0         # Score < 50 - Momentum fading
    STEADY = 1        # Score 50-80 - Stable trend
    ACCELERATING = 2  # Score > 80 - Strong momentum


# Score thresholds from MomentumScoringEngine.ts
# DYING: score < 50, STEADY: 50-80, ACCELERATING: > 80
SCORE_ACCELERATING = 80
SCORE_STEADY = 50  # This is the DYING threshold (below this = DYING)


# ============================================================================
# MOMENTUM SCORING
# ============================================================================

class MomentumScorer:
    """
    Momentum scoring logic ported from MomentumScoringEngine.ts.

    Original TS logic scored positions based on:
    - hoursHeld
    - currentPL
    - velocity (hourly pct change)

    We adapt this to score assets using fixed time windows.
    """

    # Velocity thresholds from TS (adapted for assets)
    VELOCITY_STRONG_THRESHOLD = 0.05  # 5% move = strong
    VELOCITY_MODERATE_THRESHOLD = 0.02  # 2% move = moderate
    VELOCITY_WEAK_THRESHOLD = 0.005  # 0.5% move = weak

    # Score points from TS logic
    POINTS_VELOCITY_STRONG = 30
    POINTS_VELOCITY_MODERATE = 15
    POINTS_VELOCITY_WEAK = 5

    def __init__(self, windows: list = None, lag: int = 1):
        """
        Initialize momentum scorer.

        Args:
            windows: Time windows in bars (default: [12, 60, 240] for 1h/5h/20h at 5min)
            lag: Lag period for lookahead prevention
        """
        self.windows = windows or [12, 60, 240]  # 1h, 5h, 20h at 5-min bars
        self.lag = lag

    def add_momentum_scores(
        self,
        df: pd.DataFrame,
        price_col: str = 'close',
        volume_col: str = 'volume',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add momentum scoring features.

        Ported from MomentumScoringEngine.ts computeMomentumScore()

        Args:
            df: DataFrame with price data
            price_col: Price column name
            volume_col: Volume column name
            lag: Override default lag

        Returns:
            DataFrame with momentum score features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        price = result[price_col]
        volume = result.get(volume_col, pd.Series(1, index=df.index))

        for w in self.windows:
            # Lagged price change for this window
            ret = price.pct_change(w).shift(lag)

            # 1. Raw velocity (% change)
            result[f'velocity_{w}'] = ret

            # 2. Velocity score (from TS logic)
            velocity_score = pd.Series(0.0, index=df.index)
            velocity_score[ret.abs() > self.VELOCITY_STRONG_THRESHOLD] = self.POINTS_VELOCITY_STRONG
            velocity_score[(ret.abs() > self.VELOCITY_MODERATE_THRESHOLD) &
                          (ret.abs() <= self.VELOCITY_STRONG_THRESHOLD)] = self.POINTS_VELOCITY_MODERATE
            velocity_score[(ret.abs() > self.VELOCITY_WEAK_THRESHOLD) &
                          (ret.abs() <= self.VELOCITY_MODERATE_THRESHOLD)] = self.POINTS_VELOCITY_WEAK
            result[f'velocity_score_{w}'] = velocity_score

            # 3. Direction-aware velocity score
            result[f'velocity_score_signed_{w}'] = velocity_score * np.sign(ret)

            # 4. Acceleration of velocity
            result[f'velocity_accel_{w}'] = ret.diff(w)

        # 5. Composite momentum score (average across windows)
        score_cols = [f'velocity_score_{w}' for w in self.windows]
        result['momentum_score_composite'] = result[score_cols].mean(axis=1)

        # 6. Trend state classification (from TS thresholds)
        # Handle NaN explicitly - NaN scores get -1 (invalid), not STEADY
        composite = result['momentum_score_composite']
        trend_state = pd.Series(-1, index=df.index)  # -1 = invalid/NaN

        # Only classify non-NaN values
        valid_mask = composite.notna()
        trend_state[valid_mask & (composite >= SCORE_ACCELERATING)] = TrendState.ACCELERATING
        trend_state[valid_mask & (composite >= SCORE_STEADY) & (composite < SCORE_ACCELERATING)] = TrendState.STEADY
        trend_state[valid_mask & (composite < SCORE_STEADY)] = TrendState.DYING

        result['trend_state'] = trend_state.astype(int)

        # 7. State one-hot encoding
        result['is_accelerating'] = (result['trend_state'] == TrendState.ACCELERATING).astype(int)
        result['is_steady'] = (result['trend_state'] == TrendState.STEADY).astype(int)
        result['is_dying'] = (result['trend_state'] == TrendState.DYING).astype(int)

        # 8. Momentum persistence (consecutive bars in same state)
        result['trend_state_persistence'] = (
            result['trend_state']
            .groupby((result['trend_state'] != result['trend_state'].shift()).cumsum())
            .cumcount() + 1
        )

        # 9. Volume-weighted momentum (from TS "Power" concept)
        if volume_col in result.columns:
            log_vol = np.log(volume.shift(lag) + 1)
            log_vol_mean = log_vol.rolling(60).mean()
            # Floor at 1% of log_vol to prevent explosion during low-volume periods
            log_vol_floor = np.maximum(log_vol_mean, log_vol * 0.01)
            result['momentum_power'] = result['momentum_score_composite'] * log_vol / np.maximum(log_vol_floor, 0.01)

        return result

    def add_relative_strength(
        self,
        df: pd.DataFrame,
        asset_col: str = 'close',
        benchmark_col: str = 'spy',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add relative strength (RS) features vs benchmark.

        RS > 1 = outperforming benchmark
        RS < 1 = underperforming benchmark

        Args:
            df: DataFrame with asset and benchmark prices
            asset_col: Asset price column
            benchmark_col: Benchmark price column
            lag: Override default lag

        Returns:
            DataFrame with relative strength features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if benchmark_col not in result.columns:
            return result

        asset = result[asset_col].shift(lag)
        benchmark = result[benchmark_col].shift(lag)

        for w in [20, 60, 120]:
            # Relative strength: asset return / benchmark return
            asset_ret = asset.pct_change(w)
            bench_ret = benchmark.pct_change(w)

            # RS ratio (avoid division by zero)
            # Floor denominator at 0.01 to prevent explosion during crashes
            bench_factor = np.maximum(1 + bench_ret, 0.01)
            result[f'rs_ratio_{w}'] = (1 + asset_ret) / bench_factor

            # RS momentum (is RS improving?)
            result[f'rs_momentum_{w}'] = result[f'rs_ratio_{w}'].pct_change(w)

            # RS percentile (where in distribution?)
            result[f'rs_percentile_{w}'] = result[f'rs_ratio_{w}'].rolling(252).apply(
                lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
            )

        return result


# ============================================================================
# MULTI-TIMEFRAME MOMENTUM
# ============================================================================

class MultiTimeframeMomentum:
    """
    Multi-timeframe momentum analysis.

    Combines momentum across multiple timeframes:
    - Short (1h): Intraday momentum
    - Medium (1d): Daily momentum
    - Long (1w): Weekly momentum

    Alignment = all timeframes agree = strong signal.
    """

    def __init__(self, lag: int = 1):
        self.lag = lag

    def add_mtf_momentum(
        self,
        df: pd.DataFrame,
        price_col: str = 'close',
        short_window: int = 12,   # 1h at 5-min
        medium_window: int = 78,  # 1d at 5-min
        long_window: int = 390,   # 1w at 5-min
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add multi-timeframe momentum features.

        Args:
            df: DataFrame with price data
            price_col: Price column
            short_window: Short-term window (bars)
            medium_window: Medium-term window (bars)
            long_window: Long-term window (bars)
            lag: Override default lag

        Returns:
            DataFrame with MTF momentum features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        price = result[price_col]

        # Calculate momentum at each timeframe
        short_mom = price.pct_change(short_window).shift(lag)
        medium_mom = price.pct_change(medium_window).shift(lag)
        long_mom = price.pct_change(long_window).shift(lag)

        result['mtf_short'] = short_mom
        result['mtf_medium'] = medium_mom
        result['mtf_long'] = long_mom

        # Direction at each timeframe
        result['mtf_short_up'] = (short_mom > 0).astype(int)
        result['mtf_medium_up'] = (medium_mom > 0).astype(int)
        result['mtf_long_up'] = (long_mom > 0).astype(int)

        # Alignment score (-3 to +3)
        result['mtf_alignment'] = (
            np.sign(short_mom) +
            np.sign(medium_mom) +
            np.sign(long_mom)
        )

        # Full bullish alignment
        result['mtf_full_bull'] = (result['mtf_alignment'] == 3).astype(int)

        # Full bearish alignment
        result['mtf_full_bear'] = (result['mtf_alignment'] == -3).astype(int)

        # Divergence: short vs long disagree
        result['mtf_divergence'] = (
            np.sign(short_mom) != np.sign(long_mom)
        ).astype(int)

        return result


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def add_momentum_features(
    df: pd.DataFrame,
    price_col: str = 'close',
    lag: int = 1
) -> pd.DataFrame:
    """
    Add all momentum features.

    Args:
        df: DataFrame with price data
        price_col: Price column
        lag: Lag period for lookahead prevention

    Returns:
        DataFrame with momentum features
    """
    result = df.copy()

    scorer = MomentumScorer(lag=lag)
    result = scorer.add_momentum_scores(result, price_col=price_col)

    mtf = MultiTimeframeMomentum(lag=lag)
    result = mtf.add_mtf_momentum(result, price_col=price_col)

    return result


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample price data
    np.random.seed(42)
    n = 500

    dates = pd.date_range('2024-01-01', periods=n, freq='5min')

    # Simulate trending price with some reversals
    returns = np.random.randn(n) * 0.002 + 0.0001
    close = 400 * np.exp(np.cumsum(returns))

    df = pd.DataFrame({
        'timestamp': dates,
        'close': close,
        'volume': np.random.randint(10000, 100000, n)
    })

    # Add momentum features
    result = add_momentum_features(df, lag=1)

    print("Momentum feature columns added:")
    mom_cols = [c for c in result.columns if c not in ['timestamp', 'close', 'volume']]
    for col in sorted(mom_cols):
        print(f"  {col}")

    print(f"\nTotal momentum features: {len(mom_cols)}")

    print("\nTrend state distribution:")
    print(result['trend_state'].value_counts().sort_index())

    print("\nSample data:")
    print(result[['timestamp', 'close', 'momentum_score_composite', 'trend_state', 'mtf_alignment']].tail(10))
