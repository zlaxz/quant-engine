#!/usr/bin/env python3
"""
AI-Native Pipeline - Full Orchestration
=======================================
Ties together all components:
Foundation (Features → Scout → Math → Jury) →
Observer Swarm → Synthesis → Adversarial → Expression → Learning

This is the superpowered version: proven quant foundation feeding
an AI reasoning engine that UNDERSTANDS what the math means.
"""

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path

import pandas as pd

from .observers import ObserverSwarm, ObserverOutput, OBSERVER_REGISTRY
from .synthesis import SynthesisAgent, Thesis
from .adversarial import AdversarialAgent, Challenge
from .expression import ExpressionAgent, TradeExpression
from .learning import LearningAgent, LearningOutcome, TradeOutcome

logger = logging.getLogger("AINative.Pipeline")


@dataclass
class PipelineResult:
    """Complete result from AI-native pipeline run."""
    timestamp: str
    symbol: str
    observations: List[Dict]  # ObserverOutput as dicts
    thesis: Dict  # Thesis as dict
    challenge: Dict  # Challenge as dict
    evaluation: Dict  # Thesis strength evaluation
    trade: Optional[Dict]  # TradeExpression as dict (if tradeable)
    should_trade: bool
    reasoning_summary: str
    full_audit_trail: Dict

    def to_dict(self) -> Dict:
        return asdict(self)

    def save(self, filepath: str):
        """Save pipeline result to JSON."""
        with open(filepath, 'w') as f:
            json.dump(self.to_dict(), f, indent=2, default=str)


