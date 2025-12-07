"""
Futures Backtester

Production-grade event-driven backtester for futures.
Proper walk-forward validation, realistic costs, full audit trail.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Callable, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import logging
import json
from pathlib import Path

logger = logging.getLogger(__name__)


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"


class PositionSide(Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLAT = "FLAT"


@dataclass
class Order:
    """Order representation."""
    order_id: str
    symbol: str
    side: OrderSide
    quantity: int
    order_type: OrderType
    price: Optional[float] = None  # For limit/stop orders
    stop_price: Optional[float] = None  # For stop orders
    timestamp: datetime = field(default_factory=datetime.now)
    filled: bool = False
    fill_price: Optional[float] = None
    fill_timestamp: Optional[datetime] = None
    commission: float = 0.0
    slippage: float = 0.0
    metadata: Dict = field(default_factory=dict)


@dataclass
class Position:
    """Position representation."""
    symbol: str
    side: PositionSide
    quantity: int
    entry_price: float
    entry_timestamp: datetime
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0
    commissions_paid: float = 0.0


@dataclass
class Trade:
    """Completed trade (round trip)."""
    trade_id: str
    symbol: str
    side: PositionSide
    entry_price: float
    exit_price: float
    quantity: int
    entry_time: datetime
    exit_time: datetime
    gross_pnl: float
    commissions: float
    slippage: float
    net_pnl: float
    hold_duration: timedelta
    metadata: Dict = field(default_factory=dict)


@dataclass
class BacktestConfig:
    """Backtester configuration."""
    initial_capital: float = 100_000.0
    commission_per_contract: float = 2.50  # Per side
    slippage_ticks: float = 1.0  # Ticks of slippage per trade
    max_position_size: int = 10  # Max contracts
    use_margin: bool = True
    margin_per_contract: float = 15_000.0  # ES margin approx
    risk_free_rate: float = 0.05  # For Sharpe calculation


class FuturesBacktester:
    """
    Production-grade futures backtester.

    Features:
    - Event-driven architecture
    - Realistic transaction costs
    - Slippage modeling
    - Position and risk tracking
    - Full trade audit trail
    - Walk-forward support
    - Performance analytics
    """

    def __init__(
        self,
        config: Optional[BacktestConfig] = None,
        contract_specs: Optional[Dict] = None
    ):
        self.config = config or BacktestConfig()
        self.contract_specs = contract_specs or {
            'ES': {'tick_size': 0.25, 'tick_value': 12.50, 'multiplier': 50},
            'NQ': {'tick_size': 0.25, 'tick_value': 5.00, 'multiplier': 20},
            'MES': {'tick_size': 0.25, 'tick_value': 1.25, 'multiplier': 5},
            'MNQ': {'tick_size': 0.25, 'tick_value': 0.50, 'multiplier': 2},
        }

        # State
        self.capital = self.config.initial_capital
        self.positions: Dict[str, Position] = {}
        self.orders: List[Order] = []
        self.trades: List[Trade] = []
        self.equity_curve: List[Tuple[datetime, float]] = []

        # Counters
        self._order_counter = 0
        self._trade_counter = 0

    def reset(self):
        """Reset backtester state."""
        self.capital = self.config.initial_capital
        self.positions = {}
        self.orders = []
        self.trades = []
        self.equity_curve = []
        self._order_counter = 0
        self._trade_counter = 0

    def run(
        self,
        data: pd.DataFrame,
        strategy: Callable[[pd.DataFrame, 'FuturesBacktester'], Optional[Order]],
        symbol: str = 'ES'
    ) -> Dict[str, Any]:
        """
        Run backtest.

        Args:
            data: OHLCV DataFrame with features
            strategy: Strategy function that returns Order or None
            symbol: Symbol being traded

        Returns:
            Performance results dict
        """
        self.reset()
        logger.info(f"Starting backtest on {symbol} with {len(data):,} bars")

        spec = self.contract_specs.get(symbol, self.contract_specs['ES'])

        for i in range(len(data)):
            # Get current bar
            current_bar = data.iloc[:i+1]
            current_time = data.index[i]
            current_price = data.iloc[i]['close']

            # Update position P&L
            self._update_positions(symbol, current_price, spec)

            # Record equity
            equity = self._calculate_equity(current_price, spec)
            self.equity_curve.append((current_time, equity))

            # Get signal from strategy
            try:
                order = strategy(current_bar, self)
            except Exception as e:
                logger.error(f"Strategy error at {current_time}: {e}")
                continue

            # Process order
            if order:
                self._process_order(order, current_price, current_time, spec)

        # Close any remaining positions at end
        if symbol in self.positions:
            final_price = data.iloc[-1]['close']
            final_time = data.index[-1]
            self._close_position(symbol, final_price, final_time, spec, "backtest_end")

        # Calculate performance
        results = self._calculate_performance()
        logger.info(f"Backtest complete. Sharpe: {results['sharpe_ratio']:.2f}, "
                   f"Total Return: {results['total_return_pct']:.1f}%")

        return results

    def run_walk_forward(
        self,
        data: pd.DataFrame,
        strategy_factory: Callable,
        symbol: str = 'ES',
        train_period: int = 252,  # ~1 year
        test_period: int = 63,    # ~3 months
        step: int = 21            # ~1 month
    ) -> List[Dict[str, Any]]:
        """
        Run walk-forward backtest.

        Args:
            data: Full OHLCV DataFrame
            strategy_factory: Function that returns a strategy given training data
            train_period: Bars for training
            test_period: Bars for testing
            step: Bars to step forward each iteration

        Returns:
            List of results for each walk-forward period
        """
        results = []
        total_bars = len(data)

        i = 0
        while i + train_period + test_period <= total_bars:
            # Split data
            train_data = data.iloc[i:i + train_period]
            test_data = data.iloc[i + train_period:i + train_period + test_period]

            logger.info(f"Walk-forward period {len(results) + 1}: "
                       f"Train {train_data.index[0]} to {train_data.index[-1]}, "
                       f"Test {test_data.index[0]} to {test_data.index[-1]}")

            # Train strategy
            strategy = strategy_factory(train_data)

            # Test
            self.reset()
            period_results = self.run(test_data, strategy, symbol)
            period_results['train_start'] = train_data.index[0]
            period_results['train_end'] = train_data.index[-1]
            period_results['test_start'] = test_data.index[0]
            period_results['test_end'] = test_data.index[-1]

            results.append(period_results)

            i += step

        # Aggregate results
        if results:
            logger.info(f"Walk-forward complete. {len(results)} periods. "
                       f"Avg Sharpe: {np.mean([r['sharpe_ratio'] for r in results]):.2f}")

        return results

    def _process_order(
        self,
        order: Order,
        current_price: float,
        current_time: datetime,
        spec: Dict
    ):
        """Process an order."""
        # Generate order ID
        self._order_counter += 1
        order.order_id = f"ORD_{self._order_counter:06d}"

        # Calculate fill price with slippage
        slippage_points = self.config.slippage_ticks * spec['tick_size']
        if order.side == OrderSide.BUY:
            fill_price = current_price + slippage_points
        else:
            fill_price = current_price - slippage_points

        # Calculate commission
        commission = self.config.commission_per_contract * order.quantity

        # Enforce Max Position Size limit
        if self.config.max_position_size > 0:
            current_pos = self.positions.get(order.symbol)
            if current_pos:
                current_signed_qty = current_pos.quantity if current_pos.side == PositionSide.LONG else -current_pos.quantity
            else:
                current_signed_qty = 0

            order_signed_qty = order.quantity if order.side == OrderSide.BUY else -order.quantity
            new_signed_qty = current_signed_qty + order_signed_qty

            if abs(new_signed_qty) > self.config.max_position_size:
                logger.warning(
                    f"Order rejected: Position size limit {self.config.max_position_size} exceeded "
                    f"(Current: {current_signed_qty}, New: {new_signed_qty})"
                )
                return

        # Check if we have enough capital/margin (including existing positions)
        if self.config.use_margin:
            # Calculate total margin required (existing positions + new order)
            current_positions_qty = sum(p.quantity for p in self.positions.values())
            total_margin_required = (current_positions_qty + order.quantity) * self.config.margin_per_contract

            # Check against current equity (Capital + Unrealized PnL)
            current_equity = self._calculate_equity(current_price, spec)

            if total_margin_required > current_equity:
                logger.warning(f"Insufficient margin for order: required {total_margin_required:.2f}, equity {current_equity:.2f}")
                return

        # Update order
        order.filled = True
        order.fill_price = fill_price
        order.fill_timestamp = current_time
        order.commission = commission
        order.slippage = abs(fill_price - current_price) * spec['multiplier'] * order.quantity

        self.orders.append(order)

        # Update position (pass commission so it can be tracked)
        self._update_position_from_order(order, spec, commission)

    def _update_position_from_order(self, order: Order, spec: Dict, commission: float = 0.0):
        """Update position based on filled order."""
        symbol = order.symbol

        if symbol not in self.positions:
            # New position - deduct commission from capital for entry
            self.capital -= commission
            side = PositionSide.LONG if order.side == OrderSide.BUY else PositionSide.SHORT
            self.positions[symbol] = Position(
                symbol=symbol,
                side=side,
                quantity=order.quantity,
                entry_price=order.fill_price,
                entry_timestamp=order.fill_timestamp,
                commissions_paid=commission  # Track entry commission
            )
        else:
            pos = self.positions[symbol]

            # Same direction - add to position
            if (pos.side == PositionSide.LONG and order.side == OrderSide.BUY) or \
               (pos.side == PositionSide.SHORT and order.side == OrderSide.SELL):
                # Average in - deduct commission for adding
                self.capital -= commission
                total_qty = pos.quantity + order.quantity
                pos.entry_price = (pos.entry_price * pos.quantity + order.fill_price * order.quantity) / total_qty
                pos.quantity = total_qty
                pos.commissions_paid += commission  # Track cumulative entry commissions
            else:
                # Opposite direction - reduce or flip
                # Exit commission is paid only for closing quantity
                if order.quantity >= pos.quantity:
                    # Close position and possibly flip
                    close_comm = self.config.commission_per_contract * pos.quantity
                    self._close_position(
                        symbol, order.fill_price, order.fill_timestamp, spec,
                        reason="signal_reverse", close_qty=pos.quantity, exit_commission=close_comm
                    )
                    remaining = order.quantity - pos.quantity
                    if remaining > 0:
                        # Open new position in opposite direction - commission for new position
                        new_comm = self.config.commission_per_contract * remaining
                        self.capital -= new_comm
                        new_side = PositionSide.LONG if order.side == OrderSide.BUY else PositionSide.SHORT
                        self.positions[symbol] = Position(
                            symbol=symbol,
                            side=new_side,
                            quantity=remaining,
                            entry_price=order.fill_price,
                            entry_timestamp=order.fill_timestamp,
                            commissions_paid=new_comm
                        )
                else:
                    # Partial close
                    close_comm = self.config.commission_per_contract * order.quantity
                    self._close_position(
                        symbol, order.fill_price, order.fill_timestamp, spec,
                        reason="partial_close", close_qty=order.quantity, exit_commission=close_comm
                    )

    def _close_position(
        self,
        symbol: str,
        exit_price: float,
        exit_time: datetime,
        spec: Dict,
        reason: str = "signal",
        close_qty: Optional[int] = None,
        exit_commission: Optional[float] = None
    ):
        """Close a position (fully or partially)."""
        if symbol not in self.positions:
            return

        pos = self.positions[symbol]
        qty = close_qty or pos.quantity

        # Calculate P&L
        if pos.side == PositionSide.LONG:
            gross_pnl = (exit_price - pos.entry_price) * spec['multiplier'] * qty
        else:
            gross_pnl = (pos.entry_price - exit_price) * spec['multiplier'] * qty

        # Exit commission (passed in, or calculate if not provided)
        if exit_commission is None:
            exit_commission = self.config.commission_per_contract * qty

        # Entry commission proportional to closed quantity
        entry_comm_portion = pos.commissions_paid * qty / pos.quantity if pos.quantity > 0 else 0
        total_commissions = exit_commission + entry_comm_portion

        # Net P&L = gross - exit commission only (entry already deducted from capital)
        net_pnl = gross_pnl - exit_commission

        # Record trade
        self._trade_counter += 1
        trade = Trade(
            trade_id=f"TRD_{self._trade_counter:06d}",
            symbol=symbol,
            side=pos.side,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            quantity=qty,
            entry_time=pos.entry_timestamp,
            exit_time=exit_time,
            gross_pnl=gross_pnl,
            commissions=total_commissions,  # Total commissions for this trade (entry + exit)
            slippage=0,  # Already accounted in fill prices
            net_pnl=gross_pnl - total_commissions,  # True net P&L for reporting
            hold_duration=exit_time - pos.entry_timestamp,
            metadata={'reason': reason}
        )
        self.trades.append(trade)

        # Update capital (only add gross_pnl - exit_commission since entry was already deducted)
        self.capital += net_pnl

        # Update or remove position
        if qty >= pos.quantity:
            del self.positions[symbol]
        else:
            pos.quantity -= qty

    def _update_positions(self, symbol: str, current_price: float, spec: Dict):
        """Update unrealized P&L for positions."""
        if symbol not in self.positions:
            return

        pos = self.positions[symbol]
        if pos.side == PositionSide.LONG:
            pos.unrealized_pnl = (current_price - pos.entry_price) * spec['multiplier'] * pos.quantity
        else:
            pos.unrealized_pnl = (pos.entry_price - current_price) * spec['multiplier'] * pos.quantity

    def _calculate_equity(self, current_price: float, spec: Dict) -> float:
        """Calculate current equity."""
        equity = self.capital
        for pos in self.positions.values():
            equity += pos.unrealized_pnl
        return equity

    def _calculate_performance(self) -> Dict[str, Any]:
        """Calculate performance metrics."""
        if not self.equity_curve:
            return {}

        # Convert equity curve to series
        equity_df = pd.DataFrame(self.equity_curve, columns=['timestamp', 'equity'])
        equity_df.set_index('timestamp', inplace=True)

        # Returns - resample to daily closes first, then calculate returns
        daily_equity = equity_df['equity'].resample('D').last().dropna()
        daily_returns = daily_equity.pct_change().dropna()

        # Basic metrics
        total_return = (equity_df['equity'].iloc[-1] - self.config.initial_capital) / self.config.initial_capital
        total_return_pct = total_return * 100

        # Sharpe ratio (annualized)
        if len(daily_returns) > 0 and daily_returns.std() > 0:
            sharpe_ratio = (daily_returns.mean() - self.config.risk_free_rate / 252) / daily_returns.std() * np.sqrt(252)
        else:
            sharpe_ratio = 0.0

        # Sortino ratio (using downside deviation relative to 0, over ALL days)
        # Downside deviation = sqrt(mean(min(r - target, 0)^2)) where target = 0
        # Use np.minimum to treat positive days as 0 deviation (not filtering to negatives only)
        if len(daily_returns) > 0:
            downside_returns = np.minimum(daily_returns, 0)  # All days, positive treated as 0
            downside_deviation = np.sqrt(np.mean(downside_returns ** 2))
            if downside_deviation > 0:
                sortino_ratio = (daily_returns.mean() - self.config.risk_free_rate / 252) / downside_deviation * np.sqrt(252)
            else:
                sortino_ratio = 0.0
        else:
            sortino_ratio = 0.0

        # Drawdown
        rolling_max = equity_df['equity'].cummax()
        drawdown = (equity_df['equity'] - rolling_max) / rolling_max
        max_drawdown = drawdown.min()
        max_drawdown_pct = max_drawdown * 100

        # Calmar ratio
        years = len(daily_returns) / 252
        if years > 0 and max_drawdown != 0:
            cagr = (1 + total_return) ** (1 / years) - 1
            calmar_ratio = cagr / abs(max_drawdown)
        else:
            calmar_ratio = 0.0

        # Trade statistics
        if self.trades:
            winning_trades = [t for t in self.trades if t.net_pnl > 0]
            losing_trades = [t for t in self.trades if t.net_pnl <= 0]

            win_rate = len(winning_trades) / len(self.trades) if self.trades else 0
            avg_win = np.mean([t.net_pnl for t in winning_trades]) if winning_trades else 0
            avg_loss = np.mean([t.net_pnl for t in losing_trades]) if losing_trades else 0
            profit_factor = abs(sum(t.net_pnl for t in winning_trades) / sum(t.net_pnl for t in losing_trades)) if losing_trades and sum(t.net_pnl for t in losing_trades) != 0 else 0

            avg_hold_duration = np.mean([t.hold_duration.total_seconds() / 3600 for t in self.trades])  # Hours
        else:
            win_rate = avg_win = avg_loss = profit_factor = avg_hold_duration = 0

        return {
            'total_return_pct': total_return_pct,
            'sharpe_ratio': sharpe_ratio,
            'sortino_ratio': sortino_ratio,
            'max_drawdown_pct': max_drawdown_pct,
            'calmar_ratio': calmar_ratio,
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'avg_win': avg_win,
            'avg_loss': avg_loss,
            'avg_hold_hours': avg_hold_duration,
            'total_trades': len(self.trades),
            'winning_trades': len([t for t in self.trades if t.net_pnl > 0]),
            'losing_trades': len([t for t in self.trades if t.net_pnl <= 0]),
            'total_commissions': sum(t.commissions for t in self.trades),
            'final_equity': equity_df['equity'].iloc[-1] if len(equity_df) > 0 else self.config.initial_capital,
            'equity_curve': equity_df['equity'].tolist(),
            'timestamps': [str(t) for t in equity_df.index.tolist()],
        }

    def get_position(self, symbol: str) -> Optional[Position]:
        """Get current position for symbol."""
        return self.positions.get(symbol)

    def get_equity(self) -> float:
        """Get current equity."""
        if not self.equity_curve:
            return self.config.initial_capital
        return self.equity_curve[-1][1]

    def export_trades(self, filepath: str):
        """Export trades to JSON for audit."""
        trades_data = []
        for t in self.trades:
            trades_data.append({
                'trade_id': t.trade_id,
                'symbol': t.symbol,
                'side': t.side.value,
                'entry_price': t.entry_price,
                'exit_price': t.exit_price,
                'quantity': t.quantity,
                'entry_time': str(t.entry_time),
                'exit_time': str(t.exit_time),
                'gross_pnl': t.gross_pnl,
                'commissions': t.commissions,
                'net_pnl': t.net_pnl,
                'hold_duration_hours': t.hold_duration.total_seconds() / 3600,
                'metadata': t.metadata
            })

        with open(filepath, 'w') as f:
            json.dump(trades_data, f, indent=2)

        logger.info(f"Exported {len(trades_data)} trades to {filepath}")
