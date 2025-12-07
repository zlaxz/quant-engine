#!/usr/bin/env python3
"""
Futures Pipeline Runner with JARVIS UI Events

First-ever futures pipeline run with full visualization.
Emits events at each stage so the JARVIS UI can display progress.
"""

import sys
import time
import pandas as pd
from datetime import datetime
from pathlib import Path

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.ui_bridge import emit_ui_event
from engine.futures import (
    FuturesDataLoader,
    FuturesFeatureEngine,
    FuturesBacktester,
)
from engine.futures.backtester import BacktestConfig, Order, OrderSide, OrderType


def main():
    """Run the futures pipeline with JARVIS visualization"""

    session_id = f"futures-jarvis-{int(time.time())}"
    data_root = "/Volumes/VelocityData/velocity_om/futures"

    # ========================================
    # STAGE 1: Startup
    # ========================================
    print("\n" + "="*60)
    print("🚀 FUTURES PIPELINE - JARVIS VISUALIZATION")
    print("="*60 + "\n")

    emit_ui_event(
        view="mission",
        message="🚀 Initializing Futures Pipeline with JARVIS Visualization",
        activity_type="discovery",
        session_id=session_id,
        notification={
            "type": "info",
            "title": "Futures Pipeline Starting",
            "message": "First operator run with full JARVIS visualization"
        }
    )
    time.sleep(1.5)

    # ========================================
    # STAGE 2: Load Data
    # ========================================
    print("📊 Stage 1: Loading ES Futures Data...")

    emit_ui_event(
        view="pipeline",
        message="Loading ES futures data (2023)...",
        activity_type="data_loading",
        progress=0,
        session_id=session_id,
    )

    loader = FuturesDataLoader(data_root)
    df = loader.load_symbol("ES", "1h", "2023-01-01", "2023-12-31")

    emit_ui_event(
        view="pipeline",
        message=f"Loaded {len(df):,} bars of ES hourly data",
        activity_type="data_loading",
        progress=20,
        session_id=session_id,
        data={"bars": len(df), "symbol": "ES", "timeframe": "1h"}
    )

    print(f"   ✓ Loaded {len(df):,} bars")
    time.sleep(1)

    # ========================================
    # STAGE 3: Generate Features
    # ========================================
    print("🔬 Stage 2: Generating Features...")

    emit_ui_event(
        view="swarm",
        message="Generating market physics features...",
        activity_type="swarm_work",
        progress=25,
        session_id=session_id,
    )

    # Use correct initialization with timeframe
    feature_engine = FuturesFeatureEngine(timeframe="1h")

    # Emit progress during feature generation
    for i, (pct, msg) in enumerate([
        (30, "Computing momentum features..."),
        (35, "Computing volatility features..."),
        (40, "Computing market structure..."),
        (45, "Computing support/resistance..."),
    ]):
        emit_ui_event(
            view="swarm",
            message=msg,
            activity_type="swarm_work",
            progress=pct,
            session_id=session_id,
        )
        time.sleep(0.5)

    df_features = feature_engine.generate_features(df)
    # Drop NaN rows
    df_features = df_features.dropna()
    n_features = len(df_features.columns)

    emit_ui_event(
        view="swarm",
        message=f"Generated {n_features} features ({len(df_features)} clean bars)",
        activity_type="discovery",  # Use discovery for Observatory panel
        progress=50,
        session_id=session_id,
        data={
            "title": "Feature Generation Complete",
            "finding": f"Generated {n_features} market physics features",
            "evidence": [
                f"Loaded {len(df):,} ES hourly bars",
                f"Computed momentum, volatility, structure features",
                f"Clean bars after NaN removal: {len(df_features):,}",
            ],
            "significance": "Features ready for signal generation and backtesting"
        },
        notification={
            "type": "success",
            "title": "Features Complete",
            "message": f"{n_features} market physics features computed"
        }
    )

    print(f"   ✓ Generated {n_features} features ({len(df_features)} clean bars)")
    time.sleep(1)

    # ========================================
    # STAGE 4: Run Backtest
    # ========================================
    print("📈 Stage 3: Running Backtest...")

    emit_ui_event(
        view="backtest",
        message="Starting ES momentum backtest (2023)...",
        activity_type="backtest",
        progress=55,
        session_id=session_id,
        data={"symbol": "ES", "strategy": "Momentum", "start_date": "2023-01-01", "end_date": "2023-12-31"}
    )

    config = BacktestConfig(
        initial_capital=100_000,
        commission_per_contract=2.50,
        slippage_ticks=1,
    )

    backtester = FuturesBacktester(config=config)

    # Simple momentum strategy (same as test)
    def momentum_strategy(current_data: pd.DataFrame, bt: FuturesBacktester):
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

    # Progress updates during backtest
    for pct in [60, 70, 80]:
        emit_ui_event(
            view="backtest",
            message=f"Running backtest... {pct}%",
            activity_type="backtest",
            progress=pct,
            session_id=session_id,
        )
        time.sleep(0.5)

    # Run backtest
    results = backtester.run(
        data=df_features,
        strategy=momentum_strategy,
        symbol="ES"
    )

    emit_ui_event(
        view="backtest",
        message="Backtest complete, computing results...",
        activity_type="backtest",
        progress=90,
        session_id=session_id,
    )

    print(f"   ✓ Backtest complete ({results['total_trades']} trades)")
    time.sleep(1)

    # ========================================
    # STAGE 5: Results
    # ========================================
    print("📊 Stage 4: Displaying Results...")

    total_return = results.get('total_return_pct', 0)
    sharpe = results.get('sharpe_ratio', 0)
    max_dd = results.get('max_drawdown_pct', 0)
    total_trades = results.get('total_trades', 0)
    win_rate = results.get('win_rate', 0) * 100

    # Build equity curve data in correct format for LineChartData type
    equity_curve = results.get('equity_curve', [100000])
    step = max(1, len(equity_curve) // 50)  # ~50 points
    equity_series_values = [
        {"x": i, "y": equity_curve[i]}
        for i in range(0, len(equity_curve), step)
    ]

    # Metrics card - send with 'complete' flag for Observatory
    emit_ui_event(
        view="backtest",
        message="ES Futures Backtest Results",
        activity_type="backtest",
        progress=95,
        session_id=session_id,
        data={
            "complete": True,  # Observatory needs this!
            "symbol": "ES",
            "total_return": total_return,
            "sharpe": sharpe,
            "max_dd": max_dd,
            "win_rate": win_rate,
            "total_trades": total_trades,
            "chart": {
                "id": f"equity_curve_{session_id}",
                "type": "line",
                "title": "ES Futures Equity Curve (2023)",
                "data": {
                    "series": [{
                        "name": "Portfolio Value",
                        "values": equity_series_values,
                        "color": "#22c55e"
                    }]
                },
                "config": {
                    "xLabel": "Bar",
                    "yLabel": "Portfolio Value ($)",
                    "legend": True,
                    "tooltip": True,
                    "grid": True
                }
            }
        },
        metrics={
            "id": f"backtest_metrics_{session_id}",
            "title": "ES Futures Backtest Results (2023)",
            "metrics": [
                {"name": "Total Return", "value": f"{total_return:.2f}%", "status": "good" if total_return > 0 else "danger"},
                {"name": "Sharpe Ratio", "value": f"{sharpe:.2f}", "status": "good" if sharpe > 0.5 else "warning"},
                {"name": "Max Drawdown", "value": f"{max_dd:.2f}%", "status": "danger" if max_dd < -20 else "warning"},
                {"name": "Win Rate", "value": f"{win_rate:.1f}%", "status": "good" if win_rate > 50 else "warning"},
                {"name": "Total Trades", "value": str(total_trades), "status": "neutral"},
            ]
        }
    )

    time.sleep(2)

    # Equity curve - send as chart directive with correct LineChartData format
    if 'equity_curve' in results and results['equity_curve']:
        emit_ui_event(
            view="backtest",
            message="Equity Curve",
            activity_type="backtest",
            progress=100,
            session_id=session_id,
            chart={
                "id": f"equity_curve_final_{session_id}",
                "type": "line",
                "title": "ES Futures Equity Curve (2023)",
                "data": {
                    "series": [{
                        "name": "Portfolio Value",
                        "values": equity_series_values,  # Reuse computed values
                        "color": "#22c55e"
                    }]
                },
                "config": {
                    "xLabel": "Bar",
                    "yLabel": "Portfolio Value ($)",
                    "legend": True,
                    "tooltip": True,
                    "grid": True,
                    "height": 400
                }
            }
        )

    time.sleep(2)

    # Final notification
    emit_ui_event(
        view="default",
        message="Futures pipeline complete!",
        activity_type="discovery",
        session_id=session_id,
        notification={
            "type": "success",
            "title": "🎉 Pipeline Complete",
            "message": f"ES backtest: {total_return:.1f}% return, {sharpe:.2f} Sharpe, {total_trades} trades"
        }
    )

    print("\n" + "="*60)
    print("✅ PIPELINE COMPLETE")
    print("="*60)
    print(f"   Total Return: {total_return:.2f}%")
    print(f"   Sharpe Ratio: {sharpe:.2f}")
    print(f"   Max Drawdown: {max_dd:.2f}%")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total Trades: {total_trades}")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
