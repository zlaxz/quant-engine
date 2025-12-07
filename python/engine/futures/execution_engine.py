"""
Futures Execution Engine

Production-grade order execution for futures trading.
Supports backtesting simulation and live trading through broker APIs.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Callable, Any, Tuple, Union
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from collections import deque
import asyncio
import logging
import uuid
import os

logger = logging.getLogger(__name__)


class OrderType(Enum):
    """Order types."""
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"
    MIT = "market_if_touched"  # Market If Touched


class OrderSide(Enum):
    """Order side."""
    BUY = "buy"
    SELL = "sell"


class OrderStatus(Enum):
    """Order status."""
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIAL = "partial"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"


class TimeInForce(Enum):
    """Time in force options."""
    DAY = "day"
    GTC = "gtc"  # Good Till Cancelled
    IOC = "ioc"  # Immediate or Cancel
    FOK = "fok"  # Fill or Kill
    GTD = "gtd"  # Good Till Date


@dataclass
class Order:
    """Order representation."""
    order_id: str
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: int
    price: Optional[float] = None  # For limit orders
    stop_price: Optional[float] = None  # For stop orders
    time_in_force: TimeInForce = TimeInForce.DAY
    status: OrderStatus = OrderStatus.PENDING
    filled_quantity: int = 0
    avg_fill_price: float = 0.0
    commission: float = 0.0
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    filled_at: Optional[datetime] = None
    parent_order_id: Optional[str] = None  # For bracket orders
    child_order_ids: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_active(self) -> bool:
        """Check if order is still active."""
        return self.status in [OrderStatus.PENDING, OrderStatus.SUBMITTED, OrderStatus.PARTIAL]


@dataclass
class Fill:
    """Order fill (execution)."""
    fill_id: str
    order_id: str
    symbol: str
    side: OrderSide
    quantity: int
    price: float
    commission: float
    timestamp: datetime
    liquidity: str = "taker"  # "maker" or "taker"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExecutionReport:
    """Execution quality report."""
    order_id: str
    symbol: str
    side: OrderSide
    requested_quantity: int
    filled_quantity: int
    avg_fill_price: float
    vwap: float  # Volume-weighted average price during execution
    slippage_bps: float  # Slippage in basis points
    market_impact_bps: float
    total_commission: float
    execution_time_ms: float
    fill_rate: float
    fills: List[Fill] = field(default_factory=list)


class ExecutionHandler(ABC):
    """Abstract base for execution handlers (backtest or live)."""

    @abstractmethod
    async def submit_order(self, order: Order) -> Order:
        """Submit an order for execution."""
        pass

    @abstractmethod
    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an order."""
        pass

    @abstractmethod
    async def modify_order(self, order_id: str, **kwargs) -> Order:
        """Modify an existing order."""
        pass

    @abstractmethod
    async def get_order_status(self, order_id: str) -> Order:
        """Get current order status."""
        pass

    @abstractmethod
    async def get_positions(self) -> Dict[str, Dict]:
        """Get current positions."""
        pass


