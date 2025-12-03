#!/usr/bin/env python3
"""
ThetaData Client - Live Market Data Streaming

Connects to local Theta Terminal for real-time stocks and options data.
Provides trades, quotes, Greeks, and IV via WebSocket.

Prerequisites:
    1. ThetaData subscription (Standard or Pro tier for streaming)
    2. Theta Terminal running locally (Java-based, auto-installed on Windows)
    3. pip install thetadata websockets

Architecture:
    Theta Terminal runs on localhost:25520, connects to ThetaData servers.
    This client connects to the terminal's WebSocket endpoint.

Usage:
    client = ThetaDataClient()
    await client.connect()

    # Stock streaming
    await client.subscribe_stock_trades(['SPY', 'QQQ'])
    await client.subscribe_stock_quotes(['SPY', 'QQQ'])

    # Options streaming
    await client.subscribe_option_trades('SPY', date(2024, 12, 20), 500.0, 'C')
    await client.subscribe_option_quotes('SPY', date(2024, 12, 20), 500.0, 'P')

    async for tick in client.stream():
        if isinstance(tick, TradeTick):
            # Process trade
        elif isinstance(tick, QuoteTick):
            # Process quote
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional, List, Dict, Any, AsyncGenerator, Callable, Union
from enum import Enum

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websockets = None
    ConnectionClosed = Exception

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# =============================================================================
# Data Classes
# =============================================================================

class TickType(Enum):
    """Type of market data tick."""
    TRADE = 'TRADE'
    QUOTE = 'QUOTE'


class SecurityType(Enum):
    """Type of security."""
    STOCK = 'STOCK'
    OPTION = 'OPTION'


@dataclass
class TradeTick:
    """
    Represents a single trade execution.

    Attributes:
        symbol: Ticker symbol (e.g., 'SPY' or 'SPY241220C00500000' for options)
        price: Trade execution price
        size: Number of shares/contracts traded
        timestamp: Trade timestamp
        exchange: Exchange ID where trade occurred
        condition: Trade condition code
        sequence: Sequence number for ordering
        security_type: STOCK or OPTION
        root: Underlying symbol for options
        expiration: Option expiration date (options only)
        strike: Option strike price (options only)
        right: 'C' for call, 'P' for put (options only)
    """
    symbol: str
    price: float
    size: int
    timestamp: datetime
    exchange: int = 0
    condition: int = 0
    sequence: int = 0
    security_type: SecurityType = SecurityType.STOCK

    # Options-specific fields
    root: Optional[str] = None
    expiration: Optional[date] = None
    strike: Optional[float] = None
    right: Optional[str] = None  # 'C' or 'P'

    @property
    def is_option(self) -> bool:
        return self.security_type == SecurityType.OPTION


@dataclass
class QuoteTick:
    """
    Represents a bid/ask quote update.

    Attributes:
        symbol: Ticker symbol
        bid_price: Best bid price
        ask_price: Best ask price
        bid_size: Size at bid
        ask_size: Size at ask
        timestamp: Quote timestamp
        bid_exchange: Exchange ID for bid
        ask_exchange: Exchange ID for ask
        mid_price: Calculated mid price
        spread: Bid-ask spread
        security_type: STOCK or OPTION
    """
    symbol: str
    bid_price: float
    ask_price: float
    bid_size: int
    ask_size: int
    timestamp: datetime
    bid_exchange: int = 0
    ask_exchange: int = 0
    bid_condition: int = 0
    ask_condition: int = 0
    security_type: SecurityType = SecurityType.STOCK

    # Options-specific fields
    root: Optional[str] = None
    expiration: Optional[date] = None
    strike: Optional[float] = None
    right: Optional[str] = None

    @property
    def mid_price(self) -> float:
        """Calculate mid price from bid/ask."""
        if self.bid_price > 0 and self.ask_price > 0:
            return (self.bid_price + self.ask_price) / 2
        return self.ask_price if self.ask_price > 0 else self.bid_price

    @property
    def spread(self) -> float:
        """Calculate bid-ask spread."""
        if self.bid_price > 0 and self.ask_price > 0:
            return self.ask_price - self.bid_price
        return 0.0

    @property
    def spread_pct(self) -> float:
        """Calculate spread as percentage of mid."""
        mid = self.mid_price
        if mid > 0:
            return (self.spread / mid) * 100
        return 0.0

    @property
    def is_option(self) -> bool:
        return self.security_type == SecurityType.OPTION


@dataclass
class OptionGreeks:
    """
    Greeks and IV for an option contract.

    Populated when streaming option quotes with Greeks enabled.
    """
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    rho: float = 0.0
    implied_volatility: float = 0.0


# Type alias for any tick
Tick = Union[TradeTick, QuoteTick]


# =============================================================================
# ThetaData Client
# =============================================================================

class ThetaDataClient:
    """
    Async client for ThetaData live market data streaming.

    Connects to locally-running Theta Terminal via WebSocket.
    Supports stocks and options trades/quotes streaming.
    """

    # Theta Terminal default endpoint
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 25520
    WEBSOCKET_PATH = "/v1/events"

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        auto_reconnect: bool = True,
        reconnect_delay: float = 5.0,
        on_trade: Optional[Callable[[TradeTick], None]] = None,
        on_quote: Optional[Callable[[QuoteTick], None]] = None,
        on_disconnect: Optional[Callable[[], None]] = None,
        on_reconnect: Optional[Callable[[], None]] = None,
    ):
        """
        Initialize ThetaData client.

        Args:
            host: Theta Terminal host (default localhost)
            port: Theta Terminal port (default 25520)
            auto_reconnect: Automatically reconnect on disconnect
            reconnect_delay: Seconds to wait before reconnect attempt
            on_trade: Callback for trade ticks
            on_quote: Callback for quote ticks
            on_disconnect: Callback when disconnected
            on_reconnect: Callback when reconnected
        """
        self.host = host
        self.port = port
        self.auto_reconnect = auto_reconnect
        self.reconnect_delay = reconnect_delay

        # Callbacks
        self.on_trade = on_trade
        self.on_quote = on_quote
        self.on_disconnect = on_disconnect
        self.on_reconnect = on_reconnect

        # Connection state
        self._ws: Optional[Any] = None
        self._connected = False
        self._running = False
        self._request_id = 0

        # Subscription tracking
        self._subscriptions: Dict[int, Dict[str, Any]] = {}

        # Message queue for async iteration
        self._tick_queue: asyncio.Queue = asyncio.Queue()

        logger.info(f"ThetaDataClient initialized (terminal: {host}:{port})")

    @property
    def ws_url(self) -> str:
        """WebSocket URL for Theta Terminal."""
        return f"ws://{self.host}:{self.port}{self.WEBSOCKET_PATH}"

    @property
    def is_connected(self) -> bool:
        """Check if connected to Theta Terminal."""
        return self._connected and self._ws is not None

    def _next_request_id(self) -> int:
        """Generate next request ID."""
        self._request_id += 1
        return self._request_id

    async def connect(self) -> bool:
        """
        Connect to Theta Terminal WebSocket.

        Returns:
            True if connected successfully, False otherwise.
        """
        if websockets is None:
            logger.error("websockets package not installed")
            return False

        try:
            logger.info(f"Connecting to Theta Terminal at {self.ws_url}...")
            self._ws = await websockets.connect(self.ws_url)
            self._connected = True
            self._running = True
            logger.info("Connected to Theta Terminal")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to Theta Terminal: {e}")
            logger.error("Make sure Theta Terminal is running!")
            return False

    async def disconnect(self) -> None:
        """Disconnect from Theta Terminal."""
        self._running = False
        self._connected = False

        if self._ws:
            await self._ws.close()
            self._ws = None

        logger.info("Disconnected from Theta Terminal")

    async def _send_request(self, request: Dict[str, Any]) -> int:
        """Send a request to Theta Terminal."""
        if not self._ws:
            raise ConnectionError("Not connected to Theta Terminal")

        request_id = self._next_request_id()
        request['id'] = request_id

        await self._ws.send(json.dumps(request))
        return request_id

    # -------------------------------------------------------------------------
    # Stock Subscriptions
    # -------------------------------------------------------------------------

    async def subscribe_stock_trades(self, symbols: List[str]) -> List[int]:
        """
        Subscribe to stock trade stream for multiple symbols.

        Args:
            symbols: List of stock symbols (e.g., ['SPY', 'QQQ'])

        Returns:
            List of request IDs for tracking subscriptions
        """
        request_ids = []

        for symbol in symbols:
            request = {
                'msg_type': 'STREAM',
                'sec_type': 'STOCK',
                'req_type': 'TRADE',
                'add': True,
                'contract': {
                    'root': symbol.upper()
                }
            }

            req_id = await self._send_request(request)
            self._subscriptions[req_id] = {
                'type': 'stock_trade',
                'symbol': symbol.upper()
            }
            request_ids.append(req_id)
            logger.info(f"Subscribed to {symbol} trades (id={req_id})")

        return request_ids

    async def subscribe_stock_quotes(self, symbols: List[str]) -> List[int]:
        """
        Subscribe to stock quote stream for multiple symbols.

        Args:
            symbols: List of stock symbols

        Returns:
            List of request IDs
        """
        request_ids = []

        for symbol in symbols:
            request = {
                'msg_type': 'STREAM',
                'sec_type': 'STOCK',
                'req_type': 'QUOTE',
                'add': True,
                'contract': {
                    'root': symbol.upper()
                }
            }

            req_id = await self._send_request(request)
            self._subscriptions[req_id] = {
                'type': 'stock_quote',
                'symbol': symbol.upper()
            }
            request_ids.append(req_id)
            logger.info(f"Subscribed to {symbol} quotes (id={req_id})")

        return request_ids

    # -------------------------------------------------------------------------
    # Option Subscriptions
    # -------------------------------------------------------------------------

    async def subscribe_option_trades(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str  # 'C' or 'P'
    ) -> int:
        """
        Subscribe to option trade stream for a specific contract.

        Args:
            root: Underlying symbol (e.g., 'SPY')
            expiration: Option expiration date
            strike: Strike price
            right: 'C' for call, 'P' for put

        Returns:
            Request ID
        """
        exp_int = int(expiration.strftime('%Y%m%d'))

        request = {
            'msg_type': 'STREAM',
            'sec_type': 'OPTION',
            'req_type': 'TRADE',
            'add': True,
            'contract': {
                'root': root.upper(),
                'expiration': exp_int,
                'strike': strike,
                'right': right.upper()
            }
        }

        req_id = await self._send_request(request)
        self._subscriptions[req_id] = {
            'type': 'option_trade',
            'root': root.upper(),
            'expiration': expiration,
            'strike': strike,
            'right': right.upper()
        }

        occ_symbol = f"{root}{expiration.strftime('%y%m%d')}{right}{int(strike*1000):08d}"
        logger.info(f"Subscribed to {occ_symbol} trades (id={req_id})")
        return req_id

    async def subscribe_option_quotes(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str
    ) -> int:
        """
        Subscribe to option quote stream for a specific contract.

        Args:
            root: Underlying symbol
            expiration: Option expiration date
            strike: Strike price
            right: 'C' or 'P'

        Returns:
            Request ID
        """
        exp_int = int(expiration.strftime('%Y%m%d'))

        request = {
            'msg_type': 'STREAM',
            'sec_type': 'OPTION',
            'req_type': 'QUOTE',
            'add': True,
            'contract': {
                'root': root.upper(),
                'expiration': exp_int,
                'strike': strike,
                'right': right.upper()
            }
        }

        req_id = await self._send_request(request)
        self._subscriptions[req_id] = {
            'type': 'option_quote',
            'root': root.upper(),
            'expiration': expiration,
            'strike': strike,
            'right': right.upper()
        }

        occ_symbol = f"{root}{expiration.strftime('%y%m%d')}{right}{int(strike*1000):08d}"
        logger.info(f"Subscribed to {occ_symbol} quotes (id={req_id})")
        return req_id

    async def subscribe_all_option_trades(self) -> int:
        """
        Subscribe to ALL option trades (PRO tier only).

        Returns:
            Request ID
        """
        request = {
            'msg_type': 'STREAM',
            'sec_type': 'OPTION',
            'req_type': 'FULL_TRADE',
            'add': True
        }

        req_id = await self._send_request(request)
        self._subscriptions[req_id] = {'type': 'all_option_trades'}
        logger.info(f"Subscribed to ALL option trades (id={req_id})")
        return req_id

    # -------------------------------------------------------------------------
    # Unsubscribe
    # -------------------------------------------------------------------------

    async def unsubscribe(self, request_id: int) -> bool:
        """
        Unsubscribe from a specific stream.

        Args:
            request_id: The request ID returned from subscribe

        Returns:
            True if unsubscribe sent
        """
        if request_id not in self._subscriptions:
            logger.warning(f"Unknown subscription id={request_id}")
            return False

        sub_info = self._subscriptions[request_id]

        # Build unsubscribe request based on subscription type
        request = {
            'msg_type': 'STREAM',
            'add': False,
            'id': request_id
        }

        if sub_info['type'].startswith('stock'):
            request['sec_type'] = 'STOCK'
            request['req_type'] = 'TRADE' if 'trade' in sub_info['type'] else 'QUOTE'
            request['contract'] = {'root': sub_info['symbol']}

        elif sub_info['type'].startswith('option'):
            request['sec_type'] = 'OPTION'
            request['req_type'] = 'TRADE' if 'trade' in sub_info['type'] else 'QUOTE'
            request['contract'] = {
                'root': sub_info['root'],
                'expiration': int(sub_info['expiration'].strftime('%Y%m%d')),
                'strike': sub_info['strike'],
                'right': sub_info['right']
            }

        await self._ws.send(json.dumps(request))
        del self._subscriptions[request_id]
        logger.info(f"Unsubscribed from stream id={request_id}")
        return True

    async def unsubscribe_all(self) -> None:
        """Unsubscribe from all active streams."""
        for req_id in list(self._subscriptions.keys()):
            await self.unsubscribe(req_id)

    # -------------------------------------------------------------------------
    # Message Processing
    # -------------------------------------------------------------------------

    def _parse_timestamp(self, ms_of_day: int, date_int: int) -> datetime:
        """Convert ThetaData timestamp format to datetime."""
        year = date_int // 10000
        month = (date_int % 10000) // 100
        day = date_int % 100

        hours = ms_of_day // 3600000
        minutes = (ms_of_day % 3600000) // 60000
        seconds = (ms_of_day % 60000) // 1000
        ms = ms_of_day % 1000

        return datetime(year, month, day, hours, minutes, seconds, ms * 1000)

    def _parse_trade(self, msg: Dict[str, Any]) -> Optional[TradeTick]:
        """Parse a trade message into TradeTick."""
        try:
            contract = msg.get('contract', {})
            trade = msg.get('trade', {})

            sec_type = SecurityType.OPTION if contract.get('security_type') == 'OPTION' else SecurityType.STOCK

            # Build symbol
            root = contract.get('root', '')
            if sec_type == SecurityType.OPTION:
                exp = contract.get('expiration', 0)
                strike = contract.get('strike', 0)
                right = contract.get('right', 'C')
                symbol = f"{root}{str(exp)[2:]}{right}{int(strike*1000):08d}"
            else:
                symbol = root

            return TradeTick(
                symbol=symbol,
                price=trade.get('price', 0.0),
                size=trade.get('size', 0),
                timestamp=self._parse_timestamp(
                    trade.get('ms_of_day', 0),
                    trade.get('date', 0)
                ),
                exchange=trade.get('exchange', 0),
                condition=trade.get('condition', 0),
                sequence=trade.get('sequence', 0),
                security_type=sec_type,
                root=root if sec_type == SecurityType.OPTION else None,
                expiration=date(exp // 10000, (exp % 10000) // 100, exp % 100) if sec_type == SecurityType.OPTION else None,
                strike=strike if sec_type == SecurityType.OPTION else None,
                right=right if sec_type == SecurityType.OPTION else None
            )

        except Exception as e:
            logger.error(f"Error parsing trade: {e}")
            return None

    def _parse_quote(self, msg: Dict[str, Any]) -> Optional[QuoteTick]:
        """Parse a quote message into QuoteTick."""
        try:
            contract = msg.get('contract', {})
            quote = msg.get('quote', {})

            sec_type = SecurityType.OPTION if contract.get('security_type') == 'OPTION' else SecurityType.STOCK

            root = contract.get('root', '')
            if sec_type == SecurityType.OPTION:
                exp = contract.get('expiration', 0)
                strike = contract.get('strike', 0)
                right = contract.get('right', 'C')
                symbol = f"{root}{str(exp)[2:]}{right}{int(strike*1000):08d}"
            else:
                symbol = root

            return QuoteTick(
                symbol=symbol,
                bid_price=quote.get('bid', 0.0),
                ask_price=quote.get('ask', 0.0),
                bid_size=quote.get('bid_size', 0),
                ask_size=quote.get('ask_size', 0),
                timestamp=self._parse_timestamp(
                    quote.get('ms_of_day', 0),
                    quote.get('date', 0)
                ),
                bid_exchange=quote.get('bid_exchange', 0),
                ask_exchange=quote.get('ask_exchange', 0),
                bid_condition=quote.get('bid_condition', 0),
                ask_condition=quote.get('ask_condition', 0),
                security_type=sec_type,
                root=root if sec_type == SecurityType.OPTION else None,
                expiration=date(exp // 10000, (exp % 10000) // 100, exp % 100) if sec_type == SecurityType.OPTION else None,
                strike=strike if sec_type == SecurityType.OPTION else None,
                right=right if sec_type == SecurityType.OPTION else None
            )

        except Exception as e:
            logger.error(f"Error parsing quote: {e}")
            return None

    async def _process_message(self, raw_msg: str) -> Optional[Tick]:
        """Process a raw WebSocket message."""
        try:
            msg = json.loads(raw_msg)

            # Check header for message type
            header = msg.get('header', {})
            msg_type = header.get('type', '')
            status = header.get('status', '')

            # Handle status messages
            if status == 'DISCONNECTED':
                logger.warning("Theta Terminal disconnected")
                if self.on_disconnect:
                    self.on_disconnect()
                return None

            elif status == 'CONNECTED':
                logger.info(f"Stream connected: {msg_type}")
                return None

            elif status == 'RECONNECTED':
                logger.info("Theta Terminal reconnected")
                if self.on_reconnect:
                    self.on_reconnect()
                return None

            # Parse data messages
            if msg_type == 'TRADE':
                tick = self._parse_trade(msg)
                if tick and self.on_trade:
                    self.on_trade(tick)
                return tick

            elif msg_type == 'QUOTE':
                tick = self._parse_quote(msg)
                if tick and self.on_quote:
                    self.on_quote(tick)
                return tick

            return None

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            return None

    # -------------------------------------------------------------------------
    # Streaming
    # -------------------------------------------------------------------------

    async def stream(self) -> AsyncGenerator[Tick, None]:
        """
        Async generator that yields ticks as they arrive.

        Usage:
            async for tick in client.stream():
                process(tick)
        """
        if not self._ws:
            raise ConnectionError("Not connected. Call connect() first.")

        while self._running:
            try:
                raw_msg = await self._ws.recv()
                tick = await self._process_message(raw_msg)
                if tick:
                    yield tick

            except ConnectionClosed:
                logger.warning("WebSocket connection closed")
                self._connected = False

                if self.on_disconnect:
                    self.on_disconnect()

                if self.auto_reconnect and self._running:
                    logger.info(f"Reconnecting in {self.reconnect_delay}s...")
                    await asyncio.sleep(self.reconnect_delay)

                    if await self.connect():
                        # Resubscribe to all streams
                        await self._resubscribe_all()
                        if self.on_reconnect:
                            self.on_reconnect()
                    else:
                        logger.error("Reconnection failed")
                        break
                else:
                    break

            except Exception as e:
                logger.error(f"Stream error: {e}")
                await asyncio.sleep(1)

    async def _resubscribe_all(self) -> None:
        """Resubscribe to all previous subscriptions after reconnect."""
        # Store current subscriptions
        old_subs = dict(self._subscriptions)
        self._subscriptions.clear()

        for sub_info in old_subs.values():
            sub_type = sub_info['type']

            if sub_type == 'stock_trade':
                await self.subscribe_stock_trades([sub_info['symbol']])
            elif sub_type == 'stock_quote':
                await self.subscribe_stock_quotes([sub_info['symbol']])
            elif sub_type == 'option_trade':
                await self.subscribe_option_trades(
                    sub_info['root'],
                    sub_info['expiration'],
                    sub_info['strike'],
                    sub_info['right']
                )
            elif sub_type == 'option_quote':
                await self.subscribe_option_quotes(
                    sub_info['root'],
                    sub_info['expiration'],
                    sub_info['strike'],
                    sub_info['right']
                )
            elif sub_type == 'all_option_trades':
                await self.subscribe_all_option_trades()

        logger.info(f"Resubscribed to {len(self._subscriptions)} streams")

    async def run_forever(self) -> None:
        """
        Run the client indefinitely, processing all ticks.

        Useful when using callbacks instead of async iteration.
        """
        async for _ in self.stream():
            pass  # Callbacks handle the ticks


# =============================================================================
# Convenience Functions
# =============================================================================

async def create_stock_streamer(
    symbols: List[str],
    on_trade: Optional[Callable[[TradeTick], None]] = None,
    on_quote: Optional[Callable[[QuoteTick], None]] = None
) -> ThetaDataClient:
    """
    Create and connect a client for stock streaming.

    Args:
        symbols: Stock symbols to stream
        on_trade: Trade callback
        on_quote: Quote callback

    Returns:
        Connected ThetaDataClient
    """
    client = ThetaDataClient(on_trade=on_trade, on_quote=on_quote)

    if not await client.connect():
        raise ConnectionError("Failed to connect to Theta Terminal")

    await client.subscribe_stock_trades(symbols)
    await client.subscribe_stock_quotes(symbols)

    return client


async def create_option_streamer(
    contracts: List[Dict[str, Any]],
    on_trade: Optional[Callable[[TradeTick], None]] = None,
    on_quote: Optional[Callable[[QuoteTick], None]] = None
) -> ThetaDataClient:
    """
    Create and connect a client for option streaming.

    Args:
        contracts: List of contract specs, each with keys:
            root, expiration (date), strike (float), right ('C'/'P')
        on_trade: Trade callback
        on_quote: Quote callback

    Returns:
        Connected ThetaDataClient
    """
    client = ThetaDataClient(on_trade=on_trade, on_quote=on_quote)

    if not await client.connect():
        raise ConnectionError("Failed to connect to Theta Terminal")

    for contract in contracts:
        await client.subscribe_option_trades(
            contract['root'],
            contract['expiration'],
            contract['strike'],
            contract['right']
        )
        await client.subscribe_option_quotes(
            contract['root'],
            contract['expiration'],
            contract['strike'],
            contract['right']
        )

    return client


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    async def main():
        # Example: Stream SPY and QQQ stocks
        def handle_trade(tick: TradeTick):
            print(f"TRADE: {tick.symbol} @ ${tick.price:.2f} x {tick.size}")

        def handle_quote(tick: QuoteTick):
            print(f"QUOTE: {tick.symbol} ${tick.bid_price:.2f} x {tick.bid_size} / ${tick.ask_price:.2f} x {tick.ask_size}")

        client = ThetaDataClient(
            on_trade=handle_trade,
            on_quote=handle_quote
        )

        if await client.connect():
            await client.subscribe_stock_trades(['SPY', 'QQQ'])
            await client.subscribe_stock_quotes(['SPY', 'QQQ'])

            # Run for 60 seconds
            try:
                await asyncio.wait_for(client.run_forever(), timeout=60)
            except asyncio.TimeoutError:
                pass

            await client.disconnect()
        else:
            print("Failed to connect. Is Theta Terminal running?")

    asyncio.run(main())
