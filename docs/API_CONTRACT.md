# QuantOS API Contract (v1.1)

This document defines the JSON data structures that the Python Backend (`src/`) must return to the Frontend UI.
**Goal:** Enable parallel development. The UI can be built using Mock Data matching this schema while the Backend is being refactored.

---

## 1. Regime Heatmap (The Climate)
**Visual:** A calendar heatmap (like GitHub contributions) showing market regimes over time.
**Endpoint:** `GET /api/regimes?start=2023-01-01&end=2023-12-31`

```json
{
  "data": [
    {
      "date": "2023-01-03",
      "regime_key": "BEAR_VOL",
      "display_name": "Bear Volatile",
      "color_code": "#FF4444", 
      "confidence": 0.85,
      "metrics": {
        "vix": 22.5,
        "trend_score": -0.05,
        "description": "High fear, downward trend. Protective puts recommended."
      }
    },
    {
      "date": "2023-01-04",
      "regime_key": "SIDEWAYS",
      "display_name": "Choppy / Sideways",
      "color_code": "#FFCC00",
      "confidence": 0.60,
      "metrics": {
        "vix": 18.2,
        "trend_score": 0.01,
        "description": "Market indecisive. Theta harvesting (Iron Condors) recommended."
      }
    }
  ]
}
```

---

## 2. Strategy Card (The Pokemon Card)
**Visual:** A trading card representing a specific strategy genome.
**Endpoint:** `GET /api/strategies`

```json
{
  "strategies": [
    {
      "id": "strat_vanna_001",
      "name": "Vanna Harvester",
      "class": "Income Generator",
      "level": 5, // Based on Sharpe Ratio or robustness
      "badges": ["Bear Market Survivor", "Low Drawdown"],
      "stats": {
        "sharpe": 1.8,
        "win_rate": 0.65,
        "max_drawdown": -0.12,
        "annual_return": 0.24
      },
      "description": "Sells OTM Puts when VIX > 20 to capture volatility decay.",
      "best_regime": "BEAR_VOL"
    }
  ]
}
```

---

## 3. Backtest Equity Curve (The Scoreboard)
**Visual:** A line chart showing portfolio value over time, with annotations for trades.
**Endpoint:** `GET /api/backtest/{run_id}/equity`

```json
{
  "run_id": "bt_2023_vanna_01",
  "time_series": [
    {
      "timestamp": "2023-01-03T09:30:00",
      "equity": 100000.0,
      "drawdown_pct": 0.0,
      "active_trades": 0
    },
    {
      "timestamp": "2023-01-03T10:00:00",
      "equity": 99850.0,
      "drawdown_pct": -0.0015,
      "active_trades": 1,
      "event": {
        "type": "ENTRY",
        "symbol": "SPY230120P...",
        "description": "Entered Short Put"
      }
    }
  ]
}
```

---

## 4. Discovery Matrix (The Treasure Map)
**Visual:** A 6x6 Grid (or list) showing which Regimes have valid strategies.
**Endpoint:** `GET /api/discovery/matrix`

```json
{
  "matrix": [
    {
      "regime": "BULL_QUIET",
      "status": "CONQUERED", // CONQUERED, EXPLORING, UNTOUCHED
      "best_strategy_id": "strat_long_call_05",
      "coverage_pct": 100
    },
    {
      "regime": "BEAR_VOL",
      "status": "EXPLORING",
      "best_strategy_id": null,
      "coverage_pct": 30
    },
    {
      "regime": "CRASH",
      "status": "UNTOUCHED",
      "best_strategy_id": null,
      "coverage_pct": 0
    }
  ]
}
```

---

## 5. Trade Explanation (The Teacher)
**Visual:** A tooltip or side-panel explaining a specific trade decision in plain English.
**Endpoint:** `GET /api/backtest/{run_id}/trade/{trade_id}/explain`

```json
{
  "trade_id": "tr_5521",
  "action": "ENTRY",
  "timestamp": "2023-01-03 14:00",
  "logic_chain": [
    {
      "step": 1,
      "check": "Regime Check",
      "result": "PASS",
      "detail": "Market is in BEAR_VOL (VIX=24)."
    },
    {
      "step": 2,
      "check": "Trigger",
      "result": "PASS",
      "detail": "RSI (30) dropped below 20, indicating oversold."
    },
    {
      "step": 3,
      "check": "Safety",
      "result": "PASS",
      "detail": "Capital available > 50%."
    }
  ],
  "plain_english": "I entered this Short Put because the market was in a Bear Volatile state and the RSI indicated a temporary panic selling bottom. I expect a mean reversion bounce."
}
```

---

## 6. Trade Anatomy (The X-Ray)
**Visual:** A Payoff Diagram (Hockey Stick chart) showing the break-even point and current price.
**Endpoint:** `GET /api/trade/{trade_id}/anatomy`

```json
{
  "trade_id": "tr_5521",
  "symbol": "SPY 380 Put",
  "type": "Short Put",
  "current_spot": 382.50,
  "break_even": 378.20,
  "max_profit": 180.00,
  "max_loss": "Unlimited", // or numeric value
  "probability_of_profit": 0.68,
  "days_to_expiration": 5,
  "zones": [
    { "range": [0, 378.20], "type": "LOSS", "color": "red" },
    { "range": [378.20, 1000], "type": "PROFIT", "color": "green" }
  ],
  "analogy": "Like selling flood insurance. You keep the premium ($180) as long as the water level (Price) stays above 378.20."
}
```

---

## 7. The Greeks Cockpit (The Dashboard)
**Visual:** A set of Gauges (Speedometer style) showing portfolio risk metrics.
**Endpoint:** `GET /api/portfolio/greeks`

```json
{
  "timestamp": "2023-01-03 15:00",
  "metrics": [
    {
      "name": "Delta",
      "value": 150.5,
      "unit": "Shares",
      "analogy": "Directional Speed",
      "status": "WARNING", // OK, WARNING, DANGER
      "message": "Leaning too Long. Market drop will hurt."
    },
    {
      "name": "Gamma",
      "value": 5.2,
      "unit": "Acceleration",
      "analogy": "Stability",
      "status": "OK",
      "message": "Portfolio is stable."
    },
    {
      "name": "Theta",
      "value": 45.0,
      "unit": "$/Day",
      "analogy": "Time Decay (Income)",
      "status": "OK",
      "message": "Earning $45/day from time passing."
    }
  ]
}
```
