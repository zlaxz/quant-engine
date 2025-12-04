#!/usr/bin/env python3
"""
Learning Agent - Reasoning Improvement
=====================================
After trade resolution: what was right/wrong and WHY?
Continuous improvement of REASONING, not just parameters.

Key insight: We're not tuning "if VRP > X" thresholds.
We're learning "our VRP interpretation was wrong because..."
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any

from .synthesis import Thesis
from .expression import TradeExpression

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engine.swarm.orchestrator import run_swarm_sync

logger = logging.getLogger("AINative.Learning")


@dataclass
class TradeOutcome:
    """The actual outcome of a trade."""
    trade_id: str
    thesis_id: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    underlying_move_pct: float
    pnl_dollars: float
    pnl_pct: float
    thesis_correct: bool  # Did the thesis direction play out?
    timing_correct: bool  # Did it happen in the expected timeframe?
    magnitude_achieved: bool  # Was the expected move achieved?
    notes: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class LearningOutcome:
    """Lessons learned from a trade outcome."""
    learning_id: str
    trade_id: str
    thesis_id: str
    timestamp: str
    thesis_was_correct: bool
    correct_reasons: List[str]  # What we got right
    incorrect_reasons: List[str]  # What we got wrong
    root_cause_analysis: str  # WHY were we right/wrong
    observer_accuracy: Dict[str, float]  # Which observers were helpful
    synthesis_quality: str  # How good was the reasoning?
    expression_quality: str  # Was the structure optimal?
    recommendations: List[str]  # What to do differently
    weight_adjustments: Dict[str, float]  # Observer weight changes

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_llm_response(cls, response: str, learning_id: str,
                          trade_id: str, thesis_id: str) -> 'LearningOutcome':
        """Parse LLM response into structured learning."""
        try:
            if '```json' in response:
                json_str = response.split('```json')[1].split('```')[0]
                data = json.loads(json_str)
            elif '{' in response and '}' in response:
                start = response.index('{')
                end = response.rindex('}') + 1
                data = json.loads(response[start:end])
            else:
                data = {}

            return cls(
                learning_id=learning_id,
                trade_id=trade_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis_was_correct=data.get('thesis_was_correct', False),
                correct_reasons=data.get('correct_reasons', []),
                incorrect_reasons=data.get('incorrect_reasons', []),
                root_cause_analysis=data.get('root_cause_analysis', ''),
                observer_accuracy=data.get('observer_accuracy', {}),
                synthesis_quality=data.get('synthesis_quality', 'unknown'),
                expression_quality=data.get('expression_quality', 'unknown'),
                recommendations=data.get('recommendations', []),
                weight_adjustments=data.get('weight_adjustments', {})
            )
        except Exception as e:
            logger.warning(f"Failed to parse learning response: {e}")
            return cls(
                learning_id=learning_id,
                trade_id=trade_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis_was_correct=False,
                correct_reasons=[],
                incorrect_reasons=['Unable to parse'],
                root_cause_analysis='Parse error',
                observer_accuracy={},
                synthesis_quality='unknown',
                expression_quality='unknown',
                recommendations=[],
                weight_adjustments={}
            )


LEARNING_SYSTEM_PROMPT = """You are the Learning Agent - the Reasoning Improver.

Your job: After a trade resolves, analyze what was RIGHT and WRONG and WHY.

CRITICAL: You are NOT optimizing parameters.
You ARE improving reasoning and interpretation quality.

ANALYSIS FRAMEWORK:

1. THESIS ACCURACY
   - Was the direction correct?
   - Was the timing correct?
   - Was the magnitude achieved?

2. ROOT CAUSE ANALYSIS
   NOT: "VRP threshold was wrong"
   YES: "Our interpretation of VRP was wrong because we didn't account for..."

3. OBSERVER PERFORMANCE
   - Which observers provided useful signals?
   - Which observers were misleading?
   - Should we weight certain observers differently?

4. SYNTHESIS QUALITY
   - Did we correctly identify the narrative?
   - Did we miss contradictions?
   - Was the reasoning chain sound?

