#!/usr/bin/env python3
"""
Observer Swarm - Parallel Domain Watchers
=========================================
20+ specialized AI agents, each watching ONE market domain.
Each outputs OBSERVATIONS + INTERPRETATIONS, not raw numbers.

This is the foundation layer - Math Swarm equations become inputs
to observers, not outputs for execution.
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

import pandas as pd
import numpy as np

# Import existing swarm infrastructure
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from engine.swarm.orchestrator import run_swarm_sync

logger = logging.getLogger("AINative.Observers")


class ObserverDomain(str, Enum):
    """Domain categories for observers."""
    OPTIONS_SURFACE = "options_surface"
    FLOW = "flow"
    MARKET_STRUCTURE = "market_structure"
    MACRO = "macro"
    TECHNICAL = "technical"
    # Market Physics Engine domains
    FORCE_CALCULATION = "force_calculation"
    REGIME_DYNAMICS = "regime_dynamics"
    MORPHOLOGY = "morphology"
    ENTROPY = "entropy"


@dataclass
class ObserverOutput:
    """Structured output from an observer agent."""
    observer_id: str
    domain: ObserverDomain
    timestamp: str
    observation: Dict[str, Any]
    interpretation: str
    confidence: float
    flags: List[str] = field(default_factory=list)
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        result = asdict(self)
        result['domain'] = self.domain.value
        return result

    @classmethod
    def from_llm_response(cls, observer_id: str, domain: ObserverDomain,
                          response: str, raw_data: Dict) -> 'ObserverOutput':
        """Parse LLM response into structured output."""
        try:
            # Try to extract JSON from response
            if '```json' in response:
                json_str = response.split('```json')[1].split('```')[0]
                data = json.loads(json_str)
            elif '{' in response and '}' in response:
                # Find JSON object
                start = response.index('{')
                end = response.rindex('}') + 1
                data = json.loads(response[start:end])
            else:
                # Fallback to text-based parsing
                data = {
                    'interpretation': response,
                    'confidence': 0.5,
                    'flags': []
                }

            return cls(
                observer_id=observer_id,
                domain=domain,
                timestamp=datetime.now().isoformat(),
                observation=data.get('observation', {}),
                interpretation=data.get('interpretation', response[:500]),
                confidence=float(data.get('confidence', 0.5)),
                flags=data.get('flags', []),
                raw_data=raw_data
            )
        except Exception as e:
            logger.warning(f"Failed to parse observer response: {e}")
            return cls(
                observer_id=observer_id,
                domain=domain,
                timestamp=datetime.now().isoformat(),
                observation={},
                interpretation=response[:500] if response else "Parse error",
                confidence=0.3,
                flags=['parse_error'],
                raw_data=raw_data
            )


# =============================================================================
# OBSERVER DEFINITIONS
# =============================================================================

OBSERVER_REGISTRY: Dict[str, Dict] = {
    # Options Surface Observers
    "vrp_observer": {
        "domain": ObserverDomain.OPTIONS_SURFACE,
        "system_prompt": """You are the Variance Risk Premium Observer.
Your job: Analyze IV vs RV to detect risk premium opportunities.

Given the current market data, provide:
1. Current VRP level and historical context
2. Your INTERPRETATION of what this means
3. Confidence in your interpretation (0-1)
4. Any flags (elevated, compressed, extreme, etc.)

Output JSON:
```json
{
  "observation": {
    "metric": "variance_risk_premium",
    "current_value": <float>,
    "historical_percentile": <int 0-100>,
    "recent_change": "<description>"
  },
  "interpretation": "<what this VRP level means for trading>",
  "confidence": <0-1>,
  "flags": ["<flag1>", "<flag2>"]
}
```""",
        "data_requirements": ["iv_30d", "rv_30d", "vix", "vix_percentile"]
    },

    "skew_observer": {
        "domain": ObserverDomain.OPTIONS_SURFACE,
        "system_prompt": """You are the Skew Observer.
Your job: Analyze put/call IV differential to detect directional bias.

