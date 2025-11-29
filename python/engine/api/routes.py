#!/usr/bin/env python3
"""
Quant Engine API Routes
=======================
Business logic for API endpoints. Keeps server.py clean.

This module provides:
- get_regime_heatmap(): Regime classification over date range
- get_strategy_card(): Strategy details and metrics
- run_simulation(): Scenario analysis (VIX shock, price drop)
- run_backtest(): Full backtest execution
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any

# Import from engine package (relative imports)
from ..analysis.regime_engine import RegimeEngine
from ..trading.simulator import TradeSimulator
from ..data.loaders import load_spy_data


# Strategy definitions (would be in database in production)
STRATEGY_CATALOG = {
    'profile_1': {
        'id': 'profile_1',
        'name': 'Long Gamma (Crash Protection)',
        'description': 'Long straddles/strangles that profit from large moves. Best in high volatility regimes.',
        'risk_level': 'medium',
        'optimal_regimes': ['BEAR_VOL', 'VOL_EXPANSION'],
        'instruments': ['ATM Straddle', 'OTM Strangle'],
    },
    'profile_2': {
        'id': 'profile_2',
        'name': 'Short Gamma (Theta Harvest)',
        'description': 'Sell premium via iron condors, credit spreads. Best in low volatility sideways markets.',
        'risk_level': 'high',
        'optimal_regimes': ['SIDEWAYS', 'BULL_QUIET'],
        'instruments': ['Iron Condor', 'Credit Spread'],
    },
    'profile_3': {
        'id': 'profile_3',
        'name': 'Vega Play (Vol Mean Reversion)',
        'description': 'Trade volatility mean reversion using VIX derivatives or calendar spreads.',
        'risk_level': 'medium',
        'optimal_regimes': ['VOL_EXPANSION', 'VOL_COMPRESSION'],
        'instruments': ['Calendar Spread', 'VIX Call'],
    },
    'profile_4': {
        'id': 'profile_4',
        'name': 'Delta Neutral (Market Making)',
        'description': 'Delta-hedged positions capturing theta and gamma. Requires active management.',
        'risk_level': 'low',
        'optimal_regimes': ['SIDEWAYS', 'BULL_QUIET'],
        'instruments': ['Hedged Straddle', 'Box Spread'],
    },
    'profile_5': {
        'id': 'profile_5',
        'name': 'Tail Hedge (Black Swan Protection)',
        'description': 'Deep OTM puts for portfolio protection. Negative expected value but critical insurance.',
        'risk_level': 'low',
        'optimal_regimes': ['BEAR_VOL'],
        'instruments': ['Deep OTM Put', 'Put Spread'],
    },
    'profile_6': {
        'id': 'profile_6',
        'name': 'Momentum Rider (Trend Following)',
        'description': 'Directional options aligned with trend. Uses delta and momentum signals.',
        'risk_level': 'high',
        'optimal_regimes': ['BULL_QUIET', 'BEAR_TREND'],
        'instruments': ['Call Debit Spread', 'Put Debit Spread'],
    },
}

# Regime descriptions
REGIME_DESCRIPTIONS = {
    'BULL_QUIET': 'Steady uptrend with low volatility. Ideal for short premium strategies.',
    'BULL_VOL': 'Uptrend with elevated volatility. Consider hedged directional plays.',
    'BEAR_QUIET': 'Downtrend with low volatility. Watch for vol expansion.',
    'BEAR_VOL': 'High volatility downtrend. Crash risk elevated. Long gamma preferred.',
    'SIDEWAYS': 'Range-bound market. Theta harvesting strategies work well.',
    'VOL_EXPANSION': 'Volatility rising rapidly. Reduce short gamma exposure.',
    'VOL_COMPRESSION': 'Volatility declining. Good entry for long vega.',
    'TRANSITION': 'Regime transitioning. Reduce position sizes.',
}


class QuantEngineAPI:
    """
    Main API class for the Quant Engine.
    Encapsulates all business logic for HTTP endpoints.
    """

    def __init__(self):
        self.regime_engine = RegimeEngine()
        self._spy_cache = None
        self._spy_cache_time = None

    def _get_spy_data(self, force_reload: bool = False) -> pd.DataFrame:
        """Get SPY data with simple caching."""
        cache_ttl = 300  # 5 minutes
        now = datetime.now()

        if (not force_reload and
            self._spy_cache is not None and
            self._spy_cache_time and
            (now - self._spy_cache_time).seconds < cache_ttl):
            return self._spy_cache.copy()

        self._spy_cache = load_spy_data()
        self._spy_cache_time = now
        return self._spy_cache.copy()

    def get_regime_heatmap(
        self,
        start_date: str,
        end_date: str
    ) -> Dict[str, Any]:
        """
        Get regime classification heatmap for date range.

        Endpoint: GET /regimes?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD

        Returns:
            {
                'success': True,
                'data': [
                    {
                        'date': '2023-01-03',
                        'regime': 'BULL_QUIET',
                        'regime_id': 1,
                        'confidence': 0.85,
                        'metrics': {'vix': 15.2, 'trend': 'up', 'rv': 12.1},
                        'description': '...'
                    },
                    ...
                ]
            }
        """
        try:
            # Parse dates
            start = datetime.strptime(start_date, '%Y-%m-%d').date()
            end = datetime.strptime(end_date, '%Y-%m-%d').date()

            # Load SPY data
            spy_df = self._get_spy_data()

            # Filter date range
            spy_df = spy_df[(spy_df['date'] >= start) & (spy_df['date'] <= end)].copy()

            if len(spy_df) == 0:
                return {
                    'success': False,
                    'error': f'No data available for {start_date} to {end_date}'
                }

            # Run regime classification
            labeled_df = self.regime_engine.label_historical_data(spy_df)

            # Build heatmap data
            heatmap_data = []
            for _, row in labeled_df.iterrows():
                regime_label = row.get('regime', 'UNKNOWN')
                regime_id = row.get('regime_id', 0)

                # Extract metrics from row
                metrics = {}
                if 'RV5' in row:
                    metrics['rv5'] = float(row['RV5']) if pd.notna(row['RV5']) else None
                if 'RV20' in row:
                    metrics['rv20'] = float(row['RV20']) if pd.notna(row['RV20']) else None
                if 'close' in row:
                    metrics['close'] = float(row['close'])
                if 'slope' in row:
                    metrics['trend'] = 'up' if row['slope'] > 0 else 'down'

                heatmap_data.append({
                    'date': row['date'].strftime('%Y-%m-%d') if hasattr(row['date'], 'strftime') else str(row['date']),
                    'regime': regime_label,
                    'regime_id': int(regime_id) if pd.notna(regime_id) else 0,
                    'confidence': 0.85,  # Placeholder until engine supports confidence
                    'metrics': metrics,
                    'description': REGIME_DESCRIPTIONS.get(regime_label, 'Unknown market state.')
                })

            return {
                'success': True,
                'data': heatmap_data,
                'count': len(heatmap_data),
                'date_range': {'start': start_date, 'end': end_date}
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def get_strategy_card(self, strategy_id: str) -> Dict[str, Any]:
        """
        Get strategy details and performance metrics.

        Endpoint: GET /strategies/<id>

        Returns:
            {
                'success': True,
                'strategy': {
                    'id': 'profile_1',
                    'name': 'Long Gamma',
                    'description': '...',
                    'risk_level': 'medium',
                    'optimal_regimes': ['BEAR_VOL'],
                    'instruments': ['ATM Straddle'],
                    'performance': {
                        'sharpe': 1.2,
                        'max_drawdown': -15.3,
                        'win_rate': 0.55,
                        'avg_return': 2.1
                    },
                    'current_allocation': 0.15,
                    'signal': 'HOLD'
                }
            }
        """
        # Look up strategy
        strategy = STRATEGY_CATALOG.get(strategy_id)

        if not strategy:
            return {
                'success': False,
                'error': f'Strategy not found: {strategy_id}'
            }

        # Try to get performance metrics from a recent backtest
        # (In production, this would query a cache or database)
        performance = self._get_strategy_performance(strategy_id)

        # Get current regime to determine signal
        current_signal = self._get_strategy_signal(strategy_id)

        return {
            'success': True,
            'strategy': {
                **strategy,
                'performance': performance,
                'current_allocation': performance.get('recommended_allocation', 0.0),
                'signal': current_signal
            }
        }

    def _get_strategy_performance(self, strategy_id: str) -> Dict[str, float]:
        """Get strategy performance metrics (stub with realistic defaults)."""
        # In production, this would query historical backtest results
        default_performance = {
            'profile_1': {'sharpe': 0.8, 'max_drawdown': -18.5, 'win_rate': 0.42, 'avg_return': 1.8, 'recommended_allocation': 0.15},
            'profile_2': {'sharpe': 1.1, 'max_drawdown': -12.3, 'win_rate': 0.68, 'avg_return': 0.9, 'recommended_allocation': 0.25},
            'profile_3': {'sharpe': 0.6, 'max_drawdown': -22.1, 'win_rate': 0.45, 'avg_return': 1.5, 'recommended_allocation': 0.10},
            'profile_4': {'sharpe': 1.4, 'max_drawdown': -8.2, 'win_rate': 0.72, 'avg_return': 0.5, 'recommended_allocation': 0.20},
            'profile_5': {'sharpe': -0.3, 'max_drawdown': -95.0, 'win_rate': 0.08, 'avg_return': -5.2, 'recommended_allocation': 0.05},
            'profile_6': {'sharpe': 0.9, 'max_drawdown': -25.4, 'win_rate': 0.51, 'avg_return': 2.3, 'recommended_allocation': 0.15},
        }
        return default_performance.get(strategy_id, {'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'avg_return': 0, 'recommended_allocation': 0})

    def _get_strategy_signal(self, strategy_id: str) -> str:
        """Get current trading signal for strategy based on regime."""
        # In production, this would check current regime vs optimal regimes
        # For now, return a simple signal
        signals = ['BUY', 'HOLD', 'REDUCE', 'AVOID']
        # Use strategy_id hash to get deterministic but varied signals
        idx = hash(strategy_id) % len(signals)
        return signals[idx]

    def list_strategies(self) -> Dict[str, Any]:
        """
        List all available strategies.

        Endpoint: GET /strategies

        Returns:
            {
                'success': True,
                'strategies': [...]
            }
        """
        strategies = []
        for sid, strategy in STRATEGY_CATALOG.items():
            strategies.append({
                'id': sid,
                'name': strategy['name'],
                'risk_level': strategy['risk_level'],
                'description': strategy['description'][:100] + '...' if len(strategy['description']) > 100 else strategy['description']
            })

        return {
            'success': True,
            'strategies': strategies,
            'count': len(strategies)
        }

    def run_simulation(
        self,
        scenario: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Run scenario simulation (VIX shock, price drop, etc).

        Endpoint: POST /simulate

        Request body:
            {
                'scenario': 'vix_shock',
                'params': {
                    'vix_increase': 50,  # percentage
                    'duration_days': 5
                },
                'portfolio': {
                    'profile_1': 0.15,
                    'profile_2': 0.25,
                    ...
                }
            }

        Returns:
            {
                'success': True,
                'impact': {
                    'portfolio_pnl': -5.2,
                    'by_strategy': {...},
                    'greeks_impact': {...},
                    'recommendations': [...]
                }
            }
        """
        try:
            scenario_type = scenario.get('scenario', 'vix_shock')
            params = scenario.get('params', {})
            portfolio = scenario.get('portfolio', {})

            # Default portfolio if not provided
            if not portfolio:
                portfolio = {
                    'profile_1': 0.15,
                    'profile_2': 0.25,
                    'profile_3': 0.10,
                    'profile_4': 0.20,
                    'profile_5': 0.05,
                    'profile_6': 0.15,
                    'cash': 0.10
                }

            # Run scenario simulation
            if scenario_type == 'vix_shock':
                impact = self._simulate_vix_shock(params, portfolio)
            elif scenario_type == 'price_drop':
                impact = self._simulate_price_drop(params, portfolio)
            elif scenario_type == 'vol_crush':
                impact = self._simulate_vol_crush(params, portfolio)
            else:
                return {
                    'success': False,
                    'error': f'Unknown scenario type: {scenario_type}'
                }

            return {
                'success': True,
                'scenario': scenario_type,
                'params': params,
                'impact': impact
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def _simulate_vix_shock(
        self,
        params: Dict[str, Any],
        portfolio: Dict[str, float]
    ) -> Dict[str, Any]:
        """Simulate VIX spike impact on portfolio."""
        vix_increase = params.get('vix_increase', 50)  # percentage

        # Impact multipliers by strategy (simplified model)
        # Positive = benefits from VIX spike, negative = hurts
        vix_sensitivity = {
            'profile_1': +0.8,   # Long gamma benefits
            'profile_2': -1.2,   # Short gamma hurts badly
            'profile_3': +0.4,   # Vega play benefits somewhat
            'profile_4': -0.3,   # Delta neutral slight hurt
            'profile_5': +2.0,   # Tail hedge benefits greatly
            'profile_6': -0.5,   # Momentum hurt by chaos
            'cash': 0.0
        }

        by_strategy = {}
        portfolio_pnl = 0.0

        for strategy_id, allocation in portfolio.items():
            sensitivity = vix_sensitivity.get(strategy_id, 0)
            strategy_impact = allocation * sensitivity * (vix_increase / 100)
            by_strategy[strategy_id] = {
                'allocation': allocation,
                'pnl_pct': round(strategy_impact * 100, 2),
                'sensitivity': sensitivity
            }
            portfolio_pnl += strategy_impact

        # Greeks impact estimation
        greeks_impact = {
            'delta': -0.15 * (vix_increase / 50),  # Markets drop on VIX spike
            'gamma': +0.3 * (vix_increase / 50),   # Gamma value increases
            'vega': +0.5 * (vix_increase / 50),    # Vega P&L positive for long
            'theta': -0.1 * (vix_increase / 50),   # Theta accelerates
        }

        recommendations = []
        if vix_increase > 30:
            recommendations.append('Consider reducing profile_2 (short gamma) exposure')
            recommendations.append('Profile_5 (tail hedge) is providing value - hold')
        if portfolio.get('profile_2', 0) > 0.20:
            recommendations.append('Short gamma allocation above 20% - high risk in vol spike')

        return {
            'portfolio_pnl_pct': round(portfolio_pnl * 100, 2),
            'by_strategy': by_strategy,
            'greeks_impact': greeks_impact,
            'recommendations': recommendations,
            'stress_level': 'HIGH' if vix_increase > 40 else 'MEDIUM' if vix_increase > 20 else 'LOW'
        }

    def _simulate_price_drop(
        self,
        params: Dict[str, Any],
        portfolio: Dict[str, float]
    ) -> Dict[str, Any]:
        """Simulate market price drop impact."""
        drop_pct = params.get('drop_pct', 10)

        # Delta sensitivity by strategy
        delta_sensitivity = {
            'profile_1': 0.0,    # Delta neutral
            'profile_2': -0.2,   # Slight short delta
            'profile_3': 0.0,    # Delta neutral
            'profile_4': 0.0,    # Delta neutral by design
            'profile_5': +0.3,   # Long puts gain
            'profile_6': -0.5,   # Directional exposure
            'cash': 0.0
        }

        by_strategy = {}
        portfolio_pnl = 0.0

        for strategy_id, allocation in portfolio.items():
            sensitivity = delta_sensitivity.get(strategy_id, 0)
            strategy_impact = allocation * sensitivity * (drop_pct / 10)
            by_strategy[strategy_id] = {
                'allocation': allocation,
                'pnl_pct': round(strategy_impact * 100, 2),
            }
            portfolio_pnl += strategy_impact

        return {
            'portfolio_pnl_pct': round(portfolio_pnl * 100, 2),
            'by_strategy': by_strategy,
            'recommendations': ['Profile_5 providing crash protection' if drop_pct > 5 else 'Drawdown within normal range'],
            'stress_level': 'HIGH' if drop_pct > 15 else 'MEDIUM' if drop_pct > 7 else 'LOW'
        }

    def _simulate_vol_crush(
        self,
        params: Dict[str, Any],
        portfolio: Dict[str, float]
    ) -> Dict[str, Any]:
        """Simulate volatility crush impact."""
        vol_drop = params.get('vol_drop', 30)  # percentage drop in IV

        # Vega sensitivity (inverted for vol crush)
        vega_sensitivity = {
            'profile_1': -0.6,   # Long vega hurts
            'profile_2': +0.5,   # Short vega benefits
            'profile_3': -0.3,   # Long vega hurts
            'profile_4': +0.1,   # Slight benefit
            'profile_5': -0.8,   # Long vega hurts badly
            'profile_6': 0.0,    # Direction focused
            'cash': 0.0
        }

        by_strategy = {}
        portfolio_pnl = 0.0

        for strategy_id, allocation in portfolio.items():
            sensitivity = vega_sensitivity.get(strategy_id, 0)
            strategy_impact = allocation * sensitivity * (vol_drop / 30)
            by_strategy[strategy_id] = {
                'allocation': allocation,
                'pnl_pct': round(strategy_impact * 100, 2),
            }
            portfolio_pnl += strategy_impact

        return {
            'portfolio_pnl_pct': round(portfolio_pnl * 100, 2),
            'by_strategy': by_strategy,
            'recommendations': ['Profile_2 benefiting from vol crush', 'Consider closing long vega positions'],
            'stress_level': 'MEDIUM' if vol_drop > 20 else 'LOW'
        }

    def run_backtest(
        self,
        strategy_key: str,
        start_date: str,
        end_date: str,
        capital: float = 100000
    ) -> Dict[str, Any]:
        """
        Run a full backtest.

        Endpoint: POST /backtest

        Returns backtest results with equity curve, trades, and metrics.
        """
        try:
            # Load and filter data
            spy_df = self._get_spy_data()

            start = datetime.strptime(start_date, '%Y-%m-%d').date()
            end = datetime.strptime(end_date, '%Y-%m-%d').date()
            spy_df = spy_df[(spy_df['date'] >= start) & (spy_df['date'] <= end)].copy()

            if len(spy_df) == 0:
                return {
                    'success': False,
                    'error': f'No data for period {start_date} to {end_date}'
                }

            # Run simulation
            simulator = TradeSimulator(initial_capital=capital)
            result = simulator.run(spy_df, strategy_key)

            return {
                'success': True,
                'metrics': result.get('metrics', {}),
                'equity_curve': result.get('equity_curve', []),
                'trades': result.get('trades', []),
                'engine_source': 'quant-engine'
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }


# Singleton instance for server use
_api_instance = None

def get_api() -> QuantEngineAPI:
    """Get or create the API singleton."""
    global _api_instance
    if _api_instance is None:
        _api_instance = QuantEngineAPI()
    return _api_instance
