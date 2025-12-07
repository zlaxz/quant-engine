"""
Execution Logger - Immutable Audit Trail for All Trading Activity
==================================================================

CRITICAL: Every order is logged to Supabase BEFORE execution.
This creates an immutable audit trail for:
- Regulatory compliance
- Post-trade analysis
- Debugging
- Performance attribution

Tables:
- trade_executions: All order intents, submissions, fills, cancels
- position_snapshots: Periodic position state
- risk_events: Risk limit triggers, kill switch activations
- system_events: Connection status, errors

Usage:
    from engine.trading.execution_logger import ExecutionLogger

    logger = ExecutionLogger()
    await logger.initialize()

    # Log order intent BEFORE execution
    await logger.log_order_intent(order)

    # Log order submission
    await logger.log_order_submitted(order)

    # Log fill
    await logger.log_order_filled(order, fill_price, fill_qty)
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from enum import Enum
import json

logger = logging.getLogger("AlphaFactory.ExecutionLogger")


class EventType(Enum):
    """Types of events logged."""
    ORDER_INTENT = "order_intent"           # Before execution
    ORDER_SUBMITTED = "order_submitted"     # Sent to broker
    ORDER_FILLED = "order_filled"           # Execution received
    ORDER_PARTIAL = "order_partial"         # Partial fill
    ORDER_CANCELLED = "order_cancelled"     # User cancelled
    ORDER_REJECTED = "order_rejected"       # Broker rejected
    ORDER_ERROR = "order_error"             # System error

    POSITION_SNAPSHOT = "position_snapshot"  # Position state
    POSITION_CHANGE = "position_change"      # Position delta

    RISK_LIMIT_HIT = "risk_limit_hit"       # Risk limit triggered
    KILL_SWITCH = "kill_switch"             # Emergency flatten
    TRADING_HALTED = "trading_halted"       # Trading stopped
    TRADING_RESUMED = "trading_resumed"     # Trading resumed

    CONNECTION_UP = "connection_up"         # Broker connected
    CONNECTION_DOWN = "connection_down"     # Broker disconnected
    SYSTEM_ERROR = "system_error"           # System error


@dataclass
class TradeEvent:
    """Trade event for logging."""
    event_type: str
    timestamp: str
    symbol: Optional[str] = None
    side: Optional[str] = None
    quantity: Optional[int] = None
    order_type: Optional[str] = None
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    order_id: Optional[str] = None
    fill_price: Optional[float] = None
    fill_quantity: Optional[int] = None
    commission: Optional[float] = None
    pnl: Optional[float] = None
    position_after: Optional[int] = None
    account_id: Optional[str] = None
    session_id: Optional[str] = None
    signal_source: Optional[str] = None  # What generated this signal
    strategy_name: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict, filtering None values."""
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


