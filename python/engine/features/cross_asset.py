#!/usr/bin/env python3
"""
Cross-Asset Features - Relative Value and Correlation Features.

The most valuable features are often RELATIVE:
1. Asset ratios (QQQ/SPY, XLE/SPY, etc.)
2. Cross-asset correlations (SPY vs VIX)
3. Sector rotation indicators
4. Risk-on / Risk-off signals

IMPORTANT: Features must be computed with LAG to avoid lookahead bias.
"""

import logging
from typing import List, Dict, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.CrossAsset")


# ============================================================================
# ASSET PAIR FEATURES
# ============================================================================

class AssetPairFeatures:
    """
    Features from asset pairs - ratios, spreads, correlations.

    Key insight: Relative strength tells you WHERE money is flowing.
    - Tech/Energy rising → Growth over Value
    - Bonds/Stocks rising → Risk-off
    - SPY/VIX correlation flip → Regime change
    """

    def __init__(self, windows: List[int] = None, lag: int = 1):
        """
        Initialize with rolling windows.

        Args:
            windows: Rolling windows for correlations (default [20, 60, 120])
            lag: Lag period for lookahead prevention
        """
        self.windows = windows or [20, 60, 120]
        self.lag = lag

    def add_ratio_features(
        self,
        df: pd.DataFrame,
        asset1_col: str,
        asset2_col: str,
        prefix: str = None,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add ratio features between two assets.

        Args:
            df: DataFrame with both asset prices
            asset1_col: Numerator asset column
            asset2_col: Denominator asset column
            prefix: Feature prefix (default: '{asset1}_{asset2}')
            lag: Override default lag

        Returns:
            DataFrame with ratio features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if asset1_col not in result.columns or asset2_col not in result.columns:
            logger.warning(f"Missing columns for ratio: {asset1_col}, {asset2_col}")
            return result

        prefix = prefix or f"{asset1_col}_{asset2_col}"

        # Lag both assets
        a1 = result[asset1_col].shift(lag)
        a2 = result[asset2_col].shift(lag)

        # 1. Price ratio
        result[f'{prefix}_ratio'] = a1 / (a2 + 1e-10)

        # 2. Ratio change (is ratio trending up/down?)
        ratio = result[f'{prefix}_ratio']
        result[f'{prefix}_ratio_ret_1'] = ratio.pct_change(1)
        result[f'{prefix}_ratio_ret_5'] = ratio.pct_change(5)
        result[f'{prefix}_ratio_ret_20'] = ratio.pct_change(20)

        # 3. Ratio momentum (SMA crossover)
        for w in [10, 20, 50]:
            sma = ratio.rolling(w).mean()
            # Use meaningful floor for SMA (price ratios are typically > 0.1)
            sma_floor = np.maximum(sma.abs(), 0.01)
            result[f'{prefix}_ratio_vs_sma{w}'] = (ratio - sma) / sma_floor

        # 4. Ratio z-score (how extreme is current ratio?)
        for w in self.windows:
            ratio_mean = ratio.rolling(w).mean()
            ratio_std = ratio.rolling(w).std()
            # Floor std at 0.001 to prevent explosion during low-volatility periods
            # Also clip z-score to [-10, 10] to prevent outliers from dominating
            std_floor = np.maximum(ratio_std, 0.001)
            zscore = (ratio - ratio_mean) / std_floor
            result[f'{prefix}_ratio_zscore_{w}'] = zscore.clip(-10, 10)

        # 5. Ratio percentile - use min_periods to allow partial windows
        # Without min_periods, first 252 bars are all NaN which breaks short backtests
        result[f'{prefix}_ratio_pctrank'] = ratio.rolling(252, min_periods=20).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
        )

        return result

    def add_correlation_features(
        self,
        df: pd.DataFrame,
        asset1_col: str,
        asset2_col: str,
        prefix: str = None,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add rolling correlation features between two assets.

        Key signal: When correlation CHANGES, regime is changing.
        - SPY/VIX normally negative. Positive = call panic or trap.
        - SPY/TLT normally low. Rising = flight to safety.

        Args:
            df: DataFrame with both asset returns (or prices)
            asset1_col: First asset column
            asset2_col: Second asset column
            prefix: Feature prefix
            lag: Override default lag

        Returns:
            DataFrame with correlation features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if asset1_col not in result.columns or asset2_col not in result.columns:
            logger.warning(f"Missing columns for correlation: {asset1_col}, {asset2_col}")
            return result

        prefix = prefix or f"{asset1_col}_{asset2_col}"

        # Use returns for correlation (more stationary than prices)
        a1_ret = result[asset1_col].pct_change().shift(lag)
        a2_ret = result[asset2_col].pct_change().shift(lag)

        for w in self.windows:
            # Rolling correlation - DO NOT fill NaN with 0 (creates false signals)
            # NaN means "insufficient data", 0 means "no correlation" - semantically different
            corr = a1_ret.rolling(w).corr(a2_ret)
            result[f'{prefix}_corr_{w}'] = corr

            # Correlation change (regime shift indicator)
            # Leave NaN during warm-up - don't create false "no regime shift" signals
            result[f'{prefix}_corr_delta_{w}'] = corr.diff(5)

        # Correlation regime: when does correlation flip?
        # Using 60-bar correlation as the main signal
        if f'{prefix}_corr_60' in result.columns:
            corr_60 = result[f'{prefix}_corr_60']
            result[f'{prefix}_corr_positive'] = (corr_60 > 0).astype(int)
            result[f'{prefix}_corr_negative'] = (corr_60 < 0).astype(int)
            result[f'{prefix}_corr_extreme_pos'] = (corr_60 > 0.7).astype(int)
            result[f'{prefix}_corr_extreme_neg'] = (corr_60 < -0.7).astype(int)

        return result


# ============================================================================
# SECTOR ROTATION FEATURES
# ============================================================================

class SectorRotationFeatures:
    """
    Sector rotation and risk appetite features.

    Key pairs:
    - QQQ/SPY: Tech leadership
    - XLF/SPY: Financials leadership
    - XLE/SPY: Energy/commodity leadership
    - TLT/SPY: Risk-off (bonds vs stocks)
    - GLD/SPY: Inflation hedge demand
    """

    # Standard sector ETFs to track
    SECTOR_PAIRS = [
        ('QQQ', 'SPY', 'tech'),       # Tech leadership
        ('XLF', 'SPY', 'financials'), # Financials leadership
        ('XLE', 'SPY', 'energy'),     # Energy/commodities
        ('XLK', 'SPY', 'tech_sector'),# Pure tech sector
        ('TLT', 'SPY', 'bonds'),      # Bonds vs stocks (risk-off)
        ('GLD', 'SPY', 'gold'),       # Gold vs stocks (inflation fear)
        ('IWM', 'SPY', 'smallcap'),   # Small cap vs large cap
        ('EEM', 'SPY', 'emerging'),   # Emerging vs US
    ]

    def __init__(self, windows: List[int] = None, lag: int = 1):
        self.windows = windows or [20, 60]
        self.lag = lag
        self.pair_features = AssetPairFeatures(windows=windows, lag=lag)

    def add_sector_rotation(
        self,
        df: pd.DataFrame,
        pairs: List[Tuple[str, str, str]] = None,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add sector rotation features for available pairs.

        Args:
            df: DataFrame with sector ETF prices (columns: QQQ, SPY, XLF, etc.)
            pairs: List of (asset1, asset2, name) tuples
            lag: Override default lag

        Returns:
            DataFrame with sector rotation features
        """
        result = df.copy()
        pairs = pairs or self.SECTOR_PAIRS
        lag = lag if lag is not None else self.lag

        for asset1, asset2, name in pairs:
            col1 = asset1.lower()
            col2 = asset2.lower()

            if col1 in result.columns and col2 in result.columns:
                result = self.pair_features.add_ratio_features(
                    result, col1, col2, prefix=f'sector_{name}'
                )
                logger.debug(f"Added sector rotation features: {name}")
            else:
                logger.debug(f"Skipping sector pair {name}: missing {col1} or {col2}")

        return result

    def add_risk_appetite_index(
        self,
        df: pd.DataFrame,
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Create a composite risk appetite index.

        Combines:
        - Stock/bond ratio (higher = risk-on)
        - Small cap/large cap (higher = risk-on)
        - Emerging/US (higher = risk-on)

        Args:
            df: DataFrame with required ETF prices
            lag: Override default lag

        Returns:
            DataFrame with risk appetite index
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        components = []

        # SPY/TLT ratio (higher = risk-on)
        if 'spy' in result.columns and 'tlt' in result.columns:
            ratio = result['spy'].shift(lag) / (result['tlt'].shift(lag) + 1e-10)
            # Normalize to z-score
            zscore = (ratio - ratio.rolling(60).mean()) / (ratio.rolling(60).std() + 1e-10)
            components.append(zscore)

        # IWM/SPY ratio (higher = risk-on)
        if 'iwm' in result.columns and 'spy' in result.columns:
            ratio = result['iwm'].shift(lag) / (result['spy'].shift(lag) + 1e-10)
            zscore = (ratio - ratio.rolling(60).mean()) / (ratio.rolling(60).std() + 1e-10)
            components.append(zscore)

        # EEM/SPY ratio (higher = risk-on)
        if 'eem' in result.columns and 'spy' in result.columns:
            ratio = result['eem'].shift(lag) / (result['spy'].shift(lag) + 1e-10)
            zscore = (ratio - ratio.rolling(60).mean()) / (ratio.rolling(60).std() + 1e-10)
            components.append(zscore)

        if components:
            # Average of available components
            result['risk_appetite_index'] = pd.concat(components, axis=1).mean(axis=1)

            # Risk appetite zones
            result['risk_appetite_on'] = (result['risk_appetite_index'] > 0.5).astype(int)
            result['risk_appetite_off'] = (result['risk_appetite_index'] < -0.5).astype(int)

        return result


# ============================================================================
# SPY-VIX RELATIONSHIP (Special Case)
# ============================================================================

class SpyVixFeatures:
    """
    Special SPY-VIX relationship features.

    The SPY-VIX relationship is one of the most important market signals:
    - Normally negative correlation (fear gauge)
    - Positive correlation = unusual (panic buying calls OR manipulation)
    - VIX spike with SPY flat = hedging activity
    """

    def __init__(self, windows: List[int] = None, lag: int = 1):
        self.windows = windows or [20, 60, 120]
        self.lag = lag

    def add_spy_vix_features(
        self,
        df: pd.DataFrame,
        spy_col: str = 'spy',
        vix_col: str = 'vix',
        lag: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Add SPY-VIX relationship features.

        Args:
            df: DataFrame with SPY and VIX
            spy_col: SPY price column
            vix_col: VIX level column
            lag: Override default lag

        Returns:
            DataFrame with SPY-VIX features
        """
        result = df.copy()
        lag = lag if lag is not None else self.lag

        if spy_col not in result.columns or vix_col not in result.columns:
            logger.warning(f"Missing SPY or VIX columns")
            return result

        spy = result[spy_col].shift(lag)
        vix = result[vix_col].shift(lag)

        spy_ret = spy.pct_change()
        vix_ret = vix.pct_change()

        # 1. Rolling correlation
        for w in self.windows:
            result[f'spy_vix_corr_{w}'] = spy_ret.rolling(w).corr(vix_ret)

        # 2. Correlation regime change
        # Use stored 60-bar correlation if available, otherwise compute
        if 'spy_vix_corr_60' in result.columns:
            corr_60 = result['spy_vix_corr_60']
        else:
            # Compute 60-bar correlation even if not in self.windows
            corr_60 = spy_ret.rolling(60).corr(vix_ret)
            result['spy_vix_corr_60'] = corr_60  # Store for consistency
        result['spy_vix_corr_positive'] = (corr_60 > 0).astype(int)

        # 3. VIX-adjusted SPY move (how much SPY moved given VIX level)
        # Higher VIX should mean bigger moves; if SPY moves small despite high VIX = suppression
        # Floor VIX at 5 to prevent explosion from bad data (VIX historically never below 9)
        vix_floor = np.maximum(vix, 5.0)
        result['spy_vix_adjusted_move'] = spy_ret.abs() / (vix_floor / 100)

        # 4. VIX beta (how much VIX moves per SPY move)
        # Daily returns variance is small (~0.0001), so use meaningful floor
        # Floor at 1e-6 (corresponds to 0.1% daily std) to prevent explosion
        spy_var = spy_ret.rolling(20).var()
        var_floor = np.maximum(spy_var, 1e-6)
        vix_beta = vix_ret.rolling(20).cov(spy_ret) / var_floor
        result['vix_beta_20'] = vix_beta.clip(-50, 50)  # VIX beta typically -3 to -10

        # 5. Divergence: SPY up but VIX also up = unusual
        result['spy_vix_divergence'] = np.where(
            (spy_ret > 0.005) & (vix_ret > 0.02), 1,  # Both up = bearish signal
            np.where(
                (spy_ret < -0.005) & (vix_ret < -0.02), -1,  # Both down = bullish signal
                0
            )
        )

        return result


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def add_cross_asset_features(
    df: pd.DataFrame,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add all available cross-asset features.

    Automatically detects available columns and adds relevant features.

    Args:
        df: DataFrame with various asset prices
        lag: Lag period for lookahead prevention

    Returns:
        DataFrame with cross-asset features
    """
    result = df.copy()

    # Convert column names to lowercase for matching
    result.columns = result.columns.str.lower()

    # Add SPY-VIX features if available
    spy_vix = SpyVixFeatures(lag=lag)
    result = spy_vix.add_spy_vix_features(result)

    # Add sector rotation features
    sector = SectorRotationFeatures(lag=lag)
    result = sector.add_sector_rotation(result)
    result = sector.add_risk_appetite_index(result)

    return result


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample multi-asset data
    np.random.seed(42)
    n = 500

    dates = pd.date_range('2024-01-01', periods=n, freq='D')

    # Simulate correlated assets
    spy = 400 * np.exp(np.cumsum(np.random.randn(n) * 0.01 + 0.0003))
    qqq = 350 * np.exp(np.cumsum(np.random.randn(n) * 0.012 + 0.0004))  # More volatile, higher drift
    tlt = 100 * np.exp(np.cumsum(np.random.randn(n) * 0.008 - 0.0001))  # Bonds, slight decline
    vix = 20 - (spy[1:] - spy[:-1]) / spy[:-1] * 500 + np.random.randn(n-1) * 2
    vix = np.clip(np.concatenate([[20], vix]), 10, 50)

    df = pd.DataFrame({
        'timestamp': dates,
        'spy': spy,
        'qqq': qqq,
        'tlt': tlt,
        'vix': vix
    })

    # Add cross-asset features
    result = add_cross_asset_features(df, lag=1)

    print("Cross-asset feature columns added:")
    cross_cols = [c for c in result.columns if c not in ['timestamp', 'spy', 'qqq', 'tlt', 'vix']]
    for col in sorted(cross_cols):
        print(f"  {col}")

    print(f"\nTotal cross-asset features: {len(cross_cols)}")

    # Sample output
    print("\nSample SPY-VIX correlation data:")
    if 'spy_vix_corr_60' in result.columns:
        print(result[['timestamp', 'spy', 'vix', 'spy_vix_corr_60', 'spy_vix_divergence']].tail(10))
