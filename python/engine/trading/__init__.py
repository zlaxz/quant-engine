"""
Trading module for convexity rotation backtesting system.

Implements:
- Generic trade object
- Trade execution simulator
- Bid-ask spread modeling
- Slippage and transaction costs
- Delta hedging logic
- Individual profile implementations
"""

from .trade import Trade, TradeLeg
from .simulator import TradeSimulator
from .execution import ExecutionModel

__all__ = ['Trade', 'TradeLeg', 'TradeSimulator', 'ExecutionModel']
