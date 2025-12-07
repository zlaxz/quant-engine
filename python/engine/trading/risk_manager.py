"""
Risk Manager - Position Sizing with Contract Multipliers
=========================================================

THE x100 TRAP: Options have a 100x multiplier. If your bot sees an option
at $4.00 and calculates size for a $10,000 position, it might try to buy
2,500 contracts instead of 25. This blows up the account.

This module provides contract-aware position sizing to prevent disasters.

Usage:
    rm = RiskManager(account_size=100000, max_risk_per_trade=0.02)

    # For options (automatic 100x multiplier)
    size = rm.calculate_position_size(
        price=4.00,
        stop_loss=3.50,
        asset_type='option'
    )  # Returns contract count, properly adjusted

    # For futures
    size = rm.calculate_position_size(
        price=5000.00,
        stop_loss=4980.00,
        asset_type='future',
        symbol='ES'
    )  # Returns contract count, adjusted for 50x multiplier
"""

import logging
import numpy as np
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime, date

logger = logging.getLogger(__name__)


class AssetType(Enum):
    """Asset types with their contract multipliers."""
    STOCK = 'stock'
    OPTION = 'option'
    FUTURE = 'future'


class DrawdownAction(Enum):
    """Actions to take based on drawdown level."""
    NORMAL = 'normal'           # Full trading
    REDUCE_25 = 'reduce_25'     # Reduce position sizes 25%
    REDUCE_50 = 'reduce_50'     # Reduce position sizes 50%
    STOP_TODAY = 'stop_today'   # Stop trading for rest of day
    PAUSE_WEEK = 'pause_week'   # Pause for 1 week
    SHUTDOWN = 'shutdown'       # Full shutdown - circuit breaker


@dataclass
class DrawdownState:
    """Current drawdown state and metrics."""
    peak_equity: float
    current_equity: float
    drawdown_pct: float
    drawdown_dollars: float
    action: DrawdownAction
    daily_pnl: float = 0.0
    weekly_pnl: float = 0.0
    monthly_pnl: float = 0.0
    position_multiplier: float = 1.0  # Applied to all position sizes
    consecutive_losing_days: int = 0
    last_check: datetime = field(default_factory=datetime.now)


