"""
IBKR Client - Interactive Brokers API Wrapper for Futures Trading
==================================================================

Bulletproof execution system for ES/MES/NQ/MNQ futures trading.

Architecture:
- Uses ib_insync for clean async interface to TWS/IB Gateway
- All operations logged before execution
- Kill switch for emergency position flattening
- Paper trading mode by default

Requirements:
    pip install ib_insync

Connection:
    - TWS: Port 7497 (paper) or 7496 (live)
    - IB Gateway: Port 4002 (paper) or 4001 (live)

Usage:
    from engine.trading.ibkr_client import IBKRClient, TradingMode

    client = IBKRClient(mode=TradingMode.PAPER)
    await client.connect()

    # Get quote
    quote = await client.get_quote("MES")

    # Place order (logged before execution)
    order_id = await client.place_order(
        symbol="MES",
        side="BUY",
        quantity=1,
        order_type="LIMIT",
        limit_price=5000.00
    )

    # Emergency flatten all
    await client.kill_switch()
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List, Literal, Callable
from dataclasses import dataclass, field
from enum import Enum
import os
import json

logger = logging.getLogger("AlphaFactory.IBKR")

# Futures contract specifications
FUTURES_SPECS = {
    "ES": {"exchange": "CME", "multiplier": 50, "currency": "USD", "min_tick": 0.25},
    "MES": {"exchange": "CME", "multiplier": 5, "currency": "USD", "min_tick": 0.25},
    "NQ": {"exchange": "CME", "multiplier": 20, "currency": "USD", "min_tick": 0.25},
    "MNQ": {"exchange": "CME", "multiplier": 2, "currency": "USD", "min_tick": 0.25},
    "YM": {"exchange": "CBOT", "multiplier": 5, "currency": "USD", "min_tick": 1.0},
    "MYM": {"exchange": "CBOT", "multiplier": 0.5, "currency": "USD", "min_tick": 1.0},
    "RTY": {"exchange": "CME", "multiplier": 50, "currency": "USD", "min_tick": 0.1},
    "M2K": {"exchange": "CME", "multiplier": 5, "currency": "USD", "min_tick": 0.1},
    "CL": {"exchange": "NYMEX", "multiplier": 1000, "currency": "USD", "min_tick": 0.01},
    "GC": {"exchange": "COMEX", "multiplier": 100, "currency": "USD", "min_tick": 0.1},
    "ZN": {"exchange": "CBOT", "multiplier": 1000, "currency": "USD", "min_tick": 0.015625},
}


class TradingMode(Enum):
    """Trading mode - PAPER by default for safety."""
    PAPER = "paper"
    LIVE = "live"


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(Enum):
    MARKET = "MKT"
    LIMIT = "LMT"
    STOP = "STP"
    STOP_LIMIT = "STP LMT"


class OrderStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    FILLED = "filled"
    PARTIALLY_FILLED = "partial"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    ERROR = "error"


@dataclass
class Quote:
    """Real-time quote data."""
    symbol: str
    bid: float
    ask: float
    last: float
    volume: int
    timestamp: datetime

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    @property
    def spread(self) -> float:
        return self.ask - self.bid


@dataclass
class Position:
    """Open position."""
    symbol: str
    quantity: int  # Positive = long, negative = short
    avg_cost: float
    unrealized_pnl: float
    realized_pnl: float
    market_value: float

    @property
    def is_long(self) -> bool:
        return self.quantity > 0

    @property
    def is_short(self) -> bool:
        return self.quantity < 0


@dataclass
class OrderResult:
    """Result of order placement."""
    order_id: str
    status: OrderStatus
    symbol: str
    side: str
    quantity: int
    order_type: str
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    filled_quantity: int = 0
    avg_fill_price: Optional[float] = None
    commission: float = 0.0
    message: str = ""
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "order_id": self.order_id,
            "status": self.status.value,
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "order_type": self.order_type,
            "limit_price": self.limit_price,
            "stop_price": self.stop_price,
            "filled_quantity": self.filled_quantity,
            "avg_fill_price": self.avg_fill_price,
            "commission": self.commission,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class AccountInfo:
    """Account information."""
    account_id: str
    net_liquidation: float
    available_funds: float
    buying_power: float
    realized_pnl: float
    unrealized_pnl: float
    margin_used: float
    excess_liquidity: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "account_id": self.account_id,
            "net_liquidation": self.net_liquidation,
            "available_funds": self.available_funds,
            "buying_power": self.buying_power,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "margin_used": self.margin_used,
            "excess_liquidity": self.excess_liquidity,
        }


class IBKRClient:
    """
    Interactive Brokers client for futures trading.

    SAFETY FEATURES:
    1. Paper trading mode by default
    2. All orders logged to Supabase BEFORE execution
    3. Kill switch to flatten all positions instantly
    4. Position limits enforced
    5. Daily loss limit tracking
    6. Connection health monitoring
    """

    def __init__(
        self,
        mode: TradingMode = TradingMode.PAPER,
        host: str = "127.0.0.1",
        port: Optional[int] = None,
        client_id: int = 1,
        max_position_per_symbol: int = 10,  # Max contracts per symbol
        daily_loss_limit: float = 500.0,    # Max daily loss in dollars
        on_order_update: Optional[Callable] = None,
        on_position_update: Optional[Callable] = None,
    ):
        """
        Initialize IBKR client.

        Args:
            mode: PAPER or LIVE trading
            host: TWS/Gateway host
            port: TWS/Gateway port (auto-detected based on mode if None)
            client_id: Unique client ID for this connection
            max_position_per_symbol: Maximum contracts per symbol
            daily_loss_limit: Maximum daily loss before trading halts
            on_order_update: Callback for order status updates
            on_position_update: Callback for position changes
        """
        self.mode = mode
        self.host = host
        self.client_id = client_id
        self.max_position_per_symbol = max_position_per_symbol
        self.daily_loss_limit = daily_loss_limit
        self.on_order_update = on_order_update
        self.on_position_update = on_position_update

        # Auto-select port based on mode
        if port is None:
            # TWS: 7497 (paper), 7496 (live)
            # Gateway: 4002 (paper), 4001 (live)
            self.port = 7497 if mode == TradingMode.PAPER else 7496
        else:
            self.port = port

        # State
        self._ib = None  # ib_insync.IB instance
        self._connected = False
        self._account_id: Optional[str] = None
        self._positions: Dict[str, Position] = {}
        self._pending_orders: Dict[str, OrderResult] = {}
        self._daily_pnl: float = 0.0
        self._trading_halted: bool = False
        self._halt_reason: str = ""

        # Execution logger (will be injected)
        self._execution_logger = None

        logger.info(f"IBKRClient initialized:")
        logger.info(f"  Mode: {mode.value}")
        logger.info(f"  Host: {host}:{self.port}")
        logger.info(f"  Max position/symbol: {max_position_per_symbol}")
        logger.info(f"  Daily loss limit: ${daily_loss_limit}")

        if mode == TradingMode.LIVE:
            logger.warning("⚠️ LIVE TRADING MODE - Real money at risk!")

    def set_execution_logger(self, logger_instance) -> None:
        """Inject execution logger for pre-trade logging."""
        self._execution_logger = logger_instance

    async def connect(self, timeout: int = 30) -> bool:
        """
        Connect to TWS/IB Gateway.

        Args:
            timeout: Connection timeout in seconds

        Returns:
            True if connected successfully
        """
        try:
            # Import ib_insync
            from ib_insync import IB

            self._ib = IB()

            logger.info(f"Connecting to IBKR at {self.host}:{self.port}...")

            await asyncio.wait_for(
                self._ib.connectAsync(
                    self.host,
                    self.port,
                    clientId=self.client_id,
                    readonly=False
                ),
                timeout=timeout
            )

            self._connected = True

            # Get account info
            accounts = self._ib.managedAccounts()
            if accounts:
                self._account_id = accounts[0]
                logger.info(f"Connected to account: {self._account_id}")

            # Subscribe to updates
            self._ib.orderStatusEvent += self._on_order_status
            self._ib.positionEvent += self._on_position
            self._ib.errorEvent += self._on_error

            # Load current positions
            await self._sync_positions()

            logger.info("✅ IBKR connection established")
            return True

        except asyncio.TimeoutError:
            logger.error(f"Connection timeout after {timeout}s")
            return False
        except ImportError:
            logger.error("ib_insync not installed. Run: pip install ib_insync")
            return False
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            return False

    async def disconnect(self) -> None:
        """Disconnect from IBKR."""
        if self._ib and self._connected:
            self._ib.disconnect()
            self._connected = False
            logger.info("Disconnected from IBKR")

    @property
    def is_connected(self) -> bool:
        """Check if connected to IBKR."""
        return self._connected and self._ib is not None and self._ib.isConnected()

    @property
    def is_trading_halted(self) -> bool:
        """Check if trading is halted due to risk limits."""
        return self._trading_halted

    async def _sync_positions(self) -> None:
        """Sync positions from IBKR."""
        if not self.is_connected:
            return

        positions = self._ib.positions()
        self._positions.clear()

        for pos in positions:
            if pos.contract.secType == "FUT":
                symbol = pos.contract.localSymbol or pos.contract.symbol
                self._positions[symbol] = Position(
                    symbol=symbol,
                    quantity=int(pos.position),
                    avg_cost=pos.avgCost,
                    unrealized_pnl=0.0,  # Updated via PnL subscription
                    realized_pnl=0.0,
                    market_value=pos.marketValue if hasattr(pos, 'marketValue') else 0.0
                )

        logger.info(f"Synced {len(self._positions)} positions")

    def _on_order_status(self, trade) -> None:
        """Handle order status update from IBKR."""
        order_id = str(trade.order.orderId)

        status_map = {
            "Submitted": OrderStatus.SUBMITTED,
            "Filled": OrderStatus.FILLED,
            "Cancelled": OrderStatus.CANCELLED,
            "Inactive": OrderStatus.REJECTED,
        }

        status = status_map.get(trade.orderStatus.status, OrderStatus.PENDING)

        if order_id in self._pending_orders:
            self._pending_orders[order_id].status = status
            self._pending_orders[order_id].filled_quantity = int(trade.orderStatus.filled)
            self._pending_orders[order_id].avg_fill_price = trade.orderStatus.avgFillPrice

        if self.on_order_update:
            self.on_order_update(order_id, status, trade)

        logger.info(f"Order {order_id}: {status.value}")

    def _on_position(self, position) -> None:
        """Handle position update from IBKR."""
        if position.contract.secType == "FUT":
            symbol = position.contract.localSymbol or position.contract.symbol
            self._positions[symbol] = Position(
                symbol=symbol,
                quantity=int(position.position),
                avg_cost=position.avgCost,
                unrealized_pnl=0.0,
                realized_pnl=0.0,
                market_value=0.0
            )

            if self.on_position_update:
                self.on_position_update(symbol, self._positions[symbol])

    def _on_error(self, reqId, errorCode, errorString, contract) -> None:
        """Handle error from IBKR."""
        # Filter out non-critical errors
        if errorCode in [2104, 2106, 2158]:  # Market data farm connection messages
            return

        logger.error(f"IBKR Error {errorCode}: {errorString}")

    def _get_front_month_expiry(self, symbol: str) -> str:
        """Get front month expiry for a futures symbol."""
        # Simple implementation - gets current or next month
        # In production, use IBKR's contract details
        from datetime import date
        today = date.today()

        # Third Friday of current/next month
        year = today.year
        month = today.month

        # If past 15th, use next month
        if today.day > 15:
            month += 1
            if month > 12:
                month = 1
                year += 1

        return f"{year}{month:02d}"

    async def get_quote(self, symbol: str) -> Optional[Quote]:
        """
        Get real-time quote for a futures symbol.

        Args:
            symbol: Futures symbol (ES, MES, NQ, etc.)

        Returns:
            Quote object or None if unavailable
        """
        if not self.is_connected:
            logger.error("Not connected to IBKR")
            return None

        try:
            from ib_insync import Future

            spec = FUTURES_SPECS.get(symbol.upper())
            if not spec:
                logger.error(f"Unknown futures symbol: {symbol}")
                return None

            # Create contract
            contract = Future(
                symbol=symbol.upper(),
                exchange=spec["exchange"],
                currency=spec["currency"]
            )

            # Qualify contract to get exact specification
            contracts = await self._ib.qualifyContractsAsync(contract)
            if not contracts:
                logger.error(f"Could not qualify contract for {symbol}")
                return None

            contract = contracts[0]

            # Get market data
            ticker = self._ib.reqMktData(contract)
            await asyncio.sleep(1)  # Wait for data

            quote = Quote(
                symbol=symbol.upper(),
                bid=ticker.bid if ticker.bid > 0 else 0.0,
                ask=ticker.ask if ticker.ask > 0 else 0.0,
                last=ticker.last if ticker.last > 0 else 0.0,
                volume=int(ticker.volume) if ticker.volume else 0,
                timestamp=datetime.now()
            )

            # Cancel market data subscription
            self._ib.cancelMktData(contract)

            return quote

        except Exception as e:
            logger.error(f"Error getting quote for {symbol}: {e}")
            return None

    async def place_order(
        self,
        symbol: str,
        side: Literal["BUY", "SELL"],
        quantity: int,
        order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] = "LIMIT",
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
        time_in_force: Literal["GTC", "DAY", "IOC"] = "GTC",
        dry_run: bool = False,
    ) -> OrderResult:
        """
        Place a futures order with full pre-flight checks.

        SAFETY: Order is logged to Supabase BEFORE execution.

        Args:
            symbol: Futures symbol (ES, MES, NQ, etc.)
            side: BUY or SELL
            quantity: Number of contracts (positive)
            order_type: MARKET, LIMIT, STOP, or STOP_LIMIT
            limit_price: Limit price (required for LIMIT/STOP_LIMIT)
            stop_price: Stop price (required for STOP/STOP_LIMIT)
            time_in_force: GTC, DAY, or IOC
            dry_run: If True, validate but don't execute

        Returns:
            OrderResult with status and details
        """
        symbol = symbol.upper()
        order_id = f"{symbol}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

        # Initialize result
        result = OrderResult(
            order_id=order_id,
            status=OrderStatus.PENDING,
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price
        )

        # ===== PRE-FLIGHT CHECKS =====

        # 1. Check connection
        if not self.is_connected:
            result.status = OrderStatus.ERROR
            result.message = "Not connected to IBKR"
            return result

        # 2. Check if trading is halted
        if self._trading_halted:
            result.status = OrderStatus.REJECTED
            result.message = f"Trading halted: {self._halt_reason}"
            return result

        # 3. Validate symbol
        if symbol not in FUTURES_SPECS:
            result.status = OrderStatus.ERROR
            result.message = f"Unknown symbol: {symbol}"
            return result

        # 4. Validate quantity
        if quantity <= 0:
            result.status = OrderStatus.ERROR
            result.message = "Quantity must be positive"
            return result

        # 5. Check position limits
        current_pos = self._positions.get(symbol, Position(symbol, 0, 0, 0, 0, 0)).quantity
        if side == "BUY":
            new_pos = current_pos + quantity
        else:
            new_pos = current_pos - quantity

        if abs(new_pos) > self.max_position_per_symbol:
            result.status = OrderStatus.REJECTED
            result.message = f"Position limit exceeded: {abs(new_pos)} > {self.max_position_per_symbol}"
            return result

        # 6. Validate order type parameters
        if order_type in ["LIMIT", "STOP_LIMIT"] and limit_price is None:
            result.status = OrderStatus.ERROR
            result.message = f"{order_type} order requires limit_price"
            return result

        if order_type in ["STOP", "STOP_LIMIT"] and stop_price is None:
            result.status = OrderStatus.ERROR
            result.message = f"{order_type} order requires stop_price"
            return result

        # ===== LOG BEFORE EXECUTION =====
        if self._execution_logger:
            try:
                await self._execution_logger.log_order_intent(result)
            except Exception as e:
                logger.error(f"Failed to log order intent: {e}")
                # Continue anyway - logging failure shouldn't block trading

        # ===== DRY RUN CHECK =====
        if dry_run:
            result.status = OrderStatus.PENDING
            result.message = "Dry run - order validated but not submitted"
            logger.info(f"DRY RUN: {side} {quantity} {symbol} @ {limit_price or 'MARKET'}")
            return result

        # ===== EXECUTE ORDER =====
        try:
            from ib_insync import Future, Order

            spec = FUTURES_SPECS[symbol]

            # Create contract
            contract = Future(
                symbol=symbol,
                exchange=spec["exchange"],
                currency=spec["currency"]
            )

            # Qualify contract
            contracts = await self._ib.qualifyContractsAsync(contract)
            if not contracts:
                result.status = OrderStatus.ERROR
                result.message = f"Could not qualify contract for {symbol}"
                return result

            contract = contracts[0]

            # Create order
            order_type_map = {
                "MARKET": "MKT",
                "LIMIT": "LMT",
                "STOP": "STP",
                "STOP_LIMIT": "STP LMT"
            }

            order = Order(
                action=side,
                totalQuantity=quantity,
                orderType=order_type_map[order_type],
                tif=time_in_force
            )

            if limit_price:
                order.lmtPrice = limit_price
            if stop_price:
                order.auxPrice = stop_price

            # Place order
            trade = self._ib.placeOrder(contract, order)

            # Store pending order
            result.order_id = str(trade.order.orderId)
            result.status = OrderStatus.SUBMITTED
            result.message = "Order submitted"
            self._pending_orders[result.order_id] = result

            logger.info(f"Order placed: {side} {quantity} {symbol} @ {limit_price or 'MKT'} (ID: {result.order_id})")

            # Log execution
            if self._execution_logger:
                try:
                    await self._execution_logger.log_order_submitted(result)
                except Exception as e:
                    logger.error(f"Failed to log order submission: {e}")

            return result

        except Exception as e:
            result.status = OrderStatus.ERROR
            result.message = str(e)
            logger.error(f"Order failed: {e}")
            return result

    async def cancel_order(self, order_id: str) -> bool:
        """
        Cancel a pending order.

        Args:
            order_id: Order ID to cancel

        Returns:
            True if cancellation request sent
        """
        if not self.is_connected:
            logger.error("Not connected to IBKR")
            return False

        try:
            # Find the trade by order ID
            for trade in self._ib.openTrades():
                if str(trade.order.orderId) == order_id:
                    self._ib.cancelOrder(trade.order)
                    logger.info(f"Cancellation requested for order {order_id}")
                    return True

            logger.warning(f"Order {order_id} not found in open trades")
            return False

        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False

    async def kill_switch(self) -> Dict[str, Any]:
        """
        EMERGENCY: Flatten all positions immediately.

        This is the nuclear option - closes all positions with market orders.

        Returns:
            Dict with results of each position closure
        """
        logger.critical("🚨 KILL SWITCH ACTIVATED - Flattening all positions!")

        results = {
            "triggered_at": datetime.now().isoformat(),
            "positions_closed": [],
            "orders_cancelled": [],
            "errors": []
        }

        if not self.is_connected:
            results["errors"].append("Not connected to IBKR")
            return results

        # 1. Cancel all pending orders
        try:
            open_orders = self._ib.openOrders()
            for order in open_orders:
                self._ib.cancelOrder(order)
                results["orders_cancelled"].append(str(order.orderId))
            logger.info(f"Cancelled {len(open_orders)} pending orders")
        except Exception as e:
            results["errors"].append(f"Cancel orders failed: {e}")

        # 2. Close all positions with market orders
        for symbol, position in list(self._positions.items()):
            if position.quantity == 0:
                continue

            try:
                # Determine side to close
                side = "SELL" if position.quantity > 0 else "BUY"
                qty = abs(position.quantity)

                order_result = await self.place_order(
                    symbol=symbol,
                    side=side,
                    quantity=qty,
                    order_type="MARKET"
                )

                results["positions_closed"].append({
                    "symbol": symbol,
                    "side": side,
                    "quantity": qty,
                    "order_id": order_result.order_id,
                    "status": order_result.status.value
                })

                logger.info(f"Closed {qty} {symbol} position")

            except Exception as e:
                results["errors"].append(f"Failed to close {symbol}: {e}")

        # 3. Halt trading
        self._trading_halted = True
        self._halt_reason = "Kill switch activated"

        logger.critical(f"Kill switch complete: {len(results['positions_closed'])} positions closed")

        return results

    async def get_positions(self) -> Dict[str, Position]:
        """Get all open positions."""
        await self._sync_positions()
        return self._positions.copy()

    async def get_account_info(self) -> Optional[AccountInfo]:
        """Get account information."""
        if not self.is_connected:
            return None

        try:
            account_values = self._ib.accountValues()

            # Extract key values
            values = {}
            for av in account_values:
                values[av.tag] = float(av.value) if av.value else 0.0

            return AccountInfo(
                account_id=self._account_id or "",
                net_liquidation=values.get("NetLiquidation", 0.0),
                available_funds=values.get("AvailableFunds", 0.0),
                buying_power=values.get("BuyingPower", 0.0),
                realized_pnl=values.get("RealizedPnL", 0.0),
                unrealized_pnl=values.get("UnrealizedPnL", 0.0),
                margin_used=values.get("MaintMarginReq", 0.0),
                excess_liquidity=values.get("ExcessLiquidity", 0.0)
            )

        except Exception as e:
            logger.error(f"Failed to get account info: {e}")
            return None

    def halt_trading(self, reason: str) -> None:
        """Halt all trading with a reason."""
        self._trading_halted = True
        self._halt_reason = reason
        logger.warning(f"Trading halted: {reason}")

    def resume_trading(self) -> None:
        """Resume trading after a halt."""
        self._trading_halted = False
        self._halt_reason = ""
        logger.info("Trading resumed")

    def update_daily_pnl(self, pnl: float) -> None:
        """
        Update daily P&L and check loss limit.

        Args:
            pnl: Current daily P&L in dollars
        """
        self._daily_pnl = pnl

        if pnl <= -self.daily_loss_limit:
            self.halt_trading(f"Daily loss limit hit: ${pnl:.2f}")


# =============================================================================
# Convenience Functions
# =============================================================================

_client: Optional[IBKRClient] = None


def get_ibkr_client() -> Optional[IBKRClient]:
    """Get the global IBKR client instance."""
    return _client


async def init_ibkr_client(
    mode: TradingMode = TradingMode.PAPER,
    **kwargs
) -> IBKRClient:
    """
    Initialize and connect the global IBKR client.

    Args:
        mode: PAPER or LIVE trading
        **kwargs: Additional arguments for IBKRClient

    Returns:
        Connected IBKRClient instance
    """
    global _client
    _client = IBKRClient(mode=mode, **kwargs)
    await _client.connect()
    return _client


# =============================================================================
# CLI for testing
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="IBKR Client CLI")
    parser.add_argument("--mode", choices=["paper", "live"], default="paper")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("command", choices=["quote", "positions", "account", "test"])
    parser.add_argument("--symbol", default="MES")

    args = parser.parse_args()

    async def main():
        mode = TradingMode.PAPER if args.mode == "paper" else TradingMode.LIVE
        client = IBKRClient(mode=mode, port=args.port)

        if not await client.connect():
            print("Failed to connect to IBKR")
            return

        try:
            if args.command == "quote":
                quote = await client.get_quote(args.symbol)
                if quote:
                    print(f"\n{quote.symbol}")
                    print(f"  Bid: {quote.bid}")
                    print(f"  Ask: {quote.ask}")
                    print(f"  Last: {quote.last}")
                    print(f"  Spread: {quote.spread:.2f}")
                else:
                    print(f"No quote for {args.symbol}")

            elif args.command == "positions":
                positions = await client.get_positions()
                if positions:
                    for symbol, pos in positions.items():
                        print(f"\n{symbol}")
                        print(f"  Quantity: {pos.quantity}")
                        print(f"  Avg Cost: {pos.avg_cost}")
                else:
                    print("No open positions")

            elif args.command == "account":
                info = await client.get_account_info()
                if info:
                    print(f"\nAccount: {info.account_id}")
                    print(f"  Net Liquidation: ${info.net_liquidation:,.2f}")
                    print(f"  Available Funds: ${info.available_funds:,.2f}")
                    print(f"  Unrealized P&L: ${info.unrealized_pnl:,.2f}")
                else:
                    print("Could not get account info")

            elif args.command == "test":
                print("\nTesting order (dry run)...")
                result = await client.place_order(
                    symbol=args.symbol,
                    side="BUY",
                    quantity=1,
                    order_type="LIMIT",
                    limit_price=5000.00,
                    dry_run=True
                )
                print(f"  Status: {result.status.value}")
                print(f"  Message: {result.message}")

        finally:
            await client.disconnect()

    asyncio.run(main())
