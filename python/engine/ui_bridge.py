"""
UI Bridge - Emit events from Python engine to Electron UI

This module allows the Market Physics Engine to communicate with the
JARVIS UI by writing structured JSON events to /tmp/claude-code-results/.
The ClaudeCodeResultWatcher in Electron picks these up and updates the UI.

Usage:
    from engine.ui_bridge import emit_ui_event, UIEventType

    # Simple view switch
    emit_ui_event(view="swarm", message="Spawning analysis swarm...")

    # With progress
    emit_ui_event(
        view="backtest",
        message="Running backtest on SPY",
        progress=45,
        data={"symbol": "SPY", "timeframe": "5min"}
    )

    # Chart update
    emit_ui_event(
        view="insight",
        message="Gamma analysis complete",
        chart={
            "type": "bar",
            "title": "Force Vectors",
            "data": [...]
        }
    )
"""

import json
import os
import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any, List, Union
from pathlib import Path

# Directory where Electron watches for events
RESULTS_DIR = Path("/tmp/claude-code-results")

class UIView(str, Enum):
    """Available UI views that can be triggered"""
    SWARM = "swarm"
    MISSION = "mission"
    BACKTEST = "backtest"
    PIPELINE = "graduation"
    INTEGRITY = "integrity"
    INSIGHT = "insight"
    FINDINGS = "default"

class ActivityType(str, Enum):
    """Types of activities for panel orchestration"""
    SWARM_WORK = "swarm_work"
    GAMMA_ANALYSIS = "gamma_analysis"
    BACKTEST = "backtest"
    DISCOVERY = "discovery"
    CODE_WRITING = "code_writing"
    REGIME_DETECTION = "regime_detection"
    DATA_LOADING = "data_loading"
    IDLE = "idle"

def ensure_results_dir():
    """Ensure the results directory exists"""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

def emit_ui_event(
    view: Optional[str] = None,
    message: str = "",
    activity_type: Optional[str] = None,
    progress: Optional[int] = None,
    data: Optional[Dict[str, Any]] = None,
    chart: Optional[Dict[str, Any]] = None,
    table: Optional[Dict[str, Any]] = None,
    metrics: Optional[Dict[str, Any]] = None,
    notification: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    files_created: Optional[List[str]] = None,
    files_modified: Optional[List[str]] = None,
) -> Union[str, bool]:
    """
    Emit a UI event that the Electron app will pick up.

    Args:
        view: Which view to switch to (swarm, mission, backtest, etc.)
        message: Human-readable message for the narrator
        activity_type: Type of activity for panel orchestration
        progress: Progress percentage (0-100)
        data: Arbitrary data payload (symbol, timeframe, metrics, etc.)
        chart: Chart data to display (type, title, data)
        table: Table data to display (columns, rows)
        metrics: Metrics data to display (metrics array)
        notification: Toast notification to show
        session_id: Session identifier (default: "engine")
        files_created: List of files created
        files_modified: List of files modified

    Returns:
        Path to the event file created
    """
    ensure_results_dir()

    # Generate UUID for session_id if not provided
    if session_id is None:
        session_id = str(uuid.uuid4())

    # Build display directives
    display_directives = []

    if view:
        display_directives.append({
            "type": "view",
            "value": view
        })

    if progress is not None:
        display_directives.append({
            "type": "progress",
            "value": progress,
            "message": message
        })

    if chart:
        display_directives.append({
            "type": "chart",
            "value": chart
        })

    if table:
        display_directives.append({
            "type": "table",
            "value": table
        })

    if metrics:
        display_directives.append({
            "type": "metrics",
            "value": metrics
        })

    if notification:
        display_directives.append({
            "type": "notification",
            "value": notification
        })

    # Build the event
    event = {
        "session_id": session_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "content": message,
        "activity_type": activity_type or _infer_activity_type(view),
        "display_directives": display_directives,
        "data": data or {},
    }

    if files_created:
        event["files_created"] = files_created
    if files_modified:
        event["files_modified"] = files_modified

    # Write to file with unique timestamp
    filename = f"event_{int(time.time() * 1000)}.json"
    filepath = RESULTS_DIR / filename

    try:
        with open(filepath, 'w') as f:
            json.dump(event, f, indent=2)
    except Exception as e:
        import sys
        print(f"ERROR: Failed to write UI event to {filepath}: {e}", file=sys.stderr)
        return False

    return str(filepath)

