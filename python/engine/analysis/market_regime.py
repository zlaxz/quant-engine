#!/usr/bin/env python3
"""
Market Regime Detection - Mock Data for UI Demo

Provides market regime classification for the Quant Engine UI.
Currently returns mock data for demonstration purposes.
Will be extended to fetch real data once API keys are configured.
"""

import json
from datetime import datetime
from typing import TypedDict


class MarketRegimeData(TypedDict):
    """Structure for market regime classification output."""
    timestamp: str
    VIX: float
    Regime: str
    SPY_Trend: str
    confidence: float
    components: dict


def get_mock_regime_data() -> MarketRegimeData:
    """
    Return mock market regime data for UI demonstration.

    Returns:
        MarketRegimeData with VIX, Regime classification, and SPY trend.
    """
    return {
        "timestamp": datetime.now().isoformat(),
        "VIX": 14.5,
        "Regime": "Bull Volatile",
        "SPY_Trend": "Up",
        "confidence": 0.85,
        "components": {
            "volatility_regime": "Low",
            "trend_strength": 0.72,
            "momentum_signal": "Positive",
            "breadth_indicator": "Healthy"
        }
    }


def get_regime_json() -> str:
    """Return regime data as formatted JSON string."""
    return json.dumps(get_mock_regime_data(), indent=2)


if __name__ == "__main__":
    print(get_regime_json())
