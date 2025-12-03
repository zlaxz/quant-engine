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
"""

from .trade import Trade, TradeLeg
from .simulator import TradeSimulator
from .execution import ExecutionModel
from .stream_buffer import StreamBuffer, MultiSymbolBuffer, NewBarEvent, OHLCV

__all__ = [
    'Trade', 'TradeLeg', 'TradeSimulator', 'ExecutionModel',
    'StreamBuffer', 'MultiSymbolBuffer', 'NewBarEvent', 'OHLCV'
]