def _infer_activity_type(view: Optional[str]) -> str:
    """Infer activity type from view if not explicitly provided"""
    if not view:
        return ActivityType.IDLE.value

    mapping = {
        "swarm": ActivityType.SWARM_WORK.value,
        "backtest": ActivityType.BACKTEST.value,
        "graduation": ActivityType.DISCOVERY.value,
        "insight": ActivityType.GAMMA_ANALYSIS.value,
        "default": ActivityType.DISCOVERY.value,
        "mission": ActivityType.SWARM_WORK.value,
        "integrity": ActivityType.IDLE.value,
    }
    return mapping.get(view, ActivityType.IDLE.value)

# Convenience functions for common events

def ui_swarm_started(agent_count: int, objective: str):
    """Notify UI that a swarm has been spawned"""
    emit_ui_event(
        view="swarm",
        activity_type=ActivityType.SWARM_WORK.value,
        message=f"Spawning {agent_count} agents: {objective}",
        data={"agent_count": agent_count, "objective": objective}
    )

def ui_swarm_progress(completed: int, total: int, current_task: str):
    """Update swarm progress"""
    progress = int((completed / total) * 100) if total > 0 else 0
    emit_ui_event(
        view="swarm",
        activity_type=ActivityType.SWARM_WORK.value,
        message=f"Swarm progress: {current_task}",
        progress=progress,
        data={"completed": completed, "total": total, "current_task": current_task}
    )

def ui_swarm_complete(results_summary: str):
    """Notify UI that swarm has completed"""
    emit_ui_event(
        view="default",
        activity_type=ActivityType.DISCOVERY.value,
        message=f"Swarm complete: {results_summary}",
        notification={"type": "success", "title": "Swarm Complete", "message": results_summary}
    )

def ui_backtest_started(symbol: str, strategy: str, start_date: str, end_date: str):
    """Notify UI that a backtest has started"""
    emit_ui_event(
        view="backtest",
        activity_type=ActivityType.BACKTEST.value,
        message=f"Starting backtest: {strategy} on {symbol}",
        progress=0,
        data={"symbol": symbol, "strategy": strategy, "start_date": start_date, "end_date": end_date}
    )

def ui_backtest_progress(progress: int, current_date: str, pnl: float):
    """Update backtest progress"""
    emit_ui_event(
        view="backtest",
        activity_type=ActivityType.BACKTEST.value,
        message=f"Backtesting: {current_date} (P/L: ${pnl:,.2f})",
        progress=progress,
        data={"current_date": current_date, "pnl": pnl}
    )

def ui_backtest_complete(sharpe: float, total_return: float, max_dd: float):
    """Notify UI that backtest is complete with CIO interpretation"""
    # Generate CIO interpretation of results
    if sharpe > 2.0:
        quality = "Exceptional risk-adjusted returns. Validating edge persistence..."
        status = "good"
    elif sharpe > 1.0:
        quality = "Solid performance. Checking for regime robustness."
        status = "good"
    elif sharpe > 0.5:
        quality = "Marginal edge detected. May need parameter refinement."
        status = "warning"
    else:
        quality = "Insufficient edge. Investigating signal degradation."
        status = "danger"

    dd_concern = ""
    if max_dd < -0.25:
        dd_concern = " WARNING: Drawdown exceeds risk tolerance."

    narration = f"Strategy backtest complete. {quality}{dd_concern}"

    emit_ui_event(
        view="backtest",
        activity_type=ActivityType.BACKTEST.value,
        message=narration,
        progress=100,
        data={"narration": narration, "quality_assessment": status},
        metrics={
            "id": "backtest_results",
            "title": "Backtest Results",
            "metrics": [
                {"name": "Sharpe Ratio", "value": sharpe, "format": ".2f", "status": status},
                {"name": "Total Return", "value": total_return, "format": ".1%"},
                {"name": "Max Drawdown", "value": max_dd, "format": ".1%", "status": "danger" if max_dd < -0.2 else "neutral"},
            ]
        },
        notification={"type": "success", "title": "Backtest Complete", "message": narration[:80]}
    )

