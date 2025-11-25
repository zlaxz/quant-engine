#!/usr/bin/env python3
"""
Massive Socket - Polygon.io WebSocket Client for Real-Time Market Data

Connects to Polygon.io WebSocket (via Massive.com API key) and streams
live trades and quotes into an asyncio Queue for the Shadow Trader.

Usage:
    socket = MassiveSocket(api_key="your_key", symbols=["SPY", "QQQ"])
    await socket.connect()

    async for tick in socket.stream():
        print(tick)

Channels:
    - T.* (Trades): Real-time trade executions
    - Q.* (Quotes): NBBO quotes for spread analysis
    - A.* (Aggregates): 1-second OHLCV bars

Environment:
    MASSIVE_KEY or POLYGON_API_KEY: Your API key
"""

import asyncio
import json
import logging
import os
import random
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import AsyncIterator, Callable, Dict, List, Optional, Set

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================================
# Data Models
# ============================================================================

class TickType(Enum):
    TRADE = "trade"
    QUOTE = "quote"
    AGGREGATE = "aggregate"


@dataclass
class TradeTick:
    """Real-time trade execution."""
    symbol: str
    price: float
    size: int
    timestamp: datetime
    exchange: str
    conditions: List[str] = field(default_factory=list)
    tick_type: TickType = TickType.TRADE

    @classmethod
    def from_polygon(cls, data: dict) -> "TradeTick":
        """Parse from Polygon WebSocket message."""
        return cls(
            symbol=data.get("sym", ""),
            price=data.get("p", 0.0),
            size=data.get("s", 0),
            timestamp=datetime.fromtimestamp(data.get("t", 0) / 1000),
            exchange=str(data.get("x", "")),
            conditions=data.get("c", []),
        )


@dataclass
class QuoteTick:
    """NBBO quote for bid/ask analysis."""
    symbol: str
    bid_price: float
    bid_size: int
    ask_price: float
    ask_size: int
    timestamp: datetime
    bid_exchange: str = ""
    ask_exchange: str = ""
    tick_type: TickType = TickType.QUOTE

    @property
    def mid_price(self) -> float:
        """Calculate mid price."""
        if self.bid_price > 0 and self.ask_price > 0:
            return (self.bid_price + self.ask_price) / 2
        return self.bid_price or self.ask_price

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
            return self.spread / mid
        return 0.0

    @classmethod
    def from_polygon(cls, data: dict) -> "QuoteTick":
        """Parse from Polygon WebSocket message."""
        return cls(
            symbol=data.get("sym", ""),
            bid_price=data.get("bp", 0.0),
            bid_size=data.get("bs", 0),
            ask_price=data.get("ap", 0.0),
            ask_size=data.get("as", 0),
            timestamp=datetime.fromtimestamp(data.get("t", 0) / 1000),
            bid_exchange=str(data.get("bx", "")),
            ask_exchange=str(data.get("ax", "")),
        )


@dataclass
class AggregateTick:
    """1-second OHLCV bar."""
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: float
    timestamp: datetime
    tick_type: TickType = TickType.AGGREGATE

    @classmethod
    def from_polygon(cls, data: dict) -> "AggregateTick":
        """Parse from Polygon WebSocket message."""
        return cls(
            symbol=data.get("sym", ""),
            open=data.get("o", 0.0),
            high=data.get("h", 0.0),
            low=data.get("l", 0.0),
            close=data.get("c", 0.0),
            volume=data.get("v", 0),
            vwap=data.get("vw", 0.0),
            timestamp=datetime.fromtimestamp(data.get("s", 0) / 1000),
        )


Tick = TradeTick | QuoteTick | AggregateTick


# ============================================================================
# WebSocket Client
# ============================================================================

