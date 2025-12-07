#!/usr/bin/env python3
"""
JARVIS Demo Script - Demonstrates Python → UI control via event system

Shows all available visualization types:
- Notifications & Progress
- Bar Charts (Force Vectors)
- Line Charts (Equity Curves)
- Tables (Scan Results)
- Heatmaps (Correlation Matrix)
- Candlestick Charts
- Gauge Meters (Fear & Greed, VIX, etc.)
- Waterfall Charts (P&L Attribution)
- Treemaps (Portfolio Allocation)
- Options Payoff Diagrams
"""

import sys
import os
import time

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.ui_bridge import (
    emit_ui_event,
    ui_gamma_analysis,
    ui_regime_detected,
    ui_backtest_complete,
    ui_table,
    ui_pnl_chart,
    ui_heatmap,
    ui_candlestick,
    ui_gauge,
    ui_multi_gauge,
    ui_waterfall,
    ui_treemap,
    ui_payoff,
)


def demo_sequence():
    """Run through a demo sequence of JARVIS events"""
    print("=" * 60)
    print("JARVIS Demo - Python → UI Control")
    print("=" * 60)
    print()

    # 1. Start with a notification
    print("1. Sending startup notification...")
    emit_ui_event(
        activity_type="discovery",
        message="JARVIS Demo starting - watch the UI!",
        notification={
            "type": "info",
            "title": "JARVIS Demo",
            "message": "Demo sequence starting..."
        }
    )
    time.sleep(2)

    # 2. Data loading with progress
    print("2. Simulating data load with progress...")
    for pct in [10, 30, 50, 70, 90, 100]:
        emit_ui_event(
            activity_type="data_loading",
            message=f"Loading market data... {pct}%",
            progress=pct
        )
        time.sleep(0.3)
    time.sleep(1)

    # 3. Heatmap - Correlation Matrix
    print("3. Displaying correlation heatmap...")
    ui_heatmap(
        title="Asset Correlation Matrix",
        x_labels=["SPY", "QQQ", "IWM", "DIA", "VIX"],
        y_labels=["SPY", "QQQ", "IWM", "DIA", "VIX"],
        values=[
            [1.00, 0.92, 0.88, 0.95, -0.75],
            [0.92, 1.00, 0.82, 0.88, -0.68],
            [0.88, 0.82, 1.00, 0.85, -0.62],
            [0.95, 0.88, 0.85, 1.00, -0.72],
            [-0.75, -0.68, -0.62, -0.72, 1.00],
        ],
        message="Correlation matrix computed across 252 trading days"
    )
    time.sleep(2.5)

    # 4. Candlestick Chart
    print("4. Showing candlestick chart with trade annotations...")
    ui_candlestick(
        symbol="TSLA",
        candles=[
            {"date": "Dec 1", "open": 235.0, "high": 238.5, "low": 233.0, "close": 237.2, "volume": 45000000},
            {"date": "Dec 2", "open": 237.2, "high": 242.0, "low": 236.5, "close": 240.8, "volume": 52000000},
            {"date": "Dec 3", "open": 240.8, "high": 245.3, "low": 239.0, "close": 244.5, "volume": 48000000},
            {"date": "Dec 4", "open": 244.5, "high": 248.0, "low": 242.5, "close": 246.8, "volume": 55000000},
        ],
        annotations=[
            {"date": "Dec 2", "type": "buy", "label": "Entry", "price": 237.2},
            {"date": "Dec 4", "type": "sell", "label": "Exit", "price": 246.8}
        ],
        message="TSLA breakout trade - 4.0% gain in 3 days"
    )
    time.sleep(2.5)

    # 5. Gauge Meters - Market Dashboard
    print("5. Displaying market gauge dashboard...")
    ui_multi_gauge(
        title="Market Dashboard",
        gauges=[
            {
                "title": "Fear & Greed",
                "value": 72,
                "min": 0,
                "max": 100,
                "unit": "",
                "thresholds": [
                    {"from": 0, "to": 25, "color": "#ef4444", "label": "Extreme Fear"},
                    {"from": 25, "to": 45, "color": "#f97316", "label": "Fear"},
                    {"from": 45, "to": 55, "color": "#eab308", "label": "Neutral"},
                    {"from": 55, "to": 75, "color": "#84cc16", "label": "Greed"},
                    {"from": 75, "to": 100, "color": "#22c55e", "label": "Extreme Greed"}
                ]
            },
            {
                "title": "VIX",
                "value": 14.2,
                "min": 10,
                "max": 40,
                "unit": "",
                "thresholds": [
                    {"from": 10, "to": 15, "color": "#22c55e", "label": "Low Vol"},
                    {"from": 15, "to": 20, "color": "#84cc16", "label": "Normal"},
                    {"from": 20, "to": 30, "color": "#f97316", "label": "Elevated"},
                    {"from": 30, "to": 40, "color": "#ef4444", "label": "High Vol"}
                ]
            },
            {
                "title": "Put/Call Ratio",
                "value": 0.85,
                "min": 0.5,
                "max": 1.5,
                "unit": "",
                "thresholds": [
                    {"from": 0.5, "to": 0.7, "color": "#22c55e", "label": "Bullish"},
                    {"from": 0.7, "to": 1.0, "color": "#eab308", "label": "Neutral"},
                    {"from": 1.0, "to": 1.5, "color": "#ef4444", "label": "Bearish"}
                ]
            }
        ],
        message="Market sentiment indicators updated"
    )
    time.sleep(2.5)

    # 6. Single Gauge
    print("6. Showing single gauge (GEX)...")
    ui_gauge(
        title="Gamma Exposure (GEX)",
        value=2.8,
        min_val=-5,
        max_val=5,
        unit="B",
        thresholds=[
            {"from": -5, "to": -2, "color": "#ef4444", "label": "Negative Gamma"},
            {"from": -2, "to": 0, "color": "#f97316", "label": "Slightly Negative"},
            {"from": 0, "to": 2, "color": "#84cc16", "label": "Positive Gamma"},
            {"from": 2, "to": 5, "color": "#22c55e", "label": "Strong Positive"}
        ],
        message="Dealers long gamma - expect mean reversion and pinning"
    )
    time.sleep(2.5)

    # 7. Waterfall Chart - P&L Attribution
    print("7. Displaying P&L waterfall chart...")
    ui_waterfall(
        title="Monthly P&L Attribution",
        items=[
            {"label": "Starting Capital", "value": 100000, "isTotal": True},
            {"label": "TSLA Trades", "value": 5200},
            {"label": "SPY Hedges", "value": -1800},
            {"label": "NVDA Options", "value": 3400},
            {"label": "QQQ Scalps", "value": 1200},
            {"label": "Theta Decay", "value": 850},
            {"label": "Fees & Commissions", "value": -450},
            {"label": "Ending Capital", "value": 108400, "isTotal": True}
        ],
        message="November P&L breakdown: +8.4% return"
    )
    time.sleep(2.5)

    # 8. Treemap - Portfolio Allocation
    print("8. Showing portfolio allocation treemap...")
    ui_treemap(
        title="Portfolio Allocation",
        data=[
            {"name": "Equities", "value": 60000, "children": [
                {"name": "TSLA", "value": 25000},
                {"name": "NVDA", "value": 20000},
                {"name": "AAPL", "value": 15000}
            ]},
            {"name": "Options", "value": 30000, "children": [
                {"name": "SPY Puts", "value": 15000},
                {"name": "QQQ Calls", "value": 10000},
                {"name": "TSLA Straddle", "value": 5000}
            ]},
            {"name": "Cash", "value": 10000}
        ],
        message="Current portfolio: 60% equities, 30% options, 10% cash"
    )
    time.sleep(2.5)

    # 9. Options Payoff Diagram
    print("9. Displaying options payoff diagram...")
    ui_payoff(
        title="Iron Condor - SPY Dec 20",
        strategies=[
            {"type": "put", "strike": 580, "premium": 2.50, "quantity": 1, "position": "short"},
            {"type": "put", "strike": 575, "premium": 1.20, "quantity": 1, "position": "long"},
            {"type": "call", "strike": 610, "premium": 2.30, "quantity": 1, "position": "short"},
            {"type": "call", "strike": 615, "premium": 1.00, "quantity": 1, "position": "long"}
        ],
        current_price=595,
        underlying_range=[565, 625],
        message="Iron condor: Max profit $260, max loss $240, break-evens at $577.40 and $612.60"
    )
    time.sleep(2.5)

    # 10. Gamma analysis with chart
    print("10. Triggering gamma force analysis...")
    ui_gamma_analysis(
        symbol="SPY",
        forces={
            "dealer_gamma": 0.72,
            "customer_gamma": -0.45,
            "mm_hedge": 0.33,
            "vol_demand": -0.18
        }
    )
    time.sleep(2)

    # 11. Regime detection
    print("11. Detecting market regime...")
    ui_regime_detected(
        regime="volatile_bearish",
        confidence=0.87,
        probabilities={
            "trending_up": 0.08,
            "trending_down": 0.45,
            "ranging": 0.12,
            "volatile": 0.35
        }
    )
    time.sleep(2)

    # 12. Show a results table
    print("12. Displaying scan results table...")
    ui_table(
        title="Top Opportunities",
        columns=[
            {"key": "symbol", "label": "Symbol", "type": "text"},
            {"key": "edge", "label": "Edge", "type": "number"},
            {"key": "risk", "label": "Risk", "type": "number"},
            {"key": "signal", "label": "Signal", "type": "text"}
        ],
        rows=[
            {"symbol": "TSLA", "edge": 2.3, "risk": 0.45, "signal": "BUY"},
            {"symbol": "NVDA", "edge": 1.8, "risk": 0.32, "signal": "BUY"},
            {"symbol": "AAPL", "edge": -0.5, "risk": 0.21, "signal": "SELL"},
            {"symbol": "MSFT", "edge": 0.9, "risk": 0.18, "signal": "HOLD"},
        ]
    )
    time.sleep(2)

    # 13. Backtest complete
    print("13. Showing backtest results...")
    ui_backtest_complete(
        sharpe=1.85,
        total_return=0.234,
        max_dd=-0.12
    )
    time.sleep(2)

    # 14. P&L chart
    print("14. Showing equity curve...")
    ui_pnl_chart(
        dates=["2024-01", "2024-02", "2024-03", "2024-04", "2024-05",
               "2024-06", "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12"],
        equity_curve=[100, 102, 105, 103, 108, 112, 110, 115, 118, 120, 125, 128],
        symbol="Gamma Scalper Strategy"
    )
    time.sleep(2)

    # 15. Success notification
    print("15. Demo complete!")
    emit_ui_event(
        activity_type="idle",
        message="Demo sequence complete",
        notification={
            "type": "success",
            "title": "Demo Complete",
            "message": "All 14 visualization types demonstrated!"
        }
    )

    print()
    print("=" * 60)
    print("Demo finished! Check the Quant Engine UI for results.")
    print("=" * 60)