def ui_gamma_analysis(symbol: str, forces: Dict[str, float]):
    """Display gamma/force analysis results with CIO narration"""
    # Generate CIO-style narration
    dominant_force = max(forces.items(), key=lambda x: abs(x[1]))
    narration = f"Analyzing {symbol} force vectors. {dominant_force[0]} dominates at {dominant_force[1]:.2f}. "
    if dominant_force[1] > 0.5:
        narration += "Market makers likely hedging aggressively."
    elif dominant_force[1] < -0.3:
        narration += "Dealer positioning suggests caution."
    else:
        narration += "Neutral dealer stance detected."

    emit_ui_event(
        view="insight",
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=narration,
        data={"symbol": symbol, "forces": forces, "narration": narration},
        chart={
            "type": "bar",
            "id": "force_vectors",
            "title": f"Force Vectors - {symbol}",
            "data": {
                "categories": list(forces.keys()),
                "series": [{"name": "Force", "values": list(forces.values())}]
            }
        }
    )

def ui_regime_detected(regime: str, confidence: float, probabilities: Dict[str, float]):
    """Display regime detection results with CIO narration"""
    # Generate regime-specific narration
    regime_insights = {
        "trending_up": "Momentum favors continuation. Looking for pullback entries.",
        "trending_down": "Bear market conditions. Hedges activated, reducing exposure.",
        "ranging": "Chop zone detected. Mean reversion strategies preferred.",
        "volatile": "High volatility regime. Widen stops, reduce position size.",
        "quiet": "Low volatility compression. Expecting regime shift soon.",
    }
    insight = regime_insights.get(regime.lower().replace(" ", "_"), "Monitoring for regime confirmation.")
    narration = f"Regime shift: {regime} ({confidence:.0%} confidence). {insight}"

    emit_ui_event(
        view="insight",
        activity_type=ActivityType.REGIME_DETECTION.value,
        message=narration,
        data={"regime": regime, "confidence": confidence, "probabilities": probabilities, "narration": narration},
        notification={"type": "info", "title": "Regime Update", "message": f"{regime} ({confidence:.0%})"}
    )

def ui_discovery(title: str, description: str, importance: str = "medium"):
    """Announce a discovery/finding"""
    emit_ui_event(
        view="default",
        activity_type=ActivityType.DISCOVERY.value,
        message=f"Discovery: {title}",
        data={"title": title, "description": description, "importance": importance},
        notification={
            "type": "success" if importance == "high" else "info",
            "title": f"Discovery: {title}",
            "message": description
        }
    )

def ui_error(error: str, details: Optional[str] = None):
    """Report an error to the UI"""
    emit_ui_event(
        view="integrity",
        activity_type=ActivityType.IDLE.value,
        message=f"Error: {error}",
        data={"error": error, "details": details},
        notification={"type": "error", "title": "Error", "message": error}
    )

def ui_idle(message: str = "Ready for next task"):
    """Set UI to idle state"""
    emit_ui_event(
        view="default",
        activity_type=ActivityType.IDLE.value,
        message=message
    )


def ui_table(title: str, columns: List[Dict[str, str]], rows: List[Dict[str, Any]],
             message: str = "", view: str = "default"):
    """
    Display a data table in the UI.

    columns: List of {"key": str, "label": str, "type": str} dicts.
    type should be: "string", "number", "percent", "currency", "date", "boolean", "badge"
    """
    # Ensure columns have type field
    typed_columns = []
    for col in columns:
        typed_col = dict(col)
        if "type" not in typed_col:
            typed_col["type"] = "string"
        typed_columns.append(typed_col)

    emit_ui_event(
        view=view,
        activity_type=ActivityType.DISCOVERY.value,
        message=message or f"Showing table: {title}",
        table={
            "id": f"table_{title.lower().replace(' ', '_')}",
            "title": title,
            "columns": typed_columns,
            "rows": rows
        }
    )


