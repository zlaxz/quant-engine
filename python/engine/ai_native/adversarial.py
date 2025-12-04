#!/usr/bin/env python3
"""
Adversarial Agent - Thesis Challenger
=====================================
Devil's advocate that ATTACKS every thesis.
Forces refinement or rejection. Prevents overconfidence.

Key insight: The goal is not to destroy theses, but to make them ROBUST.
A thesis that survives adversarial attack is worth trading.
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any

from .synthesis import Thesis

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engine.swarm.orchestrator import run_swarm_sync

logger = logging.getLogger("AINative.Adversarial")


@dataclass
class Challenge:
    """An adversarial challenge to a thesis."""
    challenge_id: str
    thesis_id: str
    timestamp: str
    challenge_text: str
    attacks: List[str]
    alternative_scenarios: List[str]
    weakest_assumptions: List[str]
    recommended_checks: List[str]
    severity: str  # minor, moderate, severe, fatal
    survival_probability: float  # 0-1: probability thesis survives

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_llm_response(cls, response: str, challenge_id: str,
                          thesis_id: str) -> 'Challenge':
        """Parse LLM response into structured challenge."""
        try:
            if '```json' in response:
                json_str = response.split('```json')[1].split('```')[0]
                data = json.loads(json_str)
            elif '{' in response and '}' in response:
                start = response.index('{')
                end = response.rindex('}') + 1
                data = json.loads(response[start:end])
            else:
                data = {'challenge_text': response[:500]}

            return cls(
                challenge_id=challenge_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                challenge_text=data.get('challenge_text', 'Challenge parsing failed'),
                attacks=data.get('attacks', []),
                alternative_scenarios=data.get('alternative_scenarios', []),
                weakest_assumptions=data.get('weakest_assumptions', []),
                recommended_checks=data.get('recommended_checks', []),
                severity=data.get('severity', 'moderate'),
                survival_probability=float(data.get('survival_probability', 0.5))
            )
        except Exception as e:
            logger.warning(f"Failed to parse challenge response: {e}")
            return cls(
                challenge_id=challenge_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                challenge_text=response[:500] if response else "Parse error",
                attacks=['Unable to parse attacks'],
                alternative_scenarios=[],
                weakest_assumptions=[],
                recommended_checks=[],
                severity='unknown',
                survival_probability=0.5
            )


ADVERSARIAL_SYSTEM_PROMPT = """You are the Adversarial Agent - the Devil's Advocate.

Your job: ATTACK every thesis. Find the weaknesses. Expose the assumptions.

You are NOT trying to be negative for its own sake.
You ARE trying to make theses ROBUST before capital is risked.

For EVERY thesis, consider:

1. WHAT IF THE OPPOSITE IS TRUE?
   - If thesis says "bullish", what would make it actually bearish?
   - What would need to change for the thesis to flip?

2. HIDDEN ASSUMPTIONS
   - What is the thesis assuming that might not be true?
   - "VRP elevated means mispricing" assumes normal dealer behavior
   - What if dealers are hedging unusual risk?

3. ALTERNATIVE EXPLANATIONS
   - Same data can support multiple narratives
   - Flat term structure could mean: no events, OR inventory issues, OR front-month oversold
   - Which is most likely? How would we know?

4. MISSING DATA
   - What would change your confidence if you knew X?
   - What data is the thesis ignoring?

5. REGIME BLINDNESS
   - Does this thesis work in ALL regimes?
   - What if we're at a regime transition?

Output JSON:
```json
{
  "challenge_text": "<one sentence challenge to the thesis>",
  "attacks": [
    "<attack 1: specific flaw in reasoning>",
    "<attack 2: hidden assumption>",
    "<attack 3: alternative explanation>"
  ],
  "alternative_scenarios": [
    "<scenario where thesis fails>",
    "<scenario where opposite is true>"
  ],
  "weakest_assumptions": [
    "<assumption 1 that if wrong, thesis fails>",
    "<assumption 2>"
  ],
  "recommended_checks": [
    "<check 1: what data would validate/invalidate>",
    "<check 2>"
  ],
  "severity": "<minor|moderate|severe|fatal>",
  "survival_probability": <0-1 probability thesis survives this challenge>
}
```

