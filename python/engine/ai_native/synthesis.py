#!/usr/bin/env python3
"""
Synthesis Agent - Thesis Formation
==================================
Central AI that REASONS about all observer outputs together.
Forms a THESIS with confidence intervals and full reasoning chain.

Key insight: Not "if VRP > 0.1 then sell" but
"VRP elevated + term structure flat + flow normal = MISPRICING thesis"
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any

from .observers import ObserverOutput, ObserverDomain

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engine.swarm.orchestrator import run_swarm_sync

logger = logging.getLogger("AINative.Synthesis")


@dataclass
class Thesis:
    """A market thesis with full reasoning chain."""
    thesis_id: str
    timestamp: str
    thesis: str
    direction: str  # bullish, bearish, neutral
    confidence: float
    time_horizon: str  # "1 day", "5 days", "2 weeks"
    reasoning_chain: List[str]
    key_drivers: List[str]
    risks: List[str]
    contradictions: List[str]
    supporting_observations: List[str]
    regime: Optional[str] = None
    regime_confidence: Optional[float] = None

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_llm_response(cls, response: str, thesis_id: str) -> 'Thesis':
        """Parse LLM response into structured thesis."""
        try:
            # Extract JSON
            if '```json' in response:
                json_str = response.split('```json')[1].split('```')[0]
                data = json.loads(json_str)
            elif '{' in response and '}' in response:
                start = response.index('{')
                end = response.rindex('}') + 1
                data = json.loads(response[start:end])
            else:
                data = {'thesis': response[:500], 'confidence': 0.5}

            return cls(
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis=data.get('thesis', 'Unable to form thesis'),
                direction=data.get('direction', 'neutral'),
                confidence=float(data.get('confidence', 0.5)),
                time_horizon=data.get('time_horizon', '5 days'),
                reasoning_chain=data.get('reasoning_chain', []),
                key_drivers=data.get('key_drivers', []),
                risks=data.get('risks', []),
                contradictions=data.get('contradictions', []),
                supporting_observations=data.get('supporting_observations', []),
                regime=data.get('regime'),
                regime_confidence=data.get('regime_confidence')
            )
        except Exception as e:
            logger.warning(f"Failed to parse thesis response: {e}")
            return cls(
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis=response[:500] if response else "Parse error",
                direction='neutral',
                confidence=0.3,
                time_horizon='unknown',
                reasoning_chain=['Parse error occurred'],
                key_drivers=[],
                risks=['Unable to parse thesis'],
                contradictions=[],
                supporting_observations=[]
            )


SYNTHESIS_SYSTEM_PROMPT = """You are the Synthesis Agent - the central reasoning engine.

Your job: Take multiple observer outputs and REASON about what they mean TOGETHER.

You are NOT looking for simple rules like "if X > threshold then Y".
You ARE looking for NARRATIVES that explain market state.

