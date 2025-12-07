"""
Futures Trading Engine

Production-grade futures trading infrastructure.
No shortcuts. Full pipeline.
"""

from .data_loader import FuturesDataLoader
from .feature_engine import FuturesFeatureEngine
from .backtester import FuturesBacktester
from .signal_generator import SignalGenerator
from .risk_manager import FuturesRiskManager
from .execution_engine import (
    ExecutionEngine,
    IBExecutionHandler,
    BacktestExecutionHandler,
)

__all__ = [
    'FuturesDataLoader',
    'FuturesFeatureEngine',
    'FuturesBacktester',
    'SignalGenerator',
    'FuturesRiskManager',
    'ExecutionEngine',
    'IBExecutionHandler',
    'BacktestExecutionHandler',
]