class MassiveSocket:
    """
    Polygon.io WebSocket client for real-time market data.

    Streams trades and quotes into an asyncio Queue for consumption
    by the Shadow Trader.
    """

    # Polygon WebSocket endpoints
    STOCKS_WS = "wss://socket.polygon.io/stocks"
    OPTIONS_WS = "wss://socket.polygon.io/options"
    FOREX_WS = "wss://socket.polygon.io/forex"
    CRYPTO_WS = "wss://socket.polygon.io/crypto"

    def __init__(
        self,
        api_key: Optional[str] = None,
        symbols: Optional[List[str]] = None,
        feed_type: str = "stocks",
        queue_maxsize: int = 10000,
        reconnect_delay: float = 5.0,
        max_reconnect_attempts: int = 10,
    ):
        """
        Initialize the WebSocket client.

        Args:
            api_key: Polygon/Massive API key (or use MASSIVE_KEY/POLYGON_API_KEY env var)
            symbols: List of symbols to subscribe to (e.g., ["SPY", "QQQ"])
            feed_type: "stocks", "options", "forex", or "crypto"
            queue_maxsize: Maximum size of the tick queue
            reconnect_delay: Seconds to wait before reconnecting
            max_reconnect_attempts: Maximum reconnection attempts
        """
        self.api_key = api_key or os.getenv("MASSIVE_KEY") or os.getenv("POLYGON_API_KEY")
        if not self.api_key:
            raise ValueError("API key required: set MASSIVE_KEY or POLYGON_API_KEY")

        self.symbols = set(symbols or [])
        self.feed_type = feed_type
        self.queue_maxsize = queue_maxsize
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_attempts = max_reconnect_attempts

        # Select WebSocket endpoint
        self.ws_url = {
            "stocks": self.STOCKS_WS,
            "options": self.OPTIONS_WS,
            "forex": self.FOREX_WS,
            "crypto": self.CRYPTO_WS,
        }.get(feed_type, self.STOCKS_WS)

        # Internal state
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._queue: asyncio.Queue[Tick] = asyncio.Queue(maxsize=queue_maxsize)
        self._running = False
        self._reconnect_count = 0
        self._subscribed_channels: Set[str] = set()
        self._callbacks: Dict[str, List[Callable[[Tick], None]]] = {}
        self._last_quote: Dict[str, QuoteTick] = {}  # Latest quote per symbol

    @property
    def is_connected(self) -> bool:
        """Check if WebSocket is connected."""
        return self._ws is not None and self._ws.open

    def get_last_quote(self, symbol: str) -> Optional[QuoteTick]:
        """Get the most recent quote for a symbol."""
        return self._last_quote.get(symbol)

    def get_queue(self) -> asyncio.Queue[Tick]:
        """Get the tick queue for external consumption."""
        return self._queue

    async def connect(self) -> None:
        """Establish WebSocket connection and authenticate."""
        logger.info(f"Connecting to {self.ws_url}...")

        try:
            self._ws = await websockets.connect(
                self.ws_url,
                ping_interval=30,
                ping_timeout=10,
                close_timeout=5,
            )
            self._running = True
            self._reconnect_count = 0

            # Wait for connection confirmation
            response = await self._ws.recv()
            data = json.loads(response)
            if data[0].get("status") == "connected":
                logger.info("WebSocket connected, authenticating...")
            else:
                logger.warning(f"Unexpected connection response: {data}")

            # Authenticate
            await self._authenticate()

            # Subscribe to symbols
            if self.symbols:
                await self.subscribe(list(self.symbols))

            logger.info("MassiveSocket ready for streaming")

        except Exception as e:
            logger.error(f"Connection failed: {e}")
            raise

    async def _authenticate(self) -> None:
        """Send authentication message."""
        auth_msg = {"action": "auth", "params": self.api_key}
        await self._ws.send(json.dumps(auth_msg))

        response = await self._ws.recv()
        data = json.loads(response)

        if data[0].get("status") == "auth_success":
            logger.info("Authentication successful")
        else:
            raise ConnectionError(f"Authentication failed: {data}")

    async def subscribe(
        self,
        symbols: List[str],
        trades: bool = True,
        quotes: bool = True,
        aggregates: bool = False,
    ) -> None:
        """
        Subscribe to market data channels for symbols.

        Args:
            symbols: List of symbols to subscribe
            trades: Subscribe to trade channel (T.*)
            quotes: Subscribe to quote channel (Q.*)
            aggregates: Subscribe to 1-second aggregate channel (A.*)
        """
        if not self.is_connected:
            raise ConnectionError("WebSocket not connected")

        channels = []
        for symbol in symbols:
            self.symbols.add(symbol)
            if trades:
                channels.append(f"T.{symbol}")
            if quotes:
                channels.append(f"Q.{symbol}")
            if aggregates:
                channels.append(f"A.{symbol}")

        if channels:
            sub_msg = {"action": "subscribe", "params": ",".join(channels)}
            await self._ws.send(json.dumps(sub_msg))
            self._subscribed_channels.update(channels)
            logger.info(f"Subscribed to: {channels}")

    async def unsubscribe(self, symbols: List[str]) -> None:
        """Unsubscribe from symbols."""
        if not self.is_connected:
            return

        channels = []
        for symbol in symbols:
            self.symbols.discard(symbol)
            channels.extend([f"T.{symbol}", f"Q.{symbol}", f"A.{symbol}"])

        if channels:
            unsub_msg = {"action": "unsubscribe", "params": ",".join(channels)}
            await self._ws.send(json.dumps(unsub_msg))
            self._subscribed_channels -= set(channels)
            logger.info(f"Unsubscribed from: {symbols}")

    async def _process_message(self, message: str) -> None:
        """Parse and enqueue incoming WebSocket message."""
        try:
            data_list = json.loads(message)

            for data in data_list:
                ev = data.get("ev")
                tick: Optional[Tick] = None

                if ev == "T":  # Trade
                    tick = TradeTick.from_polygon(data)
                elif ev == "Q":  # Quote
                    tick = QuoteTick.from_polygon(data)
                    # Cache latest quote for spread analysis
                    self._last_quote[tick.symbol] = tick
                elif ev == "A":  # Aggregate
                    tick = AggregateTick.from_polygon(data)
                elif ev == "status":
                    logger.debug(f"Status message: {data.get('message')}")
                    continue
                else:
                    logger.debug(f"Unknown event type: {ev}")
                    continue

                if tick:
                    # Try to enqueue without blocking
                    try:
                        self._queue.put_nowait(tick)
                    except asyncio.QueueFull:
                        # Drop oldest tick if queue is full
                        try:
                            self._queue.get_nowait()
                            self._queue.put_nowait(tick)
                        except asyncio.QueueEmpty:
                            pass

                    # Fire callbacks
                    for callback in self._callbacks.get(tick.symbol, []):
                        try:
                            callback(tick)
                        except Exception as e:
                            logger.error(f"Callback error: {e}")

        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}")
        except Exception as e:
            logger.error(f"Message processing error: {e}")

    async def stream(self) -> AsyncIterator[Tick]:
        """
        Async generator that yields ticks from the queue.

        Usage:
            async for tick in socket.stream():
                process(tick)
        """
        while self._running or not self._queue.empty():
            try:
                tick = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                yield tick
            except asyncio.TimeoutError:
                continue

    async def run(self) -> None:
        """Main loop: receive messages and process them."""
        while self._running:
            try:
                if not self.is_connected:
                    await self._reconnect()
                    continue

                message = await self._ws.recv()
                await self._process_message(message)

            except ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
                await self._reconnect()
            except WebSocketException as e:
                logger.error(f"WebSocket error: {e}")
                await self._reconnect()
            except Exception as e:
                logger.error(f"Unexpected error in run loop: {e}")
                await asyncio.sleep(1)

    async def _reconnect(self) -> None:
        """Attempt to reconnect with exponential backoff."""
        if self._reconnect_count >= self.max_reconnect_attempts:
            logger.error("Max reconnection attempts reached, stopping")
            self._running = False
            return

        self._reconnect_count += 1
        delay = self.reconnect_delay * (2 ** (self._reconnect_count - 1))
        delay = min(delay, 60)  # Cap at 60 seconds
        delay += random.uniform(0, 1)  # Add jitter

        logger.info(f"Reconnecting in {delay:.1f}s (attempt {self._reconnect_count})")
        await asyncio.sleep(delay)

        try:
            await self.connect()
        except Exception as e:
            logger.error(f"Reconnection failed: {e}")

    def add_callback(self, symbol: str, callback: Callable[[Tick], None]) -> None:
        """Register a callback for a specific symbol."""
        if symbol not in self._callbacks:
            self._callbacks[symbol] = []
        self._callbacks[symbol].append(callback)

    def remove_callback(self, symbol: str, callback: Callable[[Tick], None]) -> None:
        """Remove a callback for a symbol."""
        if symbol in self._callbacks:
            self._callbacks[symbol] = [
                cb for cb in self._callbacks[symbol] if cb != callback
            ]

    async def close(self) -> None:
        """Close the WebSocket connection gracefully."""
        self._running = False

        if self._ws:
            try:
                await self._ws.close()
            except Exception as e:
                logger.error(f"Error closing WebSocket: {e}")
            finally:
                self._ws = None

        logger.info("MassiveSocket closed")


