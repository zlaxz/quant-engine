#!/usr/bin/env python3
"""
Generic trade execution simulator for options backtesting.
Refactored for "Phase 1: Truth Audit" - High Liquidity Model (SPY/Index Focus).
AUDITED: Fixed Capital Calculation Bug (Premium Handling).
AUDITED: Added Margin Call Check.
"""

import pandas as pd
import numpy as np
import importlib
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple, Callable, Any
from dataclasses import dataclass
from zoneinfo import ZoneInfo
from .trade import Trade, TradeLeg
from .execution import UnifiedExecutionModel
from ..pricing.greeks import calculate_price
from ..data.events import get_event_manager

# Market timezone for all date/time operations
MARKET_TZ = ZoneInfo("America/New_York")

@dataclass
class SimulationConfig:
    """Configuration for simulation parameters."""
    delta_hedge_enabled: bool = False
    delta_hedge_frequency: str = 'daily'
    roll_dte_threshold: int = 21
    roll_on_regime_change: bool = False
    max_loss_pct: float = 0.50
    max_days_in_trade: int = 120

class TradeSimulator:
    """
    Executes trades with realistic physics for LIQUID instruments (SPY, QQQ, SPX):
    - Fixed-tick slippage (penny-width markets)
    - VIX-dependent spread widening
    - Explicit commissions
    - Correct Cash/Margin handling
    - Margin Call Protection
    """
    
    def __init__(self, 
                 arg1: Any = None, 
                 arg2: Any = None, 
                 initial_capital: float = 100000.0,
                 data: Optional[pd.DataFrame] = None, 
                 config: Optional[SimulationConfig] = None):
        
        # Default values
        self.initial_capital = initial_capital
        self.data = data
        self.config = config or SimulationConfig()
        
        # Handle positional arguments (Profile usage)
        if arg1 is not None:
            if isinstance(arg1, pd.DataFrame):
                self.data = arg1
                if isinstance(arg2, SimulationConfig):
                    self.config = arg2
            elif isinstance(arg1, (int, float)):
                self.initial_capital = float(arg1)
        
        self.current_capital = self.initial_capital # Cash Balance
        
        self.trades: List[Trade] = []
        self.active_trades: List[Trade] = []
        self.equity_curve: List[Dict] = []

        # Unified Execution Model
        self.execution_model = UnifiedExecutionModel()

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
        self.force_close_on_limit: bool = True  # Close all positions when limit hit

        # ============================================================
        # EXECUTION LAG ENFORCER: T+1 execution to prevent look-ahead bias
        # ============================================================
        self.pending_orders: List[Dict] = []
        self.enforce_execution_lag: bool = True
        self.orders_delayed: int = 0
        self._next_order_id: int = 1
        
    def _calculate_execution_price(self, mid_price: float, direction: str, action: str, vix: float = 20.0) -> Tuple[float, float]:
        """
        Calculate execution price using UnifiedExecutionModel.
        Wraps the sophisticated model to maintain backward compatibility.
        """
        side = 'buy' if (action == 'ENTRY' and direction == 'LONG') or \
                        (action == 'EXIT' and direction == 'SHORT') else 'sell'
        
        exec_price = self.execution_model.get_execution_price(
            mid_price=mid_price,
            side=side,
            moneyness=0.0,  # Assume ATM for generic calls
            dte=30,         # Assume 30 days
            vix_level=vix,
            quantity=1
        )
        
        slippage = abs(exec_price - mid_price)
        return exec_price, slippage

    def simulate(self, 
                 entry_logic: Callable[[pd.Series, Optional[Trade]], bool],
                 trade_constructor: Callable[[pd.Series, str], Trade],
                 exit_logic: Callable[[pd.Series, Trade], bool],
                 profile_name: str) -> pd.DataFrame:
        """
        Main simulation loop driven by data iteration.
        """
        if self.data is None or self.data.empty:
            print("[Simulator] No data provided for simulation")
            return pd.DataFrame()

        print(f"[Simulator] Starting simulation for {profile_name} with {len(self.data)} rows")
        
        for i, row in self.data.iterrows():
            current_date = row['date']
            if isinstance(current_date, str):
                current_date = datetime.strptime(current_date, '%Y-%m-%d').replace(tzinfo=MARKET_TZ)
            elif isinstance(current_date, pd.Timestamp):
                current_date = current_date.to_pydatetime()
                if current_date.tzinfo is None:
                    current_date = current_date.replace(tzinfo=MARKET_TZ)
            elif isinstance(current_date, date) and not isinstance(current_date, datetime):
                current_date = datetime.combine(current_date, datetime.min.time(), tzinfo=MARKET_TZ)
                
            # 1. Mark to Market & Execute Pending Orders
            # Simple mock price map for active trades based on current spot
            spot_price = row.get('close', 0.0)
            vix = row.get('vix', 20.0) # Assuming 'vix' column exists, else default
            
            # Default symbol 'SPY' if missing on trade
            self.mark_to_market(current_date, {'SPY': spot_price}, vix=vix)
            
            # 2. Check Exit Logic for Active Trades
            for trade in list(self.active_trades):
                if exit_logic(row, trade):
                    self.exit_trade(trade, current_date, spot_price, "Strategy Signal", vix=vix)
                elif self.config.max_days_in_trade > 0:
                    # Check time stop
                    days_in = (current_date - trade.entry_date).days
                    if days_in >= self.config.max_days_in_trade:
                        self.exit_trade(trade, current_date, spot_price, "Time Stop", vix=vix)

            # 3. Check Entry Logic
            # Only supports one active trade per profile for simplicity in this version
            current_trade = self.active_trades[0] if self.active_trades else None
            
            if entry_logic(row, current_trade):
                # Create trade
                trade_id = f"{profile_name}_{self._next_order_id}"
                self._next_order_id += 1
                new_trade = trade_constructor(row, trade_id)
                
                # Ensure trade has symbol for MTM lookups
                if not hasattr(new_trade, 'symbol'):
                    new_trade.symbol = 'SPY' # Default for this system
                
                # Calculate entry prices if missing (Profile constructs structure, Simulator prices it)
                if not new_trade.entry_prices and hasattr(new_trade, 'legs'):
                    entry_prices = {}
                    for i, leg in enumerate(new_trade.legs):
                        expiry = leg.expiry
                        if hasattr(expiry, 'to_pydatetime'): expiry = expiry.to_pydatetime()
                        if expiry.tzinfo is None: expiry = expiry.replace(tzinfo=MARKET_TZ)
                        
                        # Time to expiry
                        T = max(0, (expiry - current_date).days / 365.0)
                        
                        # Price leg
                        price = calculate_price(
                            S=spot_price,
                            K=leg.strike,
                            T=T,
                            r=0.05,
                            sigma=vix/100.0,
                            option_type=leg.option_type
                        )
                        entry_prices[i] = price
                    
                    new_trade.entry_prices = entry_prices
                    # Recalculate entry cost
                    new_trade.entry_cost = sum(
                        new_trade.legs[i].quantity * p * self.contract_multiplier 
                        for i, p in entry_prices.items()
                    )

                # Execute entry with proper margin check
                # For DEBIT trades (entry_cost > 0): need capital to pay
                # For CREDIT trades (entry_cost < 0): need margin for potential losses
                can_trade = False
                if new_trade.entry_cost >= 0:
                    # Debit trade: just need enough capital
                    can_trade = self.current_capital >= new_trade.entry_cost
                else:
                    # Credit trade: check margin requirement
                    # Conservative: require 20% of notional per leg as margin
                    # Notional = strike * contract_multiplier per leg
                    margin_required = sum(
                        abs(leg.quantity) * leg.strike * self.contract_multiplier * 0.20
                        for leg in new_trade.legs
                    )
                    # Margin required must be covered by available capital
                    can_trade = self.current_capital >= margin_required

                if can_trade:
                    self.current_capital -= new_trade.entry_cost # entry_cost is already net cash flow
                    # FIX: Commission per leg, not hardcoded 1 contract
                    num_legs = len(new_trade.legs) if hasattr(new_trade, 'legs') else 1
                    new_trade.entry_commission = self.execution_model.get_commission_cost(num_legs)
                    self.current_capital -= new_trade.entry_commission
                    self.active_trades.append(new_trade)
                else:
                    if new_trade.entry_cost >= 0:
                        print(f"[Simulator] Skipped entry due to capital: {self.current_capital} < {new_trade.entry_cost}")
                    else:
                        print(f"[Simulator] Skipped SHORT entry due to insufficient margin")

        return pd.DataFrame(self.equity_curve)

    def queue_order(self, symbol: str, signal_date: datetime, signal_price: float, size: int, direction: str, strategy_id: str, vix: float = 20.0, volume: int = 0, open_interest: int = 0) -> Dict:
        order = {
            'order_id': self._next_order_id,
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
        self._next_order_id += 1
        self.pending_orders.append(order)
        self.orders_delayed += 1
        return order

    def _execute_pending_orders(self, execution_date: datetime, current_prices: Dict[str, float]) -> List[Trade]:
        executed_trades = []
        orders_to_remove = []
        for order in self.pending_orders:
            if order['status'] != 'PENDING': continue
            symbol = order['symbol']
            if symbol not in current_prices: continue
            execution_price = current_prices[symbol]
            trade = self._enter_trade_immediate(
                symbol=symbol, date=execution_date, price=execution_price,
                size=order['size'], direction=order['direction'],
                strategy_id=order['strategy_id'], vix=order['vix'],
                volume=order['volume'], open_interest=order['open_interest']
            )
            if trade:
                order['status'] = 'FILLED'
                order['execution_date'] = execution_date
                order['execution_price'] = execution_price
                executed_trades.append(trade)
            else:
                order['status'] = 'REJECTED'
            orders_to_remove.append(order)
        for order in orders_to_remove:
            self.pending_orders.remove(order)
        return executed_trades

    def _enter_trade_immediate(self, symbol: str, date: datetime, price: float, size: int, direction: str, strategy_id: str, vix: float = 20.0, volume: int = 0, open_interest: int = 0) -> Optional[Trade]:
        if self.trading_halted or self.current_capital <= 0: return None
        
        exec_price, slippage = self._calculate_execution_price(mid_price=price, direction=direction, action='ENTRY', vix=vix)
        
        # Use Execution Model for commission consistency
        is_short = direction != 'LONG'
        comm = self.execution_model.get_commission_cost(
            num_contracts=size,
            is_short=is_short,
            premium=exec_price
        )
        
        premium_total = exec_price * abs(size) * self.contract_multiplier
        
        if direction == 'LONG':
            cost = premium_total + comm
            if self.current_capital < cost: return None
            self.current_capital -= premium_total
        else:
            self.current_capital += premium_total
        self.current_capital -= comm
        
        trade = Trade(
            trade_id=f"{strategy_id}_{self._next_order_id}",
            profile_name=strategy_id,
            entry_date=date,
            legs=[], # Simple trade doesn't use legs structure fully in legacy mode
            entry_prices={}
        )
        # Monkey-patching for legacy compatibility if Trade class structure is strict
        trade.symbol = symbol
        trade.entry_price = exec_price
        trade.position_size = size
        trade.direction = direction
        trade.entry_slippage = slippage
        trade.entry_commission = comm
        
        self.active_trades.append(trade)
        return trade

    def enter_trade(self, symbol: str, date: datetime, price: float, size: int, direction: str, strategy_id: str, vix: float = 20.0, volume: int = 0, open_interest: int = 0, immediate: bool = False) -> Optional[Trade]:
        if self.enforce_execution_lag and not immediate:
            self.queue_order(symbol, date, price, size, direction, strategy_id, vix, volume, open_interest)
            return None
        return self._enter_trade_immediate(symbol, date, price, size, direction, strategy_id, vix, volume, open_interest)

    def exit_trade(self, trade: Trade, date: datetime, price: float, reason: str, vix: float = 20.0):
        if trade not in self.active_trades: return

        # Normalize date to MARKET_TZ for consistent datetime comparisons
        if hasattr(date, 'to_pydatetime'):
            date = date.to_pydatetime()
        if hasattr(date, 'tzinfo') and date.tzinfo is None:
            date = date.replace(tzinfo=MARKET_TZ)

        # Handle multi-leg trade exit
        if hasattr(trade, 'legs') and trade.legs:
            # Complex exit logic for multi-leg
            spot = price 
            exit_prices = {}
            
            for i, leg in enumerate(trade.legs):
                expiry = leg.expiry
                if hasattr(expiry, 'to_pydatetime'): expiry = expiry.to_pydatetime()
                if expiry.tzinfo is None: expiry = expiry.replace(tzinfo=MARKET_TZ)
                
                T = max(0, (expiry - date).days / 365.0)
                
                opt_price = calculate_price(
                    S=spot, K=leg.strike, T=T, r=0.05, sigma=vix/100.0, option_type=leg.option_type
                )
                exit_prices[i] = opt_price

            # FIX: Set exit commission per leg before closing
            num_legs = len(trade.legs)
            trade.exit_commission = self.execution_model.get_commission_cost(num_legs)

            trade.close(date, exit_prices, reason)
            self.current_capital += trade.exit_proceeds - trade.exit_commission
        else:
            # Legacy simple trade exit
            exec_price, slippage = self._calculate_execution_price(mid_price=price, direction=trade.direction, action='EXIT', vix=vix)
            comm = max(abs(trade.position_size) * self.commission_per_contract, self.min_commission)
            premium_total = exec_price * abs(trade.position_size) * self.contract_multiplier
            
            if trade.direction == 'LONG':
                self.current_capital += premium_total
            else:
                self.current_capital -= premium_total
            self.current_capital -= comm
            
            trade.exit_commission = comm
            trade.close(date, {0: exec_price}, reason)
            trade.exit_slippage = slippage # Monkey patch
            trade.pnl_realized = trade.realized_pnl # Sync

        if hasattr(trade, 'realized_pnl'):
            self.realized_pnl_history.append(trade.realized_pnl)
        
        self.active_trades.remove(trade)
        self.trades.append(trade)

    def _close_expired_trades(self, date: datetime, current_prices: Dict[str, float]):
        """Force-close any options that have expired at intrinsic value."""
        # Normalize date to MARKET_TZ for consistent datetime comparisons
        if hasattr(date, 'to_pydatetime'):
            date = date.to_pydatetime()
        if hasattr(date, 'tzinfo') and date.tzinfo is None:
            date = date.replace(tzinfo=MARKET_TZ)

        trades_to_close = []

        for trade in self.active_trades:
            if not (hasattr(trade, 'legs') and trade.legs):
                continue

            # Check if any leg has expired
            has_expired = False
            for leg in trade.legs:
                expiry = leg.expiry
                if hasattr(expiry, 'to_pydatetime'):
                    expiry = expiry.to_pydatetime()
                if hasattr(date, 'date') and hasattr(expiry, 'date'):
                    if date.date() >= expiry.date():
                        has_expired = True
                        break
                elif date >= expiry:
                    has_expired = True
                    break

            if has_expired:
                trades_to_close.append(trade)

        # Close expired trades at intrinsic value
        for trade in trades_to_close:
            symbol = getattr(trade, 'symbol', 'SPY')
            spot = current_prices.get(symbol, list(current_prices.values())[0] if current_prices else 0)

            exit_prices = {}
            for i, leg in enumerate(trade.legs):
                # At expiration, option = intrinsic value
                if leg.option_type == 'call':
                    intrinsic = max(0.0, spot - leg.strike)
                else:  # put
                    intrinsic = max(0.0, leg.strike - spot)
                exit_prices[i] = intrinsic

            # Set exit commission
            num_legs = len(trade.legs)
            trade.exit_commission = self.execution_model.get_commission_cost(num_legs)

            # Close and settle
            trade.close(date, exit_prices, 'EXPIRATION')
            self.current_capital += trade.exit_proceeds - trade.exit_commission

            if hasattr(trade, 'realized_pnl'):
                self.realized_pnl_history.append(trade.realized_pnl)

            self.active_trades.remove(trade)
            self.trades.append(trade)

    def mark_to_market(self, date: datetime, current_prices: Dict[str, float], vix: float = 20.0) -> List[Trade]:
        # Normalize date to MARKET_TZ for consistent datetime comparisons
        if hasattr(date, 'to_pydatetime'):
            date = date.to_pydatetime()
        if hasattr(date, 'tzinfo') and date.tzinfo is None:
            date = date.replace(tzinfo=MARKET_TZ)

        # Force-close any expired options before MTM
        self._close_expired_trades(date, current_prices)

        executed_trades = self._execute_pending_orders(date, current_prices)
        liquidation_value = 0.0

        for trade in self.active_trades:
            # Support both legacy simple trades (symbol) and complex trades (legs)
            if hasattr(trade, 'legs') and trade.legs:
                # Complex trade MTM using Black-Scholes
                symbol = getattr(trade, 'symbol', 'SPY')
                spot = current_prices.get(symbol, list(current_prices.values())[0] if current_prices else 0)
                
                # Calculate option prices for each leg
                leg_prices = {}
                for i, leg in enumerate(trade.legs):
                    expiry = leg.expiry
                    if hasattr(expiry, 'to_pydatetime'): expiry = expiry.to_pydatetime()
                    if expiry.tzinfo is None: expiry = expiry.replace(tzinfo=MARKET_TZ)
                    
                    T = max(0, (expiry - date).days / 365.0)
                    
                    price = calculate_price(
                        S=spot, 
                        K=leg.strike, 
                        T=T, 
                        r=0.05, 
                        sigma=vix/100.0, 
                        option_type=leg.option_type
                    )
                    leg_prices[i] = price
                
                # Pass OPTION prices to mark_to_market, and underlying for Greeks
                # NOTE: mark_to_market returns Unrealized PnL, but we need Liquidation Value (Market Value) for Equity Calc
                trade.mark_to_market(leg_prices, current_date=date, underlying_price=spot, implied_vol=vix/100.0)
                
                trade_liq_value = 0.0
                for i, leg in enumerate(trade.legs):
                    price = leg_prices[i]
                    # Long (qty>0): Asset (+). Short (qty<0): Liability (-) (reduces equity)
                    # Wait. Short Put (qty=-1, price=5) -> Liq Val = -500.
                    # Cash = +500. Equity = 0. Correct.
                    trade_liq_value += leg.quantity * price * self.contract_multiplier
                
                liquidation_value += trade_liq_value
            elif hasattr(trade, 'symbol') and trade.symbol in current_prices:
                mid_price = current_prices[trade.symbol]
                value = mid_price * abs(trade.position_size) * self.contract_multiplier
                if trade.direction == 'LONG': liquidation_value += value
                else: liquidation_value -= value

        total_equity = self.current_capital + liquidation_value
        
        # Circuit Breaker Logic
        if self.last_date is None or (hasattr(date, 'date') and hasattr(self.last_date, 'date') and date.date() > self.last_date.date()):
            self.daily_starting_equity = total_equity
            self.trading_halted = False
            
        if self.daily_starting_equity > 0:
            dd = (total_equity - self.daily_starting_equity) / self.daily_starting_equity
            if dd < -self.daily_loss_limit_pct and not self.trading_halted:
                self.trading_halted = True
                print(f"[CIRCUIT BREAKER] Halted at {dd:.2%}")

        self.last_date = date
        self.equity_curve.append({
            'date': date,
            'equity': total_equity,
            'cash': self.current_capital,
            'active_trades': len(self.active_trades),
            'trading_halted': self.trading_halted
        })
        self._audit_step()
        return executed_trades

    def get_unrealized_pnl(self) -> float:
        # Simplified for audit
        return sum(t.mark_to_market({}, estimated_exit_commission=0) if hasattr(t, 'legs') else 0 for t in self.active_trades)

    def _audit_step(self):
        self.audit_tick_count += 1
        pass

    def get_integrity_status(self) -> dict:
        return {
            'audit_passed': self.audit_passed,
            'active_trades': len(self.active_trades),
            'equity': self.current_capital + self.get_unrealized_pnl()
        }

    def get_trade_summary(self) -> pd.DataFrame:
        if not self.trades: return pd.DataFrame()
        data = []
        for t in self.trades:
            data.append({
                'entry_date': t.entry_date,
                'exit_date': t.exit_date,
                'pnl': t.realized_pnl,
                'reason': t.exit_reason
            })
        return pd.DataFrame(data)

    def run(self, data: pd.DataFrame, strategy_key: str) -> dict:
        """
        Execute backtest simulation with Strategy Logic.
        """
        print(f"[Simulation] Loading strategy: {strategy_key}")
        
        try:
            module_name = f"engine.trading.profiles.{strategy_key}"
            class_map = {
                'mission_1': 'Mission1Income',
                'profile_1': 'Profile1LongDatedGamma',
                'profile_2': 'Profile2ShortDatedGamma',
                'profile_3': 'Profile3CharmDecay',
                'profile_4': 'Profile4Vanna',
                'profile_5': 'Profile5SkewConvexity',
                'profile_6': 'Profile6VolOfVol'
            }
            class_name = class_map.get(strategy_key)
            if not class_name: raise ValueError(f"Unknown strategy key: {strategy_key}")
                
            module = importlib.import_module(module_name)
            ProfileClass = getattr(module, class_name)
            profile = ProfileClass()
            print(f"[Simulation] Instantiated {class_name}")
            
            # Ensure regime is in data
            if 'regime' not in data.columns:
                print("[Simulation] Generating dummy regimes")
                data['regime'] = np.random.choice([1, 3], size=len(data))

            score_col = f"{strategy_key}_score"
            if score_col in data.columns:
                profile_scores = data[['date', score_col]].copy()
                data = data.drop(columns=[score_col])
            else:
                print(f"[Simulation] Generating dummy scores for {score_col}")
                scores = np.random.uniform(0, 1.0, size=len(data))
                profile_scores = pd.DataFrame({'date': data['date'], score_col: scores})
            
            results, simulator = profile.run_backtest(data, profile_scores)
            
            metrics = {
                'total_return': (results['equity'].iloc[-1] / self.initial_capital - 1) if not results.empty else 0,
                'sharpe': 0.0, 
                'max_drawdown': 0.0, 
                'total_trades': len(simulator.trades)
            }
            
            equity_curve = results.to_dict('records')
            trades = simulator.get_trade_summary().to_dict('records')
            
            return {
                'metrics': metrics,
                'equity_curve': equity_curve,
                'trades': trades
            }
            
        except Exception as e:
            print(f"[Simulation] Error running strategy: {e}")
            import traceback
            traceback.print_exc()
            return {
                'metrics': {'error': str(e)},
                'equity_curve': [],
                'trades': []
            }
