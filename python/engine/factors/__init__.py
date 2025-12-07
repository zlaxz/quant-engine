"""
Factor Strategy Engine

Maps factor signals to option structures with notional-based position sizing.
"""

from .factor_computer import FactorComputer, compute_factors
from .strategy_mapper import StrategyMapper, StrategyRule, OPERATORS
from .playbook_builder import PlaybookBuilder, ValidatedStrategy, PlaybookMetrics

__all__ = [
    'FactorComputer',
    'compute_factors',
    'StrategyMapper',
    'StrategyRule',
    'OPERATORS',
    'PlaybookBuilder',
    'ValidatedStrategy',
    'PlaybookMetrics',
]
