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

    def enter_trade(self, 
                   symbol: str, 
                   date: datetime, 
                   price: float, 
                   size: int, 
                   direction: str, 
                   strategy_id: str,
                   vix: float = 20.0) -> Optional[Trade]:
        """
        Open a new position.
        Returns None if Margin Call triggered.
        """
        # MARGIN CALL CHECK (Safety Valve)
        if self.current_capital <= 0:
            print(f"  [MARGIN CALL] Trade rejected. Capital: {self.current_capital:.2f}")
            return None
            
        exec_price, slippage = self._calculate_execution_price(mid_price=price, direction=direction, action='ENTRY', vix=vix)
        comm = max(abs(size) * self.commission_per_contract, self.min_commission)
        
        # CASH IMPACT LOGIC
        premium_total = exec_price * abs(size) * self.contract_multiplier
        
        if direction == 'LONG':
            # Check if we can afford it
            cost = premium_total + comm
            if self.current_capital < cost:
                print(f"  [INSUFFICIENT FUNDS] Trade rejected. Cost: {cost:.2f}, Cap: {self.current_capital:.2f}")
                return None
            self.current_capital -= premium_total
        else: # SHORT
            self.current_capital += premium_total
            
        # Always pay commission
        self.current_capital -= comm
        
        # Create Trade
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
        
        self.active_trades.remove(trade)
        self.trades.append(trade)

    def mark_to_market(self, date: datetime, current_prices: Dict[str, float]):
        """
        Update portfolio equity (Liquidation Value).
        """
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
        
        self.equity_curve.append({
            'date': date,
            'equity': total_equity,
            'cash': self.current_capital,
            'active_trades': len(self.active_trades)
        })

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