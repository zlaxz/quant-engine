"""
Trading module for convexity rotation backtesting system.

Implements:
- Generic trade object
- Trade execution simulator
- Bid-ask spread modeling
- Slippage and transaction costs
- Delta hedging logic
- Individual profile implementations
- Live tick aggregation (StreamBuffer)
- Risk management with contract multipliers (RiskManager)
"""

from .trade import Trade, TradeLeg
from .simulator import TradeSimulator
from .execution import ExecutionModel
from .stream_buffer import StreamBuffer, MultiSymbolBuffer, NewBarEvent, OHLCV
from .risk_manager import (
    RiskManager, PositionSizeResult, AssetType,
    get_risk_manager, reset_risk_manager,
    CONTRACT_MULTIPLIERS, MAX_CONTRACTS
)

__all__ = [
    'Trade', 'TradeLeg', 'TradeSimulator', 'ExecutionModel',
    'StreamBuffer', 'MultiSymbolBuffer', 'NewBarEvent', 'OHLCV',
    'RiskManager', 'PositionSizeResult', 'AssetType',
    'get_risk_manager', 'reset_risk_manager',
    'CONTRACT_MULTIPLIERS', 'MAX_CONTRACTS'
]
