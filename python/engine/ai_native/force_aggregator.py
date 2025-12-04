#!/usr/bin/env python3
"""
Force Aggregator - Unified Market Physics Context
==================================================
Aggregates all force calculations, regime signals, and dynamics
into a coherent context for AI reasoning.

This is the bridge between quantitative calculations (Layer 3)
and AI synthesis (Layer 7).

The Force Aggregator:
1. Computes all force dimensions (entropy, flow, correlation, morphology)
2. Tracks regime state and transition probabilities
3. Monitors dynamics (velocity, acceleration, mean reversion)
4. Produces a unified "market physics state" for AI observers

Author: Market Physics Engine
Layer: 3-7 Bridge
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum

import pandas as pd
import numpy as np

# Import force calculation modules
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from engine.features.entropy import (
    rolling_entropy,
    transfer_entropy,
    fano_predictability_limit
)
from engine.features.flow import (
    calculate_vpin,
    kyle_lambda_regression,
    calculate_ofi
)
from engine.features.correlation import (
    rolling_absorption_ratio,
    eigenvalue_entropy,
    empirical_tail_dependence
)
from engine.features.mm_inventory import (
    calculate_nope,
    rolling_inventory_pressure
)
from engine.features.regime import (
    GaussianHMM,
    HMMConfig,
    critical_slowing_down_indicators,
    detect_slowing_down
)
from engine.features.change_point import (
    cusum_mean_shift,
    bocpd_detect,
    change_point_regime_transition
)
from engine.features.duration import (
    analyze_regime_hazard,
    extract_regime_durations,
    compute_minsky_moment_probability
)
from engine.features.morphology import (
    compute_shape_metrics,
    analyze_gamma_shape
)
from engine.features.dynamics import (
    compute_dynamics_metrics,
    compute_entropy_dynamics,
    compute_volatility_dynamics,
    estimate_ou_parameters
)

logger = logging.getLogger("AINative.ForceAggregator")


# =============================================================================
# OUTPUT SANITIZATION (FA7: Ensure no NaN/Inf propagate to consumers)
# =============================================================================

def _sanitize_value(v: Any, default: float = 0.0) -> Any:
    """Sanitize a single value - replace NaN/Inf with default."""
    if isinstance(v, (float, np.floating)):
        if np.isnan(v) or np.isinf(v):
            return default
        return float(v)
    elif isinstance(v, (int, np.integer)):
        return int(v)
    return v


def _sanitize_dict(d: Dict[str, Any], default: float = 0.0) -> Dict[str, Any]:
    """Recursively sanitize a dictionary - replace NaN/Inf with defaults."""
    if d is None:
        return {}
    sanitized = {}
    for k, v in d.items():
        if isinstance(v, dict):
            sanitized[k] = _sanitize_dict(v, default)
        elif isinstance(v, (list, tuple)):
            sanitized[k] = [_sanitize_value(x, default) for x in v]
        else:
            sanitized[k] = _sanitize_value(v, default)
    return sanitized


class ForceCategory(str, Enum):
    """Categories of market forces."""
    FLOW = "flow"
    ENTROPY = "entropy"
    CORRELATION = "correlation"
    GAMMA = "gamma"
    REGIME = "regime"
    DYNAMICS = "dynamics"
    MORPHOLOGY = "morphology"


class ForceStrength(str, Enum):
    """Qualitative force strength."""
    EXTREME_NEGATIVE = "extreme_negative"
    STRONG_NEGATIVE = "strong_negative"
    MODERATE_NEGATIVE = "moderate_negative"
    WEAK_NEGATIVE = "weak_negative"
    NEUTRAL = "neutral"
    WEAK_POSITIVE = "weak_positive"
    MODERATE_POSITIVE = "moderate_positive"
    STRONG_POSITIVE = "strong_positive"
    EXTREME_POSITIVE = "extreme_positive"


@dataclass
class ForceVector:
    """Single force measurement."""
    name: str
    category: ForceCategory
    value: float
    percentile: float  # 0-100, historical context
    strength: ForceStrength
    velocity: float  # Rate of change
    interpretation: str


@dataclass
class RegimeState:
    """Current regime and transition probabilities."""
    current_regime: int
    regime_probability: float
    regime_names: List[str]
    transition_probabilities: np.ndarray
    days_in_regime: int
    hazard_rate: float
    minsky_signal: bool
    critical_slowing_down: bool


@dataclass
class MarketPhysicsState:
    """Complete market physics state for AI reasoning."""
    timestamp: str
    symbol: str

    # Force vectors
    forces: List[ForceVector]

    # Regime state
    regime: RegimeState

    # Key signals
    entropy_signal: str  # "decaying", "rising", "stable"
    flow_signal: str     # "toxic", "normal", "benign"
    correlation_signal: str  # "concentrated", "normal", "dispersed"
    morphology_signal: str   # "P", "b", "B", "bimodal"

    # Aggregate scores
    bullish_force_score: float  # -1 to +1
    risk_score: float           # 0 to 1
    transition_score: float     # 0 to 1

    # Context for AI
    key_observations: List[str]
    warnings: List[str]
    raw_metrics: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization."""
        result = asdict(self)
        result['forces'] = [asdict(f) for f in self.forces]
        result['regime'] = asdict(self.regime)
        # Convert numpy arrays to lists
        if 'transition_probabilities' in result['regime']:
            result['regime']['transition_probabilities'] = result['regime']['transition_probabilities'].tolist()
        return result

    def to_prompt_context(self) -> str:
        """Generate context string for AI prompts."""
        lines = [
            f"=== MARKET PHYSICS STATE ({self.symbol}) ===",
            f"Timestamp: {self.timestamp}",
            "",
            "--- REGIME ---",
            f"Current Regime: {self.regime.regime_names[self.regime.current_regime]} "
            f"(prob: {self.regime.regime_probability:.2%})",
            f"Days in Regime: {self.regime.days_in_regime}",
            f"Hazard Rate: {self.regime.hazard_rate:.2%}",
            f"Critical Slowing Down: {'YES' if self.regime.critical_slowing_down else 'No'}",
            f"Minsky Signal: {'ACTIVE' if self.regime.minsky_signal else 'Inactive'}",
            "",
            "--- FORCE SIGNALS ---",
            f"Entropy: {self.entropy_signal}",
            f"Flow: {self.flow_signal}",
            f"Correlation: {self.correlation_signal}",
            f"Morphology: {self.morphology_signal}",
            "",
            "--- AGGREGATE SCORES ---",
            f"Bullish Force: {self.bullish_force_score:+.2f}",
            f"Risk Score: {self.risk_score:.2%}",
            f"Transition Score: {self.transition_score:.2%}",
            "",
            "--- KEY FORCES ---",
        ]

        for force in self.forces[:10]:  # Top 10 forces
            lines.append(
                f"  {force.name}: {force.value:.4f} "
                f"({force.strength.value}, {force.percentile:.0f}%ile)"
            )

        if self.warnings:
            lines.append("")
            lines.append("--- WARNINGS ---")
            for w in self.warnings:
                lines.append(f"  ! {w}")

        if self.key_observations:
            lines.append("")
            lines.append("--- KEY OBSERVATIONS ---")
            for obs in self.key_observations[:5]:
                lines.append(f"  - {obs}")

        return "\n".join(lines)


class ForceAggregator:
    """
    Aggregates all Market Physics Engine calculations
    into a unified context for AI reasoning.
    """

    def __init__(
        self,
        n_regimes: int = 2,
        entropy_window: int = 20,
        flow_window: int = 50,
        correlation_window: int = 60
    ):
        """
        Initialize Force Aggregator.

        Args:
            n_regimes: Number of HMM regimes
            entropy_window: Window for entropy calculations
            flow_window: Window for flow calculations
            correlation_window: Window for correlation calculations
        """
        self.n_regimes = n_regimes
        self.entropy_window = entropy_window
        self.flow_window = flow_window
        self.correlation_window = correlation_window

        # HMM model (fitted on first call)
        self.hmm = None
        self.regime_names = ["Bear/HighVol", "Bull/LowVol"]  # Default

        # Historical percentiles
        self.history: Dict[str, List[float]] = {}

    def _compute_percentile(self, name: str, value: float) -> float:
        """Compute percentile rank based on historical values."""
        if name not in self.history:
            self.history[name] = []

        self.history[name].append(value)

        # Keep last 252 values (1 year)
        if len(self.history[name]) > 252:
            self.history[name] = self.history[name][-252:]

        # Compute percentile rank (what % of historical values are <= current value)
        valid_history = [v for v in self.history[name] if not np.isnan(v)]
        if len(valid_history) <= 1:
            return 50.0

        return float(np.sum(np.array(valid_history) <= value) / len(valid_history) * 100)

    def _value_to_strength(self, value: float, thresholds: Tuple[float, ...]) -> ForceStrength:
        """Convert value to qualitative strength."""
        # thresholds = (extreme_neg, strong_neg, moderate_neg, weak_neg,
        #               weak_pos, moderate_pos, strong_pos, extreme_pos)
        if value < thresholds[0]:
            return ForceStrength.EXTREME_NEGATIVE
        elif value < thresholds[1]:
            return ForceStrength.STRONG_NEGATIVE
        elif value < thresholds[2]:
            return ForceStrength.MODERATE_NEGATIVE
        elif value < thresholds[3]:
            return ForceStrength.WEAK_NEGATIVE
        elif value < thresholds[4]:
            return ForceStrength.NEUTRAL
        elif value < thresholds[5]:
            return ForceStrength.WEAK_POSITIVE
        elif value < thresholds[6]:
            return ForceStrength.MODERATE_POSITIVE
        elif value < thresholds[7]:
            return ForceStrength.STRONG_POSITIVE
        else:
            return ForceStrength.EXTREME_POSITIVE

    def compute_forces(
        self,
        df: pd.DataFrame,
        symbol: str = "SPY"
    ) -> MarketPhysicsState:
        """
        Compute all forces and aggregate into MarketPhysicsState.

        Args:
            df: DataFrame with OHLCV and options data
            symbol: Symbol being analyzed

        Returns:
            MarketPhysicsState with all force calculations
        """
        logger.info(f"Computing forces for {symbol}...")

        forces = []
        raw_metrics = {}
        warnings = []
        observations = []

        # Ensure we have returns
        if 'returns' not in df.columns and 'close' in df.columns:
            df = df.copy()
            df['returns'] = df['close'].pct_change()

        returns = df['returns'].dropna().values

        # =====================================================================
        # ENTROPY FORCES
        # =====================================================================
        try:
            # Shannon entropy
            entropy_result = compute_entropy_dynamics(
                returns, lookback=self.entropy_window
            )

            entropy_val = entropy_result.current_entropy
            # FA7: Wrap in float() for type consistency
            entropy_vel = float(entropy_result.entropy_velocity) if not np.isnan(entropy_result.entropy_velocity) else 0.0

            forces.append(ForceVector(
                name="shannon_entropy",
                category=ForceCategory.ENTROPY,
                value=entropy_val,
                percentile=self._compute_percentile("shannon_entropy", entropy_val),
                strength=self._value_to_strength(
                    entropy_val, (1.0, 1.5, 2.0, 2.3, 2.7, 3.0, 3.5, 4.0)
                ),
                velocity=entropy_vel,
                interpretation=f"Market uncertainty {'decaying' if entropy_result.is_decaying else 'stable/rising'}"
            ))

            raw_metrics['entropy'] = entropy_val
            raw_metrics['entropy_velocity'] = entropy_vel

            if entropy_result.is_decaying:
                observations.append("Entropy decaying - consensus forming")
        except Exception as e:
            logger.warning(f"Entropy calculation failed: {e}")

        # =====================================================================
        # FLOW FORCES
        # =====================================================================
        try:
            if 'volume' in df.columns and 'close' in df.columns:
                # VPIN - calculate_vpin expects (prices, volumes, bucket_size, n_buckets)
                prices = df['close'].values
                volumes = df['volume'].values
                # Bucket size = average volume per bucket (use median daily volume)
                bucket_size = np.median(volumes[volumes > 0]) if np.any(volumes > 0) else 1e6

                vpin_values, _ = calculate_vpin(prices, volumes, bucket_size, n_buckets=50)
                if len(vpin_values) > 0:
                    vpin_val = float(vpin_values[-1])

                    forces.append(ForceVector(
                        name="vpin",
                        category=ForceCategory.FLOW,
                        value=vpin_val,
                        percentile=self._compute_percentile("vpin", vpin_val),
                        strength=self._value_to_strength(
                            vpin_val, (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)
                        ),
                        # FA8: Check for finite values before nanmean
                        velocity=float(np.nanmean(np.diff(vpin_values[-5:]))) if len(vpin_values) >= 5 and np.any(np.isfinite(vpin_values[-5:])) else 0.0,
                        interpretation=f"Order flow toxicity {'elevated' if vpin_val > 0.5 else 'normal'}"
                    ))

                    raw_metrics['vpin'] = vpin_val

                    if vpin_val > 0.7:
                        warnings.append("VPIN elevated - toxic flow detected")
        except Exception as e:
            logger.warning(f"VPIN calculation failed: {e}")

        # =====================================================================
        # CORRELATION FORCES
        # =====================================================================
        try:
            if len(df.columns) > 5:  # Need multiple assets
                # Try absorption ratio
                numeric_cols = df.select_dtypes(include=[np.number]).columns[:10]
                if len(numeric_cols) >= 3:
                    returns_matrix = df[numeric_cols].pct_change().dropna()
                    if len(returns_matrix) > self.correlation_window:
                        ar = rolling_absorption_ratio(
                            returns_matrix.values,
                            window=self.correlation_window,
                            n_components=min(3, len(numeric_cols) // 2)
                        )

                        if len(ar) > 0:
                            ar_val = ar[-1]

                            forces.append(ForceVector(
                                name="absorption_ratio",
                                category=ForceCategory.CORRELATION,
                                value=ar_val,
                                percentile=self._compute_percentile("absorption_ratio", ar_val),
                                strength=self._value_to_strength(
                                    ar_val, (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9)
                                ),
                                velocity=float(np.nanmean(np.diff(ar[-5:]))) if (len(ar) >= 5 and np.any(~np.isnan(ar[-5:]))) else 0.0,
                                interpretation=f"Systemic risk {'elevated' if ar_val > 0.8 else 'normal'}"
                            ))

                            raw_metrics['absorption_ratio'] = ar_val

                            if ar_val > 0.85:
                                warnings.append("Absorption ratio high - systemic risk elevated")
        except Exception as e:
            logger.warning(f"Correlation calculation failed: {e}")

        # =====================================================================
        # REGIME DETECTION
        # =====================================================================
        try:
            # Fit HMM if not already
            if self.hmm is None and len(returns) > 100:
                config = HMMConfig(n_regimes=self.n_regimes)
                self.hmm = GaussianHMM(config)
                self.hmm.fit(returns)

            if self.hmm is not None:
                hmm_result = self.hmm.decode(returns)

                # Get regime state
                current_regime = hmm_result.most_likely_regime[-1]
                # FA5: Clip probability to [0,1] - HMMs can have slight numerical issues
                regime_prob = float(np.clip(
                    hmm_result.regime_probabilities[-1, current_regime], 0.0, 1.0
                ))

                # Duration analysis
                regime_series = hmm_result.most_likely_regime
                durations = extract_regime_durations(regime_series)
                days_in_regime = 1
                for i in range(len(regime_series) - 1, 0, -1):
                    if regime_series[i] == regime_series[i-1]:
                        days_in_regime += 1
                    else:
                        break

                # FA4: Hazard rate with safe indexing (prevent negative index)
                hazard_result = analyze_regime_hazard(regime_series)
                idx = max(0, min(days_in_regime - 1, len(hazard_result.hazard_rates) - 1))
                hazard_rate = hazard_result.hazard_rates[idx] \
                    if len(hazard_result.hazard_rates) > 0 else 0.05

                # Critical slowing down
                csd = critical_slowing_down_indicators(returns)
                slowing_down = detect_slowing_down(csd)
                # detect_slowing_down returns 'warning_level' = 'HIGH', 'ELEVATED', 'NORMAL', or 'INSUFFICIENT_DATA'
                is_slowing_down = slowing_down.get('warning_level') == 'HIGH'

                # FA5: Clip regime probability to valid range
                regime_state = RegimeState(
                    current_regime=int(current_regime),
                    regime_probability=float(np.clip(regime_prob, 0.0, 1.0)),
                    regime_names=self.regime_names,
                    transition_probabilities=hmm_result.transition_matrix,
                    days_in_regime=days_in_regime,
                    hazard_rate=float(hazard_rate),
                    minsky_signal=hazard_result.is_increasing_hazard,
                    critical_slowing_down=is_slowing_down
                )

                # FA11: Wrap numpy types for consistency
                raw_metrics['hmm_regime'] = int(current_regime)
                raw_metrics['regime_probability'] = float(np.clip(regime_prob, 0.0, 1.0))
                raw_metrics['hazard_rate'] = float(hazard_rate)

                if is_slowing_down:
                    warnings.append("Critical slowing down detected - regime transition may be imminent")

                if hazard_result.is_increasing_hazard:
                    observations.append("Increasing hazard rate - Minsky dynamics active")
            else:
                # Default regime state
                regime_state = RegimeState(
                    current_regime=0,
                    regime_probability=0.5,
                    regime_names=self.regime_names,
                    transition_probabilities=np.array([[0.95, 0.05], [0.05, 0.95]]),
                    days_in_regime=0,
                    hazard_rate=0.05,
                    minsky_signal=False,
                    critical_slowing_down=False
                )
        except Exception as e:
            logger.warning(f"Regime detection failed: {e}")
            regime_state = RegimeState(
                current_regime=0,
                regime_probability=0.5,
                regime_names=self.regime_names,
                transition_probabilities=np.array([[0.95, 0.05], [0.05, 0.95]]),
                days_in_regime=0,
                hazard_rate=0.05,
                minsky_signal=False,
                critical_slowing_down=False
            )

        # =====================================================================
        # MORPHOLOGY
        # =====================================================================
        try:
            shape = compute_shape_metrics(returns[-60:])

            forces.append(ForceVector(
                name="skewness",
                category=ForceCategory.MORPHOLOGY,
                value=shape.skewness,
                percentile=self._compute_percentile("skewness", shape.skewness),
                strength=self._value_to_strength(
                    shape.skewness, (-2.0, -1.0, -0.5, -0.2, 0.2, 0.5, 1.0, 2.0)
                ),
                velocity=0,  # Could compute rolling
                interpretation=f"Distribution {shape.shape_class}-shaped"
            ))

            raw_metrics['skewness'] = shape.skewness
            raw_metrics['kurtosis'] = shape.kurtosis
            raw_metrics['shape_class'] = shape.shape_class

            if not shape.is_unimodal:
                warnings.append("Bimodal distribution detected - transition in progress")
        except Exception as e:
            logger.warning(f"Morphology calculation failed: {e}")

        # =====================================================================
        # DYNAMICS (Volatility)
        # =====================================================================
        try:
            vol_dynamics = compute_volatility_dynamics(returns)

            forces.append(ForceVector(
                name="realized_vol",
                category=ForceCategory.DYNAMICS,
                value=vol_dynamics.realized_vol,
                percentile=self._compute_percentile("realized_vol", vol_dynamics.realized_vol),
                strength=self._value_to_strength(
                    vol_dynamics.realized_vol, (5, 10, 15, 18, 22, 28, 35, 50)
                ),
                velocity=vol_dynamics.vol_velocity if not np.isnan(vol_dynamics.vol_velocity) else 0.0,
                interpretation=f"Volatility {vol_dynamics.vol_regime}"
            ))

            # FA10: Wrap in float() for type consistency
            raw_metrics['realized_vol'] = float(vol_dynamics.realized_vol)
            raw_metrics['vol_velocity'] = float(vol_dynamics.vol_velocity) if not np.isnan(vol_dynamics.vol_velocity) else 0.0

            if vol_dynamics.vol_regime == 'expanding':
                observations.append("Volatility expanding")
            elif vol_dynamics.vol_regime == 'contracting':
                observations.append("Volatility contracting - potential opportunity")
        except Exception as e:
            logger.warning(f"Volatility dynamics failed: {e}")

        # =====================================================================
        # AGGREGATE SIGNALS
        # =====================================================================

        # Entropy signal
        entropy_signal = "stable"
        if raw_metrics.get('entropy_velocity', 0) < -0.01:
            entropy_signal = "decaying"
        elif raw_metrics.get('entropy_velocity', 0) > 0.01:
            entropy_signal = "rising"

        # FA12: Flow signal - return "unknown" if VPIN not calculated
        flow_signal = "unknown"
        if 'vpin' in raw_metrics:
            vpin_val = raw_metrics['vpin']
            if vpin_val > 0.7:
                flow_signal = "toxic"
            elif vpin_val < 0.3:
                flow_signal = "benign"
            else:
                flow_signal = "normal"

        # FA13: Correlation signal - return "unknown" if AR not calculated
        correlation_signal = "unknown"
        if 'absorption_ratio' in raw_metrics:
            ar_val = raw_metrics['absorption_ratio']
            if ar_val > 0.85:
                correlation_signal = "concentrated"
            elif ar_val < 0.5:
                correlation_signal = "dispersed"
            else:
                correlation_signal = "normal"

        # Morphology signal
        morphology_signal = raw_metrics.get('shape_class', 'b')

        # Aggregate scores
        bullish_forces = [
            raw_metrics.get('skewness', 0),
            -raw_metrics.get('vpin', 0.5) + 0.5,  # Lower VPIN = bullish
            1 - raw_metrics.get('absorption_ratio', 0.7),  # Lower AR = bullish
        ]
        valid_bullish = [f for f in bullish_forces if not np.isnan(f) and not np.isinf(f)]
        bullish_force_score = float(np.mean(valid_bullish)) if valid_bullish else 0.0
        # FA6: Clip before scaling to prevent overflow, then clip again
        bullish_force_score = np.clip(bullish_force_score, -1, 1)
        bullish_force_score = np.clip(bullish_force_score * 2, -1, 1)

        risk_components = [
            raw_metrics.get('vpin', 0.4),
            raw_metrics.get('absorption_ratio', 0.7),
            regime_state.hazard_rate,
        ]
        valid_risk = [v for v in risk_components if v is not None and not np.isnan(v) and not np.isinf(v)]
        risk_score = float(np.mean(valid_risk)) if valid_risk else 0.5
        # FA14: Clip risk score to valid probability range
        risk_score = float(np.clip(risk_score, 0.0, 1.0))

        transition_components = [
            regime_state.hazard_rate,
            1.0 if regime_state.critical_slowing_down else 0.0,
            1.0 if regime_state.minsky_signal else 0.0,
        ]
        valid_transition = [v for v in transition_components if not np.isnan(v) and not np.isinf(v)]
        transition_score = float(np.mean(valid_transition)) if valid_transition else 0.0

        # FA7: Sanitize output dicts (NOT lists or strings - FA1/FA2 fix)
        return MarketPhysicsState(
            timestamp=datetime.now().isoformat(),
            symbol=symbol,
            forces=forces,  # FA1: List[ForceVector], not dict - don't sanitize
            regime=regime_state,
            entropy_signal=entropy_signal,  # FA2: String signal, not dict
            flow_signal=flow_signal,  # FA2: String signal, not dict
            correlation_signal=correlation_signal,  # FA2: String signal, not dict
            morphology_signal=morphology_signal,  # FA2: String signal, not dict
            bullish_force_score=bullish_force_score,
            risk_score=risk_score,
            transition_score=transition_score,
            key_observations=observations,
            warnings=warnings,
            raw_metrics=_sanitize_dict(raw_metrics)
        )


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def aggregate_forces(df: pd.DataFrame, symbol: str = "SPY") -> MarketPhysicsState:
    """
    Convenience function to aggregate all forces.

    Args:
        df: DataFrame with market data
        symbol: Symbol being analyzed

    Returns:
        MarketPhysicsState
    """
    aggregator = ForceAggregator()
    return aggregator.compute_forces(df, symbol)


def forces_to_prompt(state: MarketPhysicsState) -> str:
    """
    Convert MarketPhysicsState to prompt context.

    Args:
        state: Market physics state

    Returns:
        String context for AI prompt
    """
    return state.to_prompt_context()


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample data
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=500, freq='D')

    df = pd.DataFrame({
        'timestamp': dates,
        'close': 500 + np.cumsum(np.random.randn(500) * 2),
        'volume': np.random.randint(1000000, 5000000, 500),
        'vix': 18 + np.random.randn(500) * 5,
    })
    df['returns'] = df['close'].pct_change()

    # Test aggregator
    print("\n=== Testing Force Aggregator ===")
    aggregator = ForceAggregator()

    try:
        state = aggregator.compute_forces(df, symbol='SPY')
        print("\n" + state.to_prompt_context())
        print("\n=== Test Passed ===")
    except Exception as e:
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
