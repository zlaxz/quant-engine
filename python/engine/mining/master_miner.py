#!/usr/bin/env python3
"""
Master Miner - The Production-Grade Backtest Harness.
Moves strategy genomes through the Data -> Physics -> Result pipeline.
API-READY: Adds JSON output formatting for UI.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
import json
from typing import Dict, Any, List

# Import from unified engine package
from ..trading.simulator import TradeSimulator
from ..data.loaders import load_spy_data

# These modules may not exist yet - stub definitions
class StrategyGenome:
    """Stub for strategy genome - to be implemented."""
    def __init__(self, config=None):
        self.config = config or {}

class SymbolFactory:
    """Stub for symbol factory - to be implemented."""
    pass

class DriveLoader:
    """Stub for drive loader - replaced by load_spy_data."""
    def load_day(self, symbol: str, date_str: str):
        df = load_spy_data()
        from datetime import datetime
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        day_data = df[df['date'] == date_obj]
        return day_data if not day_data.empty else pd.DataFrame()

class MasterMiner:
    def __init__(self, start_date: str, end_date: str, capital: float = 100000.0):
        self.start_date = start_date
        self.end_date = end_date
        self.capital = capital
        self.loader = DriveLoader()
        self.simulator = TradeSimulator(initial_capital=capital)
        self.factory = SymbolFactory()
        
        self.quote_cache = {} 
        self.current_cache_date = None
        
    def _get_quote_cached(self, symbol: str, date_str: str) -> pd.DataFrame:
        if self.current_cache_date != date_str:
            self.quote_cache = {}
            self.current_cache_date = date_str
            
        if symbol not in self.quote_cache:
            if len(self.quote_cache) > 10:
                first_key = next(iter(self.quote_cache))
                del self.quote_cache[first_key]
            
            df = self.loader.load_quotes('SPY', date_str, 
                                        columns=['timestamp', 'bid_price', 'ask_price'],
                                        filters=[('symbol', '==', symbol)])
            self.quote_cache[symbol] = df
            
        return self.quote_cache[symbol]

    def _get_current_quote(self, symbol: str, timestamp: datetime, date_str: str):
        df = self._get_quote_cached(symbol, date_str)
        if df.empty: return None
        relevant = df[df['timestamp'] >= timestamp]
        if relevant.empty: return None
        return relevant.iloc[0]

    def _parse_expiration(self, symbol: str) -> datetime:
        try:
            date_part = symbol[3:9]
            return datetime.strptime(date_part, '%y%m%d')
        except ValueError as e:
            import logging
            logging.error(f"Failed to parse expiration from '{symbol}': {e}")
            raise ValueError(f"Invalid option symbol format: {symbol}") from e

    def run(self, genome: StrategyGenome):
        print(f"--- LAUNCHING MINE: {genome.name} --- ")
        dates = pd.date_range(start=self.start_date, end=self.end_date, freq='D')
        
        for date_obj in dates:
            date_str = date_obj.strftime('%Y-%m-%d')
            print(f"Processing {date_str}...")
            
            try:
                spy_df = self.loader.load_trades('SPY', date_str, columns=['timestamp', 'underlying_price', 'iv'])
            except:
                continue
            if spy_df.empty: continue
                
            ohlc = spy_df.set_index('timestamp').resample('15min').agg({
                'underlying_price': 'last',
                'iv': 'median'
            }).dropna()
            ohlc.columns = ['close', 'iv_snapshot']
            
            for timestamp, bar in ohlc.iterrows():
                current_spot = bar['close']
                current_iv_decimal = bar['iv_snapshot'] / 100.0 if bar['iv_snapshot'] > 4.0 else bar['iv_snapshot']
                
                # A. MANAGE EXITS
                for trade in list(self.simulator.active_trades):
                    days_held = (timestamp - trade.entry_date).days
                    
                    exp_date = self._parse_expiration(trade.symbol)
                    if timestamp.date() >= exp_date.date():
                         self._execute_expiration(trade, timestamp, current_spot)
                         continue
                    
                    should_exit = False
                    reason = ''
                    if days_held >= genome.exit.get('hold_days', 999):
                        should_exit = True
                        reason = 'time_exit'
                    
                    if should_exit:
                        self._execute_exit(trade, timestamp, reason, date_str)
                        
                # B. MANAGE ENTRIES
                if not self.simulator.active_trades:
                    vix_proxy = current_iv_decimal * 100.0
                    if self._check_trigger(genome, vix_proxy):
                        target_dte = 7
                        target_delta = genome.instrument.get('delta', -0.05)
                        opt_type = genome.instrument.get('type', 'put')
                        exp_date = self.factory.get_expiration(timestamp, target_dte)
                        strike = self.factory.get_strike(current_spot, target_delta, opt_type, 
                                                       iv=current_iv_decimal, dte=target_dte)
                        symbol = self.factory.build_occ('SPY', exp_date, opt_type, strike)
                        action = genome.instrument.get('action', 'buy')
                        direction = 'SHORT' if action == 'sell' else 'LONG'
                        
                        self._execute_entry(symbol, timestamp, direction, genome, date_str)
                        
        return self.simulator.get_results()

    def _check_trigger(self, genome, vix_val) -> bool:
        trigger = genome.trigger
        if trigger.get('type') == 'vix_level':
            val = trigger.get('value')
            op = trigger.get('operator')
            if op == '>': return vix_val > val
            if op == '<': return vix_val < val
        return True

    def _execute_entry(self, symbol, timestamp, direction, genome, date_str):
        quote = self._get_current_quote(symbol, timestamp, date_str)
        if quote is None: return
        price = quote.ask_price if direction == 'LONG' else quote.bid_price
        size = genome.sizing.get('value', 1)
        
        trade = self.simulator.enter_trade(symbol, timestamp, price, size, direction, genome.id)
        if trade:
            pass # Trade accepted

    def _execute_exit(self, trade, timestamp, reason, date_str):
        quote = self._get_current_quote(trade.symbol, timestamp, date_str)
        if quote is None: return 
        price = quote.bid_price if trade.direction == 'LONG' else quote.ask_price
        self.simulator.exit_trade(trade, timestamp, price, reason)

    def _execute_expiration(self, trade, timestamp, spot_price):
        try:
            strike = float(trade.symbol[-8:]) / 1000.0
            is_call = 'C' in trade.symbol
            if is_call: intrinsic = max(0.0, spot_price - strike)
            else: intrinsic = max(0.0, strike - spot_price)
            self.simulator.exit_trade(trade, timestamp, intrinsic, 'expiration', vix=0.0)
        except Exception:
            self.simulator.exit_trade(trade, timestamp, 0.0, 'expiration_error', vix=0.0)

    def generate_api_response(self) -> Dict[str, Any]:
        """
        Returns the FULL JSON response for the Frontend:
        {
          "equity_curve": [...],
          "trades": [...],
          "metrics": {...}
        }
        """
        # 1. Equity Curve
        equity_data = []
        
        if not self.simulator.equity_curve:
            return {
                "equity_curve": [{"time": self.start_date, "value": self.capital, "drawdown": 0}],
                "trades": [],
                "metrics": {"total_return": 0, "sharpe": 0, "win_rate": 0}
            }
            
        peak_equity = self.capital
        for point in self.simulator.equity_curve:
            eq = point['equity']
            peak_equity = max(peak_equity, eq)
            dd = (eq - peak_equity) / peak_equity if peak_equity > 0 else 0
            
            equity_data.append({
                "time": point['date'].strftime('%Y-%m-%d %H:%M'),
                "value": round(eq, 2),
                "drawdown": round(dd, 4)
            })
            
        # 2. Trades List
        trades_data = []
        df_trades = self.simulator.get_results()
        if not df_trades.empty:
            for _, row in df_trades.iterrows():
                expl = f"{row['direction']} {row['symbol']} on {row['entry_date']}"
                trades_data.append({
                    "id": f"t_{_}",
                    "symbol": row['symbol'],
                    "type": "Short Put" if "P" in row['symbol'] and row['direction']=="SHORT" else "Long Call",
                    "entry_date": row['entry_date'].strftime('%Y-%m-%d %H:%M'),
                    "exit_date": row['exit_date'].strftime('%Y-%m-%d %H:%M'),
                    "entry_price": round(row['entry_price'], 2),
                    "exit_price": round(row['exit_price'], 2),
                    "pnl": round(row['pnl'], 2),
                    "pnl_percent": round(row['return_pct'] * 100, 2),
                    "status": "closed",
                    "explanation": expl
                })
                
        # 3. Aggregate Metrics
        final_eq = equity_data[-1]['value'] if equity_data else self.capital
        total_ret = (final_eq - self.capital) / self.capital
        win_rate = (df_trades['pnl'] > 0).mean() if not df_trades.empty else 0
        
        return {
            "equity_curve": equity_data,
            "trades": trades_data,
            "metrics": {
                "total_return": round(total_ret * 100, 2),
                "sharpe": 0.0, 
                "win_rate": round(win_rate * 100, 1),
                "max_drawdown": round(min([x['drawdown'] for x in equity_data] or [0]) * 100, 2)
            }
        }