def ui_options_analysis(symbol: str, expiry: str, chain_data: List[Dict[str, Any]]):
    """Display options chain analysis results"""
    # Build table from chain data with types
    columns = [
        {"key": "strike", "label": "Strike", "type": "currency"},
        {"key": "call_iv", "label": "Call IV", "type": "percent"},
        {"key": "put_iv", "label": "Put IV", "type": "percent"},
        {"key": "call_delta", "label": "Call Δ", "type": "number"},
        {"key": "put_delta", "label": "Put Δ", "type": "number"},
        {"key": "gamma", "label": "Γ", "type": "number"},
        {"key": "oi_ratio", "label": "P/C OI", "type": "number"},
    ]

    emit_ui_event(
        view="insight",
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=f"Options analysis for {symbol} {expiry}",
        data={"symbol": symbol, "expiry": expiry},
        table={
            "id": f"options_chain_{symbol}",
            "title": f"{symbol} Options Chain - {expiry}",
            "columns": columns,
            "rows": chain_data
        }
    )


def ui_scan_results(scan_name: str, results: List[Dict[str, Any]], top_n: int = 10):
    """Display scan/screening results"""
    columns = []
    if results:
        # Infer columns from first result with type inference
        for k, v in results[0].items():
            col_type = "string"
            if isinstance(v, (int, float)):
                col_type = "number"
            elif isinstance(v, bool):
                col_type = "boolean"
            columns.append({
                "key": k,
                "label": k.replace("_", " ").title(),
                "type": col_type
            })

    emit_ui_event(
        view="default",
        activity_type=ActivityType.DISCOVERY.value,
        message=f"Scan complete: {scan_name} ({len(results)} results)",
        table={
            "id": f"scan_{scan_name.lower().replace(' ', '_')}",
            "title": f"{scan_name} - Top {top_n}",
            "columns": columns,
            "rows": results[:top_n]
        },
        notification={
            "type": "success",
            "title": "Scan Complete",
            "message": f"Found {len(results)} matches for {scan_name}"
        }
    )


def ui_pnl_chart(dates: List[str], equity_curve: List[float], symbol: str = "Portfolio"):
    """Display P&L / equity curve chart"""
    # Convert to {x, y} format for line chart
    values = [{"x": d, "y": v} for d, v in zip(dates, equity_curve)]
    emit_ui_event(
        view="backtest",
        activity_type=ActivityType.BACKTEST.value,
        message=f"Equity curve for {symbol}",
        chart={
            "id": f"pnl_{symbol.lower()}",
            "type": "line",
            "title": f"Equity Curve - {symbol}",
            "data": {
                "series": [{"name": "Equity", "values": values}]
            }
        }
    )


def ui_heatmap(title: str, x_labels: List[str], y_labels: List[str],
               values: List[List[float]], color_scale: str = "RdYlGn",
               message: str = "", view: str = "insight"):
    """
    Display a heatmap visualization.

    Args:
        title: Chart title
        x_labels: Labels for X axis (columns)
        y_labels: Labels for Y axis (rows)
        values: 2D array of values [row][col]
        color_scale: Color scale name (RdYlGn, Blues, Reds, etc.)
        message: Narrator message
        view: Which view to display in

    Example:
        ui_heatmap(
            title="Correlation Matrix",
            x_labels=["SPY", "QQQ", "IWM"],
            y_labels=["SPY", "QQQ", "IWM"],
            values=[[1.0, 0.85, 0.72], [0.85, 1.0, 0.68], [0.72, 0.68, 1.0]]
        )
    """
    # Convert to heatmap data format
    data_points = []
    for i, y_label in enumerate(y_labels):
        for j, x_label in enumerate(x_labels):
            data_points.append({
                "x": x_label,
                "y": y_label,
                "value": values[i][j]
            })

    emit_ui_event(
        view=view,
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=message or f"Heatmap: {title}",
        chart={
            "id": f"heatmap_{title.lower().replace(' ', '_')}",
            "type": "heatmap",
            "title": title,
            "data": {
                "xLabels": x_labels,
                "yLabels": y_labels,
                "values": data_points,
                "colorScale": color_scale
            }
        }
    )


