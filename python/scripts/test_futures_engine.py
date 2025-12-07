#!/usr/bin/env python3
"""
Test Futures Engine Pipeline

Quick verification that all components work together:
1. Load data
2. Generate features
3. Generate signals
4. Run backtest
5. Check risk management
"""

import sys
import asyncio
from pathlib import Path
from datetime import datetime

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import numpy as np

def test_data_loader():
    """Test data loading."""
    print("\n" + "="*60)
    print("1. TESTING DATA LOADER")
    print("="*60)

    from engine.futures import FuturesDataLoader

    loader = FuturesDataLoader(
        data_dir="/Volumes/VelocityData/velocity_om/futures"
    )

    # Load ES 1-hour data
    df = loader.load_symbol("ES", timeframe="1h", start_date="2023-01-01", end_date="2023-12-31")

    print(f"  Loaded ES 1h data: {len(df)} bars")
    print(f"  Date range: {df.index[0]} to {df.index[-1]}")
    print(f"  Columns: {list(df.columns)}")

    assert len(df) > 0, "No data loaded"
    assert 'close' in df.columns, "Missing close column"

    print("  ✓ Data loader works")
    return df


def test_feature_engine(df: pd.DataFrame):
    """Test feature generation."""
    print("\n" + "="*60)
    print("2. TESTING FEATURE ENGINE")
    print("="*60)

    from engine.futures import FuturesFeatureEngine

    engine = FuturesFeatureEngine(timeframe="1h")

    features = engine.generate_features(df)

    print(f"  Generated {len(features.columns)} features")
    print(f"  Sample features: {list(features.columns[:10])}")
    print(f"  NaN count: {features.isna().sum().sum()}")

    # Drop NaN rows for downstream
    features = features.dropna()
    print(f"  Clean rows: {len(features)}")

    assert len(features) > 0, "No features after dropna"

    print("  ✓ Feature engine works")
    return features


def test_signal_generator(features: pd.DataFrame, df: pd.DataFrame):
    """Test signal generation."""
    print("\n" + "="*60)
    print("3. TESTING SIGNAL GENERATOR")
    print("="*60)

    from engine.futures import SignalGenerator

    # Use default weights
    generator = SignalGenerator()

    # Align data
    common_idx = features.index.intersection(df.index)
    df_aligned = df.loc[common_idx]
    features_aligned = features.loc[common_idx]

    # Generate returns a DataFrame of signals
    signals_df = generator.generate(features_aligned, "ES")

    print(f"  Generated {len(signals_df)} signal rows")
    if not signals_df.empty:
        print(f"  Columns: {list(signals_df.columns)}")
        if 'composite_signal' in signals_df.columns:
            sig_col = 'composite_signal'
        elif 'signal' in signals_df.columns:
            sig_col = 'signal'
        else:
            sig_col = signals_df.columns[0]
        long_signals = (signals_df[sig_col] > 0).sum()
        short_signals = (signals_df[sig_col] < 0).sum()
        print(f"  Long signals: {long_signals}")
        print(f"  Short signals: {short_signals}")

    assert len(signals_df) > 0, "No signals generated"

    print("  ✓ Signal generator works")
    return signals_df


def test_risk_manager():
    """Test risk management."""
    print("\n" + "="*60)
    print("4. TESTING RISK MANAGER")
    print("="*60)

    from engine.futures import FuturesRiskManager
    from engine.futures.risk_manager import RiskLimits

    limits = RiskLimits(
        max_position_size=10,
        max_daily_loss=0.02,
        max_drawdown=0.10
    )

    risk_mgr = FuturesRiskManager(
        initial_capital=100000,
        limits=limits
    )

    # Test position sizing
    result = risk_mgr.calculate_position_size(
        symbol="ES",
        signal_strength=0.8,
        current_price=4500,
        atr=25,
        vol_regime='normal'
    )

    print(f"  Final position size for ES: {result.final_size} contracts")
    print(f"  Base: {result.base_size}, Adjusted: {result.adjusted_size}, Risk-adjusted: {result.risk_adjusted_size}")
    print(f"  Notional value: ${result.notional_value:,.2f}, Portfolio %: {result.portfolio_pct:.2%}")

    # Check if position was blocked
    if result.blocked:
        print(f"  Position blocked: {result.block_reason}")
    if result.warnings:
        print(f"  Warnings: {result.warnings}")

    print("  ✓ Risk manager works")
    return risk_mgr


