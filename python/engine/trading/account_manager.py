"""
IBKR Account Manager - Multi-Account Support for Dual Trading
==============================================================

Manages multiple IBKR connections for paper + live trading simultaneously.

Architecture:
- Each account gets its own IBKRClient with unique client_id
- Accounts identified by name: "paper", "live", or custom names
- Orders routed to specific accounts
- Positions tracked per-account and aggregated
- Kill switch can target specific account or all

Typical Setup:
- Paper account (TWS port 7497) for testing strategies
- Live account (TWS port 7496) for real trading
- Both can run simultaneously with different client IDs

Usage:
    from engine.trading.account_manager import IBKRAccountManager

    manager = IBKRAccountManager()

    # Add accounts
    await manager.add_account("paper", mode=TradingMode.PAPER, client_id=1)
    await manager.add_account("live", mode=TradingMode.LIVE, client_id=2)

    # Connect
    await manager.connect_account("paper")
    await manager.connect_account("live")

    # Place order on specific account
    result = await manager.place_order("paper", symbol="MES", side="BUY", quantity=1)

    # Get positions from all accounts
    all_positions = manager.get_all_positions()

    # Kill switch - specific or all
    await manager.kill_switch("live")  # Just live
    await manager.kill_switch_all()    # Everything
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List, Literal
from dataclasses import dataclass, field
from enum import Enum

from .ibkr_client import (
    IBKRClient, TradingMode, Position, Quote, AccountInfo,
    OrderResult, OrderStatus, FUTURES_SPECS
)
from .order_manager import OrderManager, OrderPriority
from .position_tracker import PositionTracker
from .execution_logger import ExecutionLogger

logger = logging.getLogger("AlphaFactory.AccountManager")


@dataclass
class AccountConfig:
    """Configuration for a single IBKR account."""
    name: str
    mode: TradingMode
    host: str = "127.0.0.1"
    port: Optional[int] = None  # Auto-detect based on mode
    client_id: int = 1
    max_position_per_symbol: int = 10
    daily_loss_limit: float = 500.0

    def __post_init__(self):
        # Auto-detect port if not specified
        if self.port is None:
            self.port = 7497 if self.mode == TradingMode.PAPER else 7496


@dataclass
class ManagedAccount:
    """A managed IBKR account with all components."""
    config: AccountConfig
    client: Optional[IBKRClient] = None
    order_manager: Optional[OrderManager] = None
    position_tracker: Optional[PositionTracker] = None
    execution_logger: Optional[ExecutionLogger] = None
    is_connected: bool = False
    last_error: Optional[str] = None
    connected_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize account state."""
        return {
            "name": self.config.name,
            "mode": self.config.mode.value,
            "host": self.config.host,
            "port": self.config.port,
            "client_id": self.config.client_id,
            "is_connected": self.is_connected,
            "last_error": self.last_error,
            "connected_at": self.connected_at.isoformat() if self.connected_at else None,
            "is_halted": self.order_manager.is_halted if self.order_manager else False,
        }