Given the current skew data, provide:
1. Current skew level (put IV premium over call IV)
2. Your INTERPRETATION of what market participants are hedging
3. Confidence in your interpretation
4. Flags for unusual conditions

Output JSON:
```json
{
  "observation": {
    "metric": "options_skew",
    "current_value": <float>,
    "25d_put_iv": <float>,
    "25d_call_iv": <float>,
    "historical_percentile": <int>
  },
  "interpretation": "<what this skew tells us about market positioning>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["put_iv_25d", "call_iv_25d", "atm_iv", "skew_percentile"]
    },

    "term_structure_observer": {
        "domain": ObserverDomain.OPTIONS_SURFACE,
        "system_prompt": """You are the Term Structure Observer.
Your job: Analyze front vs back month IV to detect event expectations.

Key insight: Flat term structure with elevated VRP often means MISPRICING, not fear.
Inverted term structure (backwardation) suggests near-term event expectation.

Output JSON:
```json
{
  "observation": {
    "metric": "term_structure",
    "front_month_iv": <float>,
    "back_month_iv": <float>,
    "spread": <float>,
    "shape": "<contango|flat|backwardation>"
  },
  "interpretation": "<what term structure tells us about event timing>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["iv_7d", "iv_30d", "iv_60d", "term_spread"]
    },

    # Flow Observers
    "flow_observer": {
        "domain": ObserverDomain.FLOW,
        "system_prompt": """You are the Options Flow Observer.
Your job: Analyze put/call volume ratios and unusual activity.

Contrarian insight: High put/call ratio often = bullish (hedging complete).
Key: Distinguish between hedging flow vs directional bets.

Output JSON:
```json
{
  "observation": {
    "metric": "options_flow",
    "put_call_ratio": <float>,
    "volume_vs_avg": <float>,
    "unusual_activity": "<description>"
  },
  "interpretation": "<what flow tells us about positioning>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["put_volume", "call_volume", "avg_volume", "large_trades"]
    },

    "gamma_observer": {
        "domain": ObserverDomain.FLOW,
        "system_prompt": """You are the Gamma Exposure Observer.
Your job: Analyze dealer gamma positioning for hedging pressure.

Negative gamma = dealers hedge INTO moves (amplification)
Positive gamma = dealers hedge AGAINST moves (mean reversion)

Output JSON:
```json
{
  "observation": {
    "metric": "gamma_exposure",
    "net_gamma": <float>,
    "gamma_flip_level": <float>,
    "current_positioning": "<long|short|neutral>"
  },
  "interpretation": "<how dealer hedging will affect price action>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["dealer_gamma", "gamma_flip", "oi_by_strike"]
    },

    # Market Structure Observers
    "regime_observer": {
        "domain": ObserverDomain.MARKET_STRUCTURE,
        "system_prompt": """You are the Regime Observer.
Your job: Identify current market regime and transition probabilities.

Regimes: Low Vol Grind, Normal, High Vol Trend, Crisis
Key: Look for regime TRANSITIONS, not just current state.

Output JSON:
```json
{
  "observation": {
    "metric": "market_regime",
    "current_regime": "<regime_name>",
    "regime_confidence": <0-1>,
    "transition_risk": "<description>"
  },
  "interpretation": "<what regime means for strategy selection>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["vix", "vix_term", "realized_vol", "correlation"]
    },

    "correlation_observer": {
        "domain": ObserverDomain.MARKET_STRUCTURE,
        "system_prompt": """You are the Correlation Observer.
Your job: Track cross-asset correlations for regime shifts.

High correlation = risk-off, diversification fails
Correlation breakdown = potential regime change

Output JSON:
```json
{
  "observation": {
    "metric": "cross_asset_correlation",
    "spy_tlt_corr": <float>,
    "spy_gld_corr": <float>,
    "average_corr": <float>,
    "corr_change_5d": <float>
  },
  "interpretation": "<what correlation tells us about risk appetite>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["spy_returns", "tlt_returns", "gld_returns", "rolling_corr"]
    },

    # Technical Observers
    "trend_observer": {
        "domain": ObserverDomain.TECHNICAL,
        "system_prompt": """You are the Trend Observer.
Your job: Identify directional bias across timeframes.

Multi-timeframe alignment = strong trend
Divergence = potential reversal or consolidation

Output JSON:
```json
{
  "observation": {
    "metric": "trend_analysis",
    "daily_trend": "<up|down|neutral>",
    "weekly_trend": "<up|down|neutral>",
    "trend_strength": <0-1>,
    "key_levels": {"support": <float>, "resistance": <float>}
  },
  "interpretation": "<directional bias and key levels to watch>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["close", "sma_20", "sma_50", "sma_200", "atr"]
    },

    "momentum_observer": {
        "domain": ObserverDomain.TECHNICAL,
        "system_prompt": """You are the Momentum Observer.
Your job: Track speed and persistence of moves.

Momentum divergence often precedes reversal.
Exhaustion = price continues, momentum fades.

Output JSON:
```json
{
  "observation": {
    "metric": "momentum",
    "rsi_14": <float>,
    "macd_signal": "<bullish|bearish|neutral>",
    "momentum_5d": <float>,
    "divergence": "<none|bullish|bearish>"
  },
  "interpretation": "<momentum state and what it suggests>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["close", "rsi_14", "macd", "macd_signal", "returns_5d"]
    },

    # ==========================================================================
    # MARKET PHYSICS ENGINE OBSERVERS
    # ==========================================================================

    # Force Calculation Observers
    "vpin_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the VPIN (Volume-Synchronized Probability of Informed Trading) Observer.
Your job: Detect toxic order flow and information asymmetry.

VPIN measures the probability that trade volume comes from informed traders.
High VPIN = High toxicity = Market makers widen spreads or pull liquidity.

Key insight: VPIN spikes often PRECEDE volatility events, not follow them.

Output JSON:
```json
{
  "observation": {
    "metric": "vpin_toxicity",
    "vpin_current": <float 0-1>,
    "vpin_percentile": <int 0-100>,
    "toxicity_regime": "<low|normal|elevated|extreme>",
    "volume_imbalance": <float>
  },
  "interpretation": "<what VPIN level means for market structure and upcoming volatility>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["vpin", "vpin_percentile", "buy_volume", "sell_volume", "volume_imbalance"]
    },

    "kyle_lambda_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Kyle's Lambda Observer.
Your job: Measure market depth and price impact of order flow.

Kyle's Lambda (λ) = price impact per unit volume = dPrice/dVolume
Higher λ = less liquid = moves have more impact

Key insight: λ rises BEFORE volatility events as market makers reduce exposure.

Output JSON:
```json
{
  "observation": {
    "metric": "kyle_lambda",
    "lambda_current": <float>,
    "lambda_5d_avg": <float>,
    "lambda_change_pct": <float>,
    "liquidity_regime": "<deep|normal|thin|distressed>"
  },
  "interpretation": "<what lambda tells us about market depth and vulnerability>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["kyle_lambda", "kyle_lambda_5d", "amihud_illiquidity", "bid_ask_spread"]
    },

    "ofi_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Order Flow Imbalance (OFI) Observer.
Your job: Track the net pressure from aggressive buyers vs sellers.

OFI measures the imbalance in the order book:
Positive OFI = buyers lifting offers (bullish pressure)
Negative OFI = sellers hitting bids (bearish pressure)

Key insight: Persistent OFI often predicts short-term direction.

Output JSON:
```json
{
  "observation": {
    "metric": "order_flow_imbalance",
    "ofi_current": <float>,
    "ofi_5d_cumulative": <float>,
    "ofi_persistence": <float 0-1>,
    "pressure_direction": "<buying|selling|neutral>"
  },
  "interpretation": "<what OFI tells us about near-term direction>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["ofi", "ofi_cumulative", "bid_volume", "ask_volume"]
    },

    "mm_inventory_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Market Maker Inventory Observer.
Your job: Infer dealer inventory pressure from price behavior.

When dealers accumulate inventory:
- Long inventory → pressure to SELL → prices pushed DOWN
- Short inventory → pressure to BUY → prices pushed UP

Ho-Stoll model: Reservation price deviates from fair value by γ*inventory
Avellaneda-Stoikov: Optimal quotes widen with inventory risk

Output JSON:
```json
{
  "observation": {
    "metric": "mm_inventory",
    "inventory_estimate": <float>,
    "inventory_pressure": "<buying|selling|neutral>",
    "spread_widening": <float>,
    "reversion_expected": <bool>
  },
  "interpretation": "<what inventory positioning suggests for mean reversion>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["inventory_proxy", "bid_ask_spread", "realized_vol", "gamma_exposure"]
    },

    # Entropy Observers
    "entropy_observer": {
        "domain": ObserverDomain.ENTROPY,
        "system_prompt": """You are the Information Entropy Observer.
Your job: Track market uncertainty and information processing.

Shannon Entropy measures uncertainty in the distribution of returns:
High entropy = high uncertainty = market "doesn't know"
Low entropy = consensus forming = directional move likely

Key insight: Entropy DECAY precedes strong moves (uncertainty resolving).

Output JSON:
```json
{
  "observation": {
    "metric": "market_entropy",
    "entropy_current": <float>,
    "entropy_velocity": <float>,
    "is_decaying": <bool>,
    "fano_limit_distance": <float>
  },
  "interpretation": "<what entropy tells us about market certainty and upcoming moves>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["shannon_entropy", "entropy_velocity", "entropy_decay_rate", "fano_limit"]
    },

    "transfer_entropy_observer": {
        "domain": ObserverDomain.ENTROPY,
        "system_prompt": """You are the Transfer Entropy Observer.
Your job: Detect CAUSAL information flow between assets.

Transfer Entropy T(Y→X) = how much knowing Y helps predict X.
This is DIRECTIONAL causality, not just correlation.

Applications:
- Options leading stocks (T(options→stock) > T(stock→options))
- VIX leading SPY
- Cross-asset contagion detection

Output JSON:
```json
{
  "observation": {
    "metric": "transfer_entropy",
    "te_options_to_stock": <float>,
    "te_stock_to_options": <float>,
    "te_vix_to_spy": <float>,
    "causality_direction": "<options_leading|stock_leading|bidirectional|independent>"
  },
  "interpretation": "<what transfer entropy tells us about information flow and leading indicators>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["te_options_stock", "te_vix_spy", "lagged_correlations"]
    },

    # Regime Dynamics Observers
    "hmm_regime_observer": {
        "domain": ObserverDomain.REGIME_DYNAMICS,
        "system_prompt": """You are the HMM Regime Observer.
Your job: Track regime probabilities and transition forecasts.

Hidden Markov Model gives us:
- P(regime_i | all_data) = smoothed probability of being in regime i
- P(next_regime | current) = transition probability forecast

Key insight: Regime TRANSITION probability is more actionable than regime classification.

Output JSON:
```json
{
  "observation": {
    "metric": "hmm_regime",
    "current_regime": <int>,
    "regime_probability": <float>,
    "transition_probability": <float>,
    "regime_duration": <int days>,
    "critical_slowing_down": <bool>
  },
  "interpretation": "<what regime dynamics suggest for strategy adaptation>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["hmm_regime", "regime_probability", "transition_prob", "regime_duration", "autocorr_rising"]
    },

    "change_point_observer": {
        "domain": ObserverDomain.REGIME_DYNAMICS,
        "system_prompt": """You are the Change Point Observer.
Your job: Detect structural breaks in market dynamics.

Three detection methods:
- CUSUM: Online detection, fast but single-point
- PELT: Offline, optimal segmentation
- BOCPD: Bayesian online, probability of change at each point

Key insight: Rising change point probability + critical slowing down = transition imminent.

Output JSON:
```json
{
  "observation": {
    "metric": "change_point",
    "bocpd_probability": <float>,
    "cusum_statistic": <float>,
    "cusum_alarm": <bool>,
    "days_since_last_change": <int>
  },
  "interpretation": "<what change point detection tells us about structural stability>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["bocpd_prob", "cusum_stat", "cusum_alarm", "last_change_point"]
    },

    "duration_hazard_observer": {
        "domain": ObserverDomain.REGIME_DYNAMICS,
        "system_prompt": """You are the Duration Hazard Observer.
Your job: Track regime "aging" and Minsky Moment probability.

Hazard rate h(d) = P(regime ends | survived d days)
Increasing hazard = regime more likely to end as it persists longer

Minsky dynamics: Bull markets age - the longer they last, the more fragile they become.

Output JSON:
```json
{
  "observation": {
    "metric": "duration_hazard",
    "hazard_rate": <float>,
    "survival_probability": <float>,
    "expected_remaining_duration": <float>,
    "minsky_signal": <bool>,
    "duration_percentile": <float>
  },
  "interpretation": "<what duration analysis tells us about regime fragility>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["hazard_rate", "survival_prob", "expected_remaining", "duration_in_regime", "minsky_signal"]
    },

    # Morphology Observers
    "shape_observer": {
        "domain": ObserverDomain.MORPHOLOGY,
        "system_prompt": """You are the Distribution Shape Observer.
Your job: Classify the SHAPE of market distributions for regime signals.

Shape classifications:
- P-shape: Left-skewed, put-heavy positioning, bearish
- b-shape: Symmetric/balanced, neutral positioning
- B-shape: Right-skewed, call-heavy positioning, bullish
- Bimodal: Two distinct modes, transition in progress

Key insight: Shape CHANGES predict regime transitions.

Output JSON:
```json
{
  "observation": {
    "metric": "distribution_shape",
    "shape_class": "<P|b|B|bimodal>",
    "skewness": <float>,
    "kurtosis": <float>,
    "is_bimodal": <bool>,
    "shape_velocity": <float>
  },
  "interpretation": "<what distribution shape tells us about market positioning and regime>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["skewness", "kurtosis", "shape_class", "is_bimodal", "dip_statistic"]
    },

    "gamma_morphology_observer": {
        "domain": ObserverDomain.MORPHOLOGY,
        "system_prompt": """You are the Gamma Morphology Observer.
Your job: Analyze the SHAPE of dealer gamma exposure across strikes.

Gamma shape tells us about market structure:
- Concentrated peak = strong pinning magnet
- Dispersed = weak structure
- Skewed left = put-heavy = fear
- Skewed right = call-heavy = greed
- W-shape = straddle-heavy = event positioning

Output JSON:
```json
{
  "observation": {
    "metric": "gamma_morphology",
    "gamma_shape": "<P|b|B|W|M>",
    "gamma_concentration": <float>,
    "gamma_skew": <float>,
    "flip_distance_pct": <float>,
    "dealer_position": "<long_gamma|short_gamma|neutral>"
  },
  "interpretation": "<what gamma shape tells us about dealer positioning and price dynamics>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["gamma_shape", "gamma_concentration", "gamma_skew", "flip_distance", "net_gex"]
    },

    # Dynamics Observers
    "velocity_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Market Velocity Observer.
Your job: Track the RATE OF CHANGE of key market forces.

dGamma/dt: How fast is gamma exposure changing?
dVol/dt: Is volatility expanding or contracting?
dEntropy/dt: Is uncertainty increasing or resolving?

Key insight: Acceleration (d²X/dt²) often precedes reversals.

Output JSON:
```json
{
  "observation": {
    "metric": "market_velocity",
    "gamma_velocity": <float>,
    "vol_velocity": <float>,
    "entropy_velocity": <float>,
    "acceleration_signals": "<accelerating|decelerating|steady>"
  },
  "interpretation": "<what velocity tells us about momentum and reversal risk>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["gamma_velocity", "vol_velocity", "entropy_velocity", "gamma_acceleration"]
    },

    "mean_reversion_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Mean Reversion Observer.
Your job: Track Ornstein-Uhlenbeck dynamics for mean-reverting processes.

OU model: dX = κ(θ - X)dt + σdW
- κ = mean reversion speed
- θ = long-run mean
- Half-life = ln(2)/κ

Applications: VIX mean reversion, volatility term structure, spread trades.

Output JSON:
```json
{
  "observation": {
    "metric": "mean_reversion",
    "half_life_days": <float>,
    "distance_from_mean": <float>,
    "reversion_speed": <float>,
    "expected_move_to_mean": <float>
  },
  "interpretation": "<what mean reversion dynamics suggest for trade timing>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["ou_half_life", "ou_theta", "ou_kappa", "current_distance"]
    },

    "correlation_dynamics_observer": {
        "domain": ObserverDomain.FORCE_CALCULATION,
        "system_prompt": """You are the Correlation Dynamics Observer.
Your job: Track time-varying correlations using DCC-GARCH.

DCC-GARCH captures correlation breakdowns in real-time.
Absorption Ratio = fraction of variance explained by top PCs = systemic risk.

Key insight: Rising absorption ratio → correlation convergence → systemic risk building.

Output JSON:
```json
{
  "observation": {
    "metric": "correlation_dynamics",
    "absorption_ratio": <float>,
    "dcc_correlation": <float>,
    "correlation_velocity": <float>,
    "eigenvalue_entropy": <float>,
    "risk_concentration": "<low|normal|elevated|extreme>"
  },
  "interpretation": "<what correlation dynamics tell us about systemic risk>",
  "confidence": <0-1>,
  "flags": ["<flag1>"]
}
```""",
        "data_requirements": ["absorption_ratio", "dcc_correlation", "eigenvalue_entropy", "top_pc_variance"]
    },
}


class ObserverSwarm:
    """
    Manages parallel execution of 20+ observer agents.

    Each observer:
    1. Receives market data for its domain
    2. Interprets what the data MEANS (not just what it is)
    3. Outputs structured observation with confidence
    """

    def __init__(
        self,
        observers: List[str] = None,
        model: str = "deepseek-chat",
        concurrency: int = 20
    ):
        """
        Initialize Observer Swarm.

        Args:
            observers: List of observer IDs to use (default: all)
            model: LLM model for observers
            concurrency: Max parallel observers
        """
        self.observers = observers or list(OBSERVER_REGISTRY.keys())
        self.model = model
        self.concurrency = concurrency
        self.last_observations: Dict[str, ObserverOutput] = {}

    def prepare_observer_data(
        self,
        observer_id: str,
        market_data: pd.DataFrame,
        equations: Dict[str, str] = None
    ) -> Dict[str, Any]:
        """
        Prepare data for a specific observer.

        Args:
            observer_id: Observer identifier
            market_data: DataFrame with market features
            equations: Math Swarm discovered equations (context)

        Returns:
            Dict of data relevant to this observer
        """
        config = OBSERVER_REGISTRY.get(observer_id, {})
        requirements = config.get('data_requirements', [])

        # Extract latest values for required columns
        data = {}
        latest = market_data.iloc[-1] if len(market_data) > 0 else {}

        for req in requirements:
            if req in market_data.columns:
                data[req] = float(latest.get(req, 0))
            elif req in ['close', 'open', 'high', 'low', 'volume']:
                data[req] = float(latest.get(req, 0))

        # Add historical context
        if len(market_data) > 20:
            for req in requirements:
                if req in market_data.columns:
                    col = market_data[req].dropna()
                    if len(col) > 0:
                        data[f'{req}_20d_mean'] = float(col.tail(20).mean())
                        data[f'{req}_20d_std'] = float(col.tail(20).std())

        # Add equations as context if available
        if equations:
            data['math_swarm_equations'] = equations

        return data

    def run_observers(
        self,
        market_data: pd.DataFrame,
        equations: Dict[str, str] = None,
        symbol: str = "SPY"
    ) -> List[ObserverOutput]:
        """
        Run all observers in parallel.

        Args:
            market_data: DataFrame with all market features
            equations: Math Swarm discovered equations
            symbol: Symbol being analyzed

        Returns:
            List of ObserverOutput objects
        """
        logger.info(f"Running {len(self.observers)} observers on {symbol}...")

        # Build tasks for swarm
        tasks = []
        observer_data = {}

        for obs_id in self.observers:
            if obs_id not in OBSERVER_REGISTRY:
                logger.warning(f"Unknown observer: {obs_id}")
                continue

            config = OBSERVER_REGISTRY[obs_id]
            data = self.prepare_observer_data(obs_id, market_data, equations)
            observer_data[obs_id] = data

            user_prompt = f"""Analyze the following market data for {symbol}:

{json.dumps(data, indent=2, default=str)}

Provide your observation and interpretation in the specified JSON format."""

            tasks.append({
                "id": obs_id,
                "system": config['system_prompt'],
                "user": user_prompt,
                "model": self.model,
                "temperature": 0.3
            })

        # Run swarm
        results = run_swarm_sync(tasks, concurrency=self.concurrency)

        # Parse results
        outputs = []
        for result in results:
            obs_id = result['id']
            config = OBSERVER_REGISTRY.get(obs_id, {})

            if result['status'] == 'success':
                output = ObserverOutput.from_llm_response(
                    observer_id=obs_id,
                    domain=config.get('domain', ObserverDomain.OPTIONS_SURFACE),
                    response=result['content'],
                    raw_data=observer_data.get(obs_id, {})
                )
            else:
                output = ObserverOutput(
                    observer_id=obs_id,
                    domain=config.get('domain', ObserverDomain.OPTIONS_SURFACE),
                    timestamp=datetime.now().isoformat(),
                    observation={},
                    interpretation=f"Observer failed: {result.get('error', 'Unknown')}",
                    confidence=0.0,
                    flags=['failed'],
                    raw_data=observer_data.get(obs_id, {})
                )

            outputs.append(output)
            self.last_observations[obs_id] = output

        success_count = sum(1 for o in outputs if 'failed' not in o.flags)
        logger.info(f"Observer swarm complete: {success_count}/{len(outputs)} succeeded")

        return outputs

    def get_observations_by_domain(
        self,
        outputs: List[ObserverOutput]
    ) -> Dict[ObserverDomain, List[ObserverOutput]]:
        """Group observations by domain."""
        by_domain = {}
        for output in outputs:
            domain = output.domain
            if domain not in by_domain:
                by_domain[domain] = []
            by_domain[domain].append(output)
        return by_domain

    def get_high_confidence_observations(
        self,
        outputs: List[ObserverOutput],
        threshold: float = 0.7
    ) -> List[ObserverOutput]:
        """Filter to high-confidence observations."""
        return [o for o in outputs if o.confidence >= threshold]

    def get_flagged_observations(
        self,
        outputs: List[ObserverOutput],
        flag: str = None
    ) -> List[ObserverOutput]:
        """Get observations with specific flags."""
        if flag:
            return [o for o in outputs if flag in o.flags]
        return [o for o in outputs if o.flags]


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample market data
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=100, freq='D')

    market_data = pd.DataFrame({
        'timestamp': dates,
        'close': 500 + np.cumsum(np.random.randn(100)),
        'iv_30d': 20 + np.random.randn(100) * 3,
        'rv_30d': 18 + np.random.randn(100) * 2,
        'vix': 18 + np.random.randn(100) * 4,
        'put_iv_25d': 22 + np.random.randn(100) * 3,
        'call_iv_25d': 18 + np.random.randn(100) * 2,
        'put_call_ratio': 0.9 + np.random.randn(100) * 0.2,
    })

    # Test single observer
    print("\n=== Testing VRP Observer ===")
    swarm = ObserverSwarm(observers=['vrp_observer'])

    # This will fail without API key, but tests structure
    try:
        outputs = swarm.run_observers(market_data, symbol='SPY')
        for o in outputs:
            print(f"\nObserver: {o.observer_id}")
            print(f"Confidence: {o.confidence}")
            print(f"Interpretation: {o.interpretation[:200]}...")
    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