# ============================================================================
# Convenience Functions
# ============================================================================

async def create_socket(
    symbols: List[str],
    feed_type: str = "stocks",
    api_key: Optional[str] = None,
) -> MassiveSocket:
    """
    Create and connect a MassiveSocket.

    Usage:
        socket = await create_socket(["SPY", "QQQ"])
        async for tick in socket.stream():
            print(tick)
    """
    socket = MassiveSocket(
        api_key=api_key,
        symbols=symbols,
        feed_type=feed_type,
    )
    await socket.connect()
    return socket


# ============================================================================
# CLI Testing
# ============================================================================

async def main():
    """Test the WebSocket client."""
    import argparse

    parser = argparse.ArgumentParser(description="Test Polygon WebSocket connection")
    parser.add_argument(
        "--symbols",
        type=str,
        default="SPY,QQQ",
        help="Comma-separated symbols to subscribe",
    )
    parser.add_argument(
        "--feed",
        type=str,
        default="stocks",
        choices=["stocks", "options", "forex", "crypto"],
        help="Feed type",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=30,
        help="Duration to run in seconds",
    )
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",")]
    print(f"Testing MassiveSocket with symbols: {symbols}")

    socket = MassiveSocket(symbols=symbols, feed_type=args.feed)

    try:
        await socket.connect()

        # Start the receiver loop in background
        receiver_task = asyncio.create_task(socket.run())

        # Stream ticks for specified duration
        tick_count = 0
        start_time = asyncio.get_event_loop().time()

        async for tick in socket.stream():
            tick_count += 1

            # Print tick info
            if isinstance(tick, TradeTick):
                print(f"TRADE: {tick.symbol} @ ${tick.price:.2f} x {tick.size}")
            elif isinstance(tick, QuoteTick):
                print(
                    f"QUOTE: {tick.symbol} "
                    f"${tick.bid_price:.2f}x{tick.bid_size} / "
                    f"${tick.ask_price:.2f}x{tick.ask_size} "
                    f"(spread: {tick.spread_pct*100:.3f}%)"
                )

            # Check duration
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed >= args.duration:
                break

        print(f"\nReceived {tick_count} ticks in {args.duration} seconds")
        receiver_task.cancel()

    finally:
        await socket.close()


if __name__ == "__main__":
    asyncio.run(main())