class IBKRAccountManager:
    """
    Manages multiple IBKR accounts for dual paper/live trading.

    Features:
    - Named accounts (paper, live, or custom)
    - Independent connections with unique client IDs
    - Per-account position tracking and P&L
    - Aggregated views across all accounts
    - Per-account or global kill switch
    - Account-specific daily loss limits
    """

    def __init__(self):
        """Initialize account manager."""
        self._accounts: Dict[str, ManagedAccount] = {}
        self._active_account: Optional[str] = None
        logger.info("IBKRAccountManager initialized")

    # =========================================================================
    # Account Management
    # =========================================================================

    def add_account(
        self,
        name: str,
        mode: TradingMode = TradingMode.PAPER,
        host: str = "127.0.0.1",
        port: Optional[int] = None,
        client_id: Optional[int] = None,
        max_position_per_symbol: int = 10,
        daily_loss_limit: float = 500.0,
    ) -> bool:
        """
        Add an account configuration.

        Args:
            name: Unique account name (e.g., "paper", "live")
            mode: PAPER or LIVE trading mode
            host: TWS/Gateway host
            port: TWS/Gateway port (auto-detect if None)
            client_id: Unique client ID (auto-assign if None)
            max_position_per_symbol: Max contracts per symbol
            daily_loss_limit: Max daily loss before halt

        Returns:
            True if account added successfully
        """
        if name in self._accounts:
            logger.warning(f"Account '{name}' already exists")
            return False

        # Auto-assign client_id if not specified
        if client_id is None:
            existing_ids = {a.config.client_id for a in self._accounts.values()}
            client_id = 1
            while client_id in existing_ids:
                client_id += 1

        config = AccountConfig(
            name=name,
            mode=mode,
            host=host,
            port=port,
            client_id=client_id,
            max_position_per_symbol=max_position_per_symbol,
            daily_loss_limit=daily_loss_limit,
        )

        self._accounts[name] = ManagedAccount(config=config)

        logger.info(f"Added account '{name}': {mode.value} @ {config.host}:{config.port} (client_id={client_id})")

        # Set as active if first account
        if self._active_account is None:
            self._active_account = name

        return True

    def remove_account(self, name: str) -> bool:
        """
        Remove an account (must be disconnected first).

        Args:
            name: Account name to remove

        Returns:
            True if removed successfully
        """
        if name not in self._accounts:
            logger.warning(f"Account '{name}' not found")
            return False

        account = self._accounts[name]
        if account.is_connected:
            logger.error(f"Cannot remove connected account '{name}'. Disconnect first.")
            return False

        del self._accounts[name]

        # Update active account if needed
        if self._active_account == name:
            self._active_account = next(iter(self._accounts), None)

        logger.info(f"Removed account '{name}'")
        return True

    def list_accounts(self) -> List[Dict[str, Any]]:
        """List all configured accounts with their status."""
        return [account.to_dict() for account in self._accounts.values()]

    def get_account(self, name: str) -> Optional[ManagedAccount]:
        """Get a managed account by name."""
        return self._accounts.get(name)

    def set_active_account(self, name: str) -> bool:
        """Set the active account for default operations."""
        if name not in self._accounts:
            logger.warning(f"Account '{name}' not found")
            return False
        self._active_account = name
        logger.info(f"Active account set to '{name}'")
        return True

    @property
    def active_account(self) -> Optional[str]:
        """Get the currently active account name."""
        return self._active_account

    # =========================================================================
    # Connection Management
    # =========================================================================

    async def connect_account(self, name: str, timeout: int = 30) -> bool:
        """
        Connect a specific account to IBKR.

        Args:
            name: Account name to connect
            timeout: Connection timeout in seconds

        Returns:
            True if connected successfully
        """
        if name not in self._accounts:
            logger.error(f"Account '{name}' not found")
            return False

        account = self._accounts[name]

        if account.is_connected:
            logger.info(f"Account '{name}' already connected")
            return True

        try:
            config = account.config

            # Create IBKR client
            client = IBKRClient(
                mode=config.mode,
                host=config.host,
                port=config.port,
                client_id=config.client_id,
                max_position_per_symbol=config.max_position_per_symbol,
                daily_loss_limit=config.daily_loss_limit,
            )

            # Create execution logger
            execution_logger = ExecutionLogger()
            client.set_execution_logger(execution_logger)

            # Connect
            success = await client.connect(timeout=timeout)

            if not success:
                account.last_error = "Failed to connect to IBKR"
                logger.error(f"Account '{name}': {account.last_error}")
                return False

            # Create order manager
            order_manager = OrderManager(trading_mode=config.mode)
            order_manager._ibkr = client  # Inject client
            await order_manager.initialize()

            # Create position tracker
            position_tracker = PositionTracker()
            await position_tracker.initialize(client)
            await position_tracker.start()

            # Store components
            account.client = client
            account.order_manager = order_manager
            account.position_tracker = position_tracker
            account.execution_logger = execution_logger
            account.is_connected = True
            account.connected_at = datetime.now()
            account.last_error = None

            logger.info(f"✅ Account '{name}' connected ({config.mode.value})")
            return True

        except Exception as e:
            account.last_error = str(e)
            logger.error(f"Account '{name}' connection failed: {e}")
            return False

    async def disconnect_account(self, name: str) -> bool:
        """
        Disconnect a specific account.

        Args:
            name: Account name to disconnect

        Returns:
            True if disconnected successfully
        """
        if name not in self._accounts:
            logger.error(f"Account '{name}' not found")
            return False

        account = self._accounts[name]

        if not account.is_connected:
            logger.info(f"Account '{name}' already disconnected")
            return True

        try:
            # Stop position tracker
            if account.position_tracker:
                await account.position_tracker.stop()

            # Shutdown order manager
            if account.order_manager:
                await account.order_manager.shutdown()

            # Disconnect client
            if account.client:
                await account.client.disconnect()

            # Clear components
            account.client = None
            account.order_manager = None
            account.position_tracker = None
            account.execution_logger = None
            account.is_connected = False
            account.connected_at = None

            logger.info(f"Account '{name}' disconnected")
            return True

        except Exception as e:
            account.last_error = str(e)
            logger.error(f"Account '{name}' disconnect error: {e}")
            return False

    async def connect_all(self) -> Dict[str, bool]:
        """Connect all configured accounts."""
        results = {}
        for name in self._accounts:
            results[name] = await self.connect_account(name)
        return results

    async def disconnect_all(self) -> Dict[str, bool]:
        """Disconnect all accounts."""
        results = {}
        for name in self._accounts:
            results[name] = await self.disconnect_account(name)
        return results

    # =========================================================================
    # Trading Operations
    # =========================================================================

    async def place_order(
        self,
        account_name: Optional[str],
        symbol: str,
        side: Literal["BUY", "SELL"],
        quantity: int,
        order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] = "LIMIT",
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
        time_in_force: Literal["GTC", "DAY", "IOC"] = "GTC",
        priority: OrderPriority = OrderPriority.NORMAL,
        strategy_name: str = "manual",
        dry_run: bool = False,
    ) -> OrderResult:
        """
        Place an order on a specific account.

        Args:
            account_name: Account to trade on (uses active if None)
            symbol: Futures symbol
            side: BUY or SELL
            quantity: Number of contracts
            order_type: Order type
            limit_price: Limit price
            stop_price: Stop price
            time_in_force: Time in force
            priority: Order priority
            strategy_name: Strategy name for logging
            dry_run: Validate only, don't execute

        Returns:
            OrderResult with status and details
        """
        # Use active account if not specified
        name = account_name or self._active_account

        if not name:
            return OrderResult(
                order_id="",
                status=OrderStatus.ERROR,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                message="No account specified and no active account set"
            )

        account = self._accounts.get(name)
        if not account:
            return OrderResult(
                order_id="",
                status=OrderStatus.ERROR,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                message=f"Account '{name}' not found"
            )

        if not account.is_connected or not account.order_manager:
            return OrderResult(
                order_id="",
                status=OrderStatus.ERROR,
                symbol=symbol,
                side=side,
                quantity=quantity,
                order_type=order_type,
                message=f"Account '{name}' not connected"
            )

        # Submit order
        return await account.order_manager.submit_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            priority=priority,
            strategy_name=strategy_name,
            dry_run=dry_run,
        )

    async def cancel_order(self, account_name: Optional[str], order_id: str) -> bool:
        """Cancel an order on a specific account."""
        name = account_name or self._active_account

        if not name:
            logger.error("No account specified")
            return False

        account = self._accounts.get(name)
        if not account or not account.order_manager:
            logger.error(f"Account '{name}' not found or not connected")
            return False

        return await account.order_manager.cancel_order(order_id)

    async def get_quote(self, symbol: str, account_name: Optional[str] = None) -> Optional[Quote]:
        """Get quote from a specific account (any connected account works)."""
        name = account_name or self._active_account

        if not name:
            # Try any connected account
            for acc in self._accounts.values():
                if acc.is_connected and acc.client:
                    return await acc.client.get_quote(symbol)
            return None

        account = self._accounts.get(name)
        if not account or not account.client:
            return None

        return await account.client.get_quote(symbol)

    # =========================================================================
    # Position Management
    # =========================================================================

    def get_positions(self, account_name: str) -> Dict[str, Position]:
        """Get positions for a specific account."""
        account = self._accounts.get(account_name)
        if not account or not account.position_tracker:
            return {}
        return account.position_tracker.get_positions()

    def get_all_positions(self) -> Dict[str, Dict[str, Position]]:
        """Get positions from all accounts, keyed by account name."""
        result = {}
        for name, account in self._accounts.items():
            if account.is_connected and account.position_tracker:
                result[name] = account.position_tracker.get_positions()
        return result

    def get_aggregated_positions(self) -> Dict[str, Position]:
        """
        Get aggregated positions across all accounts.

        Returns combined position for each symbol.
        """
        aggregated: Dict[str, Position] = {}

        for account in self._accounts.values():
            if not account.is_connected or not account.position_tracker:
                continue

            for symbol, pos in account.position_tracker.get_positions().items():
                if symbol in aggregated:
                    # Aggregate
                    agg = aggregated[symbol]
                    total_qty = agg.quantity + pos.quantity

                    # Weighted average cost
                    if total_qty != 0:
                        avg_cost = (
                            (agg.quantity * agg.avg_cost + pos.quantity * pos.avg_cost)
                            / total_qty
                        )
                    else:
                        avg_cost = 0

                    aggregated[symbol] = Position(
                        symbol=symbol,
                        quantity=total_qty,
                        avg_cost=avg_cost,
                        unrealized_pnl=agg.unrealized_pnl + pos.unrealized_pnl,
                        realized_pnl=agg.realized_pnl + pos.realized_pnl,
                        market_value=agg.market_value + pos.market_value,
                    )
                else:
                    aggregated[symbol] = Position(
                        symbol=pos.symbol,
                        quantity=pos.quantity,
                        avg_cost=pos.avg_cost,
                        unrealized_pnl=pos.unrealized_pnl,
                        realized_pnl=pos.realized_pnl,
                        market_value=pos.market_value,
                    )

        return aggregated

    # =========================================================================
    # Daily P&L
    # =========================================================================

    def get_daily_stats(self, account_name: str) -> Optional[Dict[str, Any]]:
        """Get daily stats for a specific account."""
        account = self._accounts.get(account_name)
        if not account or not account.position_tracker:
            return None
        return account.position_tracker.get_daily_stats().to_dict()

    def get_all_daily_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get daily stats from all accounts."""
        result = {}
        for name, account in self._accounts.items():
            if account.is_connected and account.position_tracker:
                result[name] = account.position_tracker.get_daily_stats().to_dict()
        return result

    def get_aggregated_daily_pnl(self) -> Dict[str, float]:
        """Get aggregated daily P&L across all accounts."""
        total_realized = 0.0
        total_unrealized = 0.0
        total_trades = 0
        total_wins = 0

        for account in self._accounts.values():
            if account.is_connected and account.position_tracker:
                stats = account.position_tracker.get_daily_stats()
                total_realized += stats.realized_pnl
                total_unrealized += stats.unrealized_pnl
                total_trades += stats.trades_today
                total_wins += stats.winning_trades

        return {
            "realized_pnl": total_realized,
            "unrealized_pnl": total_unrealized,
            "total_pnl": total_realized + total_unrealized,
            "trades_today": total_trades,
            "winning_trades": total_wins,
            "win_rate": total_wins / total_trades if total_trades > 0 else 0.0,
        }

    # =========================================================================
    # Kill Switch
    # =========================================================================

    async def kill_switch(self, account_name: str, reason: str = "Manual trigger") -> Dict[str, Any]:
        """
        EMERGENCY: Flatten all positions on a specific account.

        Args:
            account_name: Account to flatten
            reason: Reason for kill switch

        Returns:
            Results of the kill switch operation
        """
        account = self._accounts.get(account_name)
        if not account:
            return {"success": False, "error": f"Account '{account_name}' not found"}

        if not account.is_connected or not account.order_manager:
            return {"success": False, "error": f"Account '{account_name}' not connected"}

        logger.critical(f"🚨 KILL SWITCH on account '{account_name}': {reason}")

        return await account.order_manager.emergency_flatten(reason)

    async def kill_switch_all(self, reason: str = "Manual trigger - ALL ACCOUNTS") -> Dict[str, Any]:
        """
        EMERGENCY: Flatten all positions on ALL accounts.

        Args:
            reason: Reason for kill switch

        Returns:
            Results from all accounts
        """
        logger.critical(f"🚨 GLOBAL KILL SWITCH: {reason}")

        results = {}
        for name in self._accounts:
            results[name] = await self.kill_switch(name, reason)

        return results

    # =========================================================================
    # Trading Control
    # =========================================================================

    def halt_trading(self, account_name: str, reason: str) -> bool:
        """Halt trading on a specific account."""
        account = self._accounts.get(account_name)
        if not account or not account.order_manager:
            return False
        account.order_manager.halt_trading(reason)
        return True

    def resume_trading(self, account_name: str) -> bool:
        """Resume trading on a specific account."""
        account = self._accounts.get(account_name)
        if not account or not account.order_manager:
            return False
        account.order_manager.resume_trading()
        return True

    def halt_all(self, reason: str) -> Dict[str, bool]:
        """Halt trading on all accounts."""
        results = {}
        for name in self._accounts:
            results[name] = self.halt_trading(name, reason)
        return results

    def resume_all(self) -> Dict[str, bool]:
        """Resume trading on all accounts."""
        results = {}
        for name in self._accounts:
            results[name] = self.resume_trading(name)
        return results

    # =========================================================================
    # Account Info
    # =========================================================================

    async def get_account_info(self, account_name: str) -> Optional[AccountInfo]:
        """Get account info for a specific account."""
        account = self._accounts.get(account_name)
        if not account or not account.client:
            return None
        return await account.client.get_account_info()

    async def get_all_account_info(self) -> Dict[str, Optional[AccountInfo]]:
        """Get account info from all connected accounts."""
        result = {}
        for name, account in self._accounts.items():
            if account.is_connected and account.client:
                result[name] = await account.client.get_account_info()
        return result


# =============================================================================
# Convenience: Pre-configured dual account setup
# =============================================================================

async def create_dual_account_manager(
    paper_client_id: int = 1,
    live_client_id: int = 2,
    paper_loss_limit: float = 1000.0,
    live_loss_limit: float = 500.0,
) -> IBKRAccountManager:
    """
    Create a pre-configured account manager with paper and live accounts.

    Args:
        paper_client_id: Client ID for paper account
        live_client_id: Client ID for live account
        paper_loss_limit: Daily loss limit for paper
        live_loss_limit: Daily loss limit for live

    Returns:
        Configured IBKRAccountManager
    """
    manager = IBKRAccountManager()

    manager.add_account(
        name="paper",
        mode=TradingMode.PAPER,
        client_id=paper_client_id,
        daily_loss_limit=paper_loss_limit,
    )

    manager.add_account(
        name="live",
        mode=TradingMode.LIVE,
        client_id=live_client_id,
        daily_loss_limit=live_loss_limit,
    )

    return manager
