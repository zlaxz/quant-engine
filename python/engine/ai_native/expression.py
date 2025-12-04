#!/usr/bin/env python3
"""
Expression Agent - Convexity-Aware Position Selection
====================================================
Given a thesis + confidence, select the OPTIMAL options structure.

This is WHERE convexity matters:
- If we're 50% confident in +5% move, what structure maximizes return/risk?
- Call spread vs butterfly vs calendar vs condor?
- What strikes optimize convexity for our confidence level?

Key insight: Options exist to provide ASYMMETRIC payoffs.
The question isn't "what structure backtested well" but
"what structure best EXPRESSES our thesis with optimal risk/reward"
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from .synthesis import Thesis
from .adversarial import Challenge

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engine.swarm.orchestrator import run_swarm_sync

logger = logging.getLogger("AINative.Expression")


class StructureType(str, Enum):
    """Options structure types."""
    LONG_CALL = "long_call"
    LONG_PUT = "long_put"
    CALL_SPREAD = "call_spread"
    PUT_SPREAD = "put_spread"
    STRADDLE = "straddle"
    STRANGLE = "strangle"
    IRON_CONDOR = "iron_condor"
    BUTTERFLY = "butterfly"
    CALENDAR = "calendar"
    DIAGONAL = "diagonal"
    RATIO_SPREAD = "ratio_spread"
    COLLAR = "collar"


@dataclass
class Greeks:
    """Options Greeks for a position."""
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float = 0.0

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class TradeExpression:
    """A specific options trade expressing a thesis."""
    trade_id: str
    thesis_id: str
    timestamp: str
    structure_type: StructureType
    underlying: str
    expiration: str
    legs: List[Dict[str, Any]]  # List of {strike, type, quantity, side}
    rationale: Dict[str, str]
    greeks: Greeks
    max_loss: float
    max_gain: float
    breakeven: List[float]
    position_size_pct: float  # Portfolio allocation
    confidence_adjusted: bool
    kelly_fraction: float

    def to_dict(self) -> Dict:
        result = asdict(self)
        result['structure_type'] = self.structure_type.value
        return result

    @classmethod
    def from_llm_response(cls, response: str, trade_id: str,
                          thesis_id: str, underlying: str) -> 'TradeExpression':
        """Parse LLM response into structured trade."""
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

            # Parse structure type
            structure_str = data.get('structure_type', 'call_spread').lower()
            try:
                structure_type = StructureType(structure_str)
            except ValueError:
                structure_type = StructureType.CALL_SPREAD

            # Parse Greeks
            greeks_data = data.get('greeks', {})
            greeks = Greeks(
                delta=float(greeks_data.get('delta', 0)),
                gamma=float(greeks_data.get('gamma', 0)),
                theta=float(greeks_data.get('theta', 0)),
                vega=float(greeks_data.get('vega', 0))
            )

            return cls(
                trade_id=trade_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                structure_type=structure_type,
                underlying=underlying,
                expiration=data.get('expiration', ''),
                legs=data.get('legs', []),
                rationale=data.get('rationale', {}),
                greeks=greeks,
                max_loss=float(data.get('max_loss', 0)),
                max_gain=float(data.get('max_gain', 0)),
                breakeven=data.get('breakeven', []),
                position_size_pct=float(data.get('position_size_pct', 2.0)),
                confidence_adjusted=data.get('confidence_adjusted', True),
                kelly_fraction=float(data.get('kelly_fraction', 0.25))
            )
        except Exception as e:
            logger.warning(f"Failed to parse trade expression: {e}")
            return cls(
                trade_id=trade_id,
                thesis_id=thesis_id,
                timestamp=datetime.now().isoformat(),
                structure_type=StructureType.CALL_SPREAD,
                underlying=underlying,
                expiration='',
                legs=[],
                rationale={'error': str(e)},
                greeks=Greeks(0, 0, 0, 0),
                max_loss=0,
                max_gain=0,
                breakeven=[],
                position_size_pct=0,
                confidence_adjusted=False,
                kelly_fraction=0
            )


EXPRESSION_SYSTEM_PROMPT = """You are the Expression Agent - the Convexity Optimizer.

Your job: Given a thesis with confidence, select the OPTIMAL options structure.

CRITICAL CONCEPT - CONVEXITY:
Options provide ASYMMETRIC payoffs. This is their whole point.
- Stock: +5% move = +5% return (linear)
- Call option: +5% move = +20% to +50% return (convex)

The question is NOT "what structure backtested well"
The question IS "what structure best EXPRESSES this thesis with optimal risk/reward"

STRUCTURE SELECTION FRAMEWORK:

1. CONFIDENCE → STRUCTURE TYPE
   - 50-60% confidence: Limited risk (spreads, condors)
   - 60-75% confidence: Moderate leverage (spreads, butterflies)
   - 75%+ confidence: Higher leverage (naked options, ratios)

2. TIME HORIZON → EXPIRATION
   - 1-5 days: Weekly expiration
   - 1-2 weeks: 2-3 week expiration
   - 2-4 weeks: Monthly expiration

3. DIRECTION → STRIKE SELECTION
   - Bullish: At or above current price for convexity
   - Bearish: At or below current price
   - Neutral: Centered on current price

4. POSITION SIZING
   - Kelly criterion adjusted for confidence
   - Max 2-5% of portfolio per trade
   - Scale down for lower confidence

STRUCTURE OPTIONS:

| Structure | Use When | Risk Profile |
|-----------|----------|--------------|
| Long call | Very bullish, high confidence | Defined loss, unlimited gain |
| Call spread | Moderately bullish | Defined risk, capped gain |
| Put spread | Moderately bearish | Defined risk, capped gain |
| Butterfly | Targeting specific price | Very limited risk, limited gain |
| Iron condor | Range-bound thesis | Limited risk, limited gain |
| Straddle | Expecting big move, unsure direction | High cost, unlimited gain |
| Calendar | Volatility thesis | Complex Greeks |

Output JSON:
```json
{
  "structure_type": "<structure_name>",
  "expiration": "<YYYY-MM-DD>",
  "legs": [
    {"strike": <float>, "type": "<call|put>", "quantity": <int>, "side": "<buy|sell>"}
  ],
  "rationale": {
    "why_this_structure": "<explanation>",
    "why_these_strikes": "<explanation>",
    "why_this_expiration": "<explanation>",
    "position_size_reasoning": "<explanation>"
  },
  "greeks": {
    "delta": <float>,
    "gamma": <float>,
    "theta": <float>,
    "vega": <float>
  },
  "max_loss": <float in dollars>,
  "max_gain": <float in dollars>,
  "breakeven": [<price1>, <price2 if applicable>],
  "position_size_pct": <float 0-5>,
  "confidence_adjusted": true,
  "kelly_fraction": <float 0-1>
}
```"""


class ExpressionAgent:
    """
    Translates thesis + confidence into optimal options structure.

    This is WHERE options knowledge matters:
    - Convexity profiles
    - Greeks management
    - Strike selection
    - Expiration timing
    - Position sizing via Kelly
    """

    def __init__(self, model: str = "deepseek-chat"):
        """
        Initialize Expression Agent.

        Args:
            model: LLM model
        """
        self.model = model
        self.trade_history: List[TradeExpression] = []

    def express_thesis(
        self,
        thesis: Thesis,
        evaluation: Dict[str, Any],  # From adversarial
        current_price: float,
        current_iv: float,
        symbol: str = "SPY",
        portfolio_value: float = 100000
    ) -> TradeExpression:
        """
        Express a thesis as an options trade.

        Args:
            thesis: The thesis to express
            evaluation: Adversarial evaluation results
            current_price: Current underlying price
            current_iv: Current implied volatility
            symbol: Underlying symbol
            portfolio_value: Total portfolio value

        Returns:
            TradeExpression with specific trade details
        """
        logger.info(f"Expressing thesis: {thesis.direction} ({thesis.confidence:.0%})")

        # Adjust confidence based on adversarial evaluation
        adjusted_confidence = evaluation.get('adjusted_confidence', thesis.confidence)
        position_modifier = evaluation.get('position_size_modifier', 1.0)

        user_prompt = f"""Express this thesis as an options trade:

THESIS:
{thesis.thesis}