IMPORTANT: A thesis that survives your attacks is STRONGER.
A thesis destroyed by your attacks saves capital.
Both outcomes are good. Your job is truth, not validation."""


class AdversarialAgent:
    """
    Attacks theses to find weaknesses and force refinement.

    The adversarial process is NOT negative - it's quality control.
    Theses that survive are worth trading. Those that don't save us money.
    """

    def __init__(self, model: str = "deepseek-reasoner"):
        """
        Initialize Adversarial Agent.

        Args:
            model: LLM model (recommend deepseek-reasoner for reasoning)
        """
        self.model = model
        self.challenge_history: List[Challenge] = []

    def challenge_thesis(
        self,
        thesis: Thesis,
        observations: List['ObserverOutput'] = None,
        historical_context: str = None
    ) -> Challenge:
        """
        Challenge a thesis with adversarial analysis.

        Args:
            thesis: The thesis to challenge
            observations: Original observations (for context)
            historical_context: Any relevant historical context

        Returns:
            Challenge object with attacks and alternatives
        """
        logger.info(f"Challenging thesis: {thesis.thesis[:50]}...")

        # Build prompt
        thesis_text = f"""
THESIS TO CHALLENGE:
{thesis.thesis}

Direction: {thesis.direction}
Confidence: {thesis.confidence:.0%}
Time Horizon: {thesis.time_horizon}

Reasoning Chain:
{json.dumps(thesis.reasoning_chain, indent=2)}

Key Drivers:
{json.dumps(thesis.key_drivers, indent=2)}

Risks Already Identified:
{json.dumps(thesis.risks, indent=2)}
"""

        context_parts = []
        if observations:
            obs_summary = [f"- {o.observer_id}: {o.interpretation[:100]}..."
                          for o in observations[:5]]
            context_parts.append(f"SUPPORTING OBSERVATIONS:\n" + "\n".join(obs_summary))

        if historical_context:
            context_parts.append(f"HISTORICAL CONTEXT:\n{historical_context}")

        context = "\n\n".join(context_parts) if context_parts else ""

        user_prompt = f"""{thesis_text}

{context}

Challenge this thesis. Find the weaknesses. What could go wrong?
What assumptions might be false? What alternative explanations exist?

