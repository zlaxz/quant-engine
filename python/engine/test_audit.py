import unittest
from unittest.mock import patch
import pandas as pd
from datetime import datetime, timedelta
from engine.trading.simulator import TradeSimulator, SimulationConfig
from engine.trading.trade import Trade, TradeLeg, create_straddle_trade
from engine.trading.execution import UnifiedExecutionModel

class TestQuantEngineAudit(unittest.TestCase):
    def setUp(self):
        pass

    def test_long_call_pnl_and_commission(self):
        """Test Case 1: Simple Long Call (Debit)"""
        print("\n--- Test Case 1: Long Call PnL & Commission ---")
        
        initial_capital = 100000.0
        sim = TradeSimulator(initial_capital=initial_capital)
        
        sim.commission_per_contract = 1.0
        sim.min_commission = 1.0
        sim.execution_model.option_commission = 1.0
        sim.execution_model.occ_fee = 0.0
        sim.execution_model.sec_fee_rate = 0.0
        sim.execution_model.finra_fee = 0.0
        
        entry_date = datetime(2023, 1, 1)
        spot_entry = 100.0
        
        # Fix lambda signature to match keyword args used in simulator
        original_calc_price = sim._calculate_execution_price
        sim._calculate_execution_price = lambda mid_price, direction, action, vix: (10.0, 0.0)
        
        trade = sim.enter_trade(
            symbol='SPY', 
            date=entry_date, 
            price=spot_entry, 
            size=1, 
            direction='LONG', 
            strategy_id='test_long_call',
            immediate=True
        )
        
        expected_capital = initial_capital - 1001.0
        
        self.assertEqual(trade.entry_price, 10.0)
        self.assertEqual(trade.entry_commission, 1.0)
        self.assertEqual(sim.current_capital, expected_capital)
        
        # Exit
        exit_date = entry_date + timedelta(days=5)
        spot_exit = 120.0
        
        sim._calculate_execution_price = lambda mid_price, direction, action, vix: (20.0, 0.0)
        
        sim.exit_trade(trade, exit_date, spot_exit, "Test Exit")
        
        # Restore
        sim._calculate_execution_price = original_calc_price

        self.assertEqual(trade.exit_prices[0], 20.0)
        self.assertEqual(trade.exit_commission, 1.0)
        self.assertEqual(trade.realized_pnl, 998.0)
        self.assertEqual(sim.current_capital, initial_capital + 998.0)
        print("Test Case 1 Passed")

    def test_short_put_margin(self):
        """Test Case 2: Short Put (Credit) & Margin"""
        print("\n--- Test Case 2: Short Put Margin ---")
        
        initial_capital = 100000.0
        sim = TradeSimulator(initial_capital=initial_capital)
        sim.commission_per_contract = 1.0
        
        entry_date = datetime(2023, 1, 1)
        spot = 100.0
        
        original_calc_price = sim._calculate_execution_price
        sim._calculate_execution_price = lambda mid_price, direction, action, vix: (5.0, 0.0)
        
        trade = sim.enter_trade(
            symbol='SPY', 
            date=entry_date, 
            price=spot, 
            size=-1, 
            direction='SHORT', 
            strategy_id='test_short_put',
            immediate=True
        )
        
        sim._calculate_execution_price = original_calc_price

        self.assertEqual(trade.entry_price, 5.0)
        self.assertEqual(sim.current_capital, initial_capital + 499.0)
        print("Test Case 2 Passed")

    def test_complex_trade_pnl(self):
        """Test Case 3: Complex Trade (Straddle) PnL"""
        print("\n--- Test Case 3: Straddle PnL ---")
        
        sim = TradeSimulator(initial_capital=100000.0)
        
        entry_date = datetime(2023, 1, 1)
        strike = 100.0
        expiry = entry_date + timedelta(days=30)
        
        entry_prices = {0: 3.0, 1: 3.0}
        
        trade = create_straddle_trade(
            trade_id="straddle_1",
            profile_name="test",
            entry_date=entry_date,
            strike=strike,
            expiry=expiry,
            dte=30,
            quantity=1,
            entry_prices=entry_prices
        )
        
        sim.active_trades.append(trade)
        trade.entry_commission = 1.30 
        sim.current_capital -= (trade.entry_cost + trade.entry_commission)
        
        exit_prices = {0: 1.0, 1: 8.0}
        
        # SET EXIT COMMISSION BEFORE CLOSE
        trade.exit_commission = 1.30
        
        trade.close(
            exit_date=entry_date+timedelta(days=5),
            exit_prices=exit_prices,
            reason="Test"
        )
        
        sim.current_capital += trade.exit_proceeds - trade.exit_commission
        
        expected_realized = 300.0 - 1.30 - 1.30 # 297.40
        
        self.assertAlmostEqual(trade.realized_pnl, 297.40)
        
        # Verify Capital - Checks exit_proceeds logic
        # Initial: 100,000
        # Entry: -600 (Premium) - 1.30 (Comm) = -601.30
        # Exit: +900 (Proceeds) - 1.30 (Comm) = +898.70
        # Net: +297.40
        expected_capital = 100000.0 + 297.40
        self.assertAlmostEqual(sim.current_capital, expected_capital)
        print("Test Case 3 Passed")

    @patch('engine.trading.simulator.calculate_price')
    def test_complex_trade_equity(self, mock_calc_price):
        """Test Case 4: Complex Trade Equity Calculation"""
        print("\n--- Test Case 4: Complex Trade Equity ---")
        sim = TradeSimulator(initial_capital=100000.0)
        entry_date = datetime(2023, 1, 1)
        
        # Long Call: Qty=1, Price=10. Cost=1000.
        trade = create_straddle_trade( 
            trade_id="long_call",
            profile_name="test",
            entry_date=entry_date,
            strike=100,
            expiry=entry_date+timedelta(days=30),
            dte=30,
            quantity=1,
            entry_prices={0: 10.0, 1: 0.0} 
        )
        trade.legs = [trade.legs[0]] # Single leg
        trade.entry_prices = {0: 10.0}
        
        sim.active_trades.append(trade)
        sim.current_capital -= 1000.0 
        
        # Mock Price = 12.0
        mock_calc_price.return_value = 12.0
        
        # Run MTM
        sim.mark_to_market(entry_date, {'SPY': 110.0}, vix=20.0)
        
        # Expected:
        # Cash = 99000.
        # Option Value = 1 * 12.0 * 100 = 1200.0.
        # Equity = 100200.0.
        
        # Current Bug:
        # PnL = (12 - 10) * 100 = 200.
        # Equity = 99000 + 200 = 99200.
        
        equity = sim.equity_curve[-1]['equity']
        print(f"Equity: {equity}")
        
        self.assertAlmostEqual(equity, 100200.0)
        print("Test Case 4 Passed") 


if __name__ == '__main__':
    unittest.main()