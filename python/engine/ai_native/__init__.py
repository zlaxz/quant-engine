#!/usr/bin/env python3
"""
AI-Native Options Trading System
================================
A paradigm shift from traditional quant to AI-native reasoning.

Instead of: AI finds rules -> computer executes
Now: AI REASONS about markets -> forms thesis -> expresses via options

Components:
- Observer Swarm: 20+ parallel agents watching different market domains
- Synthesis Agent: Reasons about observations, forms thesis
- Adversarial Agent: Attacks thesis, forces refinement
- Expression Agent: Convexity-aware position selection
- Learning Agent: Improves reasoning from outcomes
"""

from .observers import (
    ObserverSwarm,
    ObserverOutput,
    OBSERVER_REGISTRY,
)
from .synthesis import (
    SynthesisAgent,
    Thesis,
)
from .adversarial import (
    AdversarialAgent,
    Challenge,
)
from .expression import (
    ExpressionAgent,
    TradeExpression,
)
from .learning import (
    LearningAgent,
    LearningOutcome,
)
from .pipeline import (
    AINativePipeline,
    run_ai_native_analysis,
)

__all__ = [
    # Observers
    'ObserverSwarm',
    'ObserverOutput',
    'OBSERVER_REGISTRY',
    # Synthesis
    'SynthesisAgent',
    'Thesis',
    # Adversarial
    'AdversarialAgent',
    'Challenge',
    # Expression
    'ExpressionAgent',
    'TradeExpression',
    # Learning
    'LearningAgent',
    'LearningOutcome',
    # Pipeline
    'AINativePipeline',
    'run_ai_native_analysis',
]