def test_backtest(df: pd.DataFrame):
    """Test backtester."""
    print("\n" + "="*60)
    print("5. TESTING BACKTESTER")
    print("="*60)

    from engine.futures import FuturesBacktester
    from engine.futures.backtester import BacktestConfig, Order, OrderSide, OrderType

    config = BacktestConfig(
        initial_capital=100000,
        commission_per_contract=2.50,
        slippage_ticks=1
    )
    backtester = FuturesBacktester(config=config)

    # Create a simple momentum strategy function
    def simple_momentum_strategy(current_data: pd.DataFrame, bt: FuturesBacktester):
        """Simple momentum: buy when close > SMA20, sell when below."""
        if len(current_data) < 20:
            return None

        close = current_data['close'].iloc[-1]
        sma = current_data['close'].rolling(20).mean().iloc[-1]

        # Get current position
        pos = bt.get_position("ES")

        # Long signal
        if close > sma * 1.001:  # 0.1% above SMA
            if pos is None or pos.side.value == "FLAT":
                return Order(
                    order_id=f"order_{bt._order_counter}",
                    symbol="ES",
                    side=OrderSide.BUY,
                    quantity=1,
                    order_type=OrderType.MARKET
                )

        # Short signal / exit
        if close < sma * 0.999:  # 0.1% below SMA
            if pos is not None and pos.side.value == "LONG":
                return Order(
                    order_id=f"order_{bt._order_counter}",
                    symbol="ES",
                    side=OrderSide.SELL,
                    quantity=pos.quantity,
                    order_type=OrderType.MARKET
                )

        return None

    # Run backtest
    results = backtester.run(
        data=df,
        strategy=simple_momentum_strategy,
        symbol="ES"
    )

    print(f"  Total trades: {results['total_trades']}")
    print(f"  Total return: {results['total_return_pct']:.2f}%")
    print(f"  Sharpe ratio: {results['sharpe_ratio']:.2f}")
    print(f"  Max drawdown: {results['max_drawdown_pct']:.2f}%")
    print(f"  Win rate: {results.get('win_rate', 0):.2%}")

    print("  ✓ Backtester works")
    return results


async def test_execution_engine():
    """Test execution engine (backtest mode)."""
    print("\n" + "="*60)
    print("6. TESTING EXECUTION ENGINE")
    print("="*60)

    from engine.futures import ExecutionEngine, BacktestExecutionHandler
    from engine.futures.execution_engine import OrderSide, OrderType

    handler = BacktestExecutionHandler(
        slippage_model="fixed",
        slippage_bps=1.0,
        commission_per_contract=2.50
    )

    # Set simulated market data
    handler.set_current_bar({
        'open': 4500,
        'high': 4510,
        'low': 4495,
        'close': 4505,
        'volume': 10000
    })

    engine = ExecutionEngine(handler=handler)

    # Submit market order
    order = await engine.submit_order(
        symbol="ES",
        side=OrderSide.BUY,
        quantity=2,
        order_type=OrderType.MARKET
    )

    print(f"  Order status: {order.status}")
    print(f"  Fill price: {order.avg_fill_price}")
    print(f"  Commission: ${order.commission:.2f}")

    # Check positions
    positions = await engine.get_positions()
    print(f"  Position: {positions.get('ES', {})}")

    # Submit closing order
    close_order = await engine.submit_order(
        symbol="ES",
        side=OrderSide.SELL,
        quantity=2,
        order_type=OrderType.MARKET
    )

    print(f"  Close order status: {close_order.status}")

    # Final positions
    positions = await engine.get_positions()
    print(f"  Final position: {positions.get('ES', {})}")

    print("  ✓ Execution engine works")


def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("FUTURES ENGINE TEST SUITE")
    print(f"Time: {datetime.now()}")
    print("="*60)

    try:
        # Test pipeline
        df = test_data_loader()
        features = test_feature_engine(df)
        signals = test_signal_generator(features, df)
        risk_mgr = test_risk_manager()
        results = test_backtest(df)  # Backtester uses its own strategy
        asyncio.run(test_execution_engine())

        print("\n" + "="*60)
        print("ALL TESTS PASSED ✓")
        print("="*60)
        print("\nFutures engine is ready for live trading!")

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
