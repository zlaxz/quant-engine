"""
Position Tracker - Real-Time Position Monitoring
=================================================

Tracks all open positions with real-time P&L updates.

Features:
- Real-time position sync from IBKR
- P&L calculation (unrealized, realized, daily)
- Greeks aggregation (for futures options overlay)
- Risk metrics (exposure, margin)
- Position alerts (size limits, loss limits)
- JARVIS UI event emission

Usage:
    from engine.trading.position_tracker import PositionTracker

    tracker = PositionTracker()
    await tracker.initialize(ibkr_client)

    # Start real-time tracking
    await tracker.start()

    # Get positions
    positions = tracker.get_positions()
    daily_pnl = tracker.get_daily_pnl()

    # Stop tracking
    await tracker.stop()
"""

import asyncio
import logging
from datetime import datetime, date, time
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
import json

from .ibkr_client import IBKRClient, Position, Quote, FUTURES_SPECS, AccountInfo

logger = logging.getLogger("AlphaFactory.PositionTracker")


@dataclass
class TrackedPosition:
    """Enhanced position with tracking data."""
    symbol: str
    quantity: int
    avg_cost: float
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    realized_pnl_today: float = 0.0
    high_water_mark: float = 0.0  # Best unrealized P&L today
    max_drawdown: float = 0.0     # Worst drawdown from HWM
    entry_time: Optional[datetime] = None
    last_update: datetime = field(default_factory=datetime.now)

    @property
    def is_long(self) -> bool:
        return self.quantity > 0

    @property
    def is_short(self) -> bool:
        return self.quantity < 0

    @property
    def multiplier(self) -> int:
        spec = FUTURES_SPECS.get(self.symbol, {})
        return spec.get("multiplier", 1)

    @property
    def notional_value(self) -> float:
        return abs(self.quantity) * self.current_price * self.multiplier

    def update_price(self, price: float) -> None:
        """Update current price and recalculate P&L."""
        self.current_price = price
        self.last_update = datetime.now()

        # Calculate unrealized P&L
        price_change = price - self.avg_cost
        self.unrealized_pnl = self.quantity * price_change * self.multiplier

        # Track high water mark and drawdown
        if self.unrealized_pnl > self.high_water_mark:
            self.high_water_mark = self.unrealized_pnl

        drawdown = self.high_water_mark - self.unrealized_pnl
        if drawdown > self.max_drawdown:
            self.max_drawdown = drawdown

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "quantity": self.quantity,
            "avg_cost": self.avg_cost,
            "current_price": self.current_price,
            "unrealized_pnl": self.unrealized_pnl,
            "realized_pnl_today": self.realized_pnl_today,
            "high_water_mark": self.high_water_mark,
            "max_drawdown": self.max_drawdown,
            "notional_value": self.notional_value,
            "is_long": self.is_long,
            "last_update": self.last_update.isoformat(),
        }


@dataclass
class DailyStats:
    """Daily trading statistics."""
    date: date
    starting_equity: float = 0.0
    current_equity: float = 0.0
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    high_water_mark: float = 0.0
    max_drawdown: float = 0.0
    trades_count: int = 0
    winners: int = 0
    losers: int = 0

    @property
    def total_pnl(self) -> float:
        return self.realized_pnl + self.unrealized_pnl

    @property
    def pnl_percent(self) -> float:
        if self.starting_equity == 0:
            return 0.0
        return (self.total_pnl / self.starting_equity) * 100

    @property
    def win_rate(self) -> float:
        total = self.winners + self.losers
        if total == 0:
            return 0.0
        return (self.winners / total) * 100

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "starting_equity": self.starting_equity,
            "current_equity": self.current_equity,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "total_pnl": self.total_pnl,
            "pnl_percent": self.pnl_percent,
            "high_water_mark": self.high_water_mark,
            "max_drawdown": self.max_drawdown,
            "trades_count": self.trades_count,
            "win_rate": self.win_rate,
        }


