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
- Mean reversion strategy (physics-based)
- Gamma scalping strategy (long gamma + delta harvesting)
- Gamma flip strategy (trade the GEX zero-crossing)
- Volatility harvesting (systematic premium selling)
- Regime options playbook (structure selection by market state)

Live Trading Infrastructure (IBKR):
- IBKRClient: Connection and order execution with IBKR
- OrderManager: Central coordinator with pre-flight checks
- PositionTracker: Real-time position and P&L monitoring
- ExecutionLogger: Immutable audit trail to Supabase
"""

from .trade import Trade, TradeLeg
from .simulator import TradeSimulator
from .execution import ExecutionModel
from .stream_buffer import StreamBuffer, MultiSymbolBuffer, NewBarEvent, OHLCV
from .risk_manager import (
    RiskManager, PositionSizeResult, AssetType,
    get_risk_manager, reset_risk_manager,
    CONTRACT_MULTIPLIERS, MAX_CONTRACTS,
    DrawdownController, DrawdownAction, DrawdownState
)
from .mean_reversion import (
    MeanReversionStrategy, MeanReversionSignal, MeanReversionPosition
)
from .gamma_scalping import (
    GammaScalpingStrategy, GammaScalpingConfig, GammaPosition, ScalpSignal
)
from .gamma_flip import (
    GammaFlipStrategy, GammaFlipConfig, FlipSignal, FlipLevel, MarketRegime
)
from .volatility_harvesting import (
    VolatilityHarvestingStrategy, VolHarvestConfig, HarvestPosition, VolEnvironment
)
from .regime_playbook import (
    RegimePlaybook, RegimePlaybookConfig, PlaybookRecommendation, OptionStructure, GammaRegime
)

# Live Trading Infrastructure (IBKR)
from .ibkr_client import (
    IBKRClient, TradingMode, Position, Quote, AccountInfo, FUTURES_SPECS
)
from .order_manager import (
    OrderManager, OrderPriority, OrderRequest, ManagedOrder, PreFlightCheck
)
from .position_tracker import (
    PositionTracker, TrackedPosition, DailyStats
)
from .execution_logger import (
    ExecutionLogger, ExecutionRecord
)
from .account_manager import (
    IBKRAccountManager, AccountConfig, ManagedAccount, create_dual_account_manager
)

__all__ = [
    # Core
    'Trade', 'TradeLeg', 'TradeSimulator', 'ExecutionModel',
    'StreamBuffer', 'MultiSymbolBuffer', 'NewBarEvent', 'OHLCV',
    # Risk Management
    'RiskManager', 'PositionSizeResult', 'AssetType',
    'get_risk_manager', 'reset_risk_manager',
    'CONTRACT_MULTIPLIERS', 'MAX_CONTRACTS',
    'DrawdownController', 'DrawdownAction', 'DrawdownState',
    # Strategies
    'MeanReversionStrategy', 'MeanReversionSignal', 'MeanReversionPosition',
    'GammaScalpingStrategy', 'GammaScalpingConfig', 'GammaPosition', 'ScalpSignal',
    'GammaFlipStrategy', 'GammaFlipConfig', 'FlipSignal', 'FlipLevel', 'MarketRegime',
    'VolatilityHarvestingStrategy', 'VolHarvestConfig', 'HarvestPosition', 'VolEnvironment',
    'RegimePlaybook', 'RegimePlaybookConfig', 'PlaybookRecommendation', 'OptionStructure', 'GammaRegime',
    # Live Trading Infrastructure (IBKR)
    'IBKRClient', 'TradingMode', 'Position', 'Quote', 'AccountInfo', 'FUTURES_SPECS',
    'OrderManager', 'OrderPriority', 'OrderRequest', 'ManagedOrder', 'PreFlightCheck',
    'PositionTracker', 'TrackedPosition', 'DailyStats',
    'ExecutionLogger', 'ExecutionRecord',
    # Multi-Account Support
    'IBKRAccountManager', 'AccountConfig', 'ManagedAccount', 'create_dual_account_manager',
]
