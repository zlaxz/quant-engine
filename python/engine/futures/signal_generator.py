"""
Futures Signal Generator

Production-grade signal generation for futures trading.
Modular, composable signals with proper state management.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Callable, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
import logging

logger = logging.getLogger(__name__)


class SignalType(Enum):
    """Signal types."""
    LONG = 1
    SHORT = -1
    FLAT = 0


@dataclass
class Signal:
    """Individual signal output."""
    timestamp: pd.Timestamp
    symbol: str
    signal_type: SignalType
    strength: float  # -1 to 1
    confidence: float  # 0 to 1
    source: str  # Which generator produced this
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        # Validate bounds
        self.strength = max(-1.0, min(1.0, self.strength))
        self.confidence = max(0.0, min(1.0, self.confidence))


class BaseSignalGenerator(ABC):
    """
    Abstract base for all signal generators.

    All generators must implement:
    - generate(): Produce signals from features
    - get_required_features(): List of required feature columns
    """

    def __init__(self, name: str, params: Optional[Dict] = None):
        self.name = name
        self.params = params or {}
        self._state: Dict[str, Any] = {}

    @abstractmethod
    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        """Generate signals from feature DataFrame."""
        pass

    @abstractmethod
    def get_required_features(self) -> List[str]:
        """Return list of required feature columns."""
        pass

    def reset_state(self):
        """Reset internal state (for walk-forward)."""
        self._state = {}


class MomentumSignalGenerator(BaseSignalGenerator):
    """
    Momentum-based signal generator.

    Uses multiple timeframe momentum with trend confirmation.
    """

    def __init__(
        self,
        fast_period: int = 10,
        slow_period: int = 50,
        rsi_period: int = 14,
        rsi_overbought: float = 70,
        rsi_oversold: float = 30,
        trend_filter: bool = True
    ):
        super().__init__("momentum")
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.rsi_period = rsi_period
        self.rsi_overbought = rsi_overbought
        self.rsi_oversold = rsi_oversold
        self.trend_filter = trend_filter

    def get_required_features(self) -> List[str]:
        return [
            f'ret_{self.fast_period}',
            f'ret_{self.slow_period}',
            f'rsi_{self.rsi_period}',
            f'sma_{self.fast_period}',
            f'sma_{self.slow_period}',
            'close'
        ]

    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        signals = []

        for idx, row in df.iterrows():
            # Check required features exist
            fast_ret = row.get(f'ret_{self.fast_period}', 0)
            slow_ret = row.get(f'ret_{self.slow_period}', 0)
            rsi = row.get(f'rsi_{self.rsi_period}', 50)

            # Calculate momentum score
            momentum_score = 0.0

            # Fast momentum contribution (40%)
            momentum_score += 0.4 * np.clip(fast_ret * 10, -1, 1)

            # Slow momentum contribution (30%)
            momentum_score += 0.3 * np.clip(slow_ret * 5, -1, 1)

            # RSI contribution (30%)
            rsi_normalized = (rsi - 50) / 50  # -1 to 1
            momentum_score += 0.3 * rsi_normalized

            # Trend filter
            if self.trend_filter:
                fast_ma = row.get(f'sma_{self.fast_period}', 0)
                slow_ma = row.get(f'sma_{self.slow_period}', 0)
                trend_up = fast_ma > slow_ma

                # Only take signals in trend direction
                if trend_up and momentum_score < 0:
                    momentum_score *= 0.3  # Reduce counter-trend signals
                elif not trend_up and momentum_score > 0:
                    momentum_score *= 0.3

            # Determine signal type
            if momentum_score > 0.2:
                signal_type = SignalType.LONG
            elif momentum_score < -0.2:
                signal_type = SignalType.SHORT
            else:
                signal_type = SignalType.FLAT

            # Confidence based on agreement of indicators
            rsi_confirms = (rsi < self.rsi_oversold and momentum_score > 0) or \
                          (rsi > self.rsi_overbought and momentum_score < 0)
            confidence = 0.5 + 0.3 * abs(momentum_score) + 0.2 * int(rsi_confirms)

            signals.append(Signal(
                timestamp=idx,
                symbol=symbol,
                signal_type=signal_type,
                strength=momentum_score,
                confidence=confidence,
                source=self.name,
                metadata={
                    'fast_ret': fast_ret,
                    'slow_ret': slow_ret,
                    'rsi': rsi
                }
            ))

        return signals


class MeanReversionSignalGenerator(BaseSignalGenerator):
    """
    Mean reversion signal generator.

    Uses Bollinger Bands and z-score for reversal signals.
    """

    def __init__(
        self,
        bb_period: int = 20,
        zscore_period: int = 20,
        entry_zscore: float = 2.0,
        exit_zscore: float = 0.5,
        vol_filter: bool = True
    ):
        super().__init__("mean_reversion")
        self.bb_period = bb_period
        self.zscore_period = zscore_period
        self.entry_zscore = entry_zscore
        self.exit_zscore = exit_zscore
        self.vol_filter = vol_filter

    def get_required_features(self) -> List[str]:
        return [
            f'bb_pct_{self.bb_period}',
            f'bb_width_{self.bb_period}',
            f'realized_vol_{self.zscore_period}',
            'close',
            f'sma_{self.bb_period}'
        ]

    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        signals = []

        for idx, row in df.iterrows():
            bb_pct = row.get(f'bb_pct_{self.bb_period}', 0.5)
            bb_width = row.get(f'bb_width_{self.bb_period}', 0)
            vol = row.get(f'realized_vol_{self.zscore_period}', 0.15)
            close = row.get('close', 0)
            sma = row.get(f'sma_{self.bb_period}', close)

            # Calculate z-score
            if sma > 0:
                zscore = (close - sma) / (sma * vol / np.sqrt(252)) if vol > 0 else 0
            else:
                zscore = 0

            # Mean reversion score (negative of zscore - we fade extremes)
            mr_score = -np.clip(zscore / self.entry_zscore, -1, 1)

            # Determine signal
            if zscore < -self.entry_zscore:
                signal_type = SignalType.LONG  # Oversold - buy
            elif zscore > self.entry_zscore:
                signal_type = SignalType.SHORT  # Overbought - sell
            elif abs(zscore) < self.exit_zscore:
                signal_type = SignalType.FLAT  # Back to mean - exit
            else:
                signal_type = SignalType.FLAT

            # Volatility filter - mean reversion works better in normal vol
            if self.vol_filter and vol > 0.30:  # High vol = trend more likely
                mr_score *= 0.5
                signal_type = SignalType.FLAT

            # Confidence based on extreme and vol regime
            confidence = 0.4 + 0.4 * min(abs(zscore) / 3, 1) + 0.2 * (1 - min(vol / 0.3, 1))

            signals.append(Signal(
                timestamp=idx,
                symbol=symbol,
                signal_type=signal_type,
                strength=mr_score,
                confidence=confidence,
                source=self.name,
                metadata={
                    'zscore': zscore,
                    'bb_pct': bb_pct,
                    'vol': vol
                }
            ))

        return signals


class BreakoutSignalGenerator(BaseSignalGenerator):
    """
    Breakout signal generator.

    Uses range breakouts with volume confirmation.
    """

    def __init__(
        self,
        lookback: int = 20,
        atr_period: int = 14,
        volume_mult: float = 1.5,
        confirmation_bars: int = 2
    ):
        super().__init__("breakout")
        self.lookback = lookback
        self.atr_period = atr_period
        self.volume_mult = volume_mult
        self.confirmation_bars = confirmation_bars
        self._breakout_state: Dict[str, Dict] = {}

    def get_required_features(self) -> List[str]:
        return [
            f'resistance_{self.lookback}',
            f'support_{self.lookback}',
            f'atr_{self.atr_period}',
            f'vol_ratio_{self.lookback}',
            'close',
            'high',
            'low',
            'volume'
        ]

    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        signals = []

        # Track breakout confirmation
        if symbol not in self._breakout_state:
            self._breakout_state[symbol] = {
                'direction': 0,
                'bars_confirmed': 0,
                'breakout_level': 0
            }

        state = self._breakout_state[symbol]

        for idx, row in df.iterrows():
            resistance = row.get(f'resistance_{self.lookback}', 0)
            support = row.get(f'support_{self.lookback}', 0)
            atr = row.get(f'atr_{self.atr_period}', 0)
            vol_ratio = row.get(f'vol_ratio_{self.lookback}', 1.0)
            close = row.get('close', 0)
            high = row.get('high', 0)
            low = row.get('low', 0)

            breakout_score = 0.0
            signal_type = SignalType.FLAT

            # Check for new breakout
            if high > resistance and vol_ratio > self.volume_mult:
                # Upside breakout with volume
                state['direction'] = 1
                state['bars_confirmed'] = 1
                state['breakout_level'] = resistance

            elif low < support and vol_ratio > self.volume_mult:
                # Downside breakout with volume
                state['direction'] = -1
                state['bars_confirmed'] = 1
                state['breakout_level'] = support

            # Track confirmation
            elif state['direction'] != 0:
                if state['direction'] == 1 and close > state['breakout_level']:
                    state['bars_confirmed'] += 1
                elif state['direction'] == -1 and close < state['breakout_level']:
                    state['bars_confirmed'] += 1
                else:
                    # Failed breakout
                    state['direction'] = 0
                    state['bars_confirmed'] = 0

            # Generate signal after confirmation
            if state['bars_confirmed'] >= self.confirmation_bars:
                if state['direction'] == 1:
                    signal_type = SignalType.LONG
                    breakout_score = min(1.0, state['bars_confirmed'] / 5)
                elif state['direction'] == -1:
                    signal_type = SignalType.SHORT
                    breakout_score = -min(1.0, state['bars_confirmed'] / 5)

            # Confidence based on volume and confirmation
            confidence = 0.3 + 0.3 * min(vol_ratio / 2, 1) + \
                        0.4 * min(state['bars_confirmed'] / self.confirmation_bars, 1)

            signals.append(Signal(
                timestamp=idx,
                symbol=symbol,
                signal_type=signal_type,
                strength=breakout_score,
                confidence=confidence,
                source=self.name,
                metadata={
                    'breakout_direction': state['direction'],
                    'bars_confirmed': state['bars_confirmed'],
                    'vol_ratio': vol_ratio
                }
            ))

        return signals


class VolatilityRegimeSignalGenerator(BaseSignalGenerator):
    """
    Volatility regime signal generator.

    Adapts to vol regime - trend-following in high vol,
    mean-reversion in low vol.
    """

    def __init__(
        self,
        vol_period: int = 20,
        vol_percentile_period: int = 252,
        high_vol_threshold: float = 0.7,
        low_vol_threshold: float = 0.3
    ):
        super().__init__("vol_regime")
        self.vol_period = vol_period
        self.vol_percentile_period = vol_percentile_period
        self.high_vol_threshold = high_vol_threshold
        self.low_vol_threshold = low_vol_threshold

    def get_required_features(self) -> List[str]:
        return [
            f'realized_vol_{self.vol_period}',
            'vol_percentile',
            f'ret_{self.vol_period}',
            f'bb_pct_20',
            'trend_score'
        ]

    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        signals = []

        for idx, row in df.iterrows():
            vol_pct = row.get('vol_percentile', 0.5)
            ret = row.get(f'ret_{self.vol_period}', 0)
            bb_pct = row.get('bb_pct_20', 0.5)
            trend_score = row.get('trend_score', 0)

            # Determine regime
            if vol_pct > self.high_vol_threshold:
                # High vol = trend following
                regime = 'high_vol'
                # Follow momentum
                score = np.clip(ret * 10, -1, 1) * 0.7 + \
                       np.clip(trend_score / 5, -1, 1) * 0.3
            elif vol_pct < self.low_vol_threshold:
                # Low vol = mean reversion
                regime = 'low_vol'
                # Fade extremes
                score = -(bb_pct - 0.5) * 2
            else:
                # Medium vol = mixed
                regime = 'medium_vol'
                score = np.clip(ret * 5, -1, 1) * 0.5 + \
                       -(bb_pct - 0.5) * 0.5

            # Determine signal type
            if score > 0.3:
                signal_type = SignalType.LONG
            elif score < -0.3:
                signal_type = SignalType.SHORT
            else:
                signal_type = SignalType.FLAT

            # Higher confidence in extreme regimes
            if regime in ['high_vol', 'low_vol']:
                confidence = 0.6 + 0.4 * abs(score)
            else:
                confidence = 0.4 + 0.3 * abs(score)

            signals.append(Signal(
                timestamp=idx,
                symbol=symbol,
                signal_type=signal_type,
                strength=score,
                confidence=confidence,
                source=self.name,
                metadata={
                    'regime': regime,
                    'vol_percentile': vol_pct
                }
            ))

        return signals


class SignalGenerator:
    """
    Master signal generator.

    Combines multiple signal generators with configurable weighting.
    """

    def __init__(
        self,
        generators: Optional[List[Tuple[BaseSignalGenerator, float]]] = None
    ):
        """
        Args:
            generators: List of (generator, weight) tuples
        """
        if generators is None:
            # Default configuration
            self.generators = [
                (MomentumSignalGenerator(), 0.35),
                (MeanReversionSignalGenerator(), 0.25),
                (BreakoutSignalGenerator(), 0.20),
                (VolatilityRegimeSignalGenerator(), 0.20),
            ]
        else:
            self.generators = generators

        # Normalize weights
        total_weight = sum(w for _, w in self.generators)
        self.generators = [(g, w/total_weight) for g, w in self.generators]

    def get_required_features(self) -> List[str]:
        """Get all required features from all generators."""
        features = set()
        for gen, _ in self.generators:
            features.update(gen.get_required_features())
        return list(features)

    def generate(
        self,
        df: pd.DataFrame,
        symbol: str,
        combine_method: str = 'weighted_average'
    ) -> pd.DataFrame:
        """
        Generate combined signals.

        Args:
            df: Feature DataFrame
            symbol: Symbol being analyzed
            combine_method: How to combine signals
                - 'weighted_average': Weighted average of strengths
                - 'vote': Majority vote
                - 'unanimous': All must agree

        Returns:
            DataFrame with signal columns
        """
        # Validate features
        required = self.get_required_features()
        missing = [f for f in required if f not in df.columns]
        if missing:
            logger.warning(f"Missing features: {missing}")

        # Generate signals from each generator
        all_signals: Dict[str, List[Signal]] = {}
        for gen, weight in self.generators:
            try:
                signals = gen.generate(df, symbol)
                all_signals[gen.name] = signals
            except Exception as e:
                logger.error(f"Generator {gen.name} failed: {e}")

        # Combine signals
        result_df = df.copy()
        result_df['signal'] = 0.0
        result_df['signal_type'] = SignalType.FLAT.value
        result_df['confidence'] = 0.0
        result_df['signal_sources'] = ''

        for i, idx in enumerate(df.index):
            if combine_method == 'weighted_average':
                combined_strength = 0.0
                combined_confidence = 0.0
                sources = []

                for gen, weight in self.generators:
                    if gen.name in all_signals and i < len(all_signals[gen.name]):
                        sig = all_signals[gen.name][i]
                        combined_strength += sig.strength * weight
                        combined_confidence += sig.confidence * weight
                        if sig.signal_type != SignalType.FLAT:
                            sources.append(gen.name)

                result_df.loc[idx, 'signal'] = combined_strength
                result_df.loc[idx, 'confidence'] = combined_confidence
                result_df.loc[idx, 'signal_sources'] = ','.join(sources)

                if combined_strength > 0.2:
                    result_df.loc[idx, 'signal_type'] = SignalType.LONG.value
                elif combined_strength < -0.2:
                    result_df.loc[idx, 'signal_type'] = SignalType.SHORT.value
                else:
                    result_df.loc[idx, 'signal_type'] = SignalType.FLAT.value

            elif combine_method == 'vote':
                votes = {SignalType.LONG: 0, SignalType.SHORT: 0, SignalType.FLAT: 0}

                for gen, weight in self.generators:
                    if gen.name in all_signals and i < len(all_signals[gen.name]):
                        sig = all_signals[gen.name][i]
                        votes[sig.signal_type] += weight

                # Winner takes all
                winner = max(votes, key=votes.get)
                result_df.loc[idx, 'signal_type'] = winner.value
                result_df.loc[idx, 'signal'] = winner.value
                result_df.loc[idx, 'confidence'] = votes[winner]

            elif combine_method == 'unanimous':
                signal_types = []
                for gen, _ in self.generators:
                    if gen.name in all_signals and i < len(all_signals[gen.name]):
                        sig = all_signals[gen.name][i]
                        signal_types.append(sig.signal_type)

                # All non-flat signals must agree
                non_flat = [s for s in signal_types if s != SignalType.FLAT]
                if non_flat and len(set(non_flat)) == 1:
                    result_df.loc[idx, 'signal_type'] = non_flat[0].value
                    result_df.loc[idx, 'signal'] = non_flat[0].value
                    result_df.loc[idx, 'confidence'] = 0.9
                else:
                    result_df.loc[idx, 'signal_type'] = SignalType.FLAT.value

        return result_df

    def generate_raw(
        self,
        df: pd.DataFrame,
        symbol: str
    ) -> Dict[str, List[Signal]]:
        """
        Generate raw signals from all generators (uncombined).

        Useful for analysis and debugging.
        """
        all_signals = {}
        for gen, _ in self.generators:
            try:
                signals = gen.generate(df, symbol)
                all_signals[gen.name] = signals
            except Exception as e:
                logger.error(f"Generator {gen.name} failed: {e}")
        return all_signals

    def reset_all_state(self):
        """Reset state in all generators."""
        for gen, _ in self.generators:
            gen.reset_state()


class MLSignalGenerator(BaseSignalGenerator):
    """
    Machine learning-based signal generator.

    Wrapper for sklearn/xgboost/lightgbm models.
    """

    def __init__(
        self,
        model: Any,
        feature_columns: List[str],
        target_column: str = 'future_ret',
        threshold: float = 0.0
    ):
        super().__init__("ml_model")
        self.model = model
        self.feature_columns = feature_columns
        self.target_column = target_column
        self.threshold = threshold

    def get_required_features(self) -> List[str]:
        return self.feature_columns

    def generate(self, df: pd.DataFrame, symbol: str) -> List[Signal]:
        signals = []

        # Get features
        X = df[self.feature_columns].values

        # Predict
        try:
            predictions = self.model.predict(X)

            # Get probabilities if available
            if hasattr(self.model, 'predict_proba'):
                probas = self.model.predict_proba(X)
                confidences = np.max(probas, axis=1)
            else:
                confidences = np.ones(len(predictions)) * 0.5
        except Exception as e:
            logger.error(f"ML prediction failed: {e}")
            predictions = np.zeros(len(df))
            confidences = np.zeros(len(df))

        for i, idx in enumerate(df.index):
            pred = predictions[i]
            conf = confidences[i]

            if pred > self.threshold:
                signal_type = SignalType.LONG
                strength = min(pred, 1.0)
            elif pred < -self.threshold:
                signal_type = SignalType.SHORT
                strength = max(pred, -1.0)
            else:
                signal_type = SignalType.FLAT
                strength = pred

            signals.append(Signal(
                timestamp=idx,
                symbol=symbol,
                signal_type=signal_type,
                strength=strength,
                confidence=conf,
                source=self.name,
                metadata={'raw_prediction': pred}
            ))

        return signals

    def fit(
        self,
        df: pd.DataFrame,
        target: pd.Series,
        **fit_params
    ):
        """Train the model."""
        X = df[self.feature_columns].values
        y = target.values
        self.model.fit(X, y, **fit_params)
        logger.info(f"ML model trained on {len(y)} samples")