def demo_single(viz_type: str):
    """Demo a single visualization type"""
    demos = {
        "heatmap": lambda: ui_heatmap(
            title="Test Heatmap",
            x_labels=["A", "B", "C"],
            y_labels=["X", "Y", "Z"],
            values=[[1, 2, 3], [4, 5, 6], [7, 8, 9]]
        ),
        "gauge": lambda: ui_gauge(
            title="Test Gauge",
            value=65,
            min_val=0,
            max_val=100,
            unit="%"
        ),
        "waterfall": lambda: ui_waterfall(
            title="Test Waterfall",
            items=[
                {"label": "Start", "value": 100, "isTotal": True},
                {"label": "Add", "value": 20},
                {"label": "Remove", "value": -10},
                {"label": "End", "value": 110, "isTotal": True}
            ]
        ),
        "treemap": lambda: ui_treemap(
            title="Test Treemap",
            data=[
                {"name": "Group A", "value": 50},
                {"name": "Group B", "value": 30},
                {"name": "Group C", "value": 20}
            ]
        ),
        "payoff": lambda: ui_payoff(
            title="Test Payoff",
            strategies=[
                {"type": "call", "strike": 100, "premium": 5, "quantity": 1, "position": "long"}
            ],
            current_price=100,
            underlying_range=[80, 120]
        ),
        "candlestick": lambda: ui_candlestick(
            symbol="TEST",
            candles=[
                {"date": "Day 1", "open": 100, "high": 105, "low": 98, "close": 103, "volume": 1000},
                {"date": "Day 2", "open": 103, "high": 108, "low": 102, "close": 107, "volume": 1200}
            ]
        )
    }

    if viz_type in demos:
        print(f"Running {viz_type} demo...")
        demos[viz_type]()
        print("Done!")
    else:
        print(f"Unknown visualization type: {viz_type}")
        print(f"Available: {', '.join(demos.keys())}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        demo_single(sys.argv[1])
    else:
        demo_sequence()