class DrawdownController:
    """
    Drawdown-based risk controls to prevent account blowup.

    Implements tiered circuit breakers:
    - Daily limit: 2% (stop for day)
    - Weekly limit: 5% (reduce sizes 50%)
    - Monthly limit: 10% (pause 1 week)
    - Circuit breaker: 15% (full shutdown)

    Also tracks:
    - Consecutive losing days
    - VIX-based position scaling
    - Equity high water mark
    """

    def __init__(
        self,
        initial_equity: float,
        daily_limit: float = 0.02,      # 2%
        weekly_limit: float = 0.05,     # 5%
        monthly_limit: float = 0.10,    # 10%
        circuit_breaker: float = 0.15,  # 15%
        max_consecutive_losers: int = 5,
    ):
        """
        Initialize drawdown controller.

        Args:
            initial_equity: Starting account value
            daily_limit: Max daily drawdown before stopping (0.02 = 2%)
            weekly_limit: Max weekly drawdown before reducing size
            monthly_limit: Max monthly drawdown before pausing
            circuit_breaker: Max total drawdown before shutdown
            max_consecutive_losers: Max losing days before pause
        """
        self.initial_equity = initial_equity
        self.peak_equity = initial_equity
        self.current_equity = initial_equity

        # Limits
        self.daily_limit = daily_limit
        self.weekly_limit = weekly_limit
        self.monthly_limit = monthly_limit
        self.circuit_breaker = circuit_breaker
        self.max_consecutive_losers = max_consecutive_losers

        # Tracking
        self.daily_start_equity = initial_equity
        self.weekly_start_equity = initial_equity
        self.monthly_start_equity = initial_equity
        self.daily_pnl_history: List[float] = []
        self.consecutive_losing_days = 0
        self.pause_until: Optional[date] = None

        # Current state
        self._action = DrawdownAction.NORMAL
        self._position_multiplier = 1.0

        logger.info(f"DrawdownController initialized:")
        logger.info(f"  Initial equity: ${initial_equity:,.2f}")
        logger.info(f"  Daily limit: {daily_limit:.1%}")
        logger.info(f"  Weekly limit: {weekly_limit:.1%}")
        logger.info(f"  Monthly limit: {monthly_limit:.1%}")
        logger.info(f"  Circuit breaker: {circuit_breaker:.1%}")

    def update_equity(self, new_equity: float) -> DrawdownState:
        """
        Update current equity and check drawdown limits.

        Call this after each trade or at regular intervals.

        Args:
            new_equity: Current account equity

        Returns:
            DrawdownState with current status and recommended action
        """
        old_equity = self.current_equity
        self.current_equity = new_equity

        # Update high water mark
        if new_equity > self.peak_equity:
            self.peak_equity = new_equity

        # Calculate drawdowns
        total_dd = (self.peak_equity - new_equity) / self.peak_equity if self.peak_equity > 0 else 0
        daily_dd = (self.daily_start_equity - new_equity) / self.daily_start_equity if self.daily_start_equity > 0 else 0
        weekly_dd = (self.weekly_start_equity - new_equity) / self.weekly_start_equity if self.weekly_start_equity > 0 else 0
        monthly_dd = (self.monthly_start_equity - new_equity) / self.monthly_start_equity if self.monthly_start_equity > 0 else 0

        # Check if paused
        if self.pause_until and date.today() < self.pause_until:
            self._action = DrawdownAction.PAUSE_WEEK
            self._position_multiplier = 0.0
            logger.warning(f"Trading paused until {self.pause_until}")
        # Check circuit breaker (most severe)
        elif total_dd >= self.circuit_breaker:
            self._action = DrawdownAction.SHUTDOWN
            self._position_multiplier = 0.0
            logger.critical(f"CIRCUIT BREAKER: {total_dd:.1%} drawdown - SHUTDOWN")
        # Check monthly limit
        elif monthly_dd >= self.monthly_limit:
            self._action = DrawdownAction.PAUSE_WEEK
            self._position_multiplier = 0.0
            self.pause_until = date.today()  # Will be set properly by end_day
            logger.error(f"Monthly limit hit: {monthly_dd:.1%} - Pausing 1 week")
        # Check weekly limit
        elif weekly_dd >= self.weekly_limit:
            self._action = DrawdownAction.REDUCE_50
            self._position_multiplier = 0.5
            logger.warning(f"Weekly limit hit: {weekly_dd:.1%} - Reducing size 50%")
        # Check daily limit
        elif daily_dd >= self.daily_limit:
            self._action = DrawdownAction.STOP_TODAY
            self._position_multiplier = 0.0
            logger.warning(f"Daily limit hit: {daily_dd:.1%} - Stopping today")
        # Check consecutive losers
        elif self.consecutive_losing_days >= self.max_consecutive_losers:
            self._action = DrawdownAction.REDUCE_25
            self._position_multiplier = 0.75
            logger.warning(f"{self.consecutive_losing_days} consecutive losing days - Reducing size 25%")
        else:
            self._action = DrawdownAction.NORMAL
            self._position_multiplier = 1.0

        return DrawdownState(
            peak_equity=self.peak_equity,
            current_equity=self.current_equity,
            drawdown_pct=total_dd,
            drawdown_dollars=self.peak_equity - self.current_equity,
            action=self._action,
            daily_pnl=new_equity - self.daily_start_equity,
            weekly_pnl=new_equity - self.weekly_start_equity,
            monthly_pnl=new_equity - self.monthly_start_equity,
            position_multiplier=self._position_multiplier,
            consecutive_losing_days=self.consecutive_losing_days,
        )

    def start_new_day(self) -> None:
        """Call at start of trading day to reset daily tracking."""
        daily_pnl = self.current_equity - self.daily_start_equity
        self.daily_pnl_history.append(daily_pnl)

        # Track consecutive losers
        if daily_pnl < 0:
            self.consecutive_losing_days += 1
        else:
            self.consecutive_losing_days = 0

        # Reset daily start
        self.daily_start_equity = self.current_equity

        # Reset action if we were stopped for day
        if self._action == DrawdownAction.STOP_TODAY:
            self._action = DrawdownAction.NORMAL
            self._position_multiplier = 1.0

        logger.info(f"New day started. Previous day P&L: ${daily_pnl:,.2f}")

    def start_new_week(self) -> None:
        """Call at start of trading week to reset weekly tracking."""
        self.weekly_start_equity = self.current_equity

        # Reset action if we were in weekly reduction
        if self._action == DrawdownAction.REDUCE_50:
            self._action = DrawdownAction.NORMAL
            self._position_multiplier = 1.0

        logger.info(f"New week started. Equity: ${self.current_equity:,.2f}")

    def start_new_month(self) -> None:
        """Call at start of month to reset monthly tracking."""
        self.monthly_start_equity = self.current_equity

        # Reset pause if it was monthly-triggered
        if self._action == DrawdownAction.PAUSE_WEEK:
            self.pause_until = None
            self._action = DrawdownAction.NORMAL
            self._position_multiplier = 1.0

        logger.info(f"New month started. Equity: ${self.current_equity:,.2f}")

    def get_position_multiplier(self) -> float:
        """Get current position size multiplier based on drawdown state."""
        return self._position_multiplier

    def can_trade(self) -> bool:
        """Check if trading is allowed based on current state."""
        return self._action not in [
            DrawdownAction.STOP_TODAY,
            DrawdownAction.PAUSE_WEEK,
            DrawdownAction.SHUTDOWN
        ]

    def get_state(self) -> DrawdownState:
        """Get current drawdown state without updating."""
        total_dd = (self.peak_equity - self.current_equity) / self.peak_equity if self.peak_equity > 0 else 0
        return DrawdownState(
            peak_equity=self.peak_equity,
            current_equity=self.current_equity,
            drawdown_pct=total_dd,
            drawdown_dollars=self.peak_equity - self.current_equity,
            action=self._action,
            daily_pnl=self.current_equity - self.daily_start_equity,
            weekly_pnl=self.current_equity - self.weekly_start_equity,
            monthly_pnl=self.current_equity - self.monthly_start_equity,
            position_multiplier=self._position_multiplier,
            consecutive_losing_days=self.consecutive_losing_days,
        )

    def apply_vix_scaling(self, vix: float) -> float:
        """
        Apply VIX-based position scaling on top of drawdown multiplier.

        High VIX = smaller positions (vol scaling).

        Args:
            vix: Current VIX level

        Returns:
            Combined multiplier (drawdown * vix scaling)
        """
        # VIX scaling: reduce size as VIX increases
        if vix <= 15:
            vix_mult = 1.0      # Normal vol - full size
        elif vix <= 20:
            vix_mult = 0.85     # Elevated - slight reduction
        elif vix <= 25:
            vix_mult = 0.70     # High - reduce 30%
        elif vix <= 30:
            vix_mult = 0.50     # Very high - half size
        elif vix <= 40:
            vix_mult = 0.25     # Extreme - quarter size
        else:
            vix_mult = 0.10     # Crisis - minimal exposure

        combined = self._position_multiplier * vix_mult
        logger.debug(f"VIX={vix:.1f}, VIX mult={vix_mult:.2f}, Combined={combined:.2f}")
        return combined


