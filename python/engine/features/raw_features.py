#!/usr/bin/env python3
"""
Raw OHLCV Feature Generator - The Foundation Layer.

Generates ~400 features from raw price/volume data:
- Returns at various lookbacks
- OHLC relationships (body, wicks, range)
- Gap features
- Volume dynamics
- Price derivatives (velocity, acceleration, jerk)
- Rolling statistics at multiple windows
- Momentum components
- Microstructure features
- Time-based features

These feed into Scout Swarm for MI filtering, then PySR for equation discovery.
"""

import logging
from typing import List, Optional
import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features")

# Rolling window sizes for statistics
WINDOWS = [5, 10, 20, 50, 100]


class RawFeatureGenerator:
    """
    Generates raw OHLCV-derived features from price data.

    Usage:
        generator = RawFeatureGenerator()
        features_df = generator.generate(ohlcv_df)
    """

    def __init__(self, windows: List[int] = None):
        """
        Initialize the generator.

        Args:
            windows: Rolling window sizes (default: [5, 10, 20, 50, 100])
        """
        self.windows = windows or WINDOWS

    def generate(self, df: pd.DataFrame, include_targets: bool = True) -> pd.DataFrame:
        """
        Generate all features from OHLCV data.

        Args:
            df: DataFrame with columns: open, high, low, close, volume
                Optional: timestamp/datetime index
            include_targets: Whether to generate target variables

        Returns:
            DataFrame with all generated features
        """
        # Validate input
        required = ['open', 'high', 'low', 'close', 'volume']
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        logger.info(f"Generating features for {len(df)} bars...")

        # Create a copy to avoid modifying original
        result = df.copy()

        # Generate each feature category
        result = self._add_return_features(result)
        result = self._add_ohlc_features(result)
        result = self._add_gap_features(result)
        result = self._add_volume_features(result)
        result = self._add_derivative_features(result)
        result = self._add_rolling_features(result)
        result = self._add_momentum_features(result)
        result = self._add_microstructure_features(result)
        result = self._add_time_features(result)

        if include_targets:
            result = self._add_target_variables(result)

        # Count features
        original_cols = set(df.columns)
        new_cols = [c for c in result.columns if c not in original_cols]
        logger.info(f"Generated {len(new_cols)} features")

        return result

    # =========================================================================
    # RETURNS
    # =========================================================================

    def _add_return_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add return features at various lookbacks."""
        lookbacks = [1, 2, 5, 10, 20, 60, 120]

        for lb in lookbacks:
            df[f'ret_{lb}'] = df['close'].pct_change(lb)

        # Log returns (more stable for longer horizons)
        # Use np.maximum to prevent div/0 and log(0)
        close_safe = np.maximum(df['close'], 1e-10)
        df['log_ret_1'] = np.log(close_safe / np.maximum(df['close'].shift(1), 1e-10))
        df['log_ret_5'] = np.log(close_safe / np.maximum(df['close'].shift(5), 1e-10))
        df['log_ret_20'] = np.log(close_safe / np.maximum(df['close'].shift(20), 1e-10))

        return df

    # =========================================================================
    # OHLC RELATIONSHIPS
    # =========================================================================

    def _add_ohlc_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add features based on OHLC relationships."""
        # Body (signed)
        df['body'] = df['close'] - df['open']
        # Use 0.1% of open as floor to prevent explosion
        open_floor = np.maximum(df['open'].abs() * 0.001, 0.01)
        df['body_pct'] = df['body'] / np.maximum(df['open'].abs(), open_floor)
        df['body_abs'] = df['body'].abs()

        # Wicks
        df['upper_wick'] = df['high'] - df[['open', 'close']].max(axis=1)
        df['lower_wick'] = df[['open', 'close']].min(axis=1) - df['low']

        # Range
        df['range'] = df['high'] - df['low']
        df['range_pct'] = df['range'] / np.maximum(df['close'], 0.01)

        # Floor range at 0.01% of close for ratio calculations (doji bars)
        range_floor = np.maximum(df['range'], df['close'] * 0.0001)

        # Body vs Range ratio (0 = doji, 1 = no wicks)
        df['body_range_ratio'] = df['body_abs'] / range_floor

        # Where close sits in the range (0 = low, 1 = high)
        # For zero-range bars (doji), default to 0.5
        df['close_position'] = np.where(
            df['range'] > 0,
            (df['close'] - df['low']) / df['range'],
            0.5
        )
        df['open_position'] = np.where(
            df['range'] > 0,
            (df['open'] - df['low']) / df['range'],
            0.5
        )

        # Wick ratios
        df['upper_wick_pct'] = df['upper_wick'] / range_floor
        df['lower_wick_pct'] = df['lower_wick'] / range_floor
        # Wick ratio: if lower_wick is 0, ratio is undefined - use 1.0 (neutral)
        lower_wick_safe = np.maximum(df['lower_wick'], df['range'] * 0.01)
        df['wick_ratio'] = np.where(
            df['lower_wick'] > 0,
            df['upper_wick'] / lower_wick_safe,
            1.0  # No lower wick = neutral ratio
        )

        return df

    # =========================================================================
    # GAP FEATURES
    # =========================================================================

    def _add_gap_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add gap-related features."""
        prev_close = df['close'].shift(1)

        df['gap'] = df['open'] - prev_close
        # Use 0.1% of prev_close as floor to prevent explosion
        prev_close_floor = np.maximum(prev_close.abs() * 0.001, 0.01)
        df['gap_pct'] = df['gap'] / np.maximum(prev_close.abs(), prev_close_floor)

        # Did gap fill during the bar?
        df['gap_filled'] = ((df['gap'] > 0) & (df['low'] <= prev_close)) | \
                           ((df['gap'] < 0) & (df['high'] >= prev_close))
        df['gap_filled'] = df['gap_filled'].astype(int)

        # Gap direction
        df['gap_up'] = (df['gap'] > 0).astype(int)
        df['gap_down'] = (df['gap'] < 0).astype(int)

        return df

    # =========================================================================
    # VOLUME FEATURES
    # =========================================================================

    def _add_volume_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add volume-based features."""
        # Volume changes
        df['vol_change_1'] = df['volume'] / (df['volume'].shift(1) + 1)
        df['vol_change_5'] = df['volume'] / (df['volume'].rolling(5).mean() + 1)
        df['vol_change_20'] = df['volume'] / (df['volume'].rolling(20).mean() + 1)

        # Signed volume (directional)
        df['signed_volume'] = df['volume'] * np.sign(df['body'])

        # Volume per range (absorption indicator)
        # Floor range at 0.01% of close to avoid explosion on doji bars
        range_floor = np.maximum(df['range'], df['close'] * 0.0001)
        df['vol_per_range'] = df['volume'] / range_floor

        # Relative volume (vs rolling average)
        for w in [10, 20, 50]:
            df[f'rvol_{w}'] = df['volume'] / (df['volume'].rolling(w).mean() + 1)

        return df

    # =========================================================================
    # DERIVATIVE FEATURES (Velocity, Acceleration, Jerk)
    # =========================================================================

    def _add_derivative_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add price derivatives (1st, 2nd, 3rd order) - "Market Physics"."""
        # Velocity (1st derivative of returns)
        df['velocity_1'] = df['ret_1'] - df['ret_1'].shift(1)
        df['velocity_5'] = df['ret_5'] - df['ret_5'].shift(1)
        df['velocity_20'] = df['ret_20'] - df['ret_20'].shift(1)

        # Acceleration (2nd derivative)
        df['accel_1'] = df['velocity_1'] - df['velocity_1'].shift(1)
        df['accel_5'] = df['velocity_5'] - df['velocity_5'].shift(1)
        df['accel_20'] = df['velocity_20'] - df['velocity_20'].shift(1)

        # Jerk (3rd derivative)
        df['jerk_1'] = df['accel_1'] - df['accel_1'].shift(1)
        df['jerk_5'] = df['accel_5'] - df['accel_5'].shift(1)

        # Volume velocity
        df['vol_velocity'] = df['vol_change_1'] - df['vol_change_1'].shift(1)
        df['vol_accel'] = df['vol_velocity'] - df['vol_velocity'].shift(1)

        # =================================================================
        # MARKET PHYSICS (Gemini's suggestion)
        # ATR-normalized velocity makes features comparable across assets
        # =================================================================

        # True Range for normalization
        tr = np.maximum(
            df['high'] - df['low'],
            np.maximum(
                np.abs(df['high'] - df['close'].shift(1)),
                np.abs(df['low'] - df['close'].shift(1))
            )
        )

        # ATR-normalized velocity (price change / ATR)
        for w in [5, 10, 20]:
            atr = tr.rolling(w).mean()
            df[f'velocity_atr_{w}'] = df['close'].diff(w) / (atr + 1e-10)
            df[f'accel_atr_{w}'] = df[f'velocity_atr_{w}'].diff(w)
            df[f'jerk_atr_{w}'] = df[f'accel_atr_{w}'].diff(w)

        # Market Power = Acceleration * log(Volume)
        # High acceleration + high volume = unstoppable force
        log_vol = np.log(df['volume'] + 1)
        df['market_power_5'] = df['accel_5'] * log_vol
        df['market_power_20'] = df['accel_20'] * log_vol

        # Momentum score (theoretical - like MomentumScoringEngine)
        # Score based on 4h (240 min) window performance
        if len(df) > 240:
            df['momentum_score_4h'] = df['close'].diff(240) / 240

        return df

    # =========================================================================
    # ROLLING STATISTICS
    # =========================================================================

    def _add_rolling_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add rolling statistics at multiple windows."""
        for w in self.windows:
            # Return statistics
            df[f'ret_mean_{w}'] = df['ret_1'].rolling(w).mean()
            df[f'ret_std_{w}'] = df['ret_1'].rolling(w).std()
            df[f'ret_skew_{w}'] = df['ret_1'].rolling(w).skew()
            df[f'ret_kurt_{w}'] = df['ret_1'].rolling(w).kurt()
            df[f'ret_min_{w}'] = df['ret_1'].rolling(w).min()
            df[f'ret_max_{w}'] = df['ret_1'].rolling(w).max()
            df[f'ret_range_{w}'] = df[f'ret_max_{w}'] - df[f'ret_min_{w}']

            # Price statistics
            df[f'sma_{w}'] = df['close'].rolling(w).mean()
            df[f'price_std_{w}'] = df['close'].rolling(w).std()
            # Floor std at 0.1% of mean to prevent explosion during low-volatility periods
            price_std_floor = np.maximum(df[f'price_std_{w}'], df[f'sma_{w}'].abs() * 0.001)
            price_zscore = (df['close'] - df[f'sma_{w}']) / price_std_floor
            df[f'price_zscore_{w}'] = price_zscore.clip(-10, 10)

            # Price percentile rank
            df[f'price_pctrank_{w}'] = df['close'].rolling(w).apply(
                lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
            )

            # Volume statistics
            df[f'vol_mean_{w}'] = df['volume'].rolling(w).mean()
            df[f'vol_std_{w}'] = df['volume'].rolling(w).std()
            # Floor std at 1% of mean to prevent explosion during stable periods
            vol_std_floor = np.maximum(df[f'vol_std_{w}'], df[f'vol_mean_{w}'].abs() * 0.01)
            vol_zscore = (df['volume'] - df[f'vol_mean_{w}']) / vol_std_floor
            df[f'vol_zscore_{w}'] = vol_zscore.clip(-10, 10)

            # Range statistics (ATR-like)
            df[f'atr_{w}'] = df['range'].rolling(w).mean()
            df[f'range_std_{w}'] = df['range'].rolling(w).std()
            # Floor std at 1% of ATR to prevent explosion during calm markets
            range_std_floor = np.maximum(df[f'range_std_{w}'], df[f'atr_{w}'].abs() * 0.01)
            range_zscore = (df['range'] - df[f'atr_{w}']) / range_std_floor
            df[f'range_zscore_{w}'] = range_zscore.clip(-10, 10)

        return df

    # =========================================================================
    # MOMENTUM FEATURES
    # =========================================================================

    def _add_momentum_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add momentum-based features (RSI components, trend strength)."""
        for w in self.windows:
            # Gain/Loss separation (RSI components)
            gains = df['ret_1'].clip(lower=0)
            losses = (-df['ret_1']).clip(lower=0)

            df[f'avg_gain_{w}'] = gains.rolling(w).mean()
            df[f'avg_loss_{w}'] = losses.rolling(w).mean()
            # Use 1% of avg_gain as floor; if no gains, ratio is 0; if no losses, use large value
            avg_loss = df[f'avg_loss_{w}']
            avg_gain = df[f'avg_gain_{w}']
            loss_floor = np.maximum(avg_loss, avg_gain * 0.01)
            df[f'gain_loss_ratio_{w}'] = np.where(
                avg_loss > 0,
                avg_gain / loss_floor,
                np.where(avg_gain > 0, 100.0, 1.0)  # All gains = 100x, no movement = 1x
            )

            # Up/Down bar counting
            df[f'up_bars_{w}'] = (df['ret_1'] > 0).rolling(w).sum()
            df[f'down_bars_{w}'] = (df['ret_1'] < 0).rolling(w).sum()
            df[f'up_ratio_{w}'] = df[f'up_bars_{w}'] / w

            # Trend consistency (0 = choppy, 1 = trending)
            df[f'trend_consistency_{w}'] = (df[f'up_ratio_{w}'] - 0.5).abs() * 2

            # Distance from high/low - floor at 0.1% of close
            rolling_max = df['close'].rolling(w).max()
            rolling_min = df['close'].rolling(w).min()
            close_floor = np.maximum(df['close'].abs() * 0.001, 0.01)
            df[f'dist_from_high_{w}'] = (df['close'] - rolling_max) / np.maximum(rolling_max, close_floor)
            df[f'dist_from_low_{w}'] = (df['close'] - rolling_min) / np.maximum(rolling_min, close_floor)

        return df

    # =========================================================================
    # MICROSTRUCTURE FEATURES
    # =========================================================================

    def _add_microstructure_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add within-bar microstructure features."""
        # Bar efficiency (how much of the range was "used")
        # 1.0 = perfect trend bar, 0.0 = doji
        # Floor range at 0.01% of close for doji bars
        range_floor = np.maximum(df['range'], df['close'] * 0.0001)
        df['efficiency'] = df['body_abs'] / range_floor

        # Buying vs selling pressure (wick analysis)
        # If no wicks (total = 0), pressure is undefined - use 0.5 (neutral)
        total_wick = df['upper_wick'] + df['lower_wick']
        df['buy_pressure'] = np.where(
            total_wick > 0,
            df['lower_wick'] / total_wick,
            0.5  # No wicks = neutral
        )
        df['sell_pressure'] = np.where(
            total_wick > 0,
            df['upper_wick'] / total_wick,
            0.5  # No wicks = neutral
        )

        # Volume concentration (high = absorption, low = breakout)
        df['vol_concentration'] = df['volume'] / range_floor

        # Normalized to rolling average - floor at 1% of rolling mean
        vol_conc_mean = df['vol_concentration'].rolling(20).mean()
        vol_conc_floor = np.maximum(vol_conc_mean, vol_conc_mean.abs() * 0.01)
        df['vol_concentration_norm'] = df['vol_concentration'] / np.maximum(vol_conc_floor, 1)

        # True range (includes gaps)
        prev_close = df['close'].shift(1)
        df['true_range'] = pd.concat([
            df['high'] - df['low'],
            (df['high'] - prev_close).abs(),
            (df['low'] - prev_close).abs()
        ], axis=1).max(axis=1)

        return df

    # =========================================================================
    # TIME FEATURES
    # =========================================================================

    def _add_time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add time-based features."""
        # Try to get datetime from index or column
        if isinstance(df.index, pd.DatetimeIndex):
            ts = df.index
        elif 'timestamp' in df.columns:
            ts = pd.to_datetime(df['timestamp'])
        elif 'datetime' in df.columns:
            ts = pd.to_datetime(df['datetime'])
        elif 'window_start' in df.columns:
            ts = pd.to_datetime(df['window_start'])
        else:
            logger.warning("No timestamp found, skipping time features")
            return df

        # Convert to DatetimeIndex if Series
        if isinstance(ts, pd.Series):
            ts = pd.DatetimeIndex(ts)

        # Basic time components
        df['hour'] = ts.hour
        df['minute'] = ts.minute
        df['day_of_week'] = ts.dayofweek
        df['day_of_month'] = ts.day

        # Minute of day
        df['minute_of_day'] = ts.hour * 60 + ts.minute

        # Market session flags (assuming US market hours)
        df['is_first_hour'] = (((ts.hour == 9) & (ts.minute >= 30)) | (ts.hour == 10)).astype(int)
        df['is_last_hour'] = (ts.hour >= 15).astype(int)
        df['is_lunch'] = ((ts.hour >= 12) & (ts.hour < 14)).astype(int)

        # Cyclical encoding (for ML - captures periodicity)
        df['hour_sin'] = np.sin(2 * np.pi * ts.hour / 24)
        df['hour_cos'] = np.cos(2 * np.pi * ts.hour / 24)
        df['dow_sin'] = np.sin(2 * np.pi * ts.dayofweek / 7)
        df['dow_cos'] = np.cos(2 * np.pi * ts.dayofweek / 7)

        return df

    # =========================================================================
    # TARGET VARIABLES
    # =========================================================================

    def _add_target_variables(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add target variables for prediction."""
        # Future returns (classification targets)
        df['target_ret_1'] = df['close'].shift(-1) / df['close'] - 1
        df['target_ret_5'] = df['close'].shift(-5) / df['close'] - 1
        df['target_ret_15'] = df['close'].shift(-15) / df['close'] - 1
        df['target_ret_60'] = df['close'].shift(-60) / df['close'] - 1

        # Direction targets (binary)
        df['target_dir_1'] = (df['target_ret_1'] > 0).astype(int)
        df['target_dir_5'] = (df['target_ret_5'] > 0).astype(int)

        # Triple barrier target (simplified - needs ATR)
        atr_20 = df['range'].rolling(20).mean()
        df['target_triple_barrier'] = self._compute_triple_barrier(
            df['close'], df['high'], df['low'], atr_20, horizon=15
        )

        return df

    def _compute_triple_barrier(
        self,
        close: pd.Series,
        high: pd.Series,
        low: pd.Series,
        atr: pd.Series,
        horizon: int = 15,
        tp_mult: float = 1.0,
        sl_mult: float = 1.0
    ) -> pd.Series:
        """
        Compute triple barrier target.

        Returns:
            1 = hit take profit before stop loss (long wins)
           -1 = hit stop loss before take profit (short wins)
            0 = neither hit within horizon (timeout)
        """
        result = pd.Series(index=close.index, dtype=float)
        result[:] = np.nan

        for i in range(len(close) - horizon):
            entry_price = close.iloc[i]
            entry_atr = atr.iloc[i]

            if pd.isna(entry_atr) or entry_atr == 0:
                continue

            tp_level = entry_price + (entry_atr * tp_mult)
            sl_level = entry_price - (entry_atr * sl_mult)

            # Check future bars
            for j in range(1, horizon + 1):
                if i + j >= len(close):
                    break

                future_high = high.iloc[i + j]
                future_low = low.iloc[i + j]

                # Check if hit TP
                if future_high >= tp_level:
                    result.iloc[i] = 1
                    break
                # Check if hit SL
                if future_low <= sl_level:
                    result.iloc[i] = -1
                    break
            else:
                # Timeout - neither hit
                result.iloc[i] = 0

        return result

    def get_feature_names(self) -> List[str]:
        """Get list of all feature names that will be generated."""
        # Create a small dummy dataframe to get feature names
        dummy = pd.DataFrame({
            'open': [100] * 150,
            'high': [101] * 150,
            'low': [99] * 150,
            'close': [100.5] * 150,
            'volume': [1000] * 150,
            'timestamp': pd.date_range('2020-01-01', periods=150, freq='1min')
        })
        result = self.generate(dummy, include_targets=False)
        return [c for c in result.columns if c not in ['open', 'high', 'low', 'close', 'volume', 'timestamp']]


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample data
    np.random.seed(42)
    n = 1000

    dates = pd.date_range('2024-01-01 09:30', periods=n, freq='1min')
    close = 100 + np.cumsum(np.random.randn(n) * 0.1)

    df = pd.DataFrame({
        'timestamp': dates,
        'open': close - np.random.rand(n) * 0.5,
        'high': close + np.random.rand(n) * 0.5,
        'low': close - np.random.rand(n) * 0.5,
        'close': close,
        'volume': np.random.randint(100, 10000, n)
    })

    # Generate features
    generator = RawFeatureGenerator()
    features = generator.generate(df)

    print(f"\nOriginal columns: {len(df.columns)}")
    print(f"Total columns after: {len(features.columns)}")
    print(f"Features generated: {len(features.columns) - len(df.columns)}")

    # Show sample
    print("\nSample features:")
    feature_cols = [c for c in features.columns if c not in df.columns][:20]
    print(features[feature_cols].tail(5))

    # Check for NaN columns
    nan_pct = features.isna().mean()
    high_nan = nan_pct[nan_pct > 0.5]
    if len(high_nan) > 0:
        print(f"\nWarning: {len(high_nan)} columns have >50% NaN")