class ExecutionLogger:
    """
    Immutable audit trail for all trading activity.

    Logs to Supabase for persistence and queryability.
    Falls back to local file if Supabase unavailable.
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        strategy_name: str = "live_trading",
        fallback_dir: str = "/tmp/execution_logs"
    ):
        """
        Initialize execution logger.

        Args:
            session_id: Unique session identifier (auto-generated if None)
            strategy_name: Name of the trading strategy
            fallback_dir: Directory for local fallback logs
        """
        self.session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self.strategy_name = strategy_name
        self.fallback_dir = fallback_dir

        self._supabase = None
        self._initialized = False
        self._event_queue: List[TradeEvent] = []
        self._use_fallback = False

        logger.info(f"ExecutionLogger initialized:")
        logger.info(f"  Session ID: {self.session_id}")
        logger.info(f"  Strategy: {strategy_name}")

    async def initialize(self) -> bool:
        """
        Initialize Supabase connection.

        Returns:
            True if Supabase connected, False if using fallback
        """
        try:
            from supabase import create_client

            url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
            key = (os.environ.get("SUPABASE_SERVICE_KEY") or
                   os.environ.get("SUPABASE_ANON_KEY") or
                   os.environ.get("VITE_SUPABASE_ANON_KEY"))

            if not url or not key:
                logger.warning("Supabase credentials not found - using local fallback")
                self._use_fallback = True
                self._ensure_fallback_dir()
                return False

            self._supabase = create_client(url, key)
            self._initialized = True

            # Log session start
            await self.log_system_event(
                EventType.CONNECTION_UP,
                "Execution logger initialized"
            )

            logger.info("✅ Supabase connection established")
            return True

        except Exception as e:
            logger.error(f"Supabase initialization failed: {e}")
            self._use_fallback = True
            self._ensure_fallback_dir()
            return False

    def _ensure_fallback_dir(self) -> None:
        """Ensure fallback log directory exists."""
        os.makedirs(self.fallback_dir, exist_ok=True)

    def _get_fallback_path(self) -> str:
        """Get path for fallback log file."""
        date_str = datetime.now().strftime("%Y%m%d")
        return os.path.join(self.fallback_dir, f"trades_{date_str}_{self.session_id}.jsonl")

    async def _log_to_supabase(self, event: TradeEvent) -> Optional[str]:
        """
        Log event to Supabase.

        Returns:
            Record ID if successful, None if failed
        """
        if not self._supabase:
            return None

        try:
            result = self._supabase.table("trade_executions").insert(
                event.to_dict()
            ).execute()

            if result.data:
                return result.data[0].get("id")
            return None

        except Exception as e:
            logger.error(f"Supabase insert failed: {e}")
            return None

    def _log_to_fallback(self, event: TradeEvent) -> None:
        """Log event to local file."""
        try:
            with open(self._get_fallback_path(), "a") as f:
                f.write(json.dumps(event.to_dict()) + "\n")
        except Exception as e:
            logger.error(f"Fallback log failed: {e}")

    async def _log_event(self, event: TradeEvent) -> Optional[str]:
        """
        Log event to appropriate destination.

        Returns:
            Record ID if Supabase, None otherwise
        """
        # Always log to console
        logger.info(f"[{event.event_type}] {event.symbol or ''} {event.side or ''} {event.quantity or ''}")

        if self._use_fallback or not self._supabase:
            self._log_to_fallback(event)
            return None
        else:
            record_id = await self._log_to_supabase(event)
            if not record_id:
                # Fallback if Supabase fails
                self._log_to_fallback(event)
            return record_id

    async def log_order_intent(self, order) -> Optional[str]:
        """
        Log order intent BEFORE execution.

        This is the most critical log - proves we intended to trade
        before actually sending to broker.

        Args:
            order: OrderResult or similar object with order details

        Returns:
            Record ID
        """
        event = TradeEvent(
            event_type=EventType.ORDER_INTENT.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            order_type=order.order_type,
            limit_price=order.limit_price,
            stop_price=order.stop_price,
            order_id=order.order_id,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_order_submitted(self, order) -> Optional[str]:
        """Log order submitted to broker."""
        event = TradeEvent(
            event_type=EventType.ORDER_SUBMITTED.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            order_type=order.order_type,
            limit_price=order.limit_price,
            stop_price=order.stop_price,
            order_id=order.order_id,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_order_filled(
        self,
        order,
        fill_price: float,
        fill_quantity: int,
        commission: float = 0.0,
        pnl: Optional[float] = None,
        position_after: Optional[int] = None
    ) -> Optional[str]:
        """Log order fill."""
        event = TradeEvent(
            event_type=EventType.ORDER_FILLED.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            order_type=order.order_type,
            limit_price=order.limit_price,
            order_id=order.order_id,
            fill_price=fill_price,
            fill_quantity=fill_quantity,
            commission=commission,
            pnl=pnl,
            position_after=position_after,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_order_cancelled(self, order, reason: str = "") -> Optional[str]:
        """Log order cancellation."""
        event = TradeEvent(
            event_type=EventType.ORDER_CANCELLED.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            symbol=order.symbol,
            order_id=order.order_id,
            notes=reason,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_order_rejected(self, order, reason: str = "") -> Optional[str]:
        """Log order rejection."""
        event = TradeEvent(
            event_type=EventType.ORDER_REJECTED.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            order_id=order.order_id,
            notes=reason,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_position_snapshot(
        self,
        positions: Dict[str, Any],
        account_equity: float,
        unrealized_pnl: float
    ) -> Optional[str]:
        """Log current position state."""
        event = TradeEvent(
            event_type=EventType.POSITION_SNAPSHOT.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            session_id=self.session_id,
            strategy_name=self.strategy_name,
            metadata={
                "positions": positions,
                "account_equity": account_equity,
                "unrealized_pnl": unrealized_pnl
            }
        )

        return await self._log_event(event)

    async def log_risk_event(
        self,
        event_type: EventType,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Log risk-related events."""
        event = TradeEvent(
            event_type=event_type.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            notes=message,
            metadata=details,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def log_kill_switch(
        self,
        reason: str,
        positions_closed: List[Dict[str, Any]],
        orders_cancelled: List[str]
    ) -> Optional[str]:
        """Log kill switch activation."""
        event = TradeEvent(
            event_type=EventType.KILL_SWITCH.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            notes=reason,
            metadata={
                "positions_closed": positions_closed,
                "orders_cancelled": orders_cancelled
            },
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        logger.critical(f"🚨 KILL SWITCH: {reason}")
        return await self._log_event(event)

    async def log_system_event(
        self,
        event_type: EventType,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Log system events."""
        event = TradeEvent(
            event_type=event_type.value,
            timestamp=datetime.utcnow().isoformat() + "Z",
            notes=message,
            metadata=details,
            session_id=self.session_id,
            strategy_name=self.strategy_name
        )

        return await self._log_event(event)

    async def get_session_trades(
        self,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get trades for current session."""
        if not self._supabase:
            return []

        try:
            result = self._supabase.table("trade_executions").select("*").eq(
                "session_id", self.session_id
            ).order(
                "timestamp", desc=True
            ).limit(limit).execute()

            return result.data or []

        except Exception as e:
            logger.error(f"Failed to get session trades: {e}")
            return []

    async def get_daily_summary(self, date: Optional[str] = None) -> Dict[str, Any]:
        """Get summary of trading for a day."""
        if not self._supabase:
            return {}

        date_str = date or datetime.now().strftime("%Y-%m-%d")

        try:
            # Get all fills for the day
            result = self._supabase.table("trade_executions").select("*").eq(
                "event_type", "order_filled"
            ).gte(
                "timestamp", f"{date_str}T00:00:00Z"
            ).lte(
                "timestamp", f"{date_str}T23:59:59Z"
            ).execute()

            trades = result.data or []

            # Calculate summary
            total_trades = len(trades)
            total_pnl = sum(t.get("pnl", 0) or 0 for t in trades)
            total_commission = sum(t.get("commission", 0) or 0 for t in trades)

            # By symbol
            by_symbol = {}
            for t in trades:
                sym = t.get("symbol", "UNKNOWN")
                if sym not in by_symbol:
                    by_symbol[sym] = {"count": 0, "pnl": 0}
                by_symbol[sym]["count"] += 1
                by_symbol[sym]["pnl"] += t.get("pnl", 0) or 0

            return {
                "date": date_str,
                "total_trades": total_trades,
                "total_pnl": total_pnl,
                "total_commission": total_commission,
                "net_pnl": total_pnl - total_commission,
                "by_symbol": by_symbol
            }

        except Exception as e:
            logger.error(f"Failed to get daily summary: {e}")
            return {}


# =============================================================================
# Database Migration (run once)
# =============================================================================

MIGRATION_SQL = """
-- Trade executions table
CREATE TABLE IF NOT EXISTS trade_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    symbol TEXT,
    side TEXT,
    quantity INTEGER,
    order_type TEXT,
    limit_price DECIMAL(18,6),
    stop_price DECIMAL(18,6),
    order_id TEXT,
    fill_price DECIMAL(18,6),
    fill_quantity INTEGER,
    commission DECIMAL(18,6),
    pnl DECIMAL(18,6),
    position_after INTEGER,
    account_id TEXT,
    session_id TEXT,
    signal_source TEXT,
    strategy_name TEXT,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trade_executions_session ON trade_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_trade_executions_symbol ON trade_executions(symbol);
CREATE INDEX IF NOT EXISTS idx_trade_executions_timestamp ON trade_executions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trade_executions_event_type ON trade_executions(event_type);
CREATE INDEX IF NOT EXISTS idx_trade_executions_strategy ON trade_executions(strategy_name);

-- Enable RLS
ALTER TABLE trade_executions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (for service key)
CREATE POLICY IF NOT EXISTS "Allow all operations" ON trade_executions
    FOR ALL
    USING (true)
    WITH CHECK (true);
"""


async def run_migration():
    """Run database migration to create tables."""
    try:
        from supabase import create_client

        url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")

        if not url or not key:
            print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY required for migration")
            return False

        supabase = create_client(url, key)

        # Run migration
        result = supabase.rpc("exec_sql", {"query": MIGRATION_SQL}).execute()
        print("✅ Migration completed successfully")
        return True

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Execution Logger CLI")
    parser.add_argument("command", choices=["migrate", "summary", "trades"])
    parser.add_argument("--date", default=None)
    parser.add_argument("--limit", type=int, default=20)

    args = parser.parse_args()

    async def main():
        if args.command == "migrate":
            await run_migration()

        else:
            logger_inst = ExecutionLogger()
            await logger_inst.initialize()

            if args.command == "summary":
                summary = await logger_inst.get_daily_summary(args.date)
                print(json.dumps(summary, indent=2))

            elif args.command == "trades":
                trades = await logger_inst.get_session_trades(args.limit)
                for t in trades:
                    print(f"[{t['event_type']}] {t['symbol']} {t['side']} {t['quantity']}")

    asyncio.run(main())