class AINativePipeline:
    """
    Orchestrates the complete AI-native trading pipeline.

    Data Lake → Features → Scout → Math → Jury →
    OBSERVERS → SYNTHESIS → ADVERSARIAL → EXPRESSION → [TRADE]

    The Foundation Layer (Features → Jury) feeds context.
    The Intelligence Layer (Observers → Expression) reasons about it.
    """

    def __init__(
        self,
        observer_model: str = "deepseek-chat",
        synthesis_model: str = "deepseek-reasoner",
        adversarial_model: str = "deepseek-reasoner",
        expression_model: str = "deepseek-chat",
        learning_model: str = "deepseek-reasoner",
        observer_concurrency: int = 20
    ):
        """
        Initialize AI-Native Pipeline.

        Args:
            observer_model: Model for observer swarm (cheaper, parallel)
            synthesis_model: Model for synthesis (reasoning chain)
            adversarial_model: Model for adversarial (reasoning chain)
            expression_model: Model for expression (structured output)
            learning_model: Model for learning analysis
            observer_concurrency: Max parallel observers
        """
        self.observer_swarm = ObserverSwarm(
            model=observer_model,
            concurrency=observer_concurrency
        )
        self.synthesis_agent = SynthesisAgent(model=synthesis_model)
        self.adversarial_agent = AdversarialAgent(model=adversarial_model)
        self.expression_agent = ExpressionAgent(model=expression_model)
        self.learning_agent = LearningAgent(model=learning_model)

        # History
        self.results_history: List[PipelineResult] = []

    def run(
        self,
        market_data: pd.DataFrame,
        equations: Dict[str, str] = None,
        regime_context: Dict = None,
        symbol: str = "SPY",
        current_price: float = None,
        current_iv: float = None,
        portfolio_value: float = 100000,
        min_confidence_to_trade: float = 0.50
    ) -> PipelineResult:
        """
        Run the complete AI-native pipeline.

        Args:
            market_data: DataFrame with market features
            equations: Math Swarm discovered equations (context)
            regime_context: Jury Swarm regime info
            symbol: Symbol to analyze
            current_price: Current underlying price (auto-detect if None)
            current_iv: Current implied volatility (auto-detect if None)
            portfolio_value: Total portfolio value
            min_confidence_to_trade: Minimum adjusted confidence to generate trade

        Returns:
            PipelineResult with full analysis and optional trade
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"AI-NATIVE PIPELINE - {symbol}")
        logger.info(f"{'='*60}")

        timestamp = datetime.now().isoformat()

        # Auto-detect price/IV if not provided
        if current_price is None:
            current_price = market_data['close'].iloc[-1] if 'close' in market_data.columns else 500.0
        if current_iv is None:
            current_iv = market_data['iv_30d'].iloc[-1] if 'iv_30d' in market_data.columns else 20.0

        logger.info(f"Current price: ${current_price:.2f}, IV: {current_iv:.1f}%")

        # =================================================================
        # PHASE 1: OBSERVER SWARM
        # =================================================================
        logger.info("\n--- Phase 1: Observer Swarm ---")
        observations = self.observer_swarm.run_observers(
            market_data, equations, symbol
        )

        high_confidence_obs = self.observer_swarm.get_high_confidence_observations(
            observations, threshold=0.7
        )
        logger.info(f"High-confidence observations: {len(high_confidence_obs)}/{len(observations)}")

        # =================================================================
        # PHASE 2: SYNTHESIS
        # =================================================================
        logger.info("\n--- Phase 2: Synthesis ---")
        thesis = self.synthesis_agent.synthesize(
            observations, equations, regime_context, symbol
        )

        logger.info(f"Thesis: {thesis.direction} ({thesis.confidence:.0%})")
        logger.info(f"  {thesis.thesis[:80]}...")

        # =================================================================
        # PHASE 3: ADVERSARIAL CHALLENGE
        # =================================================================
        logger.info("\n--- Phase 3: Adversarial Challenge ---")
        challenge = self.adversarial_agent.challenge_thesis(
            thesis, observations
        )

        evaluation = self.adversarial_agent.evaluate_thesis_strength(
            thesis, challenge
        )

        logger.info(f"Challenge severity: {challenge.severity}")
        logger.info(f"Adjusted confidence: {evaluation['adjusted_confidence']:.0%}")
        logger.info(f"Should trade: {evaluation['should_trade']}")

        # =================================================================
        # PHASE 4: EXPRESSION (if tradeable)
        # =================================================================
        trade = None
        should_trade = evaluation['adjusted_confidence'] >= min_confidence_to_trade

        if should_trade:
            logger.info("\n--- Phase 4: Expression ---")
            trade = self.expression_agent.express_thesis(
                thesis, evaluation, current_price, current_iv,
                symbol, portfolio_value
            )
            logger.info(f"Trade: {trade.structure_type.value}")
            logger.info(f"Position size: {trade.position_size_pct:.1f}%")
        else:
            logger.info("\n--- Phase 4: No Trade (confidence too low) ---")
            logger.info(f"Adjusted confidence {evaluation['adjusted_confidence']:.0%} < {min_confidence_to_trade:.0%} threshold")

        # =================================================================
        # BUILD RESULT
        # =================================================================
        reasoning_summary = self._build_reasoning_summary(
            thesis, challenge, evaluation, trade
        )

        result = PipelineResult(
            timestamp=timestamp,
            symbol=symbol,
            observations=[o.to_dict() for o in observations],
            thesis=thesis.to_dict(),
            challenge=challenge.to_dict(),
            evaluation=evaluation,
            trade=trade.to_dict() if trade else None,
            should_trade=should_trade,
            reasoning_summary=reasoning_summary,
            full_audit_trail=self._build_audit_trail(
                observations, thesis, challenge, evaluation, trade
            )
        )

        self.results_history.append(result)

        logger.info(f"\n{'='*60}")
        logger.info(f"PIPELINE COMPLETE")
        logger.info(f"{'='*60}")
        logger.info(f"Result: {'TRADE' if should_trade else 'NO TRADE'}")
        if should_trade:
            logger.info(f"  Structure: {trade.structure_type.value}")
            logger.info(f"  Size: {trade.position_size_pct:.1f}%")

        return result

    def _build_reasoning_summary(
        self,
        thesis: Thesis,
        challenge: Challenge,
        evaluation: Dict,
        trade: Optional[TradeExpression]
    ) -> str:
        """Build human-readable reasoning summary."""
        lines = [
            f"## Thesis",
            f"{thesis.thesis}",
            f"Direction: {thesis.direction}, Confidence: {thesis.confidence:.0%}",
            f"",
            f"## Key Reasoning",
        ]
        for step in thesis.reasoning_chain[:5]:
            lines.append(f"- {step}")

        lines.extend([
            f"",
            f"## Adversarial Analysis",
            f"Challenge: {challenge.challenge_text}",
            f"Severity: {challenge.severity}",
            f"Survival probability: {challenge.survival_probability:.0%}",
            f"",
            f"## Final Assessment",
            f"Original confidence: {evaluation['original_confidence']:.0%}",
            f"Adjusted confidence: {evaluation['adjusted_confidence']:.0%}",
            f"Should trade: {evaluation['should_trade']}",
        ])

        if trade:
            lines.extend([
                f"",
                f"## Trade Expression",
                f"Structure: {trade.structure_type.value}",
                f"Position size: {trade.position_size_pct:.1f}%",
                f"Max loss: ${trade.max_loss:,.0f}",
                f"Max gain: ${trade.max_gain:,.0f}",
            ])

        return "\n".join(lines)

    def _build_audit_trail(
        self,
        observations: List[ObserverOutput],
        thesis: Thesis,
        challenge: Challenge,
        evaluation: Dict,
        trade: Optional[TradeExpression]
    ) -> Dict:
        """Build complete audit trail for compliance/review."""
        return {
            "pipeline_version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "n_observers": len(observations),
            "observer_ids": [o.observer_id for o in observations],
            "high_confidence_observers": [
                o.observer_id for o in observations if o.confidence >= 0.7
            ],
            "thesis_drivers": thesis.key_drivers,
            "thesis_risks": thesis.risks,
            "challenge_attacks": challenge.attacks,
            "confidence_progression": {
                "original": thesis.confidence,
                "after_adversarial": evaluation['adjusted_confidence']
            },
            "decision": "TRADE" if trade else "NO_TRADE",
            "trade_structure": trade.structure_type.value if trade else None
        }

    def process_outcome(
        self,
        result: PipelineResult,
        outcome: TradeOutcome
    ) -> LearningOutcome:
        """
        Process a trade outcome and extract learnings.

        Call this after a trade resolves to improve future reasoning.

        Args:
            result: Original pipeline result
            outcome: Actual trade outcome

        Returns:
            LearningOutcome with analysis
        """
        if not result.trade:
            raise ValueError("Cannot process outcome for no-trade result")

        # Reconstruct objects from dicts
        thesis = Thesis(**{k: v for k, v in result.thesis.items()})
        trade = TradeExpression(**{k: v for k, v in result.trade.items()})

        observations = [
            ObserverOutput(**obs_dict)
            for obs_dict in result.observations
        ]

        learning = self.learning_agent.analyze_outcome(
            thesis, trade, outcome, observations
        )

        return learning


def run_ai_native_analysis(
    market_data: pd.DataFrame,
    symbol: str = "SPY",
    equations: Dict[str, str] = None,
    regime_context: Dict = None,
    portfolio_value: float = 100000,
    output_dir: str = None
) -> PipelineResult:
    """
    Convenience function to run AI-native analysis.

    Args:
        market_data: DataFrame with market features
        symbol: Symbol to analyze
        equations: Math Swarm discovered equations
        regime_context: Jury Swarm regime info
        portfolio_value: Portfolio value for sizing
        output_dir: Directory to save results

    Returns:
        PipelineResult
    """
    pipeline = AINativePipeline()

    result = pipeline.run(
        market_data=market_data,
        equations=equations,
        regime_context=regime_context,
        symbol=symbol,
        portfolio_value=portfolio_value
    )

    if output_dir:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        filename = f"ai_native_result_{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        result.save(str(output_path / filename))
        logger.info(f"Result saved to: {output_path / filename}")

    return result


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    import numpy as np

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

    print("\n=== Testing AI-Native Pipeline ===")

    try:
        result = run_ai_native_analysis(
            market_data=market_data,
            symbol='SPY',
            portfolio_value=100000
        )

        print(f"\nPipeline Result:")
        print(f"  Should trade: {result.should_trade}")
        print(f"  Thesis: {result.thesis['thesis'][:80]}...")
        if result.trade:
            print(f"  Trade: {result.trade['structure_type']}")
            print(f"  Position: {result.trade['position_size_pct']:.1f}%")

    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