def ui_candlestick(symbol: str, candles: List[Dict[str, Any]],
                   annotations: Optional[List[Dict[str, Any]]] = None,
                   message: str = "", view: str = "insight"):
    """
    Display a candlestick chart with optional annotations.

    Args:
        symbol: Ticker symbol
        candles: List of {"date": str, "open": float, "high": float, "low": float, "close": float, "volume": int}
        annotations: Optional list of {"date": str, "type": "buy"|"sell"|"info", "label": str, "price": float}
        message: Narrator message
        view: Which view to display in

    Example:
        ui_candlestick(
            symbol="SPY",
            candles=[
                {"date": "2024-01-02", "open": 470, "high": 472, "low": 469, "close": 471, "volume": 1000000},
                {"date": "2024-01-03", "open": 471, "high": 475, "low": 470, "close": 474, "volume": 1200000},
            ],
            annotations=[
                {"date": "2024-01-02", "type": "buy", "label": "Entry", "price": 470}
            ]
        )
    """
    emit_ui_event(
        view=view,
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=message or f"Candlestick chart for {symbol}",
        chart={
            "id": f"candle_{symbol.lower()}",
            "type": "candlestick",
            "title": f"{symbol} Price Action",
            "data": {
                "candles": candles,
                "annotations": annotations or []
            }
        }
    )


def ui_gauge(title: str, value: float, min_val: float = 0, max_val: float = 100,
             thresholds: Optional[List[Dict[str, Any]]] = None,
             unit: str = "", message: str = "", view: str = "insight"):
    """
    Display a gauge/dial meter.

    Args:
        title: Gauge title
        value: Current value
        min_val: Minimum scale value
        max_val: Maximum scale value
        thresholds: Optional zones [{"from": 0, "to": 30, "color": "red"}, ...]
        unit: Unit suffix (%, $, etc.)
        message: Narrator message
        view: Which view to display in

    Example:
        ui_gauge(
            title="Fear & Greed Index",
            value=65,
            thresholds=[
                {"from": 0, "to": 25, "color": "#ef4444", "label": "Extreme Fear"},
                {"from": 25, "to": 45, "color": "#f97316", "label": "Fear"},
                {"from": 45, "to": 55, "color": "#eab308", "label": "Neutral"},
                {"from": 55, "to": 75, "color": "#84cc16", "label": "Greed"},
                {"from": 75, "to": 100, "color": "#22c55e", "label": "Extreme Greed"}
            ]
        )
    """
    default_thresholds = [
        {"from": min_val, "to": min_val + (max_val - min_val) * 0.33, "color": "#ef4444", "label": "Low"},
        {"from": min_val + (max_val - min_val) * 0.33, "to": min_val + (max_val - min_val) * 0.66, "color": "#eab308", "label": "Medium"},
        {"from": min_val + (max_val - min_val) * 0.66, "to": max_val, "color": "#22c55e", "label": "High"},
    ]

    emit_ui_event(
        view=view,
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=message or f"{title}: {value}{unit}",
        chart={
            "id": f"gauge_{title.lower().replace(' ', '_')}",
            "type": "gauge",
            "title": title,
            "data": {
                "value": value,
                "min": min_val,
                "max": max_val,
                "thresholds": thresholds or default_thresholds,
                "unit": unit
            }
        }
    )


def ui_waterfall(title: str, items: List[Dict[str, Any]],
                 message: str = "", view: str = "insight"):
    """
    Display a waterfall chart for P&L attribution or flow analysis.

    Args:
        title: Chart title
        items: List of {"label": str, "value": float, "isTotal": bool (optional)}
        message: Narrator message
        view: Which view to display in

    Example:
        ui_waterfall(
            title="Monthly P&L Attribution",
            items=[
                {"label": "Starting Capital", "value": 100000, "isTotal": True},
                {"label": "TSLA Trades", "value": 5200},
                {"label": "SPY Hedges", "value": -1800},
                {"label": "Options Premium", "value": 3400},
                {"label": "Fees & Commissions", "value": -450},
                {"label": "Ending Capital", "value": 106350, "isTotal": True}
            ]
        )
    """
    emit_ui_event(
        view=view,
        activity_type=ActivityType.BACKTEST.value,
        message=message or f"Waterfall: {title}",
        chart={
            "id": f"waterfall_{title.lower().replace(' ', '_')}",
            "type": "waterfall",
            "title": title,
            "data": {
                "items": items
            }
        }
    )