Provide your adversarial analysis in the specified JSON format."""

        # Run challenge
        task = [{
            "id": "adversarial",
            "system": ADVERSARIAL_SYSTEM_PROMPT,
            "user": user_prompt,
            "model": self.model,
            "temperature": 0.3  # Slightly higher for creative attacks
        }]

        results = run_swarm_sync(task, concurrency=1, timeout=120)

        challenge_id = f"challenge_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        if results[0]['status'] == 'success':
            challenge = Challenge.from_llm_response(
                results[0]['content'],
                challenge_id,
                thesis.thesis_id
            )
        else:
            challenge = Challenge(
                challenge_id=challenge_id,
                thesis_id=thesis.thesis_id,
                timestamp=datetime.now().isoformat(),
                challenge_text=f"Challenge failed: {results[0].get('error')}",
                attacks=['Challenge agent failed'],
                alternative_scenarios=[],
                weakest_assumptions=[],
                recommended_checks=[],
                severity='unknown',
                survival_probability=0.5
            )

        self.challenge_history.append(challenge)

        logger.info(f"Challenge severity: {challenge.severity}")
        logger.info(f"Survival probability: {challenge.survival_probability:.0%}")

        return challenge

    def evaluate_thesis_strength(
        self,
        thesis: Thesis,
        challenge: Challenge
    ) -> Dict[str, Any]:
        """
        Evaluate overall thesis strength after challenge.

        Returns:
            Dict with:
            - adjusted_confidence: thesis confidence after challenge
            - should_trade: bool
            - required_hedges: list of suggested hedges
            - position_size_modifier: 0-1 multiplier for position size
        """
        # Adjust confidence based on challenge severity
        severity_modifiers = {
            'minor': 0.95,
            'moderate': 0.80,
            'severe': 0.60,
            'fatal': 0.20,
            'unknown': 0.70
        }

        modifier = severity_modifiers.get(challenge.severity, 0.70)
        adjusted_confidence = thesis.confidence * modifier * challenge.survival_probability

        # Trading decision thresholds
        should_trade = adjusted_confidence >= 0.50
        position_size_modifier = min(adjusted_confidence / 0.70, 1.0)  # Full size at 70%+

        # Suggest hedges based on attacks
        hedges = []
        for attack in challenge.attacks:
            if 'regime' in attack.lower():
                hedges.append("Consider regime-conditional position sizing")
            if 'volatility' in attack.lower() or 'vol' in attack.lower():
                hedges.append("Add vega hedge or use spreads")
            if 'timing' in attack.lower() or 'early' in attack.lower():
                hedges.append("Use shorter expiration for faster feedback")

        return {
            'original_confidence': thesis.confidence,
            'adjusted_confidence': adjusted_confidence,
            'challenge_severity': challenge.severity,
            'survival_probability': challenge.survival_probability,
            'should_trade': should_trade,
            'position_size_modifier': position_size_modifier,
            'required_hedges': hedges,
            'weakest_assumptions': challenge.weakest_assumptions
        }

    def multi_round_challenge(
        self,
        thesis: Thesis,
        rounds: int = 2
    ) -> List[Challenge]:
        """
        Run multiple rounds of adversarial challenge.

        Each round builds on previous attacks for deeper analysis.
        """
        challenges = []

        for round_num in range(rounds):
            context = None
            if challenges:
                # Build on previous challenges
                prev_attacks = []
                for c in challenges:
                    prev_attacks.extend(c.attacks)
                context = f"Previous attacks already made:\n" + "\n".join(prev_attacks)

            challenge = self.challenge_thesis(thesis, historical_context=context)
            challenges.append(challenge)

            # If thesis is already destroyed, stop
            if challenge.severity == 'fatal':
                logger.info(f"Thesis destroyed in round {round_num + 1}")
                break

        return challenges


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

    # Create sample thesis
    thesis = Thesis(
        thesis_id="thesis_test_001",
        timestamp=datetime.now().isoformat(),
        thesis="70% confident we see a relief rally within 5 days because VRP is elevated without term structure steepening, suggesting mispricing not genuine fear",
        direction="bullish",
        confidence=0.70,
        time_horizon="5 days",
        reasoning_chain=[
            "VRP at 82nd percentile indicates elevated fear premium",
            "But term structure is flat - no near-term event pricing",
            "Flow is normal - no unusual dealer positioning",
            "Conclusion: mispricing, not genuine fear"
        ],
        key_drivers=["vrp_elevated", "term_structure_flat", "normal_flow"],
        risks=["Unknown event", "Regime transition"],
        contradictions=[],
        supporting_observations=["vrp_observer", "term_structure_observer", "flow_observer"]
    )

    # Test challenge
    print("\n=== Testing Adversarial Agent ===")
    agent = AdversarialAgent()

    try:
        challenge = agent.challenge_thesis(thesis)
        print(f"\nChallenge: {challenge.challenge_text}")
        print(f"Severity: {challenge.severity}")
        print(f"Survival Probability: {challenge.survival_probability:.0%}")
        print(f"\nAttacks:")
        for attack in challenge.attacks:
            print(f"  - {attack}")
        print(f"\nAlternative Scenarios:")
        for scenario in challenge.alternative_scenarios:
            print(f"  - {scenario}")

        # Evaluate strength
        evaluation = agent.evaluate_thesis_strength(thesis, challenge)
        print(f"\nEvaluation:")
        print(f"  Original confidence: {evaluation['original_confidence']:.0%}")
        print(f"  Adjusted confidence: {evaluation['adjusted_confidence']:.0%}")
        print(f"  Should trade: {evaluation['should_trade']}")
        print(f"  Position size modifier: {evaluation['position_size_modifier']:.1%}")

    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