class BacktestExecutionHandler(ExecutionHandler):
    """
    Backtest execution handler with realistic simulation.

    Features:
    - Configurable slippage models
    - Partial fills simulation
    - Latency simulation
    - Order book simulation (optional)
    """

    def __init__(
        self,
        slippage_model: str = "fixed",  # "fixed", "proportional", "volatility"
        slippage_bps: float = 1.0,
        latency_ms: float = 50,
        partial_fill_prob: float = 0.0,
        commission_per_contract: float = 2.50,
        contract_specs: Optional[Dict] = None
    ):
        self.slippage_model = slippage_model
        self.slippage_bps = slippage_bps
        self.latency_ms = latency_ms
        self.partial_fill_prob = partial_fill_prob
        self.commission_per_contract = commission_per_contract

        self.contract_specs = contract_specs or {
            'ES': {'tick_size': 0.25, 'multiplier': 50},
            'NQ': {'tick_size': 0.25, 'multiplier': 20},
            'MES': {'tick_size': 0.25, 'multiplier': 5},
            'MNQ': {'tick_size': 0.25, 'multiplier': 2},
        }

        self._orders: Dict[str, Order] = {}
        self._fills: List[Fill] = []
        self._positions: Dict[str, Dict] = {}
        self._current_bar: Optional[Dict] = None
        self._volatility_cache: Dict[str, float] = {}

    def set_current_bar(self, bar: Dict):
        """Set current market data bar for simulation."""
        self._current_bar = bar

    def set_volatility(self, symbol: str, vol: float):
        """Set current volatility for vol-adjusted slippage."""
        self._volatility_cache[symbol] = vol

    async def submit_order(self, order: Order) -> Order:
        """Submit and immediately simulate execution."""
        if not self._current_bar:
            order.status = OrderStatus.REJECTED
            order.metadata['reject_reason'] = "No market data"
            return order

        order.status = OrderStatus.SUBMITTED
        self._orders[order.order_id] = order

        # Simulate execution based on order type
        if order.order_type == OrderType.MARKET:
            fill_price = self._calculate_fill_price(order)
            await self._execute_fill(order, fill_price)

        elif order.order_type == OrderType.LIMIT:
            # Check if limit can be filled
            if self._can_fill_limit(order):
                await self._execute_fill(order, order.price)

        elif order.order_type == OrderType.STOP:
            # Stop orders become market when triggered
            if self._is_stop_triggered(order):
                fill_price = self._calculate_fill_price(order)
                await self._execute_fill(order, fill_price)

        elif order.order_type == OrderType.STOP_LIMIT:
            if self._is_stop_triggered(order):
                if self._can_fill_limit(order):
                    await self._execute_fill(order, order.price)

        return order

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an order."""
        if order_id in self._orders:
            order = self._orders[order_id]
            if order.is_active():
                order.status = OrderStatus.CANCELLED
                order.updated_at = datetime.now()
                return True
        return False

    async def modify_order(self, order_id: str, **kwargs) -> Order:
        """Modify order parameters."""
        if order_id not in self._orders:
            raise ValueError(f"Order {order_id} not found")

        order = self._orders[order_id]
        if not order.is_active():
            raise ValueError(f"Order {order_id} is not active")

        # Update allowed fields
        if 'price' in kwargs:
            order.price = kwargs['price']
        if 'stop_price' in kwargs:
            order.stop_price = kwargs['stop_price']
        if 'quantity' in kwargs:
            order.quantity = kwargs['quantity']

        order.updated_at = datetime.now()
        return order

    async def get_order_status(self, order_id: str) -> Order:
        """Get order status."""
        if order_id not in self._orders:
            raise ValueError(f"Order {order_id} not found")
        return self._orders[order_id]

    async def get_positions(self) -> Dict[str, Dict]:
        """Get current positions."""
        return self._positions.copy()

    def _calculate_fill_price(self, order: Order) -> float:
        """Calculate fill price with slippage."""
        if not self._current_bar:
            return 0.0

        # Base price
        if order.side == OrderSide.BUY:
            base_price = self._current_bar.get('high', self._current_bar.get('close', 0))
        else:
            base_price = self._current_bar.get('low', self._current_bar.get('close', 0))

        # Calculate slippage
        if self.slippage_model == "fixed":
            slippage_pct = self.slippage_bps / 10000

        elif self.slippage_model == "proportional":
            # Slippage proportional to order size
            base_slippage = self.slippage_bps / 10000
            size_factor = min(order.quantity / 10, 3.0)  # Cap at 3x
            slippage_pct = base_slippage * size_factor

        elif self.slippage_model == "volatility":
            # Slippage proportional to volatility
            vol = self._volatility_cache.get(order.symbol, 0.15)
            base_slippage = self.slippage_bps / 10000
            vol_factor = vol / 0.15  # Normalize to 15% baseline vol
            slippage_pct = base_slippage * vol_factor

        else:
            slippage_pct = self.slippage_bps / 10000

        # Apply slippage (adverse to order)
        if order.side == OrderSide.BUY:
            fill_price = base_price * (1 + slippage_pct)
        else:
            fill_price = base_price * (1 - slippage_pct)

        # Round to tick size
        spec = self.contract_specs.get(order.symbol, {'tick_size': 0.01})
        tick_size = spec['tick_size']
        fill_price = round(fill_price / tick_size) * tick_size

        return fill_price

    def _can_fill_limit(self, order: Order) -> bool:
        """Check if limit order can be filled."""
        if not self._current_bar or not order.price:
            return False

        if order.side == OrderSide.BUY:
            return self._current_bar.get('low', float('inf')) <= order.price
        else:
            return self._current_bar.get('high', 0) >= order.price

    def _is_stop_triggered(self, order: Order) -> bool:
        """Check if stop order is triggered."""
        if not self._current_bar or not order.stop_price:
            return False

        if order.side == OrderSide.BUY:
            return self._current_bar.get('high', 0) >= order.stop_price
        else:
            return self._current_bar.get('low', float('inf')) <= order.stop_price

    async def _execute_fill(self, order: Order, price: float):
        """Execute a fill."""
        # Simulate partial fills
        if self.partial_fill_prob > 0 and np.random.random() < self.partial_fill_prob:
            fill_qty = max(1, int(order.quantity * np.random.uniform(0.3, 0.8)))
        else:
            fill_qty = order.quantity - order.filled_quantity

        commission = fill_qty * self.commission_per_contract

        fill = Fill(
            fill_id=str(uuid.uuid4()),
            order_id=order.order_id,
            symbol=order.symbol,
            side=order.side,
            quantity=fill_qty,
            price=price,
            commission=commission,
            timestamp=datetime.now()
        )

        self._fills.append(fill)

        # Update order
        old_qty = order.filled_quantity
        order.filled_quantity += fill_qty
        order.avg_fill_price = (
            (order.avg_fill_price * old_qty + price * fill_qty) /
            order.filled_quantity
        )
        order.commission += commission
        order.updated_at = datetime.now()

        if order.filled_quantity >= order.quantity:
            order.status = OrderStatus.FILLED
            order.filled_at = datetime.now()
        else:
            order.status = OrderStatus.PARTIAL

        # Update positions
        self._update_positions(order, fill)

    def _update_positions(self, order: Order, fill: Fill):
        """Update position from fill."""
        symbol = order.symbol

        if symbol not in self._positions:
            self._positions[symbol] = {
                'quantity': 0,
                'avg_price': 0.0,
                'realized_pnl': 0.0
            }

        pos = self._positions[symbol]
        direction = 1 if order.side == OrderSide.BUY else -1
        qty_delta = fill.quantity * direction

        # Calculate P&L if reducing position
        if pos['quantity'] != 0 and np.sign(qty_delta) != np.sign(pos['quantity']):
            spec = self.contract_specs.get(symbol, {'multiplier': 1})
            multiplier = spec['multiplier']
            closed_qty = min(abs(qty_delta), abs(pos['quantity']))

            if pos['quantity'] > 0:  # Was long, now selling
                pnl = closed_qty * (fill.price - pos['avg_price']) * multiplier
            else:  # Was short, now buying
                pnl = closed_qty * (pos['avg_price'] - fill.price) * multiplier

            pos['realized_pnl'] += pnl

        # Update position
        new_qty = pos['quantity'] + qty_delta

        if new_qty == 0:
            pos['avg_price'] = 0.0
        elif np.sign(new_qty) != np.sign(pos['quantity']):
            # Flipped position
            pos['avg_price'] = fill.price
        elif np.sign(qty_delta) == np.sign(pos['quantity']):
            # Adding to position
            total_cost = pos['avg_price'] * abs(pos['quantity']) + fill.price * abs(qty_delta)
            pos['avg_price'] = total_cost / abs(new_qty)

        pos['quantity'] = new_qty


class IBExecutionHandler(ExecutionHandler):
    """
    Interactive Brokers execution handler for live trading.

    Uses ib_insync for clean async API.
    Supports paper trading and live accounts.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,  # 7497=TWS paper, 7496=TWS live, 4002=Gateway paper, 4001=Gateway live
        client_id: int = 1,
        account: str = None,  # If None, uses first available
        readonly: bool = False
    ):
        self.host = host
        self.port = port
        self.client_id = client_id
        self.account = account
        self.readonly = readonly

        self._ib = None
        self._orders: Dict[str, Order] = {}
        self._connected = False

    async def connect(self):
        """Connect to IB TWS or Gateway."""
        try:
            from ib_insync import IB, util
            util.startLoop()  # Enable async in Jupyter/scripts

            self._ib = IB()
            await self._ib.connectAsync(
                self.host,
                self.port,
                clientId=self.client_id,
                readonly=self.readonly
            )

            # Get account if not specified
            if not self.account:
                accounts = self._ib.managedAccounts()
                if accounts:
                    self.account = accounts[0]

            self._connected = True
            logger.info(f"Connected to IB: {self.host}:{self.port}, account: {self.account}")

        except Exception as e:
            logger.error(f"Failed to connect to IB: {e}")
            raise

    async def disconnect(self):
        """Disconnect from IB."""
        if self._ib and self._connected:
            self._ib.disconnect()
            self._connected = False
            logger.info("Disconnected from IB")

    async def submit_order(self, order: Order) -> Order:
        """Submit order to IB."""
        if not self._connected:
            await self.connect()

        try:
            from ib_insync import Future, MarketOrder, LimitOrder, StopOrder, StopLimitOrder

            # Create IB contract
            contract = Future(
                symbol=order.symbol,
                exchange='CME',  # Most futures on CME
                currency='USD'
            )

            # Qualify the contract (get full details)
            await self._ib.qualifyContractsAsync(contract)

            # Create IB order
            action = 'BUY' if order.side == OrderSide.BUY else 'SELL'

            if order.order_type == OrderType.MARKET:
                ib_order = MarketOrder(action, order.quantity)
            elif order.order_type == OrderType.LIMIT:
                ib_order = LimitOrder(action, order.quantity, order.price)
            elif order.order_type == OrderType.STOP:
                ib_order = StopOrder(action, order.quantity, order.stop_price)
            elif order.order_type == OrderType.STOP_LIMIT:
                ib_order = StopLimitOrder(action, order.quantity, order.price, order.stop_price)
            else:
                ib_order = MarketOrder(action, order.quantity)

            # Set account
            ib_order.account = self.account

            # Submit
            trade = self._ib.placeOrder(contract, ib_order)

            # Store mapping
            order.metadata['ib_order_id'] = trade.order.orderId
            order.metadata['ib_trade'] = trade
            order.status = OrderStatus.SUBMITTED
            self._orders[order.order_id] = order

            # Set up fill callback
            trade.filledEvent += lambda t: self._on_fill(order, t)

            logger.info(f"Submitted IB order: {order.symbol} {action} {order.quantity} @ {order.order_type.value}")
            return order

        except Exception as e:
            logger.error(f"IB order submission failed: {e}")
            order.status = OrderStatus.REJECTED
            order.metadata['reject_reason'] = str(e)
            return order

    def _on_fill(self, order: Order, trade):
        """Handle fill event from IB."""
        order.filled_quantity = int(trade.orderStatus.filled)
        order.avg_fill_price = trade.orderStatus.avgFillPrice
        order.commission = sum(f.commission for f in trade.fills)

        if trade.orderStatus.status == 'Filled':
            order.status = OrderStatus.FILLED
            order.filled_at = datetime.now()
        elif trade.orderStatus.status == 'Cancelled':
            order.status = OrderStatus.CANCELLED

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel order at IB."""
        if order_id not in self._orders:
            return False

        order = self._orders[order_id]
        trade = order.metadata.get('ib_trade')

        if trade:
            self._ib.cancelOrder(trade.order)
            order.status = OrderStatus.CANCELLED
            return True
        return False

    async def modify_order(self, order_id: str, **kwargs) -> Order:
        """Modify order at IB."""
        if order_id not in self._orders:
            raise ValueError(f"Order {order_id} not found")

        order = self._orders[order_id]
        trade = order.metadata.get('ib_trade')

        if trade and trade.order:
            if 'price' in kwargs:
                trade.order.lmtPrice = kwargs['price']
            if 'quantity' in kwargs:
                trade.order.totalQuantity = kwargs['quantity']

            self._ib.placeOrder(trade.contract, trade.order)

        return order

    async def get_order_status(self, order_id: str) -> Order:
        """Get order status from IB."""
        if order_id not in self._orders:
            raise ValueError(f"Order {order_id} not found")

        order = self._orders[order_id]
        trade = order.metadata.get('ib_trade')

        if trade:
            status_map = {
                'PendingSubmit': OrderStatus.PENDING,
                'PreSubmitted': OrderStatus.SUBMITTED,
                'Submitted': OrderStatus.SUBMITTED,
                'Filled': OrderStatus.FILLED,
                'Cancelled': OrderStatus.CANCELLED,
                'Inactive': OrderStatus.REJECTED
            }
            order.status = status_map.get(trade.orderStatus.status, order.status)
            order.filled_quantity = int(trade.orderStatus.filled)
            order.avg_fill_price = trade.orderStatus.avgFillPrice

        return order

    async def get_positions(self) -> Dict[str, Dict]:
        """Get positions from IB."""
        if not self._connected:
            await self.connect()

        positions = {}
        for pos in self._ib.positions(self.account):
            if pos.contract.secType == 'FUT':
                positions[pos.contract.localSymbol] = {
                    'quantity': int(pos.position),
                    'avg_price': pos.avgCost / pos.contract.multiplier if pos.contract.multiplier else pos.avgCost,
                    'market_value': pos.marketValue,
                    'unrealized_pnl': pos.unrealizedPNL
                }

        return positions

    async def get_account_summary(self) -> Dict[str, float]:
        """Get account summary from IB."""
        if not self._connected:
            await self.connect()

        summary = {}
        for av in self._ib.accountValues(self.account):
            if av.tag in ['NetLiquidation', 'TotalCashValue', 'BuyingPower', 'GrossPositionValue']:
                summary[av.tag] = float(av.value)

        return summary

    async def get_market_data(self, symbol: str) -> Dict:
        """Get real-time market data for symbol."""
        if not self._connected:
            await self.connect()

        from ib_insync import Future

        contract = Future(symbol=symbol, exchange='CME', currency='USD')
        await self._ib.qualifyContractsAsync(contract)

        ticker = self._ib.reqMktData(contract)
        await asyncio.sleep(1)  # Wait for data

        return {
            'bid': ticker.bid,
            'ask': ticker.ask,
            'last': ticker.last,
            'volume': ticker.volume,
            'high': ticker.high,
            'low': ticker.low
        }


class SchwabExecutionHandler(ExecutionHandler):
    """
    Schwab API execution handler for live trading.

    Note: Requires schwab-py package and API credentials.
    """

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        callback_url: str,
        token_path: str,
        account_id: str
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.callback_url = callback_url
        self.token_path = token_path
        self.account_id = account_id

        self._client = None
        self._orders: Dict[str, Order] = {}

    async def connect(self):
        """Initialize Schwab API client."""
        try:
            from schwab import auth
            from schwab.orders.futures import futures_order_builder

            self._client = auth.client_from_token_file(
                self.token_path,
                self.app_key,
                self.app_secret
            )
            logger.info("Connected to Schwab API")
        except Exception as e:
            logger.error(f"Failed to connect to Schwab: {e}")
            raise

    async def submit_order(self, order: Order) -> Order:
        """Submit order to Schwab."""
        if not self._client:
            await self.connect()

        try:
            # Build Schwab order
            schwab_order = self._build_schwab_order(order)

            # Submit
            response = self._client.place_order(
                self.account_id,
                schwab_order
            )

            if response.status_code == 201:
                # Get order ID from response
                order_url = response.headers.get('Location')
                if order_url:
                    schwab_order_id = order_url.split('/')[-1]
                    order.metadata['schwab_order_id'] = schwab_order_id
                    order.status = OrderStatus.SUBMITTED
                else:
                    order.status = OrderStatus.REJECTED
                    order.metadata['reject_reason'] = "No order ID returned"
            else:
                order.status = OrderStatus.REJECTED
                order.metadata['reject_reason'] = response.text

            self._orders[order.order_id] = order
            return order

        except Exception as e:
            logger.error(f"Order submission failed: {e}")
            order.status = OrderStatus.REJECTED
            order.metadata['reject_reason'] = str(e)
            return order

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel order at Schwab."""
        if order_id not in self._orders:
            return False

        order = self._orders[order_id]
        schwab_id = order.metadata.get('schwab_order_id')

        if not schwab_id:
            return False

        try:
            response = self._client.cancel_order(
                self.account_id,
                schwab_id
            )
            if response.status_code == 200:
                order.status = OrderStatus.CANCELLED
                return True
            return False
        except Exception as e:
            logger.error(f"Cancel failed: {e}")
            return False

    async def modify_order(self, order_id: str, **kwargs) -> Order:
        """Modify order at Schwab (cancel and replace)."""
        # Schwab doesn't support modify - cancel and resubmit
        await self.cancel_order(order_id)

        old_order = self._orders[order_id]
        new_order = Order(
            order_id=str(uuid.uuid4()),
            symbol=old_order.symbol,
            side=old_order.side,
            order_type=old_order.order_type,
            quantity=kwargs.get('quantity', old_order.quantity),
            price=kwargs.get('price', old_order.price),
            stop_price=kwargs.get('stop_price', old_order.stop_price),
            time_in_force=old_order.time_in_force
        )

        return await self.submit_order(new_order)

    async def get_order_status(self, order_id: str) -> Order:
        """Get order status from Schwab."""
        if order_id not in self._orders:
            raise ValueError(f"Order {order_id} not found")

        order = self._orders[order_id]
        schwab_id = order.metadata.get('schwab_order_id')

        if schwab_id:
            try:
                response = self._client.get_order(self.account_id, schwab_id)
                if response.status_code == 200:
                    schwab_order = response.json()
                    order = self._parse_schwab_order(schwab_order, order)
            except Exception as e:
                logger.error(f"Failed to get order status: {e}")

        return order

    async def get_positions(self) -> Dict[str, Dict]:
        """Get positions from Schwab."""
        try:
            response = self._client.get_account(
                self.account_id,
                fields=['positions']
            )

            positions = {}
            if response.status_code == 200:
                account_data = response.json()
                for pos in account_data.get('positions', []):
                    symbol = pos['instrument']['symbol']
                    positions[symbol] = {
                        'quantity': pos['longQuantity'] - pos['shortQuantity'],
                        'avg_price': pos['averagePrice'],
                        'market_value': pos['marketValue']
                    }

            return positions

        except Exception as e:
            logger.error(f"Failed to get positions: {e}")
            return {}

    def _build_schwab_order(self, order: Order) -> Dict:
        """Build Schwab order format."""
        # Map order type
        order_type_map = {
            OrderType.MARKET: 'MARKET',
            OrderType.LIMIT: 'LIMIT',
            OrderType.STOP: 'STOP',
            OrderType.STOP_LIMIT: 'STOP_LIMIT'
        }

        # Map time in force
        tif_map = {
            TimeInForce.DAY: 'DAY',
            TimeInForce.GTC: 'GOOD_TILL_CANCEL',
            TimeInForce.IOC: 'IMMEDIATE_OR_CANCEL',
            TimeInForce.FOK: 'FILL_OR_KILL'
        }

        schwab_order = {
            'orderType': order_type_map.get(order.order_type, 'MARKET'),
            'session': 'NORMAL',
            'duration': tif_map.get(order.time_in_force, 'DAY'),
            'orderStrategyType': 'SINGLE',
            'orderLegCollection': [{
                'orderLegType': 'FUTURE',
                'instruction': 'BUY' if order.side == OrderSide.BUY else 'SELL',
                'quantity': order.quantity,
                'instrument': {
                    'assetType': 'FUTURE',
                    'symbol': order.symbol
                }
            }]
        }

        if order.price:
            schwab_order['price'] = order.price

        if order.stop_price:
            schwab_order['stopPrice'] = order.stop_price

        return schwab_order

    def _parse_schwab_order(self, schwab_order: Dict, order: Order) -> Order:
        """Parse Schwab order response into our Order format."""
        status_map = {
            'PENDING_ACTIVATION': OrderStatus.PENDING,
            'QUEUED': OrderStatus.SUBMITTED,
            'ACCEPTED': OrderStatus.SUBMITTED,
            'WORKING': OrderStatus.SUBMITTED,
            'PENDING_CANCEL': OrderStatus.SUBMITTED,
            'FILLED': OrderStatus.FILLED,
            'CANCELED': OrderStatus.CANCELLED,
            'REJECTED': OrderStatus.REJECTED,
            'EXPIRED': OrderStatus.EXPIRED
        }

        order.status = status_map.get(schwab_order.get('status'), order.status)
        order.filled_quantity = schwab_order.get('filledQuantity', 0)

        if order.filled_quantity > 0:
            executions = schwab_order.get('orderActivityCollection', [])
            if executions:
                total_value = sum(
                    ex.get('executionLegs', [{}])[0].get('price', 0) *
                    ex.get('quantity', 0)
                    for ex in executions
                )
                order.avg_fill_price = total_value / order.filled_quantity

        return order