def ui_treemap(title: str, data: List[Dict[str, Any]],
               message: str = "", view: str = "insight"):
    """
    Display a treemap for portfolio allocation or hierarchical data.

    Args:
        title: Chart title
        data: Hierarchical data - each item has {"name": str, "value": float, "children": [...] (optional)}
        message: Narrator message
        view: Which view to display in

    Example:
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
                    {"name": "QQQ Calls", "value": 15000}
                ]},
                {"name": "Cash", "value": 10000}
            ]
        )
    """
    emit_ui_event(
        view=view,
        activity_type=ActivityType.DISCOVERY.value,
        message=message or f"Treemap: {title}",
        chart={
            "id": f"treemap_{title.lower().replace(' ', '_')}",
            "type": "treemap",
            "title": title,
            "data": {
                "items": data
            }
        }
    )


def ui_payoff(title: str, strategies: List[Dict[str, Any]],
              underlying_range: Optional[List[float]] = None,
              current_price: Optional[float] = None,
              message: str = "", view: str = "insight"):
    """
    Display an options payoff diagram.

    Args:
        title: Chart title
        strategies: List of option legs:
            {"type": "call"|"put", "strike": float, "premium": float, "quantity": int, "position": "long"|"short"}
        underlying_range: Optional [min, max] for x-axis
        current_price: Current underlying price (for reference line)
        message: Narrator message
        view: Which view to display in

    Example:
        ui_payoff(
            title="Iron Condor - SPY",
            strategies=[
                {"type": "put", "strike": 450, "premium": 2.50, "quantity": 1, "position": "short"},
                {"type": "put", "strike": 440, "premium": 1.00, "quantity": 1, "position": "long"},
                {"type": "call", "strike": 480, "premium": 2.50, "quantity": 1, "position": "short"},
                {"type": "call", "strike": 490, "premium": 1.00, "quantity": 1, "position": "long"}
            ],
            current_price=465,
            underlying_range=[430, 500]
        )
    """
    # Calculate range if not provided
    if not underlying_range and strategies:
        strikes = [s["strike"] for s in strategies]
        min_strike = min(strikes)
        max_strike = max(strikes)
        padding = (max_strike - min_strike) * 0.3
        underlying_range = [min_strike - padding, max_strike + padding]

    emit_ui_event(
        view=view,
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=message or f"Payoff diagram: {title}",
        chart={
            "id": f"payoff_{title.lower().replace(' ', '_')}",
            "type": "payoff",
            "title": title,
            "data": {
                "strategies": strategies,
                "underlyingRange": underlying_range or [0, 100],
                "currentPrice": current_price
            }
        }
    )


def ui_multi_gauge(title: str, gauges: List[Dict[str, Any]],
                   message: str = "", view: str = "insight"):
    """
    Display multiple gauges in a grid layout.

    Args:
        title: Overall title
        gauges: List of gauge configs, each with:
            {"title": str, "value": float, "min": float, "max": float, "unit": str, "thresholds": [...]}
        message: Narrator message
        view: Which view to display in

    Example:
        ui_multi_gauge(
            title="Market Dashboard",
            gauges=[
                {"title": "VIX", "value": 18.5, "min": 10, "max": 40, "unit": ""},
                {"title": "Put/Call", "value": 0.85, "min": 0.5, "max": 1.5, "unit": ""},
                {"title": "GEX", "value": 2.5, "min": -5, "max": 5, "unit": "B"}
            ]
        )
    """
    emit_ui_event(
        view=view,
        activity_type=ActivityType.GAMMA_ANALYSIS.value,
        message=message or title,
        chart={
            "id": f"multigauge_{title.lower().replace(' ', '_')}",
            "type": "multi_gauge",
            "title": title,
            "data": {
                "gauges": gauges
            }
        }
    )


# For testing
if __name__ == "__main__":
    print("Testing UI Bridge...")

    # Test basic event
    path = emit_ui_event(
        view="swarm",
        message="Test swarm event",
        progress=50
    )
    print(f"Created: {path}")

    # Test convenience function
    ui_gamma_analysis("SPY", {
        "gamma": 0.73,
        "flow": 0.42,
        "mm_inventory": 0.85,
        "correlation": 0.28
    })
    print("Gamma analysis event emitted")

    print("Done! Check /tmp/claude-code-results/ for events")
