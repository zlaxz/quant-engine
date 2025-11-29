"""
Derived feature calculations for SPY data.

Computes:
- Realized Volatility (RV5, RV10, RV20)
- ATR (ATR5, ATR10)
- Moving Averages (MA20, MA50)
- MA slopes
"""

import pandas as pd
import numpy as np


def compute_returns(df: pd.DataFrame) -> pd.DataFrame:
    """Compute log returns."""
    df = df.copy()
    df['return'] = np.log(df['close'] / df['close'].shift(1))
    return df


def compute_realized_vol(df: pd.DataFrame, windows: list = [5, 10, 20]) -> pd.DataFrame:
    """
    Compute realized volatility over multiple windows.

    RV = sqrt(252) * std(log returns)

    Args:
        df: DataFrame with 'return' column
        windows: List of rolling window sizes (in days)

    Returns:
        DataFrame with RV5, RV10, RV20 columns
    """
    df = df.copy()

    for window in windows:
        # Annualized realized vol
        rv = df['return'].rolling(window).std() * np.sqrt(252)
        df[f'RV{window}'] = rv

    return df


def compute_atr(df: pd.DataFrame, windows: list = [5, 10]) -> pd.DataFrame:
    """
    Compute Average True Range.

    TR = max(high - low, abs(high - prev_close), abs(low - prev_close))
    ATR = rolling average of TR

    Args:
        df: DataFrame with OHLC
        windows: List of rolling window sizes

    Returns:
        DataFrame with ATR5, ATR10 columns
    """
    df = df.copy()

    # True Range
    prev_close = df['close'].shift(1)
    tr1 = df['high'] - df['low']
    tr2 = abs(df['high'] - prev_close)
    tr3 = abs(df['low'] - prev_close)

    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['TR'] = tr

    for window in windows:
        df[f'ATR{window}'] = df['TR'].rolling(window).mean()

    return df


def compute_moving_averages(df: pd.DataFrame, windows: list = [20, 50]) -> pd.DataFrame:
    """
    Compute simple moving averages.

    Args:
        df: DataFrame with 'close'
        windows: List of MA window sizes

    Returns:
        DataFrame with MA20, MA50 columns
    """
    df = df.copy()

    for window in windows:
        df[f'MA{window}'] = df['close'].rolling(window).mean()

    return df


def compute_ma_slopes(df: pd.DataFrame, lookback: int = 5) -> pd.DataFrame:
    """
    Compute slopes of moving averages.

    Slope = (MA_today - MA_N_days_ago) / MA_N_days_ago

    Args:
        df: DataFrame with MA columns
        lookback: Days to look back for slope calculation

    Returns:
        DataFrame with slope_MA20, slope_MA50 columns
    """
    df = df.copy()

    for col in ['MA20', 'MA50']:
        if col in df.columns:
            ma_prev = df[col].shift(lookback)
            slope = (df[col] - ma_prev) / ma_prev
            df[f'slope_{col}'] = slope

    return df


def compute_price_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute price-based metrics.

    - Distance from MAs
    - N-day returns
    - Range compression
    """
    df = df.copy()

    # Distance from moving averages
    if 'MA20' in df.columns:
        df['price_to_MA20'] = df['close'] / df['MA20'] - 1.0

    if 'MA50' in df.columns:
        df['price_to_MA50'] = df['close'] / df['MA50'] - 1.0

    # N-day returns
    df['return_5d'] = df['close'] / df['close'].shift(5) - 1.0
    df['return_10d'] = df['close'] / df['close'].shift(10) - 1.0
    df['return_20d'] = df['close'] / df['close'].shift(20) - 1.0

    # 10-day range (for compression detection)
    high_10d = df['high'].rolling(10).max()
    low_10d = df['low'].rolling(10).min()
    df['range_10d'] = (high_10d - low_10d) / df['close']

    return df


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add all derived features to SPY OHLCV data.

    This is the main function called by DataSpine.

    Args:
        df: SPY OHLCV DataFrame

    Returns:
        DataFrame with all derived features
    """
    df = df.copy()
    df = df.sort_values('date').reset_index(drop=True)

    # 1. Returns
    df = compute_returns(df)

    # 2. Realized volatility
    df = compute_realized_vol(df, windows=[5, 10, 20])

    # 3. ATR
    df = compute_atr(df, windows=[5, 10])

    # 4. Moving averages
    df = compute_moving_averages(df, windows=[20, 50])

    # 5. MA slopes
    df = compute_ma_slopes(df, lookback=5)

    # 6. Price metrics
    df = compute_price_metrics(df)

    return df


def validate_features(df: pd.DataFrame) -> dict:
    """
    Validate feature calculations.

    Returns:
        Dict with validation results
    """
    results = {
        'row_count': len(df),
        'date_range': (df['date'].min(), df['date'].max()),
        'missing_values': {},
        'feature_stats': {}
    }

    # Check for NaN values
    feature_cols = [
        'RV5', 'RV10', 'RV20',
        'ATR5', 'ATR10',
        'MA20', 'MA50',
        'slope_MA20', 'slope_MA50',
        'return_5d', 'return_10d', 'return_20d',
        'range_10d'
    ]

    for col in feature_cols:
        if col in df.columns:
            nan_count = df[col].isna().sum()
            results['missing_values'][col] = nan_count

            # Get basic stats (excluding NaN)
            if nan_count < len(df):
                results['feature_stats'][col] = {
                    'mean': df[col].mean(),
                    'std': df[col].std(),
                    'min': df[col].min(),
                    'max': df[col].max()
                }

    # Check for expected NaN patterns (early rows should have NaN due to rolling windows)
    expected_nan_rows = 50  # MA50 needs 50 days

    return results