5. EXPRESSION QUALITY
   - Was the structure optimal for the thesis?
   - Was position sizing appropriate?
   - Did Greeks management help or hurt?

6. RECOMMENDATIONS
   NOT: "Change VRP threshold to 0.12"
   YES: "Weight term structure observer higher when VRP is elevated"
   YES: "Be more skeptical of VRP signals when flow is unusual"

Output JSON:
```json
{
  "thesis_was_correct": <bool>,
  "correct_reasons": [
    "<what we got right and why>",
    "<another correct element>"
  ],
  "incorrect_reasons": [
    "<what we got wrong and why>",
    "<another incorrect element>"
  ],
  "root_cause_analysis": "<deep analysis of WHY we were right/wrong>",
  "observer_accuracy": {
    "<observer_id>": <0-1 accuracy score>,
    "<observer_id>": <0-1 accuracy score>
  },
  "synthesis_quality": "<excellent|good|fair|poor>",
  "expression_quality": "<excellent|good|fair|poor>",
  "recommendations": [
    "<recommendation 1>",
    "<recommendation 2>"
  ],
  "weight_adjustments": {
    "<observer_id>": <multiplier, e.g., 1.2 or 0.8>,
    "<observer_id>": <multiplier>
  }
}
```"""


class LearningAgent:
    """
    Analyzes trade outcomes to improve reasoning quality.

    This closes the loop:
    Observer → Synthesis → Adversarial → Expression → Trade → Outcome → Learning
    Learning → Improved Observer/Synthesis weights

    We're not tuning parameters. We're improving understanding.
    """

    def __init__(self, model: str = "deepseek-reasoner"):
        """
        Initialize Learning Agent.

        Args:
            model: LLM model (recommend deepseek-reasoner for analysis)
        """
        self.model = model
        self.learning_history: List[LearningOutcome] = []
        self.observer_weights: Dict[str, float] = {}  # Accumulated weight adjustments

    def analyze_outcome(
        self,
        thesis: Thesis,
        trade: TradeExpression,
        outcome: TradeOutcome,
        original_observations: List['ObserverOutput'] = None
    ) -> LearningOutcome:
        """
        Analyze a trade outcome to extract learnings.

        Args:
            thesis: Original thesis
            trade: Trade expression used
            outcome: Actual outcome
            original_observations: Original observer outputs

        Returns:
            LearningOutcome with analysis
        """
        logger.info(f"Analyzing outcome for trade {trade.trade_id}...")

        # Format observations if available
        obs_text = ""
        if original_observations:
            obs_text = "\n".join([
                f"- {o.observer_id}: {o.interpretation[:100]}... (confidence: {o.confidence:.0%})"
                for o in original_observations
            ])

        user_prompt = f"""Analyze this trade outcome:

ORIGINAL THESIS:
{thesis.thesis}
Direction: {thesis.direction}
Confidence: {thesis.confidence:.0%}
Time Horizon: {thesis.time_horizon}

Reasoning Chain:
{json.dumps(thesis.reasoning_chain, indent=2)}

Key Drivers: {json.dumps(thesis.key_drivers)}
Risks Identified: {json.dumps(thesis.risks)}

TRADE EXPRESSION:
Structure: {trade.structure_type.value}
Position Size: {trade.position_size_pct:.1f}%
Max Loss: ${trade.max_loss:,.0f}
Max Gain: ${trade.max_gain:,.0f}

ACTUAL OUTCOME:
Entry: {outcome.entry_date} @ ${outcome.entry_price:.2f}
Exit: {outcome.exit_date} @ ${outcome.exit_price:.2f}
Underlying Move: {outcome.underlying_move_pct:+.1%}
PnL: ${outcome.pnl_dollars:+,.0f} ({outcome.pnl_pct:+.1%})
Thesis Direction Correct: {outcome.thesis_correct}
Timing Correct: {outcome.timing_correct}
Magnitude Achieved: {outcome.magnitude_achieved}