# Contract multipliers by asset type and symbol
CONTRACT_MULTIPLIERS = {
    'option': 100,      # 1 contract = 100 shares
    'future': {
        'ES': 50,       # E-mini S&P 500: $50 per point
        'NQ': 20,       # E-mini Nasdaq: $20 per point
        'MES': 5,       # Micro E-mini S&P: $5 per point
        'MNQ': 2,       # Micro E-mini Nasdaq: $2 per point
        'YM': 5,        # E-mini Dow: $5 per point
        'RTY': 50,      # E-mini Russell: $50 per point
        'CL': 1000,     # Crude Oil: 1000 barrels
        'GC': 100,      # Gold: 100 troy ounces
        'DEFAULT': 1,   # Unknown futures default
    },
    'stock': 1,         # Stocks have no multiplier
}

# Safety limits to prevent catastrophic bugs
MAX_CONTRACTS = {
    'option': 50,       # Max 50 option contracts per trade
    'future': 10,       # Max 10 futures contracts per trade
    'stock': 10000,     # Max 10,000 shares per trade
}


@dataclass
class PositionSizeResult:
    """Result of position sizing calculation."""
    quantity: int
    notional_value: float
    risk_amount: float
    risk_percent: float
    multiplier: int
    asset_type: str
    was_limited: bool = False
    limit_reason: str = ""


