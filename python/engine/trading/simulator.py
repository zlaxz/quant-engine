#!/usr/bin/env python3
"""
Generic trade execution simulator for options backtesting.
Refactored for "Phase 1: Truth Audit" - High Liquidity Model (SPY/Index Focus).
AUDITED: Fixed Capital Calculation Bug (Premium Handling).
AUDITED: Added Margin Call Check.
"""

import pandas as pd
import numpy as np
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from .trade import Trade
from ..data.events import get_event_manager

class TradeSimulator:
    """
    Executes trades with realistic physics for LIQUID instruments (SPY, QQQ, SPX):
    - Fixed-tick slippage (penny-width markets)
    - VIX-dependent spread widening
    - Explicit commissions
    - Correct Cash/Margin handling
    - Margin Call Protection
    """
    
    def __init__(self, initial_capital: float = 100000.0):
        self.initial_capital = initial_capital
        self.current_capital = initial_capital # Cash Balance
        self.trades: List[Trade] = []
        self.active_trades: List[Trade] = []
        self.equity_curve: List[Dict] = []

        # COST CONFIGURATION (SPY/Index Focused)
        self.commission_per_contract = 0.65  # $0.65 per leg standard retail
        self.min_commission = 1.00
        self.contract_multiplier = 100.0

        # ============================================================
        # DOUBLE-ENTRY ACCOUNTING: Track all cash flows for audit
        # ============================================================
        self.realized_pnl_history: List[float] = []
        self.fees_paid: List[float] = []
        self.collateral_locked: float = 0.0
        self.audit_tick_count: int = 0
        self.audit_passed: bool = True

        # ============================================================
        # EVENT HORIZON: Macro event risk filter
        # ============================================================
        self.event_manager = get_event_manager()
        self.event_blocks: int = 0  # Count of trades blocked by events

        # ============================================================
        # CIRCUIT BREAKER: Daily loss limit
        # ============================================================
        self.daily_starting_equity: float = initial_capital
        self.daily_loss_limit_pct: float = 0.02  # 2% hard stop per day
        self.trading_halted: bool = False
        self.last_date: Optional[datetime] = None

        # ============================================================
        # EXECUTION LAG ENFORCER: T+1 execution to prevent look-ahead bias
        # ============================================================
        # Orders are queued and executed on the NEXT tick, not immediately.
        # This prevents the classic backtest sin of "I see today's close,
        # I trade at today's close" which is impossible in live trading.
        self.pending_orders: List[Dict] = []
        self.enforce_execution_lag: bool = True  # Can disable for specific tests
        self.orders_delayed: int = 0  # Count of orders that were delayed
        
    def _calculate_execution_price(self, mid_price: float, direction: str, action: str, vix: float = 20.0) -> Tuple[float, float]:
        # 1. Determine Half-Spread Penalty (Tick-based)
        if vix < 20:
            half_spread = 0.01   # Normal: ~1-2 cents wide
        elif vix < 35:
            half_spread = 0.02   # Elevated: ~3-5 cents wide
        else:
            half_spread = 0.05   # Crisis: ~10 cents wide
            
        # 2. Apply Directional Penalty
        if action == 'ENTRY':
            if direction == 'LONG':
                exec_price = mid_price + half_spread
            else: # SHORT
                exec_price = mid_price - half_spread
        else: # EXIT
            if direction == 'LONG':
                exec_price = mid_price - half_spread
            else: # SHORT
                exec_price = mid_price + half_spread
                
        return exec_price, half_spread

    def queue_order(self,
                   symbol: str,
                   signal_date: datetime,
                   signal_price: float,
                   size: int,
                   direction: str,
                   strategy_id: str,
                   vix: float = 20.0,
                   volume: int = 0,
                   open_interest: int = 0) -> Dict:
        """
        EXECUTION LAG ENFORCER - Queue an order for T+1 execution.

        Instead of executing immediately (look-ahead bias), this queues
        the order to be executed on the NEXT tick with NEXT tick's price.

        Args:
            signal_date: Date when signal was generated (T)
            signal_price: Price when signal was generated (for logging only)
            ... other args same as enter_trade

        Returns:
            Order dict with order_id for tracking
        """
        order = {
            'order_id': len(self.pending_orders) + 1,
            'symbol': symbol,
            'signal_date': signal_date,
            'signal_price': signal_price,
            'size': size,
            'direction': direction,
            'strategy_id': strategy_id,
            'vix': vix,
            'volume': volume,
            'open_interest': open_interest,
            'status': 'PENDING'
        }

        self.pending_orders.append(order)
        self.orders_delayed += 1
        print(f"  [EXECUTION LAG] Order #{order['order_id']} queued for T+1: {direction} {size} {symbol}")

        return order

    def _execute_pending_orders(self, execution_date: datetime, current_prices: Dict[str, float]) -> List[Trade]:
        """
        Execute all pending orders at current prices.

        Called at the START of each tick (before new signals are generated).
        This ensures T+1 execution: signal at T, execute at T+1 price.

        Args:
            execution_date: Current date (T+1 relative to signal)
            current_prices: Current prices to execute at

        Returns:
            List of Trade objects created
        """
        executed_trades = []
        orders_to_remove = []

        for order in self.pending_orders:
            if order['status'] != 'PENDING':
                continue

            symbol = order['symbol']
            if symbol not in current_prices:
                print(f"  [EXECUTION LAG] Order #{order['order_id']} waiting: {symbol} not in prices")
                continue

            # Execute at T+1 price (NOT signal price)
            execution_price = current_prices[symbol]

            print(f"  [EXECUTION LAG] Executing order #{order['order_id']}: "
                  f"Signal price ${order['signal_price']:.2f} -> Exec price ${execution_price:.2f}")

            # Call _enter_trade_immediate to bypass queue
            trade = self._enter_trade_immediate(
                symbol=symbol,
                date=execution_date,
                price=execution_price,
                size=order['size'],
                direction=order['direction'],
                strategy_id=order['strategy_id'],
                vix=order['vix'],
                volume=order['volume'],
                open_interest=order['open_interest']
            )

            if trade:
                order['status'] = 'FILLED'
                order['execution_date'] = execution_date
                order['execution_price'] = execution_price
                executed_trades.append(trade)
            else:
                order['status'] = 'REJECTED'

            orders_to_remove.append(order)

        # Clean up executed/rejected orders
        for order in orders_to_remove:
            self.pending_orders.remove(order)

        return executed_trades

    def _enter_trade_immediate(self,
                               symbol: str,
                               date: datetime,
                               price: float,
                               size: int,
                               direction: str,
                               strategy_id: str,
                               vix: float = 20.0,
                               volume: int = 0,
                               open_interest: int = 0) -> Optional[Trade]:
        """
        Internal method to execute trade immediately (bypasses queue).
        Contains the actual trade execution logic.
        """
        # All safety checks are here (same as original enter_trade)
        if self.trading_halted:
            print(f"  [CIRCUIT BREAKER] Trading halted for the day. Trade rejected.")
            return None

        if self.current_capital <= 0:
            print(f"  [MARGIN CALL] Trade rejected. Capital: {self.current_capital:.2f}")
            return None

        is_risky, risk_reason = self.event_manager.is_high_risk_window(date)
        if is_risky:
            self.event_blocks += 1
            print(f"  [EVENT HORIZON] Trade rejected. {risk_reason}")
            return None

        if volume > 0 or open_interest > 0:
            if volume < 50 or open_interest < 100:
                print(f"  [LIQUIDITY TRAP] Trade rejected. Vol: {volume}, OI: {open_interest}")
                return None

        exec_price, slippage = self._calculate_execution_price(mid_price=price, direction=direction, action='ENTRY', vix=vix)
        comm = max(abs(size) * self.commission_per_contract, self.min_commission)

        premium_total = exec_price * abs(size) * self.contract_multiplier

        if direction == 'LONG':
            cost = premium_total + comm
            if self.current_capital < cost:
                print(f"  [INSUFFICIENT FUNDS] Trade rejected. Cost: {cost:.2f}, Cap: {self.current_capital:.2f}")
                return None
            self.current_capital -= premium_total
        else:
            self.current_capital += premium_total

        self.current_capital -= comm

        trade = Trade(
            symbol=symbol,
            entry_date=date,
            entry_price=exec_price,
            position_size=size,
            direction=direction,
            strategy_id=strategy_id,
            entry_commission=comm,
            entry_slippage=slippage,
            entry_vix=vix,
            entry_regime='UNKNOWN'
        )

        self.active_trades.append(trade)
        return trade

    def enter_trade(self,
                   symbol: str,
                   date: datetime,
                   price: float,
                   size: int,
                   direction: str,
                   strategy_id: str,
                   vix: float = 20.0,
                   volume: int = 0,
                   open_interest: int = 0,
                   immediate: bool = False) -> Optional[Trade]:
        """
        Open a new position.

        By default, uses T+1 execution (queue_order) to prevent look-ahead bias.
        Set immediate=True to execute immediately (use with caution - only for
        cases like executing pending orders or specific testing scenarios).

        Returns None if any safety check fails:
        - Margin Call
        - Circuit Breaker (daily loss limit)
        - Event Horizon (macro event risk)
        - Liquidity Trap (zero volume/OI)

        Args:
            immediate: If True, execute now. If False (default), queue for T+1.
        """
        # ========================================
        # EXECUTION LAG ENFORCER
        # ========================================
        if self.enforce_execution_lag and not immediate:
            # Queue for T+1 execution instead of executing immediately
            order = self.queue_order(
                symbol=symbol,
                signal_date=date,
                signal_price=price,
                size=size,
                direction=direction,
                strategy_id=strategy_id,
                vix=vix,
                volume=volume,
                open_interest=open_interest
            )
            # Return None because trade hasn't executed yet
            # The trade will be created on the next tick via _execute_pending_orders
            return None

        # Immediate execution path (for pending orders or when lag is disabled)
        return self._enter_trade_immediate(
            symbol=symbol,
            date=date,
            price=price,
            size=size,
            direction=direction,
            strategy_id=strategy_id,
            vix=vix,
            volume=volume,
            open_interest=open_interest
        )

    def exit_trade(self, 
                  trade: Trade, 
                  date: datetime, 
                  price: float, 
                  reason: str,
                  vix: float = 20.0):
        """
        Close a position.
        """
        if trade not in self.active_trades:
            return
            
        # Special handling for Expiration (No spread penalty usually, or minimal)
        if reason == 'expiration':
             # Settlement is exact
             exec_price = price
             slippage = 0.0
        else:
             exec_price, slippage = self._calculate_execution_price(mid_price=price, direction=trade.direction, action='EXIT', vix=vix)
        
        comm = max(abs(trade.position_size) * self.commission_per_contract, self.min_commission)
        
        # CASH IMPACT LOGIC
        premium_total = exec_price * abs(trade.position_size) * self.contract_multiplier
        
        if trade.direction == 'LONG':
            self.current_capital += premium_total
        else: # SHORT
            self.current_capital -= premium_total
            
        # Pay Commission
        self.current_capital -= comm
        
        # Update Trade Object
        trade.close(exit_price=exec_price, exit_date=date, reason=reason, commission=comm)
        trade.exit_slippage = slippage

        # DOUBLE-ENTRY ACCOUNTING: Track realized P&L and fees
        if hasattr(trade, 'pnl_realized'):
            self.realized_pnl_history.append(trade.pnl_realized)
        self.fees_paid.append(trade.entry_commission + comm)  # Entry + exit commission

        self.active_trades.remove(trade)
        self.trades.append(trade)

    def mark_to_market(self, date: datetime, current_prices: Dict[str, float]) -> List[Trade]:
        """
        Update portfolio equity (Liquidation Value).
        Also executes pending orders (T+1 execution) and checks daily circuit breaker.

        Returns:
            List of trades executed from pending orders this tick
        """
        # ========================================
        # EXECUTION LAG ENFORCER: Execute pending orders FIRST
        # ========================================
        # This ensures T+1 execution: orders queued yesterday execute at today's prices
        executed_trades = self._execute_pending_orders(date, current_prices)

        liquidation_value = 0.0

        for trade in self.active_trades:
            if trade.symbol in current_prices:
                mid_price = current_prices[trade.symbol]

                trade.calculate_pnl(mid_price, date)

                value = mid_price * abs(trade.position_size) * self.contract_multiplier
                if trade.direction == 'LONG':
                    liquidation_value += value
                else:
                    liquidation_value -= value

        total_equity = self.current_capital + liquidation_value

        # ========================================
        # CIRCUIT BREAKER: Daily Loss Limit Check
        # ========================================
        # Check for new day to reset starting equity
        if self.last_date is None:
            self.daily_starting_equity = total_equity
            self.trading_halted = False
        elif hasattr(date, 'date') and hasattr(self.last_date, 'date'):
            if date.date() > self.last_date.date():
                self.daily_starting_equity = total_equity
                self.trading_halted = False

        # Check daily drawdown
        if self.daily_starting_equity > 0:
            daily_drawdown = (total_equity - self.daily_starting_equity) / self.daily_starting_equity

            if daily_drawdown < -self.daily_loss_limit_pct and not self.trading_halted:
                self.trading_halted = True
                print(f"  [CIRCUIT BREAKER] Daily loss limit hit ({daily_drawdown:.2%}). TRADING HALTED.")

        self.last_date = date

        self.equity_curve.append({
            'date': date,
            'equity': total_equity,
            'cash': self.current_capital,
            'active_trades': len(self.active_trades),
            'trading_halted': self.trading_halted
        })

        # Run accounting audit after every tick
        self._audit_step()

        return executed_trades

    def get_unrealized_pnl(self) -> float:
        """
        Calculate total unrealized P&L across all open positions.
        Uses last marked prices from most recent mark_to_market.
        """
        total = 0.0
        for trade in self.active_trades:
            total += trade.pnl_unrealized if hasattr(trade, 'pnl_unrealized') else 0.0
        return total

    def _audit_step(self):
        """
        DOUBLE-ENTRY ACCOUNTING AUDIT
        Runs after EVERY tick. Verifies the accounting equation holds true.
        If a penny disappears, the system halts.
        """
        self.audit_tick_count += 1

        # The "Asset Side" - What we physically have
        calculated_equity = (
            self.current_capital +
            self.collateral_locked +
            self.get_unrealized_pnl()
        )

        # The "Liability/History Side" - What we should have based on transactions
        historical_equity = (
            self.initial_capital +
            sum(self.realized_pnl_history) -
            sum(self.fees_paid)
        )

        # THE CHECK - Floating point tolerance of $0.01
        diff = abs(calculated_equity - historical_equity)
        if diff > 0.01:
            self.audit_passed = False
            error_msg = f"""
            =====================================================
            ACCOUNTING FAILURE DETECTED AT TICK {self.audit_tick_count}!
            =====================================================
            Calculated Equity: ${calculated_equity:,.2f}
            Historical Equity: ${historical_equity:,.2f}
            Difference: ${diff:.2f}

            The engine is leaking money or creating it from thin air.
            HALTING TO PROTECT CAPITAL.
            =====================================================
            """
            print(error_msg)
            raise SystemError(error_msg)

    def get_integrity_status(self) -> dict:
        """
        Returns the current integrity status of the simulator.
        Used by the System Integrity Dashboard.
        """
        return {
            # Double-Entry Accounting
            'audit_passed': self.audit_passed,
            'ticks_checked': self.audit_tick_count,
            'total_fees': sum(self.fees_paid),
            'total_realized_pnl': sum(self.realized_pnl_history),
            'current_equity': self.current_capital + self.get_unrealized_pnl(),
            # Circuit Breaker
            'trading_halted': self.trading_halted,
            'daily_loss_limit_pct': self.daily_loss_limit_pct,
            'daily_starting_equity': self.daily_starting_equity,
            # Event Horizon
            'event_blocks': self.event_blocks,
            # Execution Lag Enforcer
            'execution_lag_enabled': self.enforce_execution_lag,
            'orders_delayed': self.orders_delayed,
            'pending_orders': len(self.pending_orders),
            # Active Positions
            'active_trades': len(self.active_trades)
        }

    def get_results(self) -> pd.DataFrame:
        if not self.trades: return pd.DataFrame()
        data = []
        for t in self.trades:
            data.append({
                'entry_date': t.entry_date,
                'exit_date': t.exit_date,
                'symbol': t.symbol,
                'direction': t.direction,
                'entry_price': t.entry_price,
                'exit_price': t.exit_price,
                'pnl': t.pnl_realized,
                'return_pct': (t.pnl_realized / (t.entry_price * 100 * abs(t.position_size))) if t.entry_price > 0 else 0,
                'commissions': t.entry_commission + t.exit_commission,
                'slippage': t.entry_slippage + t.exit_slippage,
                'exit_reason': t.exit_reason
            })
        return pd.DataFrame(data)

    def run(self, data: pd.DataFrame, strategy_key: str) -> dict:
        """
        High-level backtest runner (INCOMPLETE).

        This method is called by the API but is not yet implemented.
        TradeSimulator is currently a low-level execution engine.

        TODO: Either:
        1. Implement strategy loading and backtest loop here, OR
        2. Refactor API routes to use Profile classes directly

        Args:
            data: DataFrame with market data (OHLCV, regimes, features)
            strategy_key: Strategy identifier (e.g., 'profile_1')

        Returns:
            dict with keys: metrics, equity_curve, trades

        Raises:
            NotImplementedError: This method needs implementation
        """
        raise NotImplementedError(
            f"TradeSimulator.run() is not implemented. "
            f"The API endpoint at /backtest calls this method but it doesn't exist yet. "
            f"Options:\n"
            f"1. Use Profile classes directly (e.g., Profile1LongDatedGamma.run_backtest())\n"
            f"2. Implement this method to load strategies and execute backtest loop\n"
            f"Current strategy requested: {strategy_key}"
        )