#!/usr/bin/env python3
"""
Sector Regime Intelligence - Ported from SectorRegimeIntelligence.ts

Classifies sector regimes and detects rotation:
- PARABOLIC_BULL: Extreme momentum + outperformance
- BULL: Strong momentum + outperformance
- NEUTRAL: No clear trend
- BEAR: Weak momentum + underperformance
- CRASH: Extreme weakness

Key features:
1. Multi-timeframe momentum (20d, 60d, 120d)
2. Relative strength vs SPY
3. Trend quality (higher highs/lows)
4. Institutional flow estimation
5. Rotation signal detection

IMPORTANT: Features must be computed with LAG to avoid lookahead bias.
"""

import logging
from typing import List, Dict, Tuple, Optional
from enum import IntEnum

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.SectorRegime")


# ============================================================================
# SECTOR REGIME STATES (from TypeScript)
# ============================================================================

class SectorRegimeState(IntEnum):
    """Sector regime classification from TS logic."""
    CRASH = 0          # Extreme weakness, compositeScore < 25
    BEAR = 1           # Weak momentum, score 25-40
    NEUTRAL = 2        # No clear trend, score 40-65
    BULL = 3           # Strong momentum, score 65-80
    PARABOLIC_BULL = 4 # Extreme momentum, score > 80


class InstitutionalFlow(IntEnum):
    """Institutional flow direction."""
    HEAVY_OUTFLOW = 0
    OUTFLOW = 1
    NEUTRAL = 2
    INFLOW = 3
    HEAVY_INFLOW = 4


# ============================================================================
# SECTOR REGIME ANALYZER
# ============================================================================

