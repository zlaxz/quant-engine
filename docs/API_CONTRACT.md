# QuantOS API Contract (v1.0)

This document defines the JSON data structures exchanged between the Python Backend (Chief Quant) and the Frontend UI.

## 1. Regime Heatmap (The Climate)
**Visual:** A calendar view or timeline strip showing market conditions.
**Endpoint:** `GET /api/regimes?start=2023-01-01&end=2023-12-31`

```json
{
  "data": [
    {
      "date": "2023-01-03",
      "regime_label": "BEAR_VOL",
      "regime_color": "#FF4444",
      "confidence": 0.85,
      "metrics": {
        "vix": 22.5,
        "trend": "downtrend",
        "iv_rank": 65
      },
      "description": "High volatility with downward price pressure. Protective puts recommended."
    }
  ]
}
```

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
      "level": 5,
      "stats": {
        "sharpe": 1.8,
        "win_rate": 0.65,
        "max_drawdown": -0.12,
        "annual_return": 0.24
      },
      "tags": ["Short Put", "Bullish", "Income"],
      "best_regime": "BULL_QUIET",
      "status": "incubating",
      "description": "Sells OTM puts to harvest volatility decay during quiet uptrends."
    }
  ]
}
```

## 3. Discovery Matrix (The Treasure Map)
**Visual:** A grid showing coverage of Regimes vs. Strategy Types.
**Endpoint:** `GET /api/discovery/matrix`

```json
{
  "matrix": {
    "columns": ["Long Vol", "Short Vol", "Trend Following", "Mean Reversion"],
    "rows": ["BULL_QUIET", "BEAR_VOL", "SIDEWAYS", "CRASH"],
    "cells": [
      {
        "row": "BULL_QUIET",
        "col": "Short Vol",
        "status": "conquered",
        "best_strategy_id": "strat_vanna_001",
        "score": 9.5
      }
    ]
  }
}
```

## 4. Trade Explanation (The Teacher)
**Visual:** Tooltip or side-panel when clicking a specific trade on the chart.
**Endpoint:** `GET /api/trade/explain?trade_id=123`

```json
{
  "trade_id": "123",
  "action": "BUY_OPEN",
  "symbol": "SPY230120C...",
  "timestamp": "2023-01-03T09:45:00",
  "plain_english": "We bought this Call option because the VIX dropped below 20 (Signal A) while the price was above the 50-day moving average (Signal B).",
  "analogy": "Like buying an umbrella just as the rain stops and the sun comes out.",
  "factors": [
    { "name": "VIX", "value": 19.5, "threshold": 20.0, "contribution": "positive" },
    { "name": "Trend", "value": "Up", "contribution": "positive" }
  ]
}
```

## 5. Trade Anatomy (The X-Ray)
**Visual:** A dynamic payoff diagram overlay showing the "Green Zone" and "Red Zone".
**Endpoint:** `GET /api/trade/anatomy?symbol=SPY...`

```json
{
  "current_spot": 382.50,
  "break_even_points": [385.10],
  "max_profit": "Unlimited",
  "max_loss": 450.00,
  "zones": [
    { "range": [0, 385.10], "color": "red", "label": "Loss Zone" },
    { "range": [385.10, 1000], "color": "green", "label": "Profit Zone" }
  ],
  "probability_of_profit": 0.34,
  "days_to_expiration": 17
}
```

## 6. Greeks Cockpit (Risk Dashboard)
**Visual:** Gauges or meters showing portfolio sensitivity.
**Endpoint:** `GET /api/portfolio/greeks`

```json
{
  "delta": { "value": 50.5, "sentiment": "Bullish", "desc": "Equivalent to owning 50 shares of SPY" },
  "gamma": { "value": 2.1, "sentiment": "High Acceleration", "desc": "Profits will accelerate if market moves" },
  "theta": { "value": -15.4, "sentiment": "Burning", "desc": "Losing $15.40 per day to time decay" },
  "vega": { "value": 10.2, "sentiment": "Long Vol", "desc": "Will make $10.20 if VIX goes up 1 point" }
}
```

## 7. The Greeks Cockpit (Risk Dashboard)
**Purpose:** Visualize abstract risk metrics as physical gauges.
**Analogy:** Car Dashboard (Speed, Acceleration, Fuel Burn).

```json
{
  "type": "greeks_cockpit",
  "timestamp": "2023-01-03T10:00:00Z",
  "gauges": [
    {
      "name": "Delta",
      "label": "Directional Risk",
      "value": 0.45,
      "min": -1.0,
      "max": 1.0,
      "unit": "Δ",
      "color": "green",
      "analogy": "Speedometer: You are making money as market goes UP."
    },
    {
      "name": "Gamma",
      "label": "Acceleration",
      "value": 0.02,
      "min": 0.0,
      "max": 0.1,
      "unit": "Γ",
      "color": "yellow",
      "analogy": "Turbo: Your profits will accelerate if the move continues."
    },
    {
      "name": "Theta",
      "label": "Time Decay",
      "value": -15.50,
      "min": -100.0,
      "max": 0.0,
      "unit": "$/day",
      "color": "red",
      "analogy": "Rent: You pay $15.50 per day to hold this position."
    }
  ]
}
```

## 8. The Scenario Simulator (The "What If" Engine)
**Purpose:** Interactive slider to teach risk. "What happens to my P&L if..."
**Interaction:** User drags slider, chart updates instantly.

```json
{
  "type": "scenario_simulation",
  "current_price": 382.50,
  "scenarios": [
    { "move_pct": -0.05, "price": 363.37, "projected_pnl": 1250.00, "desc": "Crash (-5%)" },
    { "move_pct": -0.02, "price": 374.85, "projected_pnl": 450.00, "desc": "Correction (-2%)" },
    { "move_pct": 0.00, "price": 382.50, "projected_pnl": 0.00, "desc": "Flat" },
    { "move_pct": +0.02, "price": 390.15, "projected_pnl": -320.00, "desc": "Rally (+2%)" }
  ],
  "explanation": "Because you are Short Delta (Put), you profit if the market crashes. But notice how your profit caps out at -5%? That's your spread limiting the gain."
}
```