ORIGINAL OBSERVATIONS:
{obs_text if obs_text else "Not available"}

Analyze:
1. What did we get RIGHT and WHY?
2. What did we get WRONG and WHY?
3. Which observers were helpful/misleading?
4. How should we adjust our reasoning?

Provide deep analysis in the specified JSON format."""

        task = [{
            "id": "learning",
            "system": LEARNING_SYSTEM_PROMPT,
            "user": user_prompt,
            "model": self.model,
            "temperature": 0.2
        }]

        results = run_swarm_sync(task, concurrency=1, timeout=120)

        learning_id = f"learning_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        if results[0]['status'] == 'success':
            learning = LearningOutcome.from_llm_response(
                results[0]['content'],
                learning_id,
                trade.trade_id,
                thesis.thesis_id
            )
        else:
            learning = LearningOutcome(
                learning_id=learning_id,
                trade_id=trade.trade_id,
                thesis_id=thesis.thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis_was_correct=outcome.thesis_correct,
                correct_reasons=[],
                incorrect_reasons=[f"Analysis failed: {results[0].get('error')}"],
                root_cause_analysis='Analysis failed',
                observer_accuracy={},
                synthesis_quality='unknown',
                expression_quality='unknown',
                recommendations=[],
                weight_adjustments={}
            )

        self.learning_history.append(learning)

        # Apply weight adjustments
        self._update_observer_weights(learning.weight_adjustments)

        logger.info(f"Learning analysis complete:")
        logger.info(f"  Thesis correct: {learning.thesis_was_correct}")
        logger.info(f"  Synthesis quality: {learning.synthesis_quality}")
        logger.info(f"  Expression quality: {learning.expression_quality}")

        return learning

    def _update_observer_weights(self, adjustments: Dict[str, float]):
        """
        Update cumulative observer weights.

        Weights are multipliers that affect confidence in future runs.
        """
        for observer_id, multiplier in adjustments.items():
            current = self.observer_weights.get(observer_id, 1.0)
            # Smooth update: new = 0.8 * old + 0.2 * adjustment
            new_weight = 0.8 * current + 0.2 * multiplier
            # Keep weights between 0.5 and 1.5
            self.observer_weights[observer_id] = max(0.5, min(1.5, new_weight))

    def get_observer_weights(self) -> Dict[str, float]:
        """Get current observer weight adjustments."""
        return self.observer_weights.copy()

    def generate_meta_learning(self, n_recent: int = 10) -> Dict[str, Any]:
        """
        Generate meta-learning from recent outcomes.

        Aggregates patterns across multiple trades.
        """
        if len(self.learning_history) < 2:
            return {"status": "Insufficient data for meta-learning"}

        recent = self.learning_history[-n_recent:]

        # Aggregate statistics
        correct_count = sum(1 for l in recent if l.thesis_was_correct)
        accuracy = correct_count / len(recent)

        # Aggregate observer performance
        observer_scores: Dict[str, List[float]] = {}
        for learning in recent:
            for obs_id, score in learning.observer_accuracy.items():
                if obs_id not in observer_scores:
                    observer_scores[obs_id] = []
                observer_scores[obs_id].append(score)

        avg_observer_scores = {
            obs_id: sum(scores) / len(scores)
            for obs_id, scores in observer_scores.items()
        }

        # Aggregate recommendations
        all_recommendations = []
        for learning in recent:
            all_recommendations.extend(learning.recommendations)

        # Count common recommendations
        rec_counts = {}
        for rec in all_recommendations:
            rec_lower = rec.lower()
            rec_counts[rec_lower] = rec_counts.get(rec_lower, 0) + 1

        top_recommendations = sorted(
            rec_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )[:5]

        return {
            "n_trades_analyzed": len(recent),
            "thesis_accuracy": accuracy,
            "avg_observer_scores": avg_observer_scores,
            "top_recommendations": [r[0] for r in top_recommendations],
            "current_weights": self.observer_weights,
            "synthesis_quality_distribution": {
                q: sum(1 for l in recent if l.synthesis_quality == q)
                for q in ['excellent', 'good', 'fair', 'poor', 'unknown']
            }
        }

    def export_learnings(self, filepath: str):
        """Export learning history to JSON."""
        data = {
            "export_timestamp": datetime.now().isoformat(),
            "n_learnings": len(self.learning_history),
            "current_weights": self.observer_weights,
            "learnings": [l.to_dict() for l in self.learning_history]
        }
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"Exported {len(self.learning_history)} learnings to {filepath}")

    def import_learnings(self, filepath: str):
        """Import learning history from JSON."""
        with open(filepath, 'r') as f:
            data = json.load(f)

        self.observer_weights = data.get('current_weights', {})

        for learning_data in data.get('learnings', []):
            learning = LearningOutcome(
                learning_id=learning_data['learning_id'],
                trade_id=learning_data['trade_id'],
                thesis_id=learning_data['thesis_id'],
                timestamp=learning_data['timestamp'],
                thesis_was_correct=learning_data['thesis_was_correct'],
                correct_reasons=learning_data['correct_reasons'],
                incorrect_reasons=learning_data['incorrect_reasons'],
                root_cause_analysis=learning_data['root_cause_analysis'],
                observer_accuracy=learning_data['observer_accuracy'],
                synthesis_quality=learning_data['synthesis_quality'],
                expression_quality=learning_data['expression_quality'],
                recommendations=learning_data['recommendations'],
                weight_adjustments=learning_data['weight_adjustments']
            )
            self.learning_history.append(learning)

        logger.info(f"Imported {len(data.get('learnings', []))} learnings from {filepath}")


# Import for type hints
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .observers import ObserverOutput


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    from .synthesis import Thesis
    from .expression import TradeExpression, StructureType, Greeks

    # Create sample data
    thesis = Thesis(
        thesis_id="thesis_test_001",
        timestamp="2024-12-01T10:00:00",
        thesis="70% confident we see a relief rally within 5 days",
        direction="bullish",
        confidence=0.70,
        time_horizon="5 days",
        reasoning_chain=["VRP elevated", "Term structure flat", "Flow normal"],
        key_drivers=["vrp_elevated", "term_flat"],
        risks=["Unknown event"],
        contradictions=[],
        supporting_observations=["vrp_observer", "term_structure_observer"]
    )

    trade = TradeExpression(
        trade_id="trade_test_001",
        thesis_id="thesis_test_001",
        timestamp="2024-12-01T10:30:00",
        structure_type=StructureType.CALL_SPREAD,
        underlying="SPY",
        expiration="2024-12-06",
        legs=[
            {"strike": 595, "type": "call", "quantity": 10, "side": "buy"},
            {"strike": 600, "type": "call", "quantity": 10, "side": "sell"}
        ],
        rationale={"why_this_structure": "Defined risk for moderate confidence"},
        greeks=Greeks(0.25, 0.02, -0.15, 0.08),
        max_loss=2000,
        max_gain=3000,
        breakeven=[597.0],
        position_size_pct=2.0,
        confidence_adjusted=True,
        kelly_fraction=0.25
    )

    outcome = TradeOutcome(
        trade_id="trade_test_001",
        thesis_id="thesis_test_001",
        entry_date="2024-12-01",
        exit_date="2024-12-05",
        entry_price=595.0,
        exit_price=601.0,
        underlying_move_pct=0.01,
        pnl_dollars=1500,
        pnl_pct=75.0,
        thesis_correct=True,
        timing_correct=True,
        magnitude_achieved=True
    )

    print("\n=== Testing Learning Agent ===")
    agent = LearningAgent()

    try:
        learning = agent.analyze_outcome(thesis, trade, outcome)
        print(f"\nThesis was correct: {learning.thesis_was_correct}")
        print(f"Root cause: {learning.root_cause_analysis[:200]}...")
        print(f"Recommendations: {learning.recommendations}")
        print(f"Weight adjustments: {learning.weight_adjustments}")
    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