class ExecutionEngine:
    """
    Main execution engine coordinating order flow.

    Provides unified interface for both backtesting and live trading.
    """

    def __init__(
        self,
        handler: ExecutionHandler,
        risk_check_callback: Optional[Callable] = None
    ):
        self.handler = handler
        self.risk_check_callback = risk_check_callback

        self._pending_orders: Dict[str, Order] = {}
        self._order_history: List[Order] = []
        self._fill_history: List[Fill] = []
        self._execution_reports: List[ExecutionReport] = []

    async def submit_order(
        self,
        symbol: str,
        side: OrderSide,
        quantity: int,
        order_type: OrderType = OrderType.MARKET,
        price: Optional[float] = None,
        stop_price: Optional[float] = None,
        time_in_force: TimeInForce = TimeInForce.DAY,
        metadata: Optional[Dict] = None
    ) -> Order:
        """
        Submit an order through the execution handler.

        Args:
            symbol: Futures symbol
            side: Buy or Sell
            quantity: Number of contracts
            order_type: Order type
            price: Limit price (for limit orders)
            stop_price: Stop price (for stop orders)
            time_in_force: Order duration
            metadata: Additional order metadata

        Returns:
            Order with status
        """
        # Create order
        order = Order(
            order_id=str(uuid.uuid4()),
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            metadata=metadata or {}
        )

        # Risk check
        if self.risk_check_callback:
            allowed, reason = self.risk_check_callback(order)
            if not allowed:
                order.status = OrderStatus.REJECTED
                order.metadata['reject_reason'] = reason
                logger.warning(f"Order rejected by risk check: {reason}")
                return order

        # Submit to handler
        order = await self.handler.submit_order(order)

        # Track
        self._pending_orders[order.order_id] = order
        self._order_history.append(order)

        return order

    async def submit_bracket_order(
        self,
        symbol: str,
        side: OrderSide,
        quantity: int,
        entry_price: Optional[float] = None,  # None = market
        stop_loss: float = None,
        take_profit: float = None,
        entry_type: OrderType = OrderType.MARKET
    ) -> Tuple[Order, Order, Order]:
        """
        Submit a bracket order (entry + stop loss + take profit).

        Returns:
            (entry_order, stop_order, take_profit_order)
        """
        # Entry order
        entry_order = await self.submit_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type=entry_type,
            price=entry_price if entry_type == OrderType.LIMIT else None,
            metadata={'bracket': 'entry'}
        )

        # Wait for entry fill
        if entry_order.status not in [OrderStatus.FILLED, OrderStatus.PARTIAL]:
            return entry_order, None, None

        # Stop loss order
        exit_side = OrderSide.SELL if side == OrderSide.BUY else OrderSide.BUY
        stop_order = await self.submit_order(
            symbol=symbol,
            side=exit_side,
            quantity=quantity,
            order_type=OrderType.STOP,
            stop_price=stop_loss,
            metadata={'bracket': 'stop_loss', 'parent_order_id': entry_order.order_id}
        )

        # Take profit order
        tp_order = await self.submit_order(
            symbol=symbol,
            side=exit_side,
            quantity=quantity,
            order_type=OrderType.LIMIT,
            price=take_profit,
            metadata={'bracket': 'take_profit', 'parent_order_id': entry_order.order_id}
        )

        # Link orders
        entry_order.child_order_ids = [stop_order.order_id, tp_order.order_id]

        return entry_order, stop_order, tp_order

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an order."""
        success = await self.handler.cancel_order(order_id)

        if success and order_id in self._pending_orders:
            del self._pending_orders[order_id]

        return success

    async def cancel_all_orders(self, symbol: Optional[str] = None) -> int:
        """Cancel all pending orders, optionally filtered by symbol."""
        cancelled = 0

        orders_to_cancel = list(self._pending_orders.values())
        if symbol:
            orders_to_cancel = [o for o in orders_to_cancel if o.symbol == symbol]

        for order in orders_to_cancel:
            if await self.cancel_order(order.order_id):
                cancelled += 1

        return cancelled

    async def flatten_position(self, symbol: str) -> Optional[Order]:
        """Close all positions in a symbol."""
        positions = await self.handler.get_positions()

        if symbol not in positions or positions[symbol]['quantity'] == 0:
            return None

        qty = positions[symbol]['quantity']
        side = OrderSide.SELL if qty > 0 else OrderSide.BUY

        return await self.submit_order(
            symbol=symbol,
            side=side,
            quantity=abs(qty),
            order_type=OrderType.MARKET,
            metadata={'action': 'flatten'}
        )

    async def flatten_all(self) -> List[Order]:
        """Close all positions."""
        positions = await self.handler.get_positions()
        orders = []

        for symbol, pos in positions.items():
            if pos['quantity'] != 0:
                order = await self.flatten_position(symbol)
                if order:
                    orders.append(order)

        return orders

    async def get_positions(self) -> Dict[str, Dict]:
        """Get current positions from handler."""
        return await self.handler.get_positions()

    async def get_order(self, order_id: str) -> Order:
        """Get order by ID."""
        return await self.handler.get_order_status(order_id)

    def get_pending_orders(self) -> List[Order]:
        """Get all pending orders."""
        return [o for o in self._pending_orders.values() if o.is_active()]

    def get_order_history(self) -> List[Order]:
        """Get full order history."""
        return self._order_history.copy()

    def generate_execution_report(
        self,
        order: Order,
        market_data: Optional[pd.DataFrame] = None
    ) -> ExecutionReport:
        """Generate execution quality report for an order."""
        # Calculate VWAP during execution period if we have data
        vwap = order.avg_fill_price
        if market_data is not None and order.created_at and order.filled_at:
            mask = (market_data.index >= order.created_at) & \
                   (market_data.index <= order.filled_at)
            if mask.any():
                period_data = market_data[mask]
                if 'volume' in period_data.columns:
                    vwap = (period_data['close'] * period_data['volume']).sum() / \
                           period_data['volume'].sum()

        # Calculate slippage
        if order.order_type == OrderType.MARKET:
            expected_price = vwap
        else:
            expected_price = order.price or vwap

        slippage_bps = abs(order.avg_fill_price - expected_price) / expected_price * 10000 \
            if expected_price > 0 else 0

        # Execution time
        exec_time_ms = 0
        if order.created_at and order.filled_at:
            exec_time_ms = (order.filled_at - order.created_at).total_seconds() * 1000

        report = ExecutionReport(
            order_id=order.order_id,
            symbol=order.symbol,
            side=order.side,
            requested_quantity=order.quantity,
            filled_quantity=order.filled_quantity,
            avg_fill_price=order.avg_fill_price,
            vwap=vwap,
            slippage_bps=slippage_bps,
            market_impact_bps=slippage_bps * 0.5,  # Estimate
            total_commission=order.commission,
            execution_time_ms=exec_time_ms,
            fill_rate=order.filled_quantity / order.quantity if order.quantity > 0 else 0
        )

        self._execution_reports.append(report)
        return report

    def get_execution_stats(self) -> Dict[str, float]:
        """Get aggregate execution statistics."""
        if not self._execution_reports:
            return {}

        reports = self._execution_reports
        return {
            'total_orders': len(reports),
            'avg_slippage_bps': np.mean([r.slippage_bps for r in reports]),
            'max_slippage_bps': max(r.slippage_bps for r in reports),
            'avg_fill_rate': np.mean([r.fill_rate for r in reports]),
            'total_commission': sum(r.total_commission for r in reports),
            'avg_exec_time_ms': np.mean([r.execution_time_ms for r in reports])
        }
