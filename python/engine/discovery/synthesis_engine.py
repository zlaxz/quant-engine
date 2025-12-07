#!/usr/bin/env python3
"""
Synthesis Engine: Micro-State (PVSI) + Macro-State (Regime) → Conditional Probability

The architecture that combines:
1. PVSI-like bar encoding (micro-state): What is THIS bar doing?
2. Regime classification (macro-state): What is the MARKET doing?
3. Conditional probability: P(outcome | micro-state, macro-state)

The same micro-pattern means different things in different regimes.
This is how we avoid averaging opposite signals into noise.
"""

import os
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("AlphaFactory.Synthesis")


# ============================================================================
# MICRO-STATE: PVSI-Style Bar Encoding
# ============================================================================

@dataclass
class MicroState:
    """4-bit encoding of a single bar's state."""
    P: int  # Price direction: 1 if close > prev_close
    V: int  # Volume direction: 1 if volume > prev_volume
    S: int  # Strength: 1 if strong move (body > 50% of range AND favorable close)
    I: int  # Impact: 1 if move was LESS than expected (absorption)

    def to_int(self) -> int:
        """Convert to integer 0-15."""
        return (self.P << 3) | (self.V << 2) | (self.S << 1) | self.I

    def to_binary(self) -> str:
        """Convert to binary string like '1101'."""
        return f"{self.P}{self.V}{self.S}{self.I}"

    @classmethod
    def from_int(cls, value: int) -> 'MicroState':
        """Create from integer 0-15."""
        return cls(
            P=(value >> 3) & 1,
            V=(value >> 2) & 1,
            S=(value >> 1) & 1,
            I=value & 1
        )