class SectorRegimeAnalyzer:
    """
    Sector regime analyzer ported from SectorRegimeIntelligence.ts.

    Analyzes sector ETFs to determine regime and rotation signals.
    """

    # Sector ETF mappings
    SECTOR_ETFS = {
        'technology': 'XLK',
        'financials': 'XLF',
        'healthcare': 'XLV',
        'consumer_discretionary': 'XLY',
        'consumer_staples': 'XLP',
        'energy': 'XLE',
        'utilities': 'XLU',
        'materials': 'XLB',
        'industrials': 'XLI',
        'real_estate': 'XLRE',
        'communication': 'XLC',
    }

    def __init__(
        self,
        momentum_windows: List[int] = None,
        momentum_weights: List[float] = None,
        lag: int = 1
    ):
        """
        Initialize sector regime analyzer.

        Args:
            momentum_windows: Windows for momentum calculation (default [20, 60, 120])
            momentum_weights: Weights for each window (default [0.5, 0.3, 0.2])
            lag: Lag period for lookahead prevention
        """
        self.momentum_windows = momentum_windows or [20, 60, 120]
        self.momentum_weights = momentum_weights or [0.5, 0.3, 0.2]
        self.lag = lag

    def add_sector_regime_features(
        self,
        df: pd.DataFrame,
        sector_col: str,
        benchmark_col: str = 'spy',
        volume_col: str = None,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add sector regime features to a DataFrame.

        Args:
            df: DataFrame with sector ETF prices
            sector_col: Column name for sector ETF price
            benchmark_col: Column name for benchmark (SPY)
            volume_col: Column name for volume (optional)
            lag: Override default lag

        Returns:
            DataFrame with sector regime features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if sector_col not in result.columns:
            logger.warning(f"Sector column '{sector_col}' not found")
            return result

        sector_price = result[sector_col]

        # 1. Multi-timeframe momentum (from TS calculateMomentum)
        momentum_scores = []
        for w in self.momentum_windows:
            mom = self._calculate_momentum(sector_price, w, lag)
            result[f'{sector_col}_momentum_{w}d'] = mom
            momentum_scores.append(mom)

        # Weighted momentum score (from TS: mom20*0.5 + mom60*0.3 + mom120*0.2)
        weighted_momentum = sum(
            m * w for m, w in zip(momentum_scores, self.momentum_weights)
        )
        result[f'{sector_col}_momentum_score'] = weighted_momentum

        # 2. Relative strength vs benchmark (from TS calculateRelativeStrength)
        if benchmark_col in result.columns:
            result = self._add_relative_strength(
                result, sector_col, benchmark_col, lag
            )

        # 3. Trend quality (from TS analyzeTrendQuality)
        result = self._add_trend_quality(result, sector_col, lag)

        # 4. Institutional flow estimate (from TS estimateInstitutionalFlow)
        if volume_col and volume_col in result.columns:
            result = self._add_institutional_flow(
                result, sector_col, volume_col, lag
            )

        # 5. Regime classification (from TS classifyRegime)
        result = self._add_regime_classification(result, sector_col)

        # 6. Risk adjustments (from TS calculateRiskAdjustments)
        result = self._add_risk_adjustments(result, sector_col)

        return result

    def _calculate_momentum(
        self,
        prices: pd.Series,
        window: int,
        lag: int
    ) -> pd.Series:
        """
        Calculate momentum score (from TS).

        Formula: ((endPrice - startPrice) / startPrice) * 100
        Normalized: ((rawReturn + 20) / 40) * 100

        Args:
            prices: Price series
            window: Lookback window
            lag: Lag period

        Returns:
            Normalized momentum score (0-100)
        """
        # Lagged prices
        price_now = prices.shift(lag)
        price_past = prices.shift(lag + window)

        # Raw return percentage
        raw_return = ((price_now - price_past) / (price_past + 1e-10)) * 100

        # Normalize to 0-100 scale (from TS: (rawReturn + 20) / 40 * 100)
        # This centers around 50 for 0% return
        normalized = ((raw_return + 20) / 40) * 100

        # Clip to 0-100
        return normalized.clip(0, 100)

    def _add_relative_strength(
        self,
        df: pd.DataFrame,
        sector_col: str,
        benchmark_col: str,
        lag: int
    ) -> pd.DataFrame:
        """Add relative strength features (from TS)."""
        sector = df[sector_col].shift(lag)
        benchmark = df[benchmark_col].shift(lag)

        for w in [20, 60, 120]:
            # Sector return
            sector_ret = sector.pct_change(w)
            # Benchmark return
            bench_ret = benchmark.pct_change(w)

            # Relative strength (from TS): (1 + sectorReturn) / (1 + benchmarkReturn)
            # Floor denominator at 0.01 to prevent explosion during crashes (99% drops)
            bench_factor = np.maximum(1 + bench_ret, 0.01)
            df[f'{sector_col}_rs_{w}d'] = (1 + sector_ret) / bench_factor

            # Outperformance percentage
            df[f'{sector_col}_outperf_{w}d'] = ((df[f'{sector_col}_rs_{w}d'] - 1) * 100)

        # Main relative strength (60-day used in TS for classification)
        df[f'{sector_col}_relative_strength'] = df[f'{sector_col}_rs_60d']

        return df

    def _add_trend_quality(
        self,
        df: pd.DataFrame,
        sector_col: str,
        lag: int
    ) -> pd.DataFrame:
        """
        Add trend quality features (from TS analyzeTrendQuality).

        Analyzes higher highs and higher lows to measure trend consistency.
        """
        price = df[sector_col].shift(lag)

        # Rolling analysis over last 60 bars
        for w in [60]:
            rolling_high = price.rolling(10).max()
            rolling_low = price.rolling(10).min()

            # Higher highs: current 10-bar high > previous 10-bar high
            hh = (rolling_high > rolling_high.shift(10)).rolling(w).sum()
            hl = (rolling_low > rolling_low.shift(10)).rolling(w).sum()

            df[f'{sector_col}_higher_highs_{w}'] = hh
            df[f'{sector_col}_higher_lows_{w}'] = hl

            # Trend consistency (how many of possible higher highs/lows achieved)
            max_possible = w // 10 - 1
            consistency = (hh + hl) / (2 * max_possible + 1e-10)
            df[f'{sector_col}_trend_consistency_{w}'] = consistency

            # Trend quality score (from TS formula)
            # score = (higherHighs/max * 50 + higherLows/max * 30 + consistency * 20)
            trend_score = (
                (hh / (max_possible + 1e-10)) * 50 +
                (hl / (max_possible + 1e-10)) * 30 +
                consistency * 20
            )
            df[f'{sector_col}_trend_quality'] = trend_score.clip(0, 100)

        return df

    def _add_institutional_flow(
        self,
        df: pd.DataFrame,
        sector_col: str,
        volume_col: str,
        lag: int
    ) -> pd.DataFrame:
        """
        Add institutional flow estimate (from TS estimateInstitutionalFlow).

        Uses volume-weighted returns to estimate if institutions are
        buying (inflow) or selling (outflow).
        """
        price = df[sector_col].shift(lag)
        volume = df[volume_col].shift(lag)

        # Daily returns
        returns = price.pct_change()

        # Volume-weighted return (from TS)
        # Floor volume sum at 1% of current volume to prevent explosion
        vol_sum = volume.rolling(20).sum()
        vol_floor = np.maximum(vol_sum, volume * 0.01)
        weighted_return = (returns * volume).rolling(20).sum() / vol_floor
        avg_weighted_return = weighted_return * 100  # Convert to percentage

        df[f'{sector_col}_vol_weighted_return'] = avg_weighted_return

        # Classify flow (from TS thresholds)
        # Initialize to -1 (invalid) for NaN rows, not NEUTRAL
        flow = pd.Series(-1, index=df.index)
        valid = avg_weighted_return.notna()

        flow[valid & (avg_weighted_return > 0.5)] = InstitutionalFlow.HEAVY_INFLOW
        flow[valid & (avg_weighted_return > 0.2) & (avg_weighted_return <= 0.5)] = InstitutionalFlow.INFLOW
        flow[valid & (avg_weighted_return >= -0.2) & (avg_weighted_return <= 0.2)] = InstitutionalFlow.NEUTRAL
        flow[valid & (avg_weighted_return >= -0.5) & (avg_weighted_return < -0.2)] = InstitutionalFlow.OUTFLOW
        flow[valid & (avg_weighted_return < -0.5)] = InstitutionalFlow.HEAVY_OUTFLOW

        df[f'{sector_col}_institutional_flow'] = flow.astype(int)

        return df

    def _add_regime_classification(
        self,
        df: pd.DataFrame,
        sector_col: str
    ) -> pd.DataFrame:
        """
        Add regime classification (from TS classifyRegime).

        Uses composite score of:
        - Momentum score (50% weight)
        - Relative strength (30% weight)
        - Trend quality (20% weight)
        """
        # Get component scores - require they exist, don't use silent defaults
        momentum_col = f'{sector_col}_momentum_score'
        rs_col = f'{sector_col}_relative_strength'
        trend_col = f'{sector_col}_trend_quality'

        # Check required columns exist
        if momentum_col not in df.columns:
            logger.warning(f"Missing {momentum_col}, skipping regime classification")
            return df
        if rs_col not in df.columns:
            logger.warning(f"Missing {rs_col}, skipping regime classification")
            return df
        if trend_col not in df.columns:
            logger.warning(f"Missing {trend_col}, skipping regime classification")
            return df

        momentum = df[momentum_col]
        rs = df[rs_col]
        trend_quality = df[trend_col]

        # Composite score (from TS formula)
        # ((relativeStrength - 0.8) / 0.4 * 100) normalizes RS to 0-100 scale
        rs_normalized = ((rs - 0.8) / 0.4) * 100
        rs_normalized = rs_normalized.clip(0, 100)

        composite_score = (
            momentum * 0.5 +
            rs_normalized * 0.3 +
            trend_quality * 0.2
        )

        df[f'{sector_col}_composite_score'] = composite_score

        # Classify regime (from TS thresholds)
        # Initialize to -1 (invalid) for NaN rows during warm-up
        regime = pd.Series(-1, index=df.index)

        # Valid mask - only classify non-NaN rows
        valid_mask = composite_score.notna() & rs.notna()

        # PARABOLIC_BULL: score >= 80 AND RS >= 1.15
        parabolic_mask = valid_mask & (composite_score >= 80) & (rs >= 1.15)
        regime[parabolic_mask] = SectorRegimeState.PARABOLIC_BULL

        # BULL: score >= 65 AND RS >= 1.05 (but not parabolic)
        bull_mask = valid_mask & (composite_score >= 65) & (rs >= 1.05) & ~parabolic_mask
        regime[bull_mask] = SectorRegimeState.BULL

        # NEUTRAL: score 40-65
        neutral_mask = valid_mask & (composite_score >= 40) & (composite_score < 65) & ~parabolic_mask & ~bull_mask
        regime[neutral_mask] = SectorRegimeState.NEUTRAL

        # BEAR: score 25-40
        bear_mask = valid_mask & (composite_score >= 25) & (composite_score < 40)
        regime[bear_mask] = SectorRegimeState.BEAR

        # CRASH: score < 25
        crash_mask = valid_mask & (composite_score < 25)
        regime[crash_mask] = SectorRegimeState.CRASH

        df[f'{sector_col}_regime'] = regime.astype(int)

        # Regime confidence (from TS)
        # Only compute for valid rows - leave NaN as NaN (don't clip to 0)
        confidence = trend_quality * 0.7 + np.where(momentum > 50, 30, 0)
        # Clip only non-NaN values, preserve NaN for invalid rows
        valid_confidence = confidence.where(confidence.isna(), confidence.clip(0, 100))
        df[f'{sector_col}_regime_confidence'] = valid_confidence

        # One-hot encoding for regimes
        for state in SectorRegimeState:
            df[f'{sector_col}_is_{state.name.lower()}'] = (regime == state).astype(int)

        return df

    def _add_risk_adjustments(
        self,
        df: pd.DataFrame,
        sector_col: str
    ) -> pd.DataFrame:
        """
        Add risk adjustments based on regime (from TS calculateRiskAdjustments).
        """
        regime_col = f'{sector_col}_regime'
        if regime_col not in df.columns:
            # No regime data - return with default values
            df[f'{sector_col}_sigma_adjustment'] = 0.0
            df[f'{sector_col}_position_size_mult'] = 1.0
            return df

        regime = df[regime_col]

        # Sigma threshold adjustment (from TS)
        sigma_adj = pd.Series(0.0, index=df.index)
        sigma_adj.loc[regime == SectorRegimeState.PARABOLIC_BULL] = 0.5
        sigma_adj.loc[regime == SectorRegimeState.BULL] = 0.3
        sigma_adj.loc[regime == SectorRegimeState.NEUTRAL] = 0.0
        sigma_adj.loc[regime == SectorRegimeState.BEAR] = -0.2
        sigma_adj.loc[regime == SectorRegimeState.CRASH] = -0.5

        df[f'{sector_col}_sigma_adjustment'] = sigma_adj

        # Position size multiplier (from TS)
        size_mult = pd.Series(1.0, index=df.index)
        size_mult.loc[regime == SectorRegimeState.PARABOLIC_BULL] = 1.5
        size_mult.loc[regime == SectorRegimeState.BULL] = 1.2
        size_mult.loc[regime == SectorRegimeState.NEUTRAL] = 1.0
        size_mult.loc[regime == SectorRegimeState.BEAR] = 0.7
        size_mult.loc[regime == SectorRegimeState.CRASH] = 0.3

        df[f'{sector_col}_position_size_mult'] = size_mult

        return df


# ============================================================================
# ROTATION DETECTOR
# ============================================================================

class RotationDetector:
    """
    Detects sector rotation signals.

    Identifies when money is flowing from one set of sectors to another.
    """

    # Sector categories
    DEFENSIVE = ['utilities', 'healthcare', 'consumer_staples']
    GROWTH = ['technology', 'consumer_discretionary', 'communication']
    CYCLICAL = ['financials', 'industrials', 'materials']
    COMMODITY = ['energy', 'materials']

    def __init__(self, momentum_threshold: float = 15.0):
        """
        Initialize rotation detector.

        Args:
            momentum_threshold: Minimum momentum change to trigger rotation signal
        """
        self.momentum_threshold = momentum_threshold

    def detect_rotation(
        self,
        df: pd.DataFrame,
        sector_momentum_cols: Dict[str, str],
        lookback: int = 20
    ) -> pd.DataFrame:
        """
        Detect sector rotation signals.

        Args:
            df: DataFrame with sector momentum scores
            sector_momentum_cols: Dict mapping sector name to momentum column
            lookback: Lookback for momentum change

        Returns:
            DataFrame with rotation signals
        """
        result = df.copy()

        # Calculate momentum changes for each sector
        gaining_count = pd.Series(0, index=df.index)
        losing_count = pd.Series(0, index=df.index)

        for sector, col in sector_momentum_cols.items():
            if col not in result.columns:
                continue

            momentum_change = result[col].diff(lookback)
            result[f'{sector}_momentum_change'] = momentum_change

            gaining_count += (momentum_change > self.momentum_threshold).astype(int)
            losing_count += (momentum_change < -self.momentum_threshold).astype(int)

        result['rotation_gaining_count'] = gaining_count
        result['rotation_losing_count'] = losing_count

        # Rotation signal strength
        result['rotation_signal'] = (gaining_count > 0) & (losing_count > 0)
        result['rotation_strength'] = (gaining_count + losing_count).clip(0, 10) / 10

        # Classify rotation type
        result['rotation_type'] = self._classify_rotation_type(result, sector_momentum_cols, lookback)

        return result

    def _classify_rotation_type(
        self,
        df: pd.DataFrame,
        sector_momentum_cols: Dict[str, str],
        lookback: int
    ) -> pd.Series:
        """Classify the type of rotation (defensive→growth, etc.)."""
        rotation_type = pd.Series('NONE', index=df.index)

        # Calculate category momentum changes
        for category_name, category_sectors in [
            ('defensive', self.DEFENSIVE),
            ('growth', self.GROWTH),
            ('cyclical', self.CYCLICAL),
        ]:
            category_changes = []
            for sector in category_sectors:
                if sector in sector_momentum_cols:
                    col = sector_momentum_cols[sector]
                    if f'{sector}_momentum_change' in df.columns:
                        category_changes.append(df[f'{sector}_momentum_change'])

            if category_changes:
                df[f'{category_name}_momentum_change'] = pd.concat(category_changes, axis=1).mean(axis=1)

        # Determine rotation type
        if 'defensive_momentum_change' in df.columns and 'growth_momentum_change' in df.columns:
            def_change = df['defensive_momentum_change']
            growth_change = df['growth_momentum_change']

            rotation_type[(def_change < -10) & (growth_change > 10)] = 'DEFENSIVE_TO_GROWTH'
            rotation_type[(growth_change < -10) & (def_change > 10)] = 'GROWTH_TO_DEFENSIVE'

        return rotation_type


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def add_sector_regime_features(
    df: pd.DataFrame,
    sector_cols: List[str],
    benchmark_col: str = 'spy',
    lag: int = 1
) -> pd.DataFrame:
    """
    Add sector regime features for multiple sectors.

    Args:
        df: DataFrame with sector ETF prices
        sector_cols: List of sector column names
        benchmark_col: Benchmark column (SPY)
        lag: Lag period for lookahead prevention

    Returns:
        DataFrame with sector regime features
    """
    result = df.copy()
    analyzer = SectorRegimeAnalyzer(lag=lag)

    for sector_col in sector_cols:
        if sector_col in result.columns:
            result = analyzer.add_sector_regime_features(
                result, sector_col, benchmark_col
            )

    return result


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample sector data
    np.random.seed(42)
    n = 252  # 1 year of daily data

    dates = pd.date_range('2024-01-01', periods=n, freq='D')

    # Simulate SPY and sector ETFs with different characteristics
    spy = 400 * np.exp(np.cumsum(np.random.randn(n) * 0.01 + 0.0003))
    xlk = 180 * np.exp(np.cumsum(np.random.randn(n) * 0.012 + 0.0004))  # Tech outperforms
    xle = 80 * np.exp(np.cumsum(np.random.randn(n) * 0.015 - 0.0001))   # Energy underperforms
    xlu = 70 * np.exp(np.cumsum(np.random.randn(n) * 0.008 + 0.0001))   # Utilities stable

    df = pd.DataFrame({
        'timestamp': dates,
        'spy': spy,
        'xlk': xlk,
        'xle': xle,
        'xlu': xlu,
        'volume': np.random.randint(1000000, 10000000, n)
    })

    # Add sector regime features
    analyzer = SectorRegimeAnalyzer(lag=1)

    result = analyzer.add_sector_regime_features(df, 'xlk', 'spy')
    result = analyzer.add_sector_regime_features(result, 'xle', 'spy')
    result = analyzer.add_sector_regime_features(result, 'xlu', 'spy')

    print("Sector regime feature columns added:")
    sector_cols = [c for c in result.columns if c not in ['timestamp', 'spy', 'xlk', 'xle', 'xlu', 'volume']]
    for col in sorted(sector_cols)[:30]:  # Show first 30
        print(f"  {col}")

    print(f"\nTotal sector features: {len(sector_cols)}")

    print("\nXLK Regime distribution:")
    print(result['xlk_regime'].value_counts().sort_index())

    print("\nSample data (XLK):")
    print(result[['timestamp', 'xlk', 'xlk_momentum_score', 'xlk_relative_strength', 'xlk_regime']].tail(10))