class RiskManager:
    """
    Risk-aware position sizing with contract multipliers.

    The core principle: Never risk more than X% of account on a single trade.
    Account for contract multipliers to avoid the x100 trap.

    Attributes:
        account_size: Total account value
        max_risk_per_trade: Maximum fraction of account to risk (default 0.02 = 2%)
        max_position_pct: Maximum position size as % of account (default 0.20 = 20%)
    """

    def __init__(
        self,
        account_size: float,
        max_risk_per_trade: float = 0.02,
        max_position_pct: float = 0.20,
    ):
        """
        Initialize Risk Manager.

        Args:
            account_size: Total account value in dollars
            max_risk_per_trade: Max % of account to risk per trade (0.02 = 2%)
            max_position_pct: Max position size as % of account (0.20 = 20%)
        """
        self.account_size = account_size
        self.max_risk_per_trade = max_risk_per_trade
        self.max_position_pct = max_position_pct

        logger.info(f"RiskManager initialized:")
        logger.info(f"  Account: ${account_size:,.2f}")
        logger.info(f"  Max risk/trade: {max_risk_per_trade:.1%}")
        logger.info(f"  Max position: {max_position_pct:.1%}")

    def get_contract_multiplier(
        self,
        asset_type: str,
        symbol: Optional[str] = None
    ) -> int:
        """
        Get the contract multiplier for an asset.

        Args:
            asset_type: 'stock', 'option', or 'future'
            symbol: Symbol (required for futures to get correct multiplier)

        Returns:
            Contract multiplier (100 for options, varies for futures, 1 for stocks)
        """
        asset_type = asset_type.lower()

        if asset_type == 'option':
            return CONTRACT_MULTIPLIERS['option']  # Always 100

        elif asset_type == 'future':
            if symbol:
                symbol = symbol.upper()
                # Check for exact match
                if symbol in CONTRACT_MULTIPLIERS['future']:
                    return CONTRACT_MULTIPLIERS['future'][symbol]
                # Check for symbol prefix (e.g., 'ESH24' -> 'ES')
                for base_symbol in CONTRACT_MULTIPLIERS['future']:
                    if symbol.startswith(base_symbol):
                        return CONTRACT_MULTIPLIERS['future'][base_symbol]
            return CONTRACT_MULTIPLIERS['future']['DEFAULT']

        else:  # stock
            return CONTRACT_MULTIPLIERS['stock']  # Always 1

    def get_max_contracts(self, asset_type: str) -> int:
        """Get the maximum contracts allowed for an asset type."""
        asset_type = asset_type.lower()
        return MAX_CONTRACTS.get(asset_type, MAX_CONTRACTS['stock'])

    def calculate_position_size(
        self,
        price: float,
        stop_loss: float,
        asset_type: str = 'stock',
        symbol: Optional[str] = None,
        custom_risk_pct: Optional[float] = None,
    ) -> PositionSizeResult:
        """
        Calculate position size with contract multiplier awareness.

        THE FORMULA:
        1. Risk Amount = Account * Risk%
        2. Risk Per Unit = |Price - Stop|
        3. Raw Quantity = Risk Amount / Risk Per Unit
        4. Adjusted Quantity = Raw Quantity / Multiplier
        5. Final = min(Adjusted, Max Contracts, Max Position Limit)

        Args:
            price: Current price of the asset
            stop_loss: Stop loss price
            asset_type: 'stock', 'option', or 'future'
            symbol: Symbol (needed for futures multiplier lookup)
            custom_risk_pct: Override default risk percentage

        Returns:
            PositionSizeResult with calculated quantity and details

        Example:
            # Option at $4.00 with $3.50 stop, 2% risk on $100k account
            # Risk = $100k * 0.02 = $2,000
            # Risk per share = $0.50
            # Raw shares = 4,000
            # Contracts = 4,000 / 100 = 40
        """
        asset_type = asset_type.lower()
        risk_pct = custom_risk_pct or self.max_risk_per_trade

        # Get multiplier
        multiplier = self.get_contract_multiplier(asset_type, symbol)

        # Calculate risk amount (dollars we're willing to lose)
        risk_amount = self.account_size * risk_pct

        # Calculate risk per share/contract
        risk_per_unit = abs(price - stop_loss)

        # NaN check on price inputs - critical for position sizing
        if np.isnan(price) or np.isnan(stop_loss) or np.isnan(risk_per_unit):
            logger.error(f"NaN detected in position sizing: price={price}, stop={stop_loss}")
            return PositionSizeResult(
                quantity=0,
                notional_value=0,
                risk_amount=0,
                risk_percent=0,
                multiplier=multiplier,
                asset_type=asset_type,
                was_limited=True,
                limit_reason="NaN in price data"
            )

        if risk_per_unit <= 0:
            logger.warning(f"Invalid stop loss: price={price}, stop={stop_loss}")
            return PositionSizeResult(
                quantity=0,
                notional_value=0,
                risk_amount=0,
                risk_percent=0,
                multiplier=multiplier,
                asset_type=asset_type,
                was_limited=True,
                limit_reason="Invalid stop loss"
            )

        # Calculate raw quantity (in shares)
        raw_quantity = risk_amount / risk_per_unit

        # Adjust for contract multiplier
        # For options: 40 contracts = 4000 shares, so divide by 100
        adjusted_quantity = raw_quantity / multiplier

        # Round down to whole contracts
        quantity = int(adjusted_quantity)

        # Apply maximum contract limit (safety check)
        max_contracts = self.get_max_contracts(asset_type)
        was_limited = False
        limit_reason = ""

        if quantity > max_contracts:
            was_limited = True
            limit_reason = f"Exceeded max contracts ({max_contracts})"
            quantity = max_contracts
            logger.warning(f"Position limited: {limit_reason}")

        # Apply maximum position size limit
        max_position_value = self.account_size * self.max_position_pct
        position_value = quantity * price * multiplier

        if position_value > max_position_value:
            was_limited = True
            limit_reason = f"Exceeded max position value (${max_position_value:,.2f})"
            # Guard against division by zero (price=0 or multiplier=0)
            if price * multiplier > 0:
                quantity = int(max_position_value / (price * multiplier))
            else:
                quantity = 0
                limit_reason = "Zero price or multiplier"
            logger.warning(f"Position limited: {limit_reason}")

        # Recalculate actual risk with final quantity
        actual_risk = quantity * risk_per_unit * multiplier
        actual_risk_pct = actual_risk / self.account_size if self.account_size > 0 else 0

        # Calculate notional value
        notional_value = quantity * price * multiplier

        result = PositionSizeResult(
            quantity=quantity,
            notional_value=notional_value,
            risk_amount=actual_risk,
            risk_percent=actual_risk_pct,
            multiplier=multiplier,
            asset_type=asset_type,
            was_limited=was_limited,
            limit_reason=limit_reason
        )

        logger.info(f"Position sized: {quantity} {asset_type}s @ ${price:.2f}")
        logger.info(f"  Multiplier: {multiplier}x, Notional: ${notional_value:,.2f}")
        logger.info(f"  Risk: ${actual_risk:,.2f} ({actual_risk_pct:.2%})")

        return result

    def validate_order(
        self,
        quantity: int,
        price: float,
        asset_type: str,
        symbol: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validate an order before submission.

        Checks:
        - Quantity within limits
        - Notional value within position limits
        - Basic sanity checks

        Returns:
            Dict with 'valid' bool and 'reason' if invalid
        """
        asset_type = asset_type.lower()
        multiplier = self.get_contract_multiplier(asset_type, symbol)
        max_contracts = self.get_max_contracts(asset_type)
        notional = quantity * price * multiplier

        # Check contract limit
        if quantity > max_contracts:
            return {
                'valid': False,
                'reason': f"Quantity {quantity} exceeds max {max_contracts} contracts"
            }

        # Check position size limit
        max_position = self.account_size * self.max_position_pct
        if notional > max_position:
            return {
                'valid': False,
                'reason': f"Notional ${notional:,.2f} exceeds max ${max_position:,.2f}"
            }

        # Check minimum quantity
        if quantity <= 0:
            return {
                'valid': False,
                'reason': "Quantity must be positive"
            }

        return {
            'valid': True,
            'notional': notional,
            'multiplier': multiplier,
            'position_pct': notional / self.account_size
        }

    def update_account_size(self, new_size: float) -> None:
        """Update account size (e.g., after daily P&L)."""
        old_size = self.account_size
        self.account_size = new_size
        logger.info(f"Account updated: ${old_size:,.2f} -> ${new_size:,.2f}")


# Singleton instance for global access
_risk_manager: Optional[RiskManager] = None


def get_risk_manager(
    account_size: float = 100000,
    max_risk_per_trade: float = 0.02,
) -> RiskManager:
    """Get or create singleton RiskManager instance."""
    global _risk_manager
    if _risk_manager is None:
        _risk_manager = RiskManager(account_size, max_risk_per_trade)
    return _risk_manager


def reset_risk_manager() -> None:
    """Reset singleton (for testing)."""
    global _risk_manager
    _risk_manager = None


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Initialize with $100k account, 2% max risk per trade
    rm = RiskManager(account_size=100000, max_risk_per_trade=0.02)

    print("\n=== Stock Position ===")
    result = rm.calculate_position_size(
        price=150.00,
        stop_loss=145.00,
        asset_type='stock'
    )
    print(f"Buy {result.quantity} shares @ $150")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")

    print("\n=== Option Position (THE x100 TRAP) ===")
    result = rm.calculate_position_size(
        price=4.00,
        stop_loss=3.50,
        asset_type='option'
    )
    print(f"Buy {result.quantity} contracts @ $4.00")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")
    print(f"WITHOUT multiplier would be: {int(2000 / 0.50)} shares (WRONG!)")

    print("\n=== ES Futures Position ===")
    result = rm.calculate_position_size(
        price=5000.00,
        stop_loss=4980.00,
        asset_type='future',
        symbol='ES'
    )
    print(f"Buy {result.quantity} contracts @ $5000")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")

    # =========================================================================
    # DRAWDOWN CONTROLLER DEMO
    # =========================================================================
    print("\n" + "=" * 60)
    print("DRAWDOWN CONTROLLER DEMO")
    print("=" * 60)

    dc = DrawdownController(initial_equity=100000)

    print("\n--- Scenario 1: Normal Trading ---")
    state = dc.update_equity(101000)  # Up $1k
    print(f"Equity: ${state.current_equity:,.0f}, DD: {state.drawdown_pct:.2%}")
    print(f"Action: {state.action.value}, Position Mult: {state.position_multiplier:.0%}")
    print(f"Can trade: {dc.can_trade()}")

    print("\n--- Scenario 2: Daily Limit Hit (-2%) ---")
    dc2 = DrawdownController(initial_equity=100000)
    state = dc2.update_equity(97500)  # Down 2.5%
    print(f"Equity: ${state.current_equity:,.0f}, DD: {state.drawdown_pct:.2%}")
    print(f"Action: {state.action.value}, Position Mult: {state.position_multiplier:.0%}")
    print(f"Can trade: {dc2.can_trade()}")

    print("\n--- Scenario 3: Weekly Limit Hit (-5%) ---")
    dc3 = DrawdownController(initial_equity=100000)
    state = dc3.update_equity(94000)  # Down 6%
    print(f"Equity: ${state.current_equity:,.0f}, DD: {state.drawdown_pct:.2%}")
    print(f"Action: {state.action.value}, Position Mult: {state.position_multiplier:.0%}")
    print(f"Can trade: {dc3.can_trade()}")

    print("\n--- Scenario 4: Circuit Breaker (-15%) ---")
    dc4 = DrawdownController(initial_equity=100000)
    state = dc4.update_equity(84000)  # Down 16%
    print(f"Equity: ${state.current_equity:,.0f}, DD: {state.drawdown_pct:.2%}")
    print(f"Action: {state.action.value}, Position Mult: {state.position_multiplier:.0%}")
    print(f"Can trade: {dc4.can_trade()}")

    print("\n--- Scenario 5: VIX Scaling ---")
    dc5 = DrawdownController(initial_equity=100000)
    for vix in [12, 18, 25, 35, 50]:
        mult = dc5.apply_vix_scaling(vix)
        print(f"VIX {vix:2d}: Position multiplier = {mult:.0%}")