class PVSIEncoder:
    """
    Encodes each bar into a 4-bit PVSI state.

    P = Price Direction (1 = up, 0 = down)
    V = Volume Direction (1 = higher than prev, 0 = lower)
    S = Strength (1 = strong body relative to range, 0 = weak)
    I = Impact/Absorption (1 = move was smaller than expected given volume)

    Based on the PVSI methodology, adapted for our data.
    """

    # Thresholds (can be tuned)
    STRENGTH_BODY_RATIO = 0.5  # Body must be > 50% of range for S=1
    STRENGTH_CLV_THRESHOLD = 0.3  # Close must be in favorable zone

    def __init__(self, lookback_for_expected_move: int = 20):
        """
        Args:
            lookback_for_expected_move: Bars to use for expected move calculation
        """
        self.lookback = lookback_for_expected_move
        self._expected_move_params: Optional[Tuple[float, float]] = None

    def fit(self, df: pd.DataFrame) -> 'PVSIEncoder':
        """
        Fit the expected move model: EM = a + b * ln(Volume)

        This allows us to calculate the Impact bit (I):
        If actual move < expected move, it's absorption (I=1)
        """
        # Calculate actual moves and log volume
        df = df.copy()
        df['actual_move'] = df['high'] - df['low']
        df['log_volume'] = np.log(df['volume'].clip(lower=1))

        # Simple linear regression: EM = a + b * ln(V)
        # Using numpy for speed
        valid = df[['log_volume', 'actual_move']].dropna()
        if len(valid) < 100:
            # Default params if not enough data
            self._expected_move_params = (0.0, 1.0)
            return self

        X = valid['log_volume'].values
        y = valid['actual_move'].values

        # OLS: b = cov(x,y) / var(x), a = mean(y) - b * mean(x)
        b = np.cov(X, y)[0, 1] / (np.var(X) + 1e-10)
        a = np.mean(y) - b * np.mean(X)

        self._expected_move_params = (a, b)
        logger.info(f"PVSI Expected Move: EM = {a:.4f} + {b:.4f} * ln(Volume)")

        return self

    def expected_move(self, volume: float) -> float:
        """Calculate expected move given volume."""
        if self._expected_move_params is None:
            raise ValueError("Must call fit() before expected_move()")
        a, b = self._expected_move_params
        return a + b * np.log(max(volume, 1))

    def encode_bar(
        self,
        row: pd.Series,
        prev_row: pd.Series,
        sigma_resid: float = 1.0
    ) -> MicroState:
        """
        Encode a single bar into PVSI state.

        Args:
            row: Current bar (must have open, high, low, close, volume)
            prev_row: Previous bar
            sigma_resid: Residual std for z-score calculation
        """
        # P: Price Direction
        P = 1 if row['close'] > prev_row['close'] else 0

        # V: Volume Direction
        V = 1 if row['volume'] > prev_row['volume'] else 0

        # S: Strength
        # Body must be significant portion of range
        body = abs(row['close'] - row['open'])
        range_ = row['high'] - row['low']
        if range_ < 1e-10:
            range_ = 1e-10  # Avoid division by zero

        body_ratio = body / range_

        # Close location value: where close is in the range (-1 to +1)
        clv = (2 * row['close'] - row['high'] - row['low']) / range_

        # S=1 if strong body AND close in favorable direction
        favorable_close = (P == 1 and clv > self.STRENGTH_CLV_THRESHOLD) or \
                         (P == 0 and clv < -self.STRENGTH_CLV_THRESHOLD)
        S = 1 if (body_ratio >= self.STRENGTH_BODY_RATIO and favorable_close) else 0

        # I: Impact/Absorption
        # If actual move < expected move, volume was "absorbed"
        actual_move = range_
        expected = self.expected_move(row['volume'])
        z_impact = (actual_move - expected) / (sigma_resid + 1e-10)

        # I=1 means absorption (move was smaller than expected)
        I = 1 if z_impact <= 0.58 else 0  # Threshold from PVSI spec

        return MicroState(P=P, V=V, S=S, I=I)

    def encode_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Encode entire dataframe, adding PVSI columns.

        Adds columns:
        - pvsi_P, pvsi_V, pvsi_S, pvsi_I (individual bits)
        - pvsi_state (integer 0-15)
        - pvsi_binary (string like '1101')
        """
        df = df.copy()

        # Fit expected move model if not already fit
        if self._expected_move_params is None:
            self.fit(df)

        # Calculate residual std for z-score
        df['actual_move'] = df['high'] - df['low']
        df['log_volume'] = np.log(df['volume'].clip(lower=1))
        a, b = self._expected_move_params
        df['expected_move'] = a + b * df['log_volume']
        df['move_residual'] = df['actual_move'] - df['expected_move']
        sigma_resid = df['move_residual'].std()

        # Initialize columns
        df['pvsi_P'] = 0
        df['pvsi_V'] = 0
        df['pvsi_S'] = 0
        df['pvsi_I'] = 0

        # Encode each bar (vectorized where possible)
        df['pvsi_P'] = (df['close'] > df['close'].shift(1)).astype(int)
        df['pvsi_V'] = (df['volume'] > df['volume'].shift(1)).astype(int)

        # Strength calculation
        df['body'] = abs(df['close'] - df['open'])
        df['range'] = df['high'] - df['low']
        df['range'] = df['range'].clip(lower=1e-10)
        df['body_ratio'] = df['body'] / df['range']
        df['clv'] = (2 * df['close'] - df['high'] - df['low']) / df['range']

        # S = 1 if strong body and favorable close
        favorable_up = (df['pvsi_P'] == 1) & (df['clv'] > self.STRENGTH_CLV_THRESHOLD)
        favorable_down = (df['pvsi_P'] == 0) & (df['clv'] < -self.STRENGTH_CLV_THRESHOLD)
        strong_body = df['body_ratio'] >= self.STRENGTH_BODY_RATIO
        df['pvsi_S'] = ((favorable_up | favorable_down) & strong_body).astype(int)

        # Impact calculation
        df['z_impact'] = df['move_residual'] / (sigma_resid + 1e-10)
        df['pvsi_I'] = (df['z_impact'] <= 0.58).astype(int)

        # Combined state
        df['pvsi_state'] = (df['pvsi_P'].astype(int) * 8) + (df['pvsi_V'].astype(int) * 4) + \
                          (df['pvsi_S'].astype(int) * 2) + df['pvsi_I'].astype(int)
        df['pvsi_binary'] = df.apply(
            lambda r: f"{int(r['pvsi_P'])}{int(r['pvsi_V'])}{int(r['pvsi_S'])}{int(r['pvsi_I'])}",
            axis=1
        )

        # Clean up temp columns
        df = df.drop(columns=[
            'actual_move', 'log_volume', 'expected_move', 'move_residual',
            'body', 'range', 'body_ratio', 'clv', 'z_impact'
        ], errors='ignore')

        return df


# ============================================================================
# MACRO-STATE: Regime Classification
# ============================================================================

class RegimeClassifier:
    """
    Classifies market into macro regimes using unsupervised clustering.

    Features used for regime detection:
    - Volatility (rolling std of returns)
    - Trend (rolling return)
    - Volume regime (relative to average)
    - Cross-asset correlations (if multi-asset data available)
    """

    def __init__(self, n_regimes: int = 4, lookback: int = 60):
        """
        Args:
            n_regimes: Number of regimes to detect
            lookback: Rolling window for regime features
        """
        self.n_regimes = n_regimes
        self.lookback = lookback
        self.model: Optional[KMeans] = None
        self.scaler: Optional[StandardScaler] = None
        self.regime_names: Dict[int, str] = {}

    def _compute_regime_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute features used for regime classification."""
        features = pd.DataFrame(index=df.index)

        # Returns
        df['return'] = df['close'].pct_change()

        # Volatility (annualized)
        features['volatility'] = df['return'].rolling(self.lookback).std() * np.sqrt(252 * 390)

        # Trend (cumulative return over lookback)
        features['trend'] = df['return'].rolling(self.lookback).sum()

        # Volume regime
        features['volume_ratio'] = df['volume'] / df['volume'].rolling(self.lookback).mean()

        # Volatility of volatility (regime stability)
        features['vol_of_vol'] = features['volatility'].rolling(20).std()

        # Trend consistency (what % of bars were in trend direction)
        features['trend_consistency'] = df['return'].rolling(self.lookback).apply(
            lambda x: (np.sign(x) == np.sign(x.sum())).mean()
        )

        return features.dropna()

    def fit(self, df: pd.DataFrame) -> 'RegimeClassifier':
        """Fit regime classifier on historical data."""
        features = self._compute_regime_features(df)

        if len(features) < self.n_regimes * 10:
            raise ValueError(f"Not enough data for {self.n_regimes} regimes")

        # Scale features
        self.scaler = StandardScaler()
        X = self.scaler.fit_transform(features)

        # Cluster
        self.model = KMeans(n_clusters=self.n_regimes, random_state=42, n_init=10)
        self.model.fit(X)

        # Name regimes based on characteristics
        self._name_regimes(features)

        logger.info(f"Regime classifier fit with {self.n_regimes} regimes")
        for i, name in self.regime_names.items():
            logger.info(f"  Regime {i}: {name}")

        return self

    def _name_regimes(self, features: pd.DataFrame):
        """Assign descriptive names to regimes based on cluster centers."""
        labels = self.model.labels_

        for i in range(self.n_regimes):
            mask = labels == i
            regime_data = features[mask]

            avg_vol = regime_data['volatility'].mean()
            avg_trend = regime_data['trend'].mean()
            avg_consistency = regime_data['trend_consistency'].mean()

            # Classify based on characteristics
            if avg_vol > features['volatility'].quantile(0.75):
                vol_desc = "HighVol"
            elif avg_vol < features['volatility'].quantile(0.25):
                vol_desc = "LowVol"
            else:
                vol_desc = "MidVol"

            if avg_trend > 0.02:
                trend_desc = "Bull"
            elif avg_trend < -0.02:
                trend_desc = "Bear"
            else:
                trend_desc = "Chop"

            if avg_consistency > 0.6:
                trend_desc += "Trend"

            self.regime_names[i] = f"{vol_desc}_{trend_desc}"

    def predict(self, df: pd.DataFrame) -> pd.Series:
        """Predict regime for each row."""
        if self.model is None:
            raise ValueError("Must call fit() before predict()")

        features = self._compute_regime_features(df)
        X = self.scaler.transform(features)

        # Create series with original index
        labels = pd.Series(index=features.index, data=self.model.predict(X))

        # Reindex to original dataframe (forward fill for missing)
        return labels.reindex(df.index).ffill().fillna(0).astype(int)

    def get_regime_name(self, regime_id: int) -> str:
        """Get descriptive name for regime."""
        return self.regime_names.get(regime_id, f"Regime_{regime_id}")