class PositionTracker:
    """
    Real-time position tracking with P&L monitoring.

    Features:
    - Syncs positions from IBKR
    - Real-time quote updates
    - P&L calculation (unrealized, realized, daily)
    - Position alerts
    - JARVIS UI event emission
    """

    def __init__(
        self,
        update_interval_seconds: float = 1.0,
        loss_alert_threshold: float = -500.0,  # Alert if daily loss exceeds
        position_alert_threshold: int = 5,      # Alert if position size exceeds
        on_position_change: Optional[Callable] = None,
        on_pnl_update: Optional[Callable] = None,
        on_alert: Optional[Callable] = None,
    ):
        """
        Initialize position tracker.

        Args:
            update_interval_seconds: How often to update quotes
            loss_alert_threshold: Daily loss threshold for alerts
            position_alert_threshold: Position size threshold for alerts
            on_position_change: Callback when positions change
            on_pnl_update: Callback for P&L updates
            on_alert: Callback for alerts
        """
        self.update_interval_seconds = update_interval_seconds
        self.loss_alert_threshold = loss_alert_threshold
        self.position_alert_threshold = position_alert_threshold
        self.on_position_change = on_position_change
        self.on_pnl_update = on_pnl_update
        self.on_alert = on_alert

        # State
        self._ibkr: Optional[IBKRClient] = None
        self._positions: Dict[str, TrackedPosition] = {}
        self._daily_stats = DailyStats(date=date.today())
        self._running = False
        self._update_task: Optional[asyncio.Task] = None

        # Alert state (prevent spam)
        self._loss_alert_triggered = False
        self._position_alerts_triggered: set = set()

        logger.info("PositionTracker initialized")

    async def initialize(self, ibkr_client: IBKRClient) -> bool:
        """
        Initialize with IBKR client.

        Args:
            ibkr_client: Connected IBKR client

        Returns:
            True if initialized successfully
        """
        self._ibkr = ibkr_client

        # Get initial account info
        account = await ibkr_client.get_account_info()
        if account:
            self._daily_stats.starting_equity = account.net_liquidation
            self._daily_stats.current_equity = account.net_liquidation
            self._daily_stats.high_water_mark = account.net_liquidation

        # Sync initial positions
        await self._sync_positions()

        logger.info(f"PositionTracker initialized with {len(self._positions)} positions")
        return True

    async def start(self) -> None:
        """Start real-time position tracking."""
        if self._running:
            logger.warning("Already running")
            return

        self._running = True
        self._update_task = asyncio.create_task(self._update_loop())
        logger.info("Position tracking started")

    async def stop(self) -> None:
        """Stop position tracking."""
        self._running = False
        if self._update_task:
            self._update_task.cancel()
            try:
                await self._update_task
            except asyncio.CancelledError:
                pass
        logger.info("Position tracking stopped")

    async def _update_loop(self) -> None:
        """Main update loop."""
        while self._running:
            try:
                await self._update_positions()
                await asyncio.sleep(self.update_interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Update loop error: {e}")
                await asyncio.sleep(5)  # Back off on error

    async def _sync_positions(self) -> None:
        """Sync positions from IBKR."""
        if not self._ibkr:
            return

        ibkr_positions = await self._ibkr.get_positions()

        # Track which symbols we've seen
        seen_symbols = set()

        for symbol, pos in ibkr_positions.items():
            seen_symbols.add(symbol)

            if symbol in self._positions:
                # Update existing position
                tracked = self._positions[symbol]
                old_qty = tracked.quantity

                if pos.quantity != old_qty:
                    # Position changed
                    tracked.quantity = pos.quantity
                    tracked.avg_cost = pos.avg_cost

                    if self.on_position_change:
                        self.on_position_change(symbol, old_qty, pos.quantity)

            else:
                # New position
                self._positions[symbol] = TrackedPosition(
                    symbol=symbol,
                    quantity=pos.quantity,
                    avg_cost=pos.avg_cost,
                    entry_time=datetime.now()
                )

                if self.on_position_change:
                    self.on_position_change(symbol, 0, pos.quantity)

        # Remove closed positions
        closed = set(self._positions.keys()) - seen_symbols
        for symbol in closed:
            old_pos = self._positions.pop(symbol)

            if self.on_position_change:
                self.on_position_change(symbol, old_pos.quantity, 0)

    async def _update_positions(self) -> None:
        """Update position prices and P&L."""
        if not self._ibkr:
            return

        # Sync positions first
        await self._sync_positions()

        # Update quotes for each position
        total_unrealized = 0.0

        for symbol, tracked in self._positions.items():
            quote = await self._ibkr.get_quote(symbol)
            if quote:
                tracked.update_price(quote.mid)
                total_unrealized += tracked.unrealized_pnl

            # Check position alerts
            if abs(tracked.quantity) >= self.position_alert_threshold:
                if symbol not in self._position_alerts_triggered:
                    self._position_alerts_triggered.add(symbol)
                    self._trigger_alert(
                        "position_size",
                        f"{symbol} position size ({tracked.quantity}) exceeds threshold",
                        {"symbol": symbol, "quantity": tracked.quantity}
                    )

        # Update daily stats
        self._daily_stats.unrealized_pnl = total_unrealized

        # Update account info
        account = await self._ibkr.get_account_info()
        if account:
            self._daily_stats.current_equity = account.net_liquidation
            self._daily_stats.realized_pnl = account.realized_pnl

            # Track HWM and drawdown
            if account.net_liquidation > self._daily_stats.high_water_mark:
                self._daily_stats.high_water_mark = account.net_liquidation

            drawdown = self._daily_stats.high_water_mark - account.net_liquidation
            if drawdown > self._daily_stats.max_drawdown:
                self._daily_stats.max_drawdown = drawdown

        # Check loss alerts
        if self._daily_stats.total_pnl <= self.loss_alert_threshold:
            if not self._loss_alert_triggered:
                self._loss_alert_triggered = True
                self._trigger_alert(
                    "daily_loss",
                    f"Daily loss (${self._daily_stats.total_pnl:.2f}) exceeds threshold",
                    {"daily_pnl": self._daily_stats.total_pnl}
                )

        # Callback
        if self.on_pnl_update:
            self.on_pnl_update(self._daily_stats)

    def _trigger_alert(
        self,
        alert_type: str,
        message: str,
        details: Dict[str, Any]
    ) -> None:
        """Trigger an alert."""
        logger.warning(f"ALERT [{alert_type}]: {message}")

        if self.on_alert:
            self.on_alert(alert_type, message, details)

        # Emit to JARVIS UI
        try:
            from ..ui_bridge import emit_ui_event
            emit_ui_event("position_alert", {
                "type": alert_type,
                "message": message,
                **details
            })
        except ImportError:
            pass

    def record_trade(self, symbol: str, pnl: float, is_winner: bool) -> None:
        """Record a completed trade."""
        self._daily_stats.trades_count += 1
        self._daily_stats.realized_pnl += pnl

        if is_winner:
            self._daily_stats.winners += 1
        else:
            self._daily_stats.losers += 1

    def reset_daily_stats(self) -> None:
        """Reset daily statistics (call at market open)."""
        self._daily_stats = DailyStats(date=date.today())
        self._loss_alert_triggered = False
        self._position_alerts_triggered.clear()

        logger.info("Daily stats reset")

    # =========================================================================
    # Query Methods
    # =========================================================================

    def get_positions(self) -> Dict[str, TrackedPosition]:
        """Get all tracked positions."""
        return self._positions.copy()

    def get_position(self, symbol: str) -> Optional[TrackedPosition]:
        """Get a specific position."""
        return self._positions.get(symbol)

    def get_daily_stats(self) -> DailyStats:
        """Get daily statistics."""
        return self._daily_stats

    def get_daily_pnl(self) -> float:
        """Get total daily P&L (realized + unrealized)."""
        return self._daily_stats.total_pnl

    def get_total_exposure(self) -> float:
        """Get total notional exposure."""
        return sum(p.notional_value for p in self._positions.values())

    def get_net_position(self) -> int:
        """Get net position (longs - shorts in contract equivalent)."""
        return sum(p.quantity for p in self._positions.values())

    def to_dict(self) -> Dict[str, Any]:
        """Serialize tracker state to dict."""
        return {
            "positions": {s: p.to_dict() for s, p in self._positions.items()},
            "daily_stats": self._daily_stats.to_dict(),
            "total_exposure": self.get_total_exposure(),
            "net_position": self.get_net_position(),
        }

    def emit_ui_update(self) -> None:
        """Emit current state to JARVIS UI."""
        try:
            from ..ui_bridge import emit_ui_event
            emit_ui_event("position_update", self.to_dict())
        except ImportError:
            pass


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Position Tracker CLI")
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--duration", type=int, default=60, help="Run duration in seconds")

    args = parser.parse_args()

    async def main():
        from .ibkr_client import IBKRClient, TradingMode

        # Connect to IBKR
        client = IBKRClient(mode=TradingMode.PAPER)
        if not await client.connect():
            print("Failed to connect to IBKR")
            return

        # Initialize tracker
        tracker = PositionTracker(
            update_interval_seconds=args.interval,
            on_pnl_update=lambda stats: print(f"P&L: ${stats.total_pnl:+.2f}"),
            on_alert=lambda t, m, d: print(f"ALERT: {m}")
        )
        await tracker.initialize(client)

        # Start tracking
        await tracker.start()

        # Run for duration
        print(f"Tracking positions for {args.duration} seconds...")
        try:
            for _ in range(args.duration):
                await asyncio.sleep(1)
                positions = tracker.get_positions()
                if positions:
                    print(f"\n{datetime.now().strftime('%H:%M:%S')}")
                    for sym, pos in positions.items():
                        print(f"  {sym}: {pos.quantity} @ {pos.current_price:.2f} "
                              f"P&L: ${pos.unrealized_pnl:+.2f}")
        except KeyboardInterrupt:
            pass

        # Stop
        await tracker.stop()
        await client.disconnect()

        # Final summary
        print(f"\n=== Daily Summary ===")
        stats = tracker.get_daily_stats()
        print(f"Total P&L: ${stats.total_pnl:+.2f}")
        print(f"Trades: {stats.trades_count}")
        print(f"Win Rate: {stats.win_rate:.1f}%")

    asyncio.run(main())
