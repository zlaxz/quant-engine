"""
Futures Feature Engine

Production-grade feature generation for futures trading.
Adapts the physics engine for futures (no Greeks, simpler structure).
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
import logging

logger = logging.getLogger(__name__)


class FuturesFeatureEngine:
    """
    Production feature engine for futures.

    Feature Categories:
    1. Price-based (momentum, mean reversion, breakout)
    2. Volume-based (flow, accumulation, distribution)
    3. Volatility-based (ATR, realized vol, vol regime)
    4. Market structure (support/resistance, pivot points)
    5. Cross-asset (correlation, spread, relative strength)
    6. Time-based (session, day of week, expiration)
    """

    # Annualization factors for different timeframes
    ANNUALIZATION_FACTORS = {
        '1m': np.sqrt(252 * 1440),    # 1440 minutes per day
        '5m': np.sqrt(252 * 288),     # 288 5-min bars per day
        '15m': np.sqrt(252 * 96),     # 96 15-min bars per day
        '30m': np.sqrt(252 * 48),     # 48 30-min bars per day
        '1h': np.sqrt(252 * 24),      # 24 hours per day
        '4h': np.sqrt(252 * 6),       # 6 4-hour bars per day
        '1d': np.sqrt(252),           # 252 trading days per year
    }

    def __init__(self, lookback_periods: Optional[List[int]] = None, timeframe: str = '1d'):
        self.lookback_periods = lookback_periods or [5, 10, 20, 50, 100, 200]
        self.timeframe = timeframe
        self.annualization_factor = self.ANNUALIZATION_FACTORS.get(timeframe, np.sqrt(252))

    def generate_features(
        self,
        df: pd.DataFrame,
        feature_sets: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Generate all features for a DataFrame.

        Args:
            df: OHLCV DataFrame
            feature_sets: Which feature sets to generate (None = all)

        Returns:
            DataFrame with original data + features
        """
        feature_sets = feature_sets or [
            'price', 'volume', 'volatility', 'structure', 'time'
        ]

        result = df.copy()

        if 'price' in feature_sets:
            result = self._add_price_features(result)

        if 'volume' in feature_sets:
            result = self._add_volume_features(result)

        if 'volatility' in feature_sets:
            result = self._add_volatility_features(result)

        if 'structure' in feature_sets:
            result = self._add_structure_features(result)

        if 'time' in feature_sets:
            result = self._add_time_features(result)

        # Drop any NaN rows from lookback calculations
        initial_len = len(result)
        result = result.dropna()
        dropped = initial_len - len(result)
        if dropped > 0:
            logger.info(f"Dropped {dropped} rows due to NaN from lookback calculations")

        return result

    def _add_price_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Price-based features."""

        # Returns at multiple horizons
        for period in self.lookback_periods:
            df[f'ret_{period}'] = df['close'].pct_change(period)
            df[f'log_ret_{period}'] = np.log(df['close'] / df['close'].shift(period))

        # Moving averages
        for period in self.lookback_periods:
            df[f'sma_{period}'] = df['close'].rolling(period).mean()
            df[f'ema_{period}'] = df['close'].ewm(span=period).mean()

        # Price relative to MAs
        for period in self.lookback_periods:
            df[f'close_vs_sma_{period}'] = (df['close'] - df[f'sma_{period}']) / df[f'sma_{period}']

        # MA crossovers
        df['sma_5_20_cross'] = (df['sma_5'] > df['sma_20']).astype(int)
        df['sma_10_50_cross'] = (df['sma_10'] > df['sma_50']).astype(int)
        df['sma_20_100_cross'] = (df['sma_20'] > df['sma_100']).astype(int)
        df['sma_50_200_cross'] = (df['sma_50'] > df['sma_200']).astype(int)

        # Momentum indicators
        for period in [10, 20, 50]:
            # Rate of change
            df[f'roc_{period}'] = (df['close'] - df['close'].shift(period)) / df['close'].shift(period)

            # RSI (with division by zero protection)
            delta = df['close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            # Protect against division by zero - when loss is 0, RSI should be 100
            rs = gain / loss.replace(0, np.nan)
            df[f'rsi_{period}'] = 100 - (100 / (1 + rs))
            # Fill RSI = 100 when there are no losses (all gains)
            df[f'rsi_{period}'] = df[f'rsi_{period}'].fillna(100)

        # MACD
        ema_12 = df['close'].ewm(span=12).mean()
        ema_26 = df['close'].ewm(span=26).mean()
        df['macd'] = ema_12 - ema_26
        df['macd_signal'] = df['macd'].ewm(span=9).mean()
        df['macd_hist'] = df['macd'] - df['macd_signal']

        # Bollinger Bands (with division by zero protection)
        for period in [20, 50]:
            sma = df['close'].rolling(period).mean()
            std = df['close'].rolling(period).std()
            df[f'bb_upper_{period}'] = sma + (2 * std)
            df[f'bb_lower_{period}'] = sma - (2 * std)
            # Protect against division by zero when std=0 (flat price)
            bb_range = df[f'bb_upper_{period}'] - df[f'bb_lower_{period}']
            df[f'bb_pct_{period}'] = (df['close'] - df[f'bb_lower_{period}']) / bb_range.replace(0, np.nan)
            df[f'bb_pct_{period}'] = df[f'bb_pct_{period}'].fillna(0.5)  # Default to middle when flat
            df[f'bb_width_{period}'] = bb_range / sma.replace(0, np.nan)
            df[f'bb_width_{period}'] = df[f'bb_width_{period}'].fillna(0)

        # Price range features
        df['daily_range'] = (df['high'] - df['low']) / df['close']
        df['body_size'] = abs(df['close'] - df['open']) / df['close']
        df['upper_wick'] = (df['high'] - df[['open', 'close']].max(axis=1)) / df['close']
        df['lower_wick'] = (df[['open', 'close']].min(axis=1) - df['low']) / df['close']

        # Higher highs / lower lows (with division by zero protection)
        for period in [5, 10, 20]:
            df[f'highest_high_{period}'] = df['high'].rolling(period).max()
            df[f'lowest_low_{period}'] = df['low'].rolling(period).min()
            range_hl = df[f'highest_high_{period}'] - df[f'lowest_low_{period}']
            df[f'close_vs_high_{period}'] = (df['close'] - df[f'lowest_low_{period}']) / range_hl.replace(0, np.nan)
            df[f'close_vs_high_{period}'] = df[f'close_vs_high_{period}'].fillna(0.5)  # Default to middle when flat

        return df

    def _add_volume_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Volume-based features."""

        # Volume moving averages
        for period in self.lookback_periods:
            df[f'vol_sma_{period}'] = df['volume'].rolling(period).mean()
            df[f'vol_ratio_{period}'] = df['volume'] / df[f'vol_sma_{period}']

        # On-Balance Volume
        df['obv'] = (np.sign(df['close'].diff()) * df['volume']).cumsum()
        df['obv_sma_20'] = df['obv'].rolling(20).mean()

        # Volume-weighted average price (with division by zero protection)
        cumvol = df['volume'].cumsum()
        df['vwap'] = (df['close'] * df['volume']).cumsum() / cumvol.replace(0, np.nan)
        df['vwap'] = df['vwap'].fillna(df['close'])  # Default to close when no volume
        df['close_vs_vwap'] = (df['close'] - df['vwap']) / df['vwap'].replace(0, np.nan)
        df['close_vs_vwap'] = df['close_vs_vwap'].fillna(0)

        # Accumulation/Distribution (with division by zero protection)
        hl_range = df['high'] - df['low']
        clv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / hl_range.replace(0, np.nan)
        clv = clv.fillna(0)  # Neutral when no range
        df['ad_line'] = (clv * df['volume']).cumsum()

        # Volume trend
        df['vol_trend'] = df['volume'].rolling(10).mean() / df['volume'].rolling(50).mean()

        # High volume bars
        df['high_volume'] = (df['volume'] > df['volume'].rolling(20).mean() * 1.5).astype(int)

        return df

    def _add_volatility_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Volatility-based features."""

        # True Range
        df['tr'] = pd.concat([
            df['high'] - df['low'],
            abs(df['high'] - df['close'].shift(1)),
            abs(df['low'] - df['close'].shift(1))
        ], axis=1).max(axis=1)

        # Average True Range
        for period in [10, 14, 20, 50]:
            df[f'atr_{period}'] = df['tr'].rolling(period).mean()
            df[f'atr_pct_{period}'] = df[f'atr_{period}'] / df['close']

        # Realized volatility (using correct annualization factor for timeframe)
        for period in [5, 10, 20, 50]:
            df[f'realized_vol_{period}'] = df['close'].pct_change().rolling(period).std() * self.annualization_factor

        # Volatility regime
        df['vol_regime'] = pd.qcut(
            df['realized_vol_20'].rolling(50).apply(lambda x: pd.Series(x).rank().iloc[-1] / len(x)),
            q=3, labels=['low', 'medium', 'high'], duplicates='drop'
        )

        # Volatility trend
        df['vol_expanding'] = (df['atr_10'] > df['atr_50']).astype(int)

        # Keltner Channels (with division by zero protection)
        ema_20 = df['close'].ewm(span=20).mean()
        df['keltner_upper'] = ema_20 + (2 * df['atr_20'])
        df['keltner_lower'] = ema_20 - (2 * df['atr_20'])
        keltner_range = df['keltner_upper'] - df['keltner_lower']
        df['keltner_pct'] = (df['close'] - df['keltner_lower']) / keltner_range.replace(0, np.nan)
        df['keltner_pct'] = df['keltner_pct'].fillna(0.5)

        # Volatility percentile
        df['vol_percentile'] = df['realized_vol_20'].rolling(252).apply(
            lambda x: pd.Series(x).rank().iloc[-1] / len(x) if len(x) > 0 else 0.5
        )

        return df

    def _add_structure_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Market structure features."""

        # Pivot points (standard)
        df['pivot'] = (df['high'].shift(1) + df['low'].shift(1) + df['close'].shift(1)) / 3
        df['r1'] = 2 * df['pivot'] - df['low'].shift(1)
        df['s1'] = 2 * df['pivot'] - df['high'].shift(1)
        df['r2'] = df['pivot'] + (df['high'].shift(1) - df['low'].shift(1))
        df['s2'] = df['pivot'] - (df['high'].shift(1) - df['low'].shift(1))

        # Distance from pivot levels
        df['dist_from_pivot'] = (df['close'] - df['pivot']) / df['pivot']
        df['dist_from_r1'] = (df['close'] - df['r1']) / df['r1']
        df['dist_from_s1'] = (df['close'] - df['s1']) / df['s1']

        # Trend structure
        df['higher_high'] = (df['high'] > df['high'].shift(1)).astype(int)
        df['higher_low'] = (df['low'] > df['low'].shift(1)).astype(int)
        df['lower_high'] = (df['high'] < df['high'].shift(1)).astype(int)
        df['lower_low'] = (df['low'] < df['low'].shift(1)).astype(int)

        # Trend score
        df['uptrend_score'] = (df['higher_high'] + df['higher_low']).rolling(5).sum()
        df['downtrend_score'] = (df['lower_high'] + df['lower_low']).rolling(5).sum()
        df['trend_score'] = df['uptrend_score'] - df['downtrend_score']

        # Support/Resistance levels (rolling) with division by zero protection
        for period in [20, 50, 100]:
            df[f'resistance_{period}'] = df['high'].rolling(period).max()
            df[f'support_{period}'] = df['low'].rolling(period).min()
            sr_range = df[f'resistance_{period}'] - df[f'support_{period}']
            df[f'range_position_{period}'] = (df['close'] - df[f'support_{period}']) / sr_range.replace(0, np.nan)
            df[f'range_position_{period}'] = df[f'range_position_{period}'].fillna(0.5)  # Middle when flat

        # Breakout signals
        df['breakout_up_20'] = (df['close'] > df['resistance_20'].shift(1)).astype(int)
        df['breakout_down_20'] = (df['close'] < df['support_20'].shift(1)).astype(int)

        return df

    def _add_time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Time-based features."""

        if not isinstance(df.index, pd.DatetimeIndex):
            return df

        # Time components
        df['hour'] = df.index.hour
        df['minute'] = df.index.minute
        df['day_of_week'] = df.index.dayofweek
        df['day_of_month'] = df.index.day
        df['month'] = df.index.month
        df['week_of_year'] = df.index.isocalendar().week

        # Session indicators (simplified - CME sessions)
        df['asian_session'] = ((df['hour'] >= 18) | (df['hour'] < 3)).astype(int)
        df['london_session'] = ((df['hour'] >= 3) & (df['hour'] < 9)).astype(int)
        df['us_session'] = ((df['hour'] >= 9) & (df['hour'] < 16)).astype(int)

        # Day of week effects
        df['is_monday'] = (df['day_of_week'] == 0).astype(int)
        df['is_friday'] = (df['day_of_week'] == 4).astype(int)

        # End of month
        df['is_month_end'] = (df['day_of_month'] >= 25).astype(int)

        # Quarter end
        df['is_quarter_end'] = ((df['month'].isin([3, 6, 9, 12])) & (df['day_of_month'] >= 25)).astype(int)

        return df

    def generate_cross_asset_features(
        self,
        data: Dict[str, pd.DataFrame],
        base_symbol: str = 'ES'
    ) -> pd.DataFrame:
        """
        Generate cross-asset features.

        Args:
            data: Dict mapping symbol -> DataFrame
            base_symbol: Symbol to add features to

        Returns:
            DataFrame with cross-asset features
        """
        if base_symbol not in data:
            raise ValueError(f"Base symbol {base_symbol} not in data")

        df = data[base_symbol].copy()

        for symbol, other_df in data.items():
            if symbol == base_symbol:
                continue

            # Align on index
            aligned = other_df.reindex(df.index, method='ffill')

            # Correlation (rolling)
            for period in [20, 50]:
                df[f'corr_{symbol}_{period}'] = df['close'].rolling(period).corr(aligned['close'])

            # Relative strength
            df[f'rel_strength_{symbol}'] = df['close'].pct_change(20) - aligned['close'].pct_change(20)

            # Spread
            df[f'spread_{symbol}'] = df['close'] / aligned['close']
            df[f'spread_{symbol}_zscore'] = (
                df[f'spread_{symbol}'] - df[f'spread_{symbol}'].rolling(50).mean()
            ) / df[f'spread_{symbol}'].rolling(50).std()

        return df


def generate_features_parallel(
    symbols: List[str],
    data_loader,
    feature_engine: FuturesFeatureEngine,
    timeframe: str = '1m',
    start_date: str = None,
    end_date: str = None,
    max_workers: int = 4
) -> Dict[str, pd.DataFrame]:
    """
    Generate features for multiple symbols in parallel.

    Returns:
        Dict mapping symbol -> DataFrame with features
    """
    # Load data in parallel
    data = data_loader.load_multiple(symbols, timeframe, start_date, end_date, parallel=True)

    # Generate features in parallel
    results = {}

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(feature_engine.generate_features, df): symbol
            for symbol, df in data.items()
        }

        for future in futures:
            symbol = futures[future]
            try:
                results[symbol] = future.result()
            except Exception as e:
                logger.error(f"Failed to generate features for {symbol}: {e}")

    return results