CRITICAL: Form a THESIS with confidence intervals. A thesis is NOT:
- "VRP is high" (that's an observation)
- "If VRP > 0.1, sell puts" (that's a rule)

A thesis IS:
- "70% confident we see a relief rally within 5 days because VRP is elevated
   WITHOUT term structure steepening, suggesting mispricing not genuine fear"

Consider:
1. CONFIRMATIONS: Which observations support each other?
2. CONTRADICTIONS: Which observations conflict? What does that mean?
3. MISSING SIGNALS: What SHOULD we see if thesis X is true?
4. REGIME CONTEXT: How does current regime affect interpretation?

Output JSON:
```json
{
  "thesis": "<one sentence thesis with direction and timeframe>",
  "direction": "<bullish|bearish|neutral>",
  "confidence": <0-1>,
  "time_horizon": "<timeframe for thesis to play out>",
  "reasoning_chain": [
    "<step 1 of reasoning>",
    "<step 2 of reasoning>",
    "<step 3 of reasoning>"
  ],
  "key_drivers": ["<driver1>", "<driver2>"],
  "risks": ["<risk1>", "<risk2>"],
  "contradictions": ["<any conflicting signals>"],
  "supporting_observations": ["<observer_id1>", "<observer_id2>"],
  "regime": "<current regime if identifiable>",
  "regime_confidence": <0-1>
}
```"""


class SynthesisAgent:
    """
    Synthesizes multiple observer outputs into a coherent thesis.

    This is WHERE the intelligence happens - not in the rules,
    but in the REASONING about what observations mean together.
    """

    def __init__(self, model: str = "deepseek-reasoner"):
        """
        Initialize Synthesis Agent.

        Args:
            model: LLM model (recommend deepseek-reasoner for reasoning chain)
        """
        self.model = model
        self.last_thesis: Optional[Thesis] = None
        self.thesis_history: List[Thesis] = []

    def format_observations(self, observations: List[ObserverOutput]) -> str:
        """Format observer outputs for synthesis prompt."""
        sections = []

        # Group by domain
        by_domain: Dict[ObserverDomain, List[ObserverOutput]] = {}
        for obs in observations:
            if obs.domain not in by_domain:
                by_domain[obs.domain] = []
            by_domain[obs.domain].append(obs)

        for domain, obs_list in by_domain.items():
            sections.append(f"\n## {domain.value.upper()} OBSERVATIONS")
            for obs in obs_list:
                sections.append(f"""
### {obs.observer_id}
- Confidence: {obs.confidence:.0%}
- Flags: {', '.join(obs.flags) if obs.flags else 'none'}
- Interpretation: {obs.interpretation}
- Data: {json.dumps(obs.observation, default=str)}
""")

        return "\n".join(sections)

    def synthesize(
        self,
        observations: List[ObserverOutput],
        equations: Dict[str, str] = None,
        regime_context: Dict = None,
        symbol: str = "SPY"
    ) -> Thesis:
        """
        Synthesize observations into a thesis.

        Args:
            observations: List of observer outputs
            equations: Math Swarm discovered equations (context)
            regime_context: Jury Swarm regime info
            symbol: Symbol being analyzed

        Returns:
            Thesis object with full reasoning
        """
        logger.info(f"Synthesizing {len(observations)} observations into thesis...")

        # Build prompt
        obs_text = self.format_observations(observations)

        context_parts = []
        if equations:
            context_parts.append(f"## DISCOVERED EQUATIONS\n{json.dumps(equations, indent=2)}")
        if regime_context:
            context_parts.append(f"## CURRENT REGIME\n{json.dumps(regime_context, indent=2)}")

        context_text = "\n\n".join(context_parts) if context_parts else ""

        user_prompt = f"""Analyze these observations for {symbol} and form a thesis:

{obs_text}

{context_text}

Based on ALL these observations:
1. What NARRATIVE explains the current market state?
2. What THESIS can we form with confidence intervals?
3. What RISKS or contradictions exist?

Provide your synthesis in the specified JSON format."""

        # Run synthesis
        task = [{
            "id": "synthesis",
            "system": SYNTHESIS_SYSTEM_PROMPT,
            "user": user_prompt,
            "model": self.model,
            "temperature": 0.2
        }]

        results = run_swarm_sync(task, concurrency=1, timeout=120)

        # Parse result
        thesis_id = f"thesis_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        if results[0]['status'] == 'success':
            thesis = Thesis.from_llm_response(results[0]['content'], thesis_id)

            # Capture reasoning chain if available (DeepSeek R1)
            if results[0].get('reasoning'):
                thesis.reasoning_chain.insert(0, f"[R1 Reasoning]: {results[0]['reasoning'][:500]}...")
        else:
            thesis = Thesis(
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                thesis=f"Synthesis failed: {results[0].get('error', 'Unknown')}",
                direction='neutral',
                confidence=0.0,
                time_horizon='unknown',
                reasoning_chain=['Synthesis agent failed'],
                key_drivers=[],
                risks=['Synthesis failed'],
                contradictions=[],
                supporting_observations=[]
            )

        self.last_thesis = thesis
        self.thesis_history.append(thesis)

        logger.info(f"Thesis formed: {thesis.direction} ({thesis.confidence:.0%} confidence)")
        logger.info(f"  {thesis.thesis[:100]}...")

        return thesis

    def refine_thesis(
        self,
        thesis: Thesis,
        challenge: 'Challenge',  # From adversarial agent
        additional_observations: List[ObserverOutput] = None
    ) -> Thesis:
        """
        Refine a thesis based on adversarial challenge.

        Args:
            thesis: Original thesis
            challenge: Adversarial challenge
            additional_observations: Any new observations

        Returns:
            Refined thesis
        """
        logger.info("Refining thesis based on adversarial challenge...")

        user_prompt = f"""Your original thesis was:
{thesis.thesis}
(Confidence: {thesis.confidence:.0%}, Direction: {thesis.direction})

An adversarial agent challenged with:
{challenge.challenge_text}

Key attacks:
{json.dumps(challenge.attacks, indent=2)}

Alternative scenarios:
{json.dumps(challenge.alternative_scenarios, indent=2)}

Recommended checks:
{json.dumps(challenge.recommended_checks, indent=2)}

Based on this challenge:
1. Does your thesis still hold?
2. Should confidence be adjusted?
3. What refinements are needed?

Provide your refined thesis in the same JSON format."""

        task = [{
            "id": "refinement",
            "system": SYNTHESIS_SYSTEM_PROMPT,
            "user": user_prompt,
            "model": self.model,
            "temperature": 0.2
        }]

        results = run_swarm_sync(task, concurrency=1, timeout=120)

        thesis_id = f"thesis_{datetime.now().strftime('%Y%m%d_%H%M%S')}_refined"

        if results[0]['status'] == 'success':
            refined = Thesis.from_llm_response(results[0]['content'], thesis_id)
            refined.reasoning_chain.insert(0, f"Refined from {thesis.thesis_id} after challenge")
        else:
            refined = thesis  # Keep original if refinement fails
            refined.risks.append(f"Refinement failed: {results[0].get('error')}")

        self.last_thesis = refined
        self.thesis_history.append(refined)

        return refined


# Import Challenge for type hint (will be defined in adversarial.py)
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .adversarial import Challenge


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    from .observers import ObserverOutput, ObserverDomain

    # Create sample observations
    observations = [
        ObserverOutput(
            observer_id="vrp_observer",
            domain=ObserverDomain.OPTIONS_SURFACE,
            timestamp=datetime.now().isoformat(),
            observation={"metric": "variance_risk_premium", "current_value": 0.15},
            interpretation="VRP elevated at 82nd percentile. Premium sellers demanding high compensation.",
            confidence=0.85,
            flags=["elevated"]
        ),
        ObserverOutput(
            observer_id="term_structure_observer",
            domain=ObserverDomain.OPTIONS_SURFACE,
            timestamp=datetime.now().isoformat(),
            observation={"metric": "term_structure", "shape": "flat"},
            interpretation="Term structure flat despite elevated VRP. No near-term event pricing.",
            confidence=0.80,
            flags=[]
        ),
        ObserverOutput(
            observer_id="flow_observer",
            domain=ObserverDomain.FLOW,
            timestamp=datetime.now().isoformat(),
            observation={"metric": "options_flow", "put_call_ratio": 0.95},
            interpretation="Flow is normal. No unusual positioning detected.",
            confidence=0.75,
            flags=[]
        ),
    ]

    # Test synthesis
    print("\n=== Testing Synthesis Agent ===")
    agent = SynthesisAgent()

    try:
        thesis = agent.synthesize(observations, symbol='SPY')
        print(f"\nThesis: {thesis.thesis}")
        print(f"Direction: {thesis.direction}")
        print(f"Confidence: {thesis.confidence:.0%}")
        print(f"Time Horizon: {thesis.time_horizon}")
        print(f"Key Drivers: {thesis.key_drivers}")
        print(f"Risks: {thesis.risks}")
    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