Direction: {thesis.direction}
Original Confidence: {thesis.confidence:.0%}
Adjusted Confidence (after adversarial): {adjusted_confidence:.0%}
Time Horizon: {thesis.time_horizon}

Key Drivers: {json.dumps(thesis.key_drivers)}
Risks: {json.dumps(thesis.risks)}

MARKET CONDITIONS:
- Underlying: {symbol}
- Current Price: ${current_price:.2f}
- Current IV: {current_iv:.1f}%
- Portfolio Value: ${portfolio_value:,.0f}

ADVERSARIAL ADJUSTMENTS:
- Position Size Modifier: {position_modifier:.0%}
- Required Hedges: {json.dumps(evaluation.get('required_hedges', []))}
- Weakest Assumptions: {json.dumps(evaluation.get('weakest_assumptions', []))}

Given this thesis and market conditions:
1. What structure best EXPRESSES this view?
2. What strikes optimize convexity for this confidence level?
3. What position size is appropriate (Kelly-adjusted)?

Provide your trade expression in the specified JSON format."""

        task = [{
            "id": "expression",
            "system": EXPRESSION_SYSTEM_PROMPT,
            "user": user_prompt,
            "model": self.model,
            "temperature": 0.2
        }]

        results = run_swarm_sync(task, concurrency=1, timeout=60)

        trade_id = f"trade_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        if results[0]['status'] == 'success':
            trade = TradeExpression.from_llm_response(
                results[0]['content'],
                trade_id,
                thesis.thesis_id,
                symbol
            )
        else:
            trade = TradeExpression(
                trade_id=trade_id,
                thesis_id=thesis.thesis_id,
                timestamp=datetime.now().isoformat(),
                structure_type=StructureType.CALL_SPREAD,
                underlying=symbol,
                expiration='',
                legs=[],
                rationale={'error': results[0].get('error', 'Unknown')},
                greeks=Greeks(0, 0, 0, 0),
                max_loss=0,
                max_gain=0,
                breakeven=[],
                position_size_pct=0,
                confidence_adjusted=False,
                kelly_fraction=0
            )

        self.trade_history.append(trade)

        logger.info(f"Trade expressed: {trade.structure_type.value}")
        logger.info(f"  Position size: {trade.position_size_pct:.1f}%")
        logger.info(f"  Max loss: ${trade.max_loss:,.0f}")

        return trade

    def calculate_kelly_position(
        self,
        confidence: float,
        expected_gain: float,
        expected_loss: float,
        max_portfolio_pct: float = 5.0
    ) -> float:
        """
        Calculate Kelly criterion position size.

        Kelly % = (bp - q) / b
        where:
        - b = odds received (gain/loss ratio)
        - p = probability of winning (confidence)
        - q = probability of losing (1 - confidence)

        Args:
            confidence: Probability of winning (0-1)
            expected_gain: Expected gain if right
            expected_loss: Expected loss if wrong
            max_portfolio_pct: Maximum portfolio allocation

        Returns:
            Recommended position size as % of portfolio
        """
        if expected_loss <= 0:
            return 0

        b = expected_gain / expected_loss  # Odds
        p = confidence
        q = 1 - confidence

        kelly = (b * p - q) / b

        # Use fractional Kelly (25-50%) for safety
        fractional_kelly = kelly * 0.25

        # Cap at maximum
        return min(max(fractional_kelly * 100, 0), max_portfolio_pct)

    def select_structure_for_confidence(
        self,
        confidence: float,
        direction: str,
        time_horizon: str
    ) -> StructureType:
        """
        Select appropriate structure type based on confidence level.

        Args:
            confidence: Adjusted confidence (0-1)
            direction: bullish, bearish, neutral
            time_horizon: Expected duration

        Returns:
            Recommended StructureType
        """
        if direction == 'neutral':
            if confidence >= 0.7:
                return StructureType.IRON_CONDOR
            else:
                return StructureType.BUTTERFLY

        # Directional
        if confidence >= 0.75:
            # High confidence: more leverage acceptable
            if direction == 'bullish':
                return StructureType.LONG_CALL
            else:
                return StructureType.LONG_PUT

        elif confidence >= 0.6:
            # Moderate confidence: spreads
            if direction == 'bullish':
                return StructureType.CALL_SPREAD
            else:
                return StructureType.PUT_SPREAD

        else:
            # Lower confidence: defined risk, lower leverage
            if direction == 'bullish':
                return StructureType.CALL_SPREAD
            else:
                return StructureType.PUT_SPREAD

    def optimize_strikes(
        self,
        current_price: float,
        structure_type: StructureType,
        direction: str,
        confidence: float
    ) -> List[Dict]:
        """
        Optimize strike selection for convexity.

        Args:
            current_price: Current underlying price
            structure_type: Selected structure
            direction: bullish, bearish, neutral
            confidence: Adjusted confidence

        Returns:
            List of leg dictionaries
        """
        # Round to nearest 5 for SPY-like underlyings
        atm = round(current_price / 5) * 5

        legs = []

        if structure_type == StructureType.CALL_SPREAD:
            # Buy ATM or slightly OTM, sell further OTM
            long_strike = atm if confidence >= 0.65 else atm + 5
            short_strike = long_strike + 5
            legs = [
                {"strike": long_strike, "type": "call", "quantity": 1, "side": "buy"},
                {"strike": short_strike, "type": "call", "quantity": 1, "side": "sell"}
            ]

        elif structure_type == StructureType.PUT_SPREAD:
            long_strike = atm if confidence >= 0.65 else atm - 5
            short_strike = long_strike - 5
            legs = [
                {"strike": long_strike, "type": "put", "quantity": 1, "side": "buy"},
                {"strike": short_strike, "type": "put", "quantity": 1, "side": "sell"}
            ]

        elif structure_type == StructureType.LONG_CALL:
            strike = atm if confidence >= 0.75 else atm + 5
            legs = [
                {"strike": strike, "type": "call", "quantity": 1, "side": "buy"}
            ]

        elif structure_type == StructureType.LONG_PUT:
            strike = atm if confidence >= 0.75 else atm - 5
            legs = [
                {"strike": strike, "type": "put", "quantity": 1, "side": "buy"}
            ]

        elif structure_type == StructureType.IRON_CONDOR:
            # Sell closer to ATM for higher premium
            put_short = atm - 5
            put_long = put_short - 5
            call_short = atm + 5
            call_long = call_short + 5
            legs = [
                {"strike": put_long, "type": "put", "quantity": 1, "side": "buy"},
                {"strike": put_short, "type": "put", "quantity": 1, "side": "sell"},
                {"strike": call_short, "type": "call", "quantity": 1, "side": "sell"},
                {"strike": call_long, "type": "call", "quantity": 1, "side": "buy"}
            ]

        return legs


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
        thesis="70% confident we see a relief rally within 5 days",
        direction="bullish",
        confidence=0.70,
        time_horizon="5 days",
        reasoning_chain=["VRP elevated", "Term structure flat", "Flow normal"],
        key_drivers=["vrp_elevated"],
        risks=["Unknown event"],
        contradictions=[],
        supporting_observations=["vrp_observer"]
    )

    evaluation = {
        'adjusted_confidence': 0.56,
        'position_size_modifier': 0.80,
        'required_hedges': ['Use spreads for defined risk'],
        'weakest_assumptions': ['Assuming normal dealer behavior']
    }

    print("\n=== Testing Expression Agent ===")
    agent = ExpressionAgent()

    # Test structure selection
    structure = agent.select_structure_for_confidence(0.56, 'bullish', '5 days')
    print(f"Recommended structure for 56% confidence: {structure.value}")

    # Test strike optimization
    legs = agent.optimize_strikes(595.0, structure, 'bullish', 0.56)
    print(f"Optimized legs: {legs}")

    # Test Kelly
    kelly = agent.calculate_kelly_position(0.56, 200, 100)
    print(f"Kelly position size: {kelly:.1f}%")

    try:
        trade = agent.express_thesis(
            thesis, evaluation,
            current_price=595.0,
            current_iv=18.5,
            symbol='SPY',
            portfolio_value=100000
        )
        print(f"\nTrade: {trade.structure_type.value}")
        print(f"Legs: {trade.legs}")
        print(f"Position size: {trade.position_size_pct:.1f}%")
    except Exception as e:
        print(f"Expected error (no API key): {e}")
        print("Structure test passed!")
