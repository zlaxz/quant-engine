"""
Order Manager - Central Coordinator for All Order Activity
===========================================================

The order manager is the single point of control for all trading activity.
No order goes to the broker without passing through here.

Responsibilities:
1. Accept order requests from strategies
2. Validate orders (pre-flight checks)
3. Queue and prioritize orders
4. Execute through IBKRClient
5. Log through ExecutionLogger
6. Track order lifecycle
7. Handle errors and retries

Usage:
    from engine.trading.order_manager import OrderManager

    manager = OrderManager()
    await manager.initialize()

    # Submit an order
    result = await manager.submit_order(
        symbol="MES",
        side="BUY",
        quantity=1,
        order_type="LIMIT",
        limit_price=5000.00,
        strategy_name="momentum_1"
    )

    # Cancel an order
    await manager.cancel_order(order_id)

    # Kill switch
    await manager.emergency_flatten("Manual trigger")
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Callable, Literal
from dataclasses import dataclass, field
from enum import Enum
from collections import deque
import json

from .ibkr_client import (
    IBKRClient, TradingMode, OrderResult, OrderStatus,
    Quote, Position, FUTURES_SPECS
)
from .execution_logger import ExecutionLogger, EventType

logger = logging.getLogger("AlphaFactory.OrderManager")


class OrderPriority(Enum):
    """Order priority levels."""
    CRITICAL = 0    # Kill switch, emergency exits
    HIGH = 1        # Stop losses, risk-triggered
    NORMAL = 2      # Strategy signals
    LOW = 3         # Optimization trades


@dataclass
class OrderRequest:
    """Order request from a strategy."""
    request_id: str
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: int
    order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    time_in_force: Literal["GTC", "DAY", "IOC"] = "GTC"
    priority: OrderPriority = OrderPriority.NORMAL
    strategy_name: str = "manual"
    signal_source: str = "unknown"
    dry_run: bool = False
    parent_order_id: Optional[str] = None  # For linked orders
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "order_type": self.order_type,
            "limit_price": self.limit_price,
            "stop_price": self.stop_price,
            "time_in_force": self.time_in_force,
            "priority": self.priority.name,
            "strategy_name": self.strategy_name,
            "signal_source": self.signal_source,
            "dry_run": self.dry_run,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class ManagedOrder:
    """Order being managed by the order manager."""
    request: OrderRequest
    result: Optional[OrderResult] = None
    status: str = "pending"  # pending, submitted, filled, cancelled, rejected, error
    submitted_at: Optional[datetime] = None
    filled_at: Optional[datetime] = None
    retry_count: int = 0
    last_error: str = ""


class PreFlightCheck:
    """Pre-flight checks before order submission."""

    def __init__(
        self,
        max_order_value: float = 50000.0,  # Max notional value per order
        max_position_per_symbol: int = 10,   # Max contracts per symbol
        max_daily_trades: int = 100,          # Max trades per day
        min_order_interval_seconds: float = 1.0,  # Min time between orders
        allowed_symbols: Optional[List[str]] = None,
        blocked_symbols: Optional[List[str]] = None,
    ):
        self.max_order_value = max_order_value
        self.max_position_per_symbol = max_position_per_symbol
        self.max_daily_trades = max_daily_trades
        self.min_order_interval_seconds = min_order_interval_seconds
        self.allowed_symbols = allowed_symbols or list(FUTURES_SPECS.keys())
        self.blocked_symbols = blocked_symbols or []

        # State tracking
        self._last_order_time: Dict[str, datetime] = {}
        self._daily_trade_count = 0
        self._daily_trade_reset: datetime = datetime.now()

    def check(
        self,
        request: OrderRequest,
        current_positions: Dict[str, Position],
        current_quote: Optional[Quote] = None
    ) -> tuple[bool, str]:
        """
        Run all pre-flight checks.

        Returns:
            (passed, message) - True if all checks pass, False with reason if not
        """
        # Reset daily counter if new day
        now = datetime.now()
        if now.date() > self._daily_trade_reset.date():
            self._daily_trade_count = 0
            self._daily_trade_reset = now

        # Check 1: Symbol allowed
        if request.symbol not in self.allowed_symbols:
            return False, f"Symbol {request.symbol} not in allowed list"

        if request.symbol in self.blocked_symbols:
            return False, f"Symbol {request.symbol} is blocked"

        # Check 2: Valid quantity
        if request.quantity <= 0:
            return False, "Quantity must be positive"

        if request.quantity > 50:  # Sanity check
            return False, f"Quantity {request.quantity} exceeds maximum (50)"

        # Check 3: Position limits
        current_pos = current_positions.get(request.symbol)
        current_qty = current_pos.quantity if current_pos else 0

        if request.side == "BUY":
            new_qty = current_qty + request.quantity
        else:
            new_qty = current_qty - request.quantity

        if abs(new_qty) > self.max_position_per_symbol:
            return False, f"Position limit: {abs(new_qty)} > {self.max_position_per_symbol}"

        # Check 4: Order value (if we have a quote)
        if current_quote and request.limit_price:
            spec = FUTURES_SPECS.get(request.symbol, {})
            multiplier = spec.get("multiplier", 1)
            notional = request.quantity * request.limit_price * multiplier

            if notional > self.max_order_value:
                return False, f"Order value ${notional:,.0f} exceeds max ${self.max_order_value:,.0f}"

        # Check 5: Order type validation
        if request.order_type in ["LIMIT", "STOP_LIMIT"]:
            if request.limit_price is None:
                return False, f"{request.order_type} requires limit_price"

        if request.order_type in ["STOP", "STOP_LIMIT"]:
            if request.stop_price is None:
                return False, f"{request.order_type} requires stop_price"

        # Check 6: Rate limiting
        last_time = self._last_order_time.get(request.symbol)
        if last_time:
            elapsed = (now - last_time).total_seconds()
            if elapsed < self.min_order_interval_seconds:
                return False, f"Rate limit: wait {self.min_order_interval_seconds - elapsed:.1f}s"

        # Check 7: Daily trade limit
        if self._daily_trade_count >= self.max_daily_trades:
            return False, f"Daily trade limit ({self.max_daily_trades}) reached"

        # All checks passed
        return True, "OK"

    def record_order(self, symbol: str) -> None:
        """Record that an order was placed."""
        self._last_order_time[symbol] = datetime.now()
        self._daily_trade_count += 1


class OrderManager:
    """
    Central coordinator for all order activity.

    Features:
    - Pre-flight validation
    - Order queue with priority
    - Execution through IBKR
    - Comprehensive logging
    - Error handling and retry
    - Kill switch
    """

    def __init__(
        self,
        trading_mode: TradingMode = TradingMode.PAPER,
        max_retries: int = 3,
        retry_delay_seconds: float = 2.0,
        on_order_update: Optional[Callable] = None,
        on_fill: Optional[Callable] = None,
        on_error: Optional[Callable] = None,
    ):
        """
        Initialize order manager.

        Args:
            trading_mode: PAPER or LIVE
            max_retries: Max retry attempts for failed orders
            retry_delay_seconds: Delay between retries
            on_order_update: Callback for order status updates
            on_fill: Callback for fills
            on_error: Callback for errors
        """
        self.trading_mode = trading_mode
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
        self.on_order_update = on_order_update
        self.on_fill = on_fill
        self.on_error = on_error

        # Components
        self._ibkr: Optional[IBKRClient] = None
        self._logger: Optional[ExecutionLogger] = None
        self._preflight = PreFlightCheck()

        # State
        self._initialized = False
        self._order_queue: deque[OrderRequest] = deque()
        self._managed_orders: Dict[str, ManagedOrder] = {}
        self._processing = False
        self._halted = False
        self._halt_reason = ""

        # Stats
        self._stats = {
            "orders_submitted": 0,
            "orders_filled": 0,
            "orders_cancelled": 0,
            "orders_rejected": 0,
            "orders_errored": 0,
        }

        logger.info(f"OrderManager initialized in {trading_mode.value} mode")

    async def initialize(self) -> bool:
        """
        Initialize connections to IBKR and logging.

        Returns:
            True if initialized successfully
        """
        try:
            # Initialize execution logger
            self._logger = ExecutionLogger(strategy_name="order_manager")
            await self._logger.initialize()

            # Initialize IBKR client
            self._ibkr = IBKRClient(
                mode=self.trading_mode,
                on_order_update=self._handle_order_update,
                on_position_update=self._handle_position_update
            )
            self._ibkr.set_execution_logger(self._logger)

            connected = await self._ibkr.connect()
            if not connected:
                logger.error("Failed to connect to IBKR")
                return False

            self._initialized = True
            logger.info("✅ OrderManager initialized successfully")

            # Log system event
            await self._logger.log_system_event(
                EventType.CONNECTION_UP,
                "OrderManager initialized",
                {"mode": self.trading_mode.value}
            )

            return True

        except Exception as e:
            logger.error(f"OrderManager initialization failed: {e}")
            return False

    async def shutdown(self) -> None:
        """Gracefully shutdown the order manager."""
        logger.info("Shutting down OrderManager...")

        # Cancel any pending orders
        pending = [o for o in self._managed_orders.values() if o.status == "pending"]
        for order in pending:
            if order.result and order.result.order_id:
                await self.cancel_order(order.result.order_id)

        # Disconnect
        if self._ibkr:
            await self._ibkr.disconnect()

        logger.info("OrderManager shutdown complete")

    def _generate_request_id(self) -> str:
        """Generate unique request ID."""
        return f"REQ_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

    async def submit_order(
        self,
        symbol: str,
        side: Literal["BUY", "SELL"],
        quantity: int,
        order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] = "LIMIT",
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
        time_in_force: Literal["GTC", "DAY", "IOC"] = "GTC",
        priority: OrderPriority = OrderPriority.NORMAL,
        strategy_name: str = "manual",
        signal_source: str = "unknown",
        dry_run: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> OrderResult:
        """
        Submit an order for execution.

        This is the main entry point for all order activity.

        Args:
            symbol: Futures symbol (ES, MES, NQ, etc.)
            side: BUY or SELL
            quantity: Number of contracts
            order_type: MARKET, LIMIT, STOP, STOP_LIMIT
            limit_price: Limit price
            stop_price: Stop price
            time_in_force: GTC, DAY, IOC
            priority: Order priority
            strategy_name: Name of the strategy
            signal_source: What generated this signal
            dry_run: If True, validate but don't execute
            metadata: Additional metadata

        Returns:
            OrderResult with status
        """
        # Check initialization
        if not self._initialized:
            return OrderResult(
                order_id="",
                status=OrderStatus.ERROR,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                message="OrderManager not initialized"
            )

        # Check if halted
        if self._halted:
            return OrderResult(
                order_id="",
                status=OrderStatus.REJECTED,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                message=f"Trading halted: {self._halt_reason}"
            )

        # Create request
        request = OrderRequest(
            request_id=self._generate_request_id(),
            symbol=symbol.upper(),
            side=side,
            quantity=quantity,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            priority=priority,
            strategy_name=strategy_name,
            signal_source=signal_source,
            dry_run=dry_run,
            metadata=metadata or {}
        )

        logger.info(f"Order request: {side} {quantity} {symbol} @ {limit_price or 'MKT'} [{strategy_name}]")

        # Pre-flight checks
        positions = await self._ibkr.get_positions() if self._ibkr else {}
        quote = await self._ibkr.get_quote(symbol) if self._ibkr else None

        passed, message = self._preflight.check(request, positions, quote)

        if not passed:
            logger.warning(f"Pre-flight failed: {message}")

            result = OrderResult(
                order_id=request.request_id,
                status=OrderStatus.REJECTED,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                limit_price=limit_price,
                stop_price=stop_price,
                message=f"Pre-flight failed: {message}"
            )

            # Log rejection
            if self._logger:
                await self._logger.log_order_rejected(result, message)

            self._stats["orders_rejected"] += 1
            return result

        # Execute order
        return await self._execute_order(request)

    async def _execute_order(self, request: OrderRequest) -> OrderResult:
        """Execute an order through IBKR."""
        try:
            # Place order via IBKR client
            result = await self._ibkr.place_order(
                symbol=request.symbol,
                side=request.side,
                quantity=request.quantity,
                order_type=request.order_type,
                limit_price=request.limit_price,
                stop_price=request.stop_price,
                time_in_force=request.time_in_force,
                dry_run=request.dry_run
            )

            # Track the order
            managed = ManagedOrder(
                request=request,
                result=result,
                status=result.status.value,
                submitted_at=datetime.now() if result.status == OrderStatus.SUBMITTED else None
            )
            self._managed_orders[result.order_id] = managed

            # Record for rate limiting
            if result.status in [OrderStatus.SUBMITTED, OrderStatus.FILLED]:
                self._preflight.record_order(request.symbol)
                self._stats["orders_submitted"] += 1

            # Callback
            if self.on_order_update:
                self.on_order_update(result)

            return result

        except Exception as e:
            logger.error(f"Order execution failed: {e}")

            result = OrderResult(
                order_id=request.request_id,
                status=OrderStatus.ERROR,
                symbol=request.symbol,
                side=request.side,
                quantity=request.quantity,
                order_type=request.order_type,
                message=str(e)
            )

            self._stats["orders_errored"] += 1

            if self.on_error:
                self.on_error(result, e)

            return result

    async def cancel_order(self, order_id: str) -> bool:
        """
        Cancel a pending order.

        Args:
            order_id: Order ID to cancel

        Returns:
            True if cancellation request sent
        """
        if not self._ibkr:
            logger.error("IBKR not initialized")
            return False

        success = await self._ibkr.cancel_order(order_id)

        if success:
            if order_id in self._managed_orders:
                self._managed_orders[order_id].status = "cancelled"
            self._stats["orders_cancelled"] += 1

            # Log cancellation
            if self._logger and order_id in self._managed_orders:
                order = self._managed_orders[order_id]
                await self._logger.log_order_cancelled(order.result, "User requested")

        return success

    async def cancel_all_orders(self, symbol: Optional[str] = None) -> int:
        """
        Cancel all pending orders.

        Args:
            symbol: If provided, only cancel orders for this symbol

        Returns:
            Number of orders cancelled
        """
        cancelled = 0

        for order_id, managed in self._managed_orders.items():
            if managed.status not in ["pending", "submitted"]:
                continue

            if symbol and managed.request.symbol != symbol:
                continue

            if await self.cancel_order(order_id):
                cancelled += 1

        logger.info(f"Cancelled {cancelled} orders")
        return cancelled

    async def emergency_flatten(self, reason: str = "Manual trigger") -> Dict[str, Any]:
        """
        EMERGENCY: Flatten all positions immediately.

        This is the kill switch - cancels all orders and closes all positions.

        Args:
            reason: Reason for the emergency flatten

        Returns:
            Results of the flatten operation
        """
        logger.critical(f"🚨 EMERGENCY FLATTEN: {reason}")

        # Halt trading
        self._halted = True
        self._halt_reason = reason

        if not self._ibkr:
            return {"error": "IBKR not initialized"}

        # Execute kill switch
        results = await self._ibkr.kill_switch()

        # Log
        if self._logger:
            await self._logger.log_kill_switch(
                reason,
                results.get("positions_closed", []),
                results.get("orders_cancelled", [])
            )

        return results

    def halt_trading(self, reason: str) -> None:
        """Halt all trading."""
        self._halted = True
        self._halt_reason = reason
        logger.warning(f"Trading halted: {reason}")

    def resume_trading(self) -> None:
        """Resume trading after a halt."""
        self._halted = False
        self._halt_reason = ""
        logger.info("Trading resumed")

    def _handle_order_update(self, order_id: str, status: OrderStatus, trade) -> None:
        """Handle order status update from IBKR."""
        if order_id in self._managed_orders:
            managed = self._managed_orders[order_id]
            managed.status = status.value

            if status == OrderStatus.FILLED:
                managed.filled_at = datetime.now()
                self._stats["orders_filled"] += 1

                if self.on_fill:
                    self.on_fill(managed.result)

    def _handle_position_update(self, symbol: str, position: Position) -> None:
        """Handle position update from IBKR."""
        logger.debug(f"Position update: {symbol} = {position.quantity}")

    # =========================================================================
    # Query Methods
    # =========================================================================

    async def get_positions(self) -> Dict[str, Position]:
        """Get all open positions."""
        if not self._ibkr:
            return {}
        return await self._ibkr.get_positions()

    async def get_quote(self, symbol: str) -> Optional[Quote]:
        """Get quote for a symbol."""
        if not self._ibkr:
            return None
        return await self._ibkr.get_quote(symbol)

    def get_order(self, order_id: str) -> Optional[ManagedOrder]:
        """Get a managed order by ID."""
        return self._managed_orders.get(order_id)

    def get_pending_orders(self) -> List[ManagedOrder]:
        """Get all pending orders."""
        return [o for o in self._managed_orders.values()
                if o.status in ["pending", "submitted"]]

    def get_stats(self) -> Dict[str, Any]:
        """Get order manager statistics."""
        return {
            **self._stats,
            "is_halted": self._halted,
            "halt_reason": self._halt_reason,
            "pending_orders": len(self.get_pending_orders()),
            "total_managed": len(self._managed_orders),
        }

    @property
    def is_connected(self) -> bool:
        """Check if connected to IBKR."""
        return self._ibkr is not None and self._ibkr.is_connected

    @property
    def is_halted(self) -> bool:
        """Check if trading is halted."""
        return self._halted


# =============================================================================
# Singleton Access
# =============================================================================

_manager: Optional[OrderManager] = None


def get_order_manager() -> Optional[OrderManager]:
    """Get the global order manager instance."""
    return _manager


async def init_order_manager(
    trading_mode: TradingMode = TradingMode.PAPER,
    **kwargs
) -> OrderManager:
    """
    Initialize the global order manager.

    Args:
        trading_mode: PAPER or LIVE
        **kwargs: Additional arguments for OrderManager

    Returns:
        Initialized OrderManager
    """
    global _manager
    _manager = OrderManager(trading_mode=trading_mode, **kwargs)
    await _manager.initialize()
    return _manager


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Order Manager CLI")
    parser.add_argument("--mode", choices=["paper", "live"], default="paper")
    parser.add_argument("command", choices=["test", "quote", "positions"])
    parser.add_argument("--symbol", default="MES")

    args = parser.parse_args()

    async def main():
        mode = TradingMode.PAPER if args.mode == "paper" else TradingMode.LIVE
        manager = OrderManager(trading_mode=mode)

        if not await manager.initialize():
            print("Failed to initialize")
            return

        try:
            if args.command == "quote":
                quote = await manager.get_quote(args.symbol)
                if quote:
                    print(f"\n{quote.symbol}")
                    print(f"  Bid: {quote.bid}")
                    print(f"  Ask: {quote.ask}")
                    print(f"  Spread: {quote.spread:.2f}")
                else:
                    print(f"No quote for {args.symbol}")

            elif args.command == "positions":
                positions = await manager.get_positions()
                if positions:
                    for sym, pos in positions.items():
                        print(f"{sym}: {pos.quantity} @ {pos.avg_cost:.2f}")
                else:
                    print("No positions")

            elif args.command == "test":
                print("\nTesting order submission (dry run)...")
                result = await manager.submit_order(
                    symbol=args.symbol,
                    side="BUY",
                    quantity=1,
                    order_type="LIMIT",
                    limit_price=5000.00,
                    strategy_name="cli_test",
                    dry_run=True
                )
                print(f"  Status: {result.status.value}")
                print(f"  Message: {result.message}")
                print(f"\nStats: {manager.get_stats()}")

        finally:
            await manager.shutdown()

    asyncio.run(main())