# ============================================================================
# CONDITIONAL PROBABILITY MODEL
# ============================================================================

class ConditionalProbabilityModel:
    """
    Builds conditional probability tables:
    P(next_up | micro_state_sequence, macro_regime)

    This is the core predictive model that combines PVSI with regimes.
    """

    def __init__(self, sequence_length: int = 3, min_samples: int = 30):
        """
        Args:
            sequence_length: Number of bars in PVSI sequence (default 3 = 12-bit)
            min_samples: Minimum samples to compute probability
        """
        self.sequence_length = sequence_length
        self.min_samples = min_samples
        self.prob_table: Dict[Tuple[str, int], Dict] = {}
        self.base_rate: float = 0.5

    def _create_sequences(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create PVSI sequences from encoded data."""
        df = df.copy()

        # Create sequence by shifting and concatenating
        sequence_parts = []
        for i in range(self.sequence_length):
            shifted = df['pvsi_binary'].shift(i)
            sequence_parts.append(shifted)

        # Concatenate: most recent first
        df['pvsi_sequence'] = sequence_parts[0]
        for i in range(1, self.sequence_length):
            df['pvsi_sequence'] = df['pvsi_sequence'] + '-' + sequence_parts[i]

        return df

    def fit(self, df: pd.DataFrame, target_col: str = 'next_up') -> 'ConditionalProbabilityModel':
        """
        Fit probability tables.

        Args:
            df: DataFrame with pvsi_binary, regime, and target columns
            target_col: Name of target column (1 = up, 0 = down)
        """
        df = self._create_sequences(df)

        # Calculate base rate
        self.base_rate = df[target_col].mean()
        logger.info(f"Base rate P(up): {self.base_rate:.2%}")

        # Group by (sequence, regime) and calculate probability
        for (sequence, regime), group in df.groupby(['pvsi_sequence', 'regime']):
            if pd.isna(sequence):
                continue

            n_samples = len(group)
            if n_samples < self.min_samples:
                continue

            prob_up = group[target_col].mean()

            key = (sequence, regime)
            self.prob_table[key] = {
                'prob_up': prob_up,
                'n_samples': n_samples,
                'edge': prob_up - self.base_rate
            }

        logger.info(f"Built probability table with {len(self.prob_table)} entries")

        # Log top edges
        sorted_entries = sorted(
            self.prob_table.items(),
            key=lambda x: abs(x[1]['edge']),
            reverse=True
        )[:10]

        logger.info("Top 10 edges:")
        for (seq, regime), stats in sorted_entries:
            logger.info(
                f"  {seq} | Regime {regime}: "
                f"P(up)={stats['prob_up']:.1%} "
                f"edge={stats['edge']:+.1%} "
                f"n={stats['n_samples']}"
            )

        return self

    def predict_probability(self, sequence: str, regime: int) -> Dict:
        """
        Get probability for a specific sequence + regime.

        Returns:
            Dict with prob_up, n_samples, edge, or defaults if not found
        """
        key = (sequence, regime)

        if key in self.prob_table:
            return self.prob_table[key]

        # Fallback: try sequence only (any regime)
        sequence_matches = [
            v for k, v in self.prob_table.items()
            if k[0] == sequence
        ]
        if sequence_matches:
            avg_prob = np.mean([m['prob_up'] for m in sequence_matches])
            total_n = sum(m['n_samples'] for m in sequence_matches)
            return {
                'prob_up': avg_prob,
                'n_samples': total_n,
                'edge': avg_prob - self.base_rate,
                'fallback': 'sequence_only'
            }

        # Default to base rate
        return {
            'prob_up': self.base_rate,
            'n_samples': 0,
            'edge': 0.0,
            'fallback': 'base_rate'
        }

    def get_high_edge_patterns(self, min_edge: float = 0.05) -> pd.DataFrame:
        """Get patterns with significant edge."""
        rows = []
        for (sequence, regime), stats in self.prob_table.items():
            if abs(stats['edge']) >= min_edge:
                rows.append({
                    'sequence': sequence,
                    'regime': regime,
                    'prob_up': stats['prob_up'],
                    'edge': stats['edge'],
                    'n_samples': stats['n_samples'],
                    'direction': 'LONG' if stats['edge'] > 0 else 'SHORT'
                })

        return pd.DataFrame(rows).sort_values('edge', key=abs, ascending=False)


# ============================================================================
# SYNTHESIS ENGINE: Combines Everything
# ============================================================================

class SynthesisEngine:
    """
    Main engine that combines:
    1. PVSI micro-state encoding
    2. Regime macro-state classification
    3. Conditional probability model

    Usage:
        engine = SynthesisEngine()
        engine.fit(historical_data)
        prediction = engine.predict(current_bar, recent_bars)
    """

    def __init__(
        self,
        n_regimes: int = 4,
        sequence_length: int = 3,
        regime_lookback: int = 60,
        min_samples: int = 30
    ):
        self.pvsi_encoder = PVSIEncoder()
        self.regime_classifier = RegimeClassifier(n_regimes=n_regimes, lookback=regime_lookback)
        self.prob_model = ConditionalProbabilityModel(
            sequence_length=sequence_length,
            min_samples=min_samples
        )
        self.is_fitted = False

    def fit(self, df: pd.DataFrame) -> 'SynthesisEngine':
        """
        Fit all components on historical data.

        Args:
            df: DataFrame with OHLCV data
        """
        logger.info("Fitting Synthesis Engine...")

        # Step 1: Encode PVSI
        logger.info("Step 1: Encoding PVSI micro-states...")
        df = self.pvsi_encoder.encode_dataframe(df)

        # Step 2: Classify regimes
        logger.info("Step 2: Classifying macro regimes...")
        df['regime'] = self.regime_classifier.fit(df).predict(df)

        # Step 3: Create target (next bar up)
        df['next_up'] = (df['close'].shift(-1) > df['close']).astype(int)

        # Step 4: Fit probability model
        logger.info("Step 3: Building conditional probability model...")
        self.prob_model.fit(df, target_col='next_up')

        self.is_fitted = True
        logger.info("Synthesis Engine fitted successfully!")

        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate predictions for dataframe.

        Returns dataframe with added columns:
        - pvsi_* columns
        - regime
        - pred_prob_up
        - pred_edge
        - pred_signal (1, 0, -1)
        """
        if not self.is_fitted:
            raise ValueError("Must call fit() before predict()")

        # Encode PVSI
        df = self.pvsi_encoder.encode_dataframe(df)

        # Classify regime
        df['regime'] = self.regime_classifier.predict(df)

        # Create sequences
        df = self.prob_model._create_sequences(df)

        # Get predictions - vectorized where possible, parallel for complex lookups
        # Pre-extract arrays for thread-safe parallel access
        sequences = df['pvsi_sequence'].values
        regimes = df['regime'].values

        # Parallel prediction using ThreadPoolExecutor
        from concurrent.futures import ThreadPoolExecutor

        def predict_single(args):
            seq, regime = args
            return self.prob_model.predict_probability(seq, regime)

        with ThreadPoolExecutor(max_workers=12) as executor:
            predictions = list(executor.map(predict_single, zip(sequences, regimes)))

        df['pred_prob_up'] = [p['prob_up'] for p in predictions]
        df['pred_edge'] = [p['edge'] for p in predictions]
        df['pred_n_samples'] = [p['n_samples'] for p in predictions]

        # Signal: 1 = long, -1 = short, 0 = no trade
        df['pred_signal'] = 0
        df.loc[df['pred_edge'] > 0.05, 'pred_signal'] = 1
        df.loc[df['pred_edge'] < -0.05, 'pred_signal'] = -1

        return df

    def get_statistics(self) -> Dict:
        """Get summary statistics of the fitted model."""
        if not self.is_fitted:
            raise ValueError("Must call fit() first")

        high_edge = self.prob_model.get_high_edge_patterns(min_edge=0.05)

        return {
            'n_patterns': len(self.prob_model.prob_table),
            'base_rate': self.prob_model.base_rate,
            'n_high_edge_patterns': len(high_edge),
            'regime_names': self.regime_classifier.regime_names,
            'top_long_patterns': high_edge[high_edge['direction'] == 'LONG'].head(5).to_dict('records'),
            'top_short_patterns': high_edge[high_edge['direction'] == 'SHORT'].head(5).to_dict('records'),
        }


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def load_stock_data(data_dir: str, symbols: List[str] = None) -> pd.DataFrame:
    """Load stock data from parquet files."""
    data_path = Path(data_dir)

    if symbols is None:
        symbols = ['SPY']  # Default to SPY

    all_data = []
    for symbol in symbols:
        pattern = data_path / f"*{symbol}*.parquet"
        files = list(data_path.glob(f"*"))

        for f in sorted(files):
            if f.suffix == '.parquet':
                try:
                    df = pd.read_parquet(f)
                    if 'ticker' in df.columns:
                        df = df[df['ticker'] == symbol]
                    all_data.append(df)
                except Exception as e:
                    logger.warning(f"Failed to load {f}: {e}")

    if not all_data:
        raise ValueError(f"No data found for {symbols}")

    combined = pd.concat(all_data, ignore_index=True)

    # Rename columns if needed
    column_map = {
        'window_start': 'timestamp',
        'ts': 'timestamp'
    }
    combined = combined.rename(columns=column_map)

    # Ensure sorted
    if 'timestamp' in combined.columns:
        combined = combined.sort_values('timestamp')

    return combined


if __name__ == '__main__':
    # Quick test
    logging.basicConfig(level=logging.INFO)

    # Load SPY data
    data_dir = '/Volumes/VelocityData/velocity_om/massive/stocks'

    print("Loading data...")
    df = load_stock_data(data_dir, ['SPY'])
    print(f"Loaded {len(df)} bars")

    print("\nFitting Synthesis Engine...")
    engine = SynthesisEngine(n_regimes=4, sequence_length=3)
    engine.fit(df)

    print("\nStatistics:")
    stats = engine.get_statistics()
    for k, v in stats.items():
        print(f"  {k}: {v}")
