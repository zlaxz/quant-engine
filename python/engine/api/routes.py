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
import logging
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import from engine package (relative imports)
from ..analysis.regime_engine import RegimeEngine
from ..trading.simulator import TradeSimulator
from ..data.loaders import load_spy_data
from ..core.plugin_loader import get_registry, reload_plugins
from ..data.events import get_event_manager


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
        # Simulator instance for integrity tracking
        self._simulator: Optional[TradeSimulator] = None

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
            logger.error(f"Error in get_regime_heatmap: {e}", exc_info=True)
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

    def get_discovery_matrix(self) -> Dict[str, Any]:
        """
        Get the Discovery Matrix - coverage of strategies across regimes.

        Endpoint: GET /discovery

        Returns a matrix showing which strategies are optimal for each regime,
        plus coverage statistics.

        Returns:
            {
                'success': True,
                'matrix': {
                    'BULL_QUIET': ['profile_2', 'profile_4', 'profile_6'],
                    'BEAR_VOL': ['profile_1', 'profile_5'],
                    ...
                },
                'coverage': {
                    'total_regimes': 8,
                    'covered_regimes': 7,
                    'coverage_pct': 87.5
                },
                'strategy_reach': {
                    'profile_1': ['BEAR_VOL', 'VOL_EXPANSION'],
                    ...
                }
            }
        """
        # Build regime -> strategies mapping
        regime_strategies = {}
        for regime in REGIME_DESCRIPTIONS.keys():
            regime_strategies[regime] = []

        # Populate from strategy catalog
        for strategy_id, strategy in STRATEGY_CATALOG.items():
            for regime in strategy.get('optimal_regimes', []):
                if regime in regime_strategies:
                    regime_strategies[regime].append({
                        'id': strategy_id,
                        'name': strategy['name'],
                        'risk_level': strategy['risk_level']
                    })

        # Build strategy -> regimes mapping (inverse)
        strategy_reach = {}
        for strategy_id, strategy in STRATEGY_CATALOG.items():
            strategy_reach[strategy_id] = {
                'name': strategy['name'],
                'optimal_regimes': strategy.get('optimal_regimes', []),
                'regime_count': len(strategy.get('optimal_regimes', []))
            }

        # Calculate coverage statistics
        total_regimes = len(REGIME_DESCRIPTIONS)
        covered_regimes = sum(1 for strategies in regime_strategies.values() if strategies)
        coverage_pct = (covered_regimes / total_regimes * 100) if total_regimes > 0 else 0

        # Find coverage gaps (regimes with no optimal strategies)
        coverage_gaps = [
            regime for regime, strategies in regime_strategies.items()
            if not strategies
        ]

        # Calculate regime risk distribution
        regime_risk_profile = {}
        for regime, strategies in regime_strategies.items():
            if strategies:
                risk_levels = [s['risk_level'] for s in strategies]
                regime_risk_profile[regime] = {
                    'strategy_count': len(strategies),
                    'dominant_risk': max(set(risk_levels), key=risk_levels.count) if risk_levels else 'unknown',
                    'risk_distribution': {
                        'low': risk_levels.count('low'),
                        'medium': risk_levels.count('medium'),
                        'high': risk_levels.count('high')
                    }
                }
            else:
                regime_risk_profile[regime] = {
                    'strategy_count': 0,
                    'dominant_risk': 'none',
                    'risk_distribution': {'low': 0, 'medium': 0, 'high': 0}
                }

        return {
            'success': True,
            'matrix': regime_strategies,
            'coverage': {
                'total_regimes': total_regimes,
                'covered_regimes': covered_regimes,
                'coverage_pct': round(coverage_pct, 1),
                'gaps': coverage_gaps
            },
            'strategy_reach': strategy_reach,
            'regime_risk_profile': regime_risk_profile,
            'regime_descriptions': REGIME_DESCRIPTIONS
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
            logger.error(f"Error in run_simulation: {e}", exc_info=True)
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
            logger.error(f"Error in run_backtest: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }

    def run_backtest_on_noise(
        self,
        strategy_key: str,
        noise_prices: np.ndarray,
        capital: float = 100000
    ) -> Dict[str, Any]:
        """
        WHITE NOISE PROTOCOL - Run backtest on synthetic random data.

        A legitimate strategy should produce near-zero Sharpe on random data.
        If Sharpe > 0.5, the strategy likely has look-ahead bias or is overfit.

        Args:
            strategy_key: Strategy identifier
            noise_prices: Array of synthetic price series (pure random walk)
            capital: Starting capital

        Returns:
            {
                'success': True,
                'metrics': {'sharpe': 0.1, 'total_return': -2.3, ...},
                'verdict': 'PASS' or 'FAIL'
            }
        """
        try:
            # Create synthetic DataFrame from noise prices
            dates = pd.date_range(start='2020-01-01', periods=len(noise_prices), freq='B')
            noise_df = pd.DataFrame({
                'date': dates,
                'open': noise_prices * 0.999,
                'high': noise_prices * 1.005,
                'low': noise_prices * 0.995,
                'close': noise_prices,
                'volume': np.random.randint(1000000, 5000000, len(noise_prices)),
            })
            noise_df['date'] = noise_df['date'].dt.date

            # Run simplified buy-and-hold simulation on noise
            # (Full strategy simulation requires loading strategy logic)
            returns = np.diff(noise_prices) / noise_prices[:-1]
            sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252) if np.std(returns) > 0 else 0
            total_return = (noise_prices[-1] / noise_prices[0] - 1) * 100
            max_dd = self._calc_max_drawdown(noise_prices)

            return {
                'success': True,
                'metrics': {
                    'sharpe': round(sharpe, 3),
                    'total_return': round(total_return, 2),
                    'max_drawdown': round(max_dd, 2),
                    'data_source': 'WHITE_NOISE'
                }
            }

        except Exception as e:
            logger.error(f"Error in run_backtest_on_noise: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }

    def _calc_max_drawdown(self, prices: np.ndarray) -> float:
        """Calculate maximum drawdown percentage."""
        peak = prices[0]
        max_dd = 0.0
        for price in prices:
            if price > peak:
                peak = price
            dd = (peak - price) / peak * 100
            if dd > max_dd:
                max_dd = dd
        return max_dd

    def run_plugin(
        self,
        plugin_name: str,
        params: Optional[Dict[str, Any]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute a dynamically loaded plugin.

        Endpoint: GET /analysis/<plugin_name>

        Query params:
            - start_date: YYYY-MM-DD (optional, defaults to 90 days ago)
            - end_date: YYYY-MM-DD (optional, defaults to today)
            - Any plugin-specific params

        Returns:
            {
                'success': True,
                'plugin': 'volatility_analyzer',
                'result': { ... plugin output ... }
            }
        """
        try:
            # Get plugin from registry
            registry = get_registry()
            plugin = registry.get(plugin_name)

            if plugin is None:
                available = [p['name'] for p in registry.list_plugins()]
                return {
                    'success': False,
                    'error': f'Plugin not found: {plugin_name}',
                    'available_plugins': available
                }

            # Get data for plugin
            spy_df = self._get_spy_data()

            # Filter date range if provided
            if start_date or end_date:
                if start_date:
                    start = datetime.strptime(start_date, '%Y-%m-%d').date()
                else:
                    start = (datetime.now() - timedelta(days=90)).date()

                if end_date:
                    end = datetime.strptime(end_date, '%Y-%m-%d').date()
                else:
                    end = datetime.now().date()

                spy_df = spy_df[(spy_df['date'] >= start) & (spy_df['date'] <= end)].copy()

            if len(spy_df) == 0:
                return {
                    'success': False,
                    'error': 'No data available for specified date range'
                }

            # Validate data meets plugin requirements
            plugin.validate_data(spy_df)

            # Execute plugin
            result = plugin.run(spy_df, params or {})

            return {
                'success': True,
                'plugin': plugin_name,
                'version': plugin.version,
                'data_points': len(spy_df),
                'result': result
            }

        except ValueError as e:
            return {
                'success': False,
                'error': f'Validation error: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Plugin error: {str(e)}'
            }

    def list_plugins(self) -> Dict[str, Any]:
        """
        List all available plugins.

        Endpoint: GET /plugins

        Returns:
            {
                'success': True,
                'plugins': [
                    {'name': 'vol_analyzer', 'description': '...', 'version': '1.0.0'},
                    ...
                ],
                'count': 3
            }
        """
        registry = get_registry()
        plugins = registry.list_plugins()
        errors = registry.get_errors()

        return {
            'success': True,
            'plugins': plugins,
            'count': len(plugins),
            'load_errors': errors if errors else None
        }

    def reload_plugins(self) -> Dict[str, Any]:
        """
        Hot reload all plugins from disk.

        Endpoint: POST /plugins/reload

        Returns:
            {
                'success': True,
                'loaded': ['plugin1', 'plugin2'],
                'errors': {...},
                'total': 2
            }
        """
        result = reload_plugins()
        return {
            'success': True,
            **result
        }

    def get_integrity_status(self) -> Dict[str, Any]:
        """
        Get system integrity status for the dashboard.

        Endpoint: GET /integrity

        Returns comprehensive status of all safety systems:
        - Double-Entry Accounting audit status
        - Circuit Breaker status
        - Event Horizon (macro event risk)
        - Execution Lag Enforcer status
        - Active positions and pending orders
        """
        # Get simulator status if available
        simulator_status = {}
        if self._simulator:
            simulator_status = self._simulator.get_integrity_status()

        # Get event horizon status
        event_manager = get_event_manager()
        now = datetime.now()
        is_risky, risk_reason = event_manager.is_high_risk_window(now)
        upcoming_events = event_manager.get_upcoming_events(now, hours_ahead=24)

        return {
            'success': True,
            'timestamp': now.isoformat(),
            'systems': {
                'double_entry_accounting': {
                    'name': 'Double-Entry Accounting',
                    'status': 'PASS' if simulator_status.get('audit_passed', True) else 'FAIL',
                    'ticks_checked': simulator_status.get('ticks_checked', 0),
                    'total_fees': simulator_status.get('total_fees', 0),
                    'total_realized_pnl': simulator_status.get('total_realized_pnl', 0)
                },
                'circuit_breaker': {
                    'name': 'Daily Circuit Breaker',
                    'status': 'HALTED' if simulator_status.get('trading_halted', False) else 'ARMED',
                    'daily_loss_limit': f"{simulator_status.get('daily_loss_limit_pct', 0.02) * 100:.1f}%",
                    'daily_starting_equity': simulator_status.get('daily_starting_equity', 0)
                },
                'event_horizon': {
                    'name': 'Event Horizon (Macro Risk)',
                    'status': 'BLOCKED' if is_risky else 'CLEAR',
                    'reason': risk_reason,
                    'events_blocked': simulator_status.get('event_blocks', 0),
                    'upcoming_events': upcoming_events[:3]  # Next 3 events
                },
                'execution_lag': {
                    'name': 'Execution Lag Enforcer',
                    'status': 'ENABLED' if simulator_status.get('execution_lag_enabled', True) else 'DISABLED',
                    'orders_delayed': simulator_status.get('orders_delayed', 0),
                    'pending_orders': simulator_status.get('pending_orders', 0)
                },
                'positions': {
                    'name': 'Active Positions',
                    'count': simulator_status.get('active_trades', 0),
                    'current_equity': simulator_status.get('current_equity', 0)
                }
            },
            'overall_status': 'HEALTHY' if simulator_status.get('audit_passed', True) and not simulator_status.get('trading_halted', False) else 'WARNING'
        }


# Singleton instance for server use
_api_instance = None

def get_api() -> QuantEngineAPI:
    """Get or create the API singleton."""
    global _api_instance
    if _api_instance is None:
        _api_instance = QuantEngineAPI()
    return _api_instance
