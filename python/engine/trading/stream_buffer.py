"""
StreamBuffer - Live Tick to OHLCV Aggregator
=============================================

Transforms a firehose of live ticks into clean 1-minute OHLCV bars.
Maintains a rolling window DataFrame that strategies can consume
exactly like they do in backtesting - enabling Simulation-Reality Parity.

Usage:
    buffer = StreamBuffer('SPY', window_size=500)

    # In tick consumer:
    new_bar = buffer.on_tick(tick)
    if new_bar:
        # Get rolling DataFrame and run strategies
        df = buffer.get_dataframe()
        signal = strategy.run(df).iloc[-1]
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class OHLCV:
    """Single OHLCV bar."""
    date: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    vwap: float = 0.0
    trade_count: int = 0


@dataclass
class NewBarEvent:
    """Event emitted when a new bar closes."""
    symbol: str
    bar: OHLCV
    dataframe: pd.DataFrame
    bar_count: int


class StreamBuffer:
    """
    Turns a firehose of Ticks into a clean DataFrame for Strategies.
    Maintains a rolling window of the last N candles.

    The key insight: By maintaining a rolling DataFrame and running strategies
    on it, we ensure the strategy behaves EXACTLY the same as in backtesting.
    This is "Simulation-Reality Parity" - the most important principle in live trading.

    Attributes:
        symbol: The ticker symbol this buffer handles
        window_size: Number of bars to keep in memory (default 500)
        bar_interval: Bar duration in seconds (default 60 = 1 minute)
        min_bars_to_trade: Minimum bars before signaling ready (default 50)
    """

    def __init__(
        self,
        symbol: str,
        window_size: int = 500,
        bar_interval: int = 60,
        min_bars_to_trade: int = 50
    ):
        self.symbol = symbol.upper()
        self.window_size = window_size
        self.bar_interval = bar_interval
        self.min_bars_to_trade = min_bars_to_trade

        # Current forming bar
        self._current_bar: Optional[Dict] = None
        self._current_bar_time: Optional[datetime] = None

        # Completed bars
        self._bars: List[Dict] = []
        self._df: Optional[pd.DataFrame] = None

        # VWAP accumulator for current bar
        self._vwap_volume: float = 0.0
        self._vwap_value: float = 0.0
        self._trade_count: int = 0

        # State
        self._is_ready = False
        self._total_ticks = 0
        self._total_bars = 0

        logger.info(f"📊 StreamBuffer initialized for {self.symbol}")
        logger.info(f"   Window: {window_size} bars, Interval: {bar_interval}s")
        logger.info(f"   Min bars to trade: {min_bars_to_trade}")

    def _get_bar_time(self, timestamp: datetime) -> datetime:
        """Round timestamp down to bar boundary."""
        # For 1-minute bars, zero out seconds and microseconds
        if self.bar_interval == 60:
            return timestamp.replace(second=0, microsecond=0)
        else:
            # For other intervals, round to nearest interval
            seconds = timestamp.timestamp()
            bar_seconds = (seconds // self.bar_interval) * self.bar_interval
            return datetime.fromtimestamp(bar_seconds)

    def on_tick(self, price: float, size: float, timestamp: datetime) -> Optional[NewBarEvent]:
        """
        Process a single tick.

        Args:
            price: Trade price
            size: Trade size (shares/contracts)
            timestamp: Trade timestamp

        Returns:
            NewBarEvent if a bar just closed, None otherwise
        """
        self._total_ticks += 1
        bar_time = self._get_bar_time(timestamp)

        # First tick ever
        if self._current_bar is None:
            self._start_new_bar(bar_time, price, size)
            return None

        # Check if we've rolled into a new bar
        if bar_time > self._current_bar_time:
            # Close the current bar
            closed_bar = self._close_current_bar()

            # Start new bar
            self._start_new_bar(bar_time, price, size)

            # Return the closed bar event
            if closed_bar:
                self._total_bars += 1
                self._check_ready()

                return NewBarEvent(
                    symbol=self.symbol,
                    bar=closed_bar,
                    dataframe=self.get_dataframe(),
                    bar_count=len(self._bars)
                )

            return None

        # Same bar - update OHLCV
        self._update_current_bar(price, size)
        return None

    def on_quote(self, bid: float, ask: float, timestamp: datetime) -> None:
        """
        Process a quote tick (optional - for mid-price tracking).
        Currently not used for bar building, but could be extended.
        """
        pass  # Could track bid-ask spread metrics

    def _start_new_bar(self, bar_time: datetime, price: float, size: float) -> None:
        """Initialize a new forming bar."""
        self._current_bar_time = bar_time
        self._current_bar = {
            'date': bar_time,
            'open': price,
            'high': price,
            'low': price,
            'close': price,
            'volume': size
        }

        # Reset VWAP accumulator
        self._vwap_volume = size
        self._vwap_value = price * size
        self._trade_count = 1

    def _update_current_bar(self, price: float, size: float) -> None:
        """Update the current forming bar with new tick."""
        if self._current_bar is None:
            return

        self._current_bar['high'] = max(self._current_bar['high'], price)
        self._current_bar['low'] = min(self._current_bar['low'], price)
        self._current_bar['close'] = price
        self._current_bar['volume'] += size

        # Update VWAP accumulator
        self._vwap_volume += size
        self._vwap_value += price * size
        self._trade_count += 1

    def _close_current_bar(self) -> Optional[OHLCV]:
        """Close and store the current bar."""
        if self._current_bar is None:
            return None

        # Calculate VWAP
        vwap = self._vwap_value / self._vwap_volume if self._vwap_volume > 0 else self._current_bar['close']

        # Create OHLCV object
        bar = OHLCV(
            date=self._current_bar['date'],
            open=self._current_bar['open'],
            high=self._current_bar['high'],
            low=self._current_bar['low'],
            close=self._current_bar['close'],
            volume=self._current_bar['volume'],
            vwap=vwap,
            trade_count=self._trade_count
        )

        # Store the bar
        self._bars.append({
            'date': bar.date,
            'open': bar.open,
            'high': bar.high,
            'low': bar.low,
            'close': bar.close,
            'volume': bar.volume,
            'vwap': bar.vwap,
            'trade_count': bar.trade_count
        })

        # Trim to window size
        if len(self._bars) > self.window_size:
            self._bars = self._bars[-self.window_size:]

        # Invalidate cached DataFrame
        self._df = None

        return bar

    def _check_ready(self) -> None:
        """Check if we have enough bars to start trading."""
        if not self._is_ready and len(self._bars) >= self.min_bars_to_trade:
            self._is_ready = True
            logger.info(f"🟢 StreamBuffer {self.symbol} READY - {len(self._bars)} bars accumulated")

    def get_dataframe(self) -> pd.DataFrame:
        """
        Get the rolling DataFrame for strategy consumption.

        Returns:
            DataFrame with columns: date, open, high, low, close, volume, vwap, trade_count
            Indexed by date, sorted chronologically
        """
        if self._df is None and self._bars:
            self._df = pd.DataFrame(self._bars)
            self._df.set_index('date', inplace=True)

            # Ensure numeric types
            numeric_cols = ['open', 'high', 'low', 'close', 'volume', 'vwap', 'trade_count']
            for col in numeric_cols:
                if col in self._df.columns:
                    self._df[col] = pd.to_numeric(self._df[col])

        return self._df if self._df is not None else pd.DataFrame()

    def is_ready(self) -> bool:
        """Check if buffer has enough bars for trading."""
        return self._is_ready

    def get_bar_count(self) -> int:
        """Get number of completed bars."""
        return len(self._bars)

    def get_latest_bar(self) -> Optional[OHLCV]:
        """Get the most recently completed bar."""
        if not self._bars:
            return None

        b = self._bars[-1]
        return OHLCV(
            date=b['date'],
            open=b['open'],
            high=b['high'],
            low=b['low'],
            close=b['close'],
            volume=b['volume'],
            vwap=b.get('vwap', b['close']),
            trade_count=b.get('trade_count', 0)
        )

    def get_current_bar(self) -> Optional[Dict]:
        """Get the currently forming (incomplete) bar."""
        return self._current_bar.copy() if self._current_bar else None

    def get_stats(self) -> Dict[str, Any]:
        """Get buffer statistics."""
        return {
            'symbol': self.symbol,
            'total_ticks': self._total_ticks,
            'total_bars': self._total_bars,
            'bars_in_window': len(self._bars),
            'is_ready': self._is_ready,
            'window_size': self.window_size,
            'min_bars_to_trade': self.min_bars_to_trade
        }

    def reset(self) -> None:
        """Reset the buffer to initial state."""
        self._current_bar = None
        self._current_bar_time = None
        self._bars = []
        self._df = None
        self._vwap_volume = 0.0
        self._vwap_value = 0.0
        self._trade_count = 0
        self._is_ready = False
        self._total_ticks = 0
        self._total_bars = 0
        logger.info(f"📊 StreamBuffer {self.symbol} reset")


class MultiSymbolBuffer:
    """
    Manages StreamBuffers for multiple symbols.
    Convenience wrapper for the ShadowTrader.
    """

    def __init__(
        self,
        symbols: List[str],
        window_size: int = 500,
        bar_interval: int = 60,
        min_bars_to_trade: int = 50
    ):
        self.buffers: Dict[str, StreamBuffer] = {}

        for symbol in symbols:
            self.buffers[symbol.upper()] = StreamBuffer(
                symbol=symbol,
                window_size=window_size,
                bar_interval=bar_interval,
                min_bars_to_trade=min_bars_to_trade
            )

        logger.info(f"📊 MultiSymbolBuffer initialized for {len(symbols)} symbols")

    def on_tick(
        self,
        symbol: str,
        price: float,
        size: float,
        timestamp: datetime
    ) -> Optional[NewBarEvent]:
        """Route tick to appropriate buffer."""
        symbol = symbol.upper()
        if symbol in self.buffers:
            return self.buffers[symbol].on_tick(price, size, timestamp)
        return None

    def get_buffer(self, symbol: str) -> Optional[StreamBuffer]:
        """Get buffer for a specific symbol."""
        return self.buffers.get(symbol.upper())

    def get_all_ready(self) -> List[str]:
        """Get list of symbols with ready buffers."""
        return [s for s, b in self.buffers.items() if b.is_ready()]

    def get_stats(self) -> Dict[str, Dict]:
        """Get stats for all buffers."""
        return {s: b.get_stats() for s, b in self.buffers.items()}
