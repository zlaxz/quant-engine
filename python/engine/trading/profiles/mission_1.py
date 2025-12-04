"""
Mission 1: $2,000/day Income Strategy (High Theta / Income Focus)

Instrument: SPY Options
Strategy: 0-1 DTE Iron Condors / Credit Spreads
Target: High probability income collection to meet $2k/day target on $100k capital.
Risk: Max drawdown 15%.

Note: 2% daily return is extremely aggressive. This strategy uses high leverage and
short-dated options (Gamma risk) to attempt to meet this target.
"""

import pandas as pd
import numpy as np
from datetime import timedelta, date, datetime as dt_datetime
from typing import Optional
from zoneinfo import ZoneInfo

# Adjust relative imports to work from engine.trading.profiles package
from ..trade import Trade, create_strangle_trade
from ..simulator import TradeSimulator, SimulationConfig

MARKET_TZ = ZoneInfo("America/New_York")

class Mission1Income:
    """Mission 1: High Income 0DTE Strategy."""

    def __init__(
        self,
        target_daily_pnl: float = 2000.0,
        max_drawdown_pct: float = 0.15,
        stop_loss_pct: float = 2.0  # Stop loss at 200% of credit received
    ):
        self.target_daily_pnl = target_daily_pnl
        self.max_drawdown_pct = max_drawdown_pct
        self.stop_loss_pct = stop_loss_pct

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """
        Entry logic: Enter daily if no current position.
        0DTE strategy implies we enter every morning.
        """
        # If we have an active trade, don't enter (wait for close)
        if current_trade is not None:
            return False
            
        return True

    def exit_logic(self, row: pd.Series, trade: Trade) -> bool:
        """
        Exit logic: 
        1. Take Profit: 50% of max profit? (Optional, usually hold 0DTE to close/expiry if OTM)
        2. Stop Loss: 2x Credit received (handled in simulator risk check usually, but here manual)
        3. EOD: Close at end of day
        """
        # For 0DTE, we usually hold until end of day unless stopped out
        # This simple logic relies on Simulator's "Time Stop" or Expiration
        
        # Check if current price breaches stops
        current_price = row.get('close', 0.0)
        
        # Simple stop loss check on short strikes
        # Short Call Strike
        short_call = next((leg for leg in trade.legs if leg.option_type == 'call' and leg.quantity < 0), None)
        short_put = next((leg for leg in trade.legs if leg.option_type == 'put' and leg.quantity < 0), None)
        
        if short_call and current_price > short_call.strike:
            return True # Stop out if ITM
            
        if short_put and current_price < short_put.strike:
            return True # Stop out if ITM
            
        return False

    def trade_constructor(self, row: pd.Series, trade_id: str) -> Trade:
        """
        Construct Short Strangle (Income) 0DTE.
        Selling OTM Call and OTM Put to collect premium.
        """
        spot = row['close']
        raw_entry_date = row['date']
        
        # Normalize Date
        if isinstance(raw_entry_date, pd.Timestamp):
            entry_date = raw_entry_date.to_pydatetime()
        elif isinstance(raw_entry_date, dt_datetime):
            entry_date = raw_entry_date
        else:
            entry_date = dt_datetime.combine(raw_entry_date, dt_datetime.min.time())
            
        if entry_date.tzinfo is None:
            entry_date = entry_date.replace(tzinfo=MARKET_TZ)

        # 0 DTE = Expires Today
        expiry = entry_date.replace(hour=16, minute=0, second=0, microsecond=0)
        
        # Strike Selection: Delta 20 (Approx)
        # Simple approximation: +/- 1.5% OTM?
        # VIX adjustment: Higher VIX -> Wider Strikes
        vix = row.get('vix', 20.0)
        move_pct = (vix / 16.0) * 0.01 # Daily Move approx VIX/16
        
        call_strike = round(spot * (1 + move_pct))
        put_strike = round(spot * (1 - move_pct))
        
        # Sizing: Target $2k premium?
        # Or fixed size? Let's do Fixed Size logic relative to account?
        # Simulator handles entry sizing based on Margin/Capital?
        # Here we define the trade structure. Simulator defaults to 1 unit?
        # We need 20 contracts to make $2k probably.
        # Let's start with 10 contracts.
        quantity = 10 

        # Create Short Strangle
        trade = create_strangle_trade(
            trade_id=trade_id,
            profile_name="Mission_1_Income",
            entry_date=entry_date,
            call_strike=call_strike,
            put_strike=put_strike,
            expiry=expiry,
            dte=0,
            quantity=quantity,
            short=True # We are SELLING
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: Optional[pd.DataFrame] = None
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """
        Run backtest for Mission 1.
        """
        config = SimulationConfig(
            delta_hedge_enabled=False,
            roll_dte_threshold=0,
            roll_on_regime_change=False,
            max_loss_pct=self.max_drawdown_pct,
            max_days_in_trade=1 # Close daily
        )

        simulator = TradeSimulator(initial_capital=100000.0, data=data, config=config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Mission_1_Income"
        )

        return results, simulator
