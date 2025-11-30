#!/usr/bin/env python3
"""
Volatility Analyzer Plugin
==========================
Sample plugin demonstrating the QuantModule interface.

Calculates rolling volatility statistics on price data.

Usage via API:
    GET /analysis/volatility_analyzer?start_date=2024-01-01&window=20

Parameters:
    window: Rolling window size in days (default: 20)
    annualize: Whether to annualize volatility (default: true)
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, Optional

# Import the base class from core
from ..core.interfaces import QuantModule


class VolatilityAnalyzer(QuantModule):
    """
    Calculates rolling and aggregate volatility statistics.

    This plugin demonstrates:
    - Implementing the QuantModule interface
    - Using required_columns for data validation
    - Processing parameters from API requests
    - Returning JSON-serializable results
    """

    name = "volatility_analyzer"
    description = "Calculate rolling volatility statistics on price data"
    version = "1.0.0"
    author = "Chief Quant"
    required_columns = ['close', 'date']

    def run(self, data: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Calculate volatility metrics.

        Args:
            data: DataFrame with 'close' and 'date' columns
            params: {
                'window': int (default 20) - Rolling window size
                'annualize': bool (default True) - Annualize the volatility
            }

        Returns:
            {
                'current_vol': float - Latest rolling volatility,
                'mean_vol': float - Average volatility over period,
                'max_vol': float - Maximum volatility spike,
                'min_vol': float - Minimum volatility,
                'vol_percentile': float - Current vol as percentile,
                'regime': str - Vol regime classification,
                'rolling_vol': list - Time series of rolling volatility
            }
        """
        params = params or {}
        window = int(params.get('window', 20))
        annualize = params.get('annualize', True)

        # Calculate log returns
        data = data.sort_values('date').copy()
        data['returns'] = np.log(data['close'] / data['close'].shift(1))

        # Rolling volatility
        data['rolling_vol'] = data['returns'].rolling(window=window).std()

        # Annualize if requested (sqrt of trading days)
        if annualize:
            data['rolling_vol'] = data['rolling_vol'] * np.sqrt(252)

        # Drop NaN values for statistics
        vol_series = data['rolling_vol'].dropna()

        if len(vol_series) == 0:
            return {
                'success': False,
                'error': f'Not enough data for window size {window}'
            }

        current_vol = float(vol_series.iloc[-1])
        mean_vol = float(vol_series.mean())
        max_vol = float(vol_series.max())
        min_vol = float(vol_series.min())

        # Calculate percentile rank of current vol
        vol_percentile = float((vol_series < current_vol).mean() * 100)

        # Classify regime
        if vol_percentile >= 80:
            regime = 'HIGH_VOL'
        elif vol_percentile >= 60:
            regime = 'ELEVATED'
        elif vol_percentile >= 40:
            regime = 'NORMAL'
        elif vol_percentile >= 20:
            regime = 'LOW'
        else:
            regime = 'COMPRESSED'

        # Build rolling vol time series for charts
        rolling_vol_series = []
        for _, row in data.dropna(subset=['rolling_vol']).iterrows():
            rolling_vol_series.append({
                'date': row['date'].strftime('%Y-%m-%d') if hasattr(row['date'], 'strftime') else str(row['date']),
                'volatility': round(float(row['rolling_vol']) * 100, 2)  # As percentage
            })

        return {
            'success': True,
            'metrics': {
                'current_vol': round(current_vol * 100, 2),  # As percentage
                'mean_vol': round(mean_vol * 100, 2),
                'max_vol': round(max_vol * 100, 2),
                'min_vol': round(min_vol * 100, 2),
                'vol_percentile': round(vol_percentile, 1),
                'regime': regime
            },
            'parameters': {
                'window': window,
                'annualized': annualize
            },
            'rolling_vol': rolling_vol_series[-30:]  # Last 30 points for chart
        }
