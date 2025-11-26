/**
 * Mock data generators for QuantOS visualizations
 * These provide realistic data matching the API contract for UI development
 */

import {
  RegimeHeatmapData,
  StrategyCardCollection,
  BacktestEquityCurve,
  DiscoveryMatrix,
  TradeExplanation,
  TradeAnatomy,
  GreeksCockpit,
  ScenarioSimulation,
} from '@/types/api-contract';

export function generateRegimeHeatmap(startDate: string, endDate: string): RegimeHeatmapData {
  const regimes = ['BULL_QUIET', 'BULL_VOL', 'BEAR_QUIET', 'BEAR_VOL', 'SIDEWAYS', 'CRASH'];
  const colors = ['#22C55E', '#84CC16', '#F59E0B', '#EF4444', '#FFCC00', '#991B1B'];
  
  const data = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const regimeIndex = Math.floor(Math.random() * regimes.length);
    data.push({
      date: d.toISOString().split('T')[0],
      regime_key: regimes[regimeIndex],
      display_name: regimes[regimeIndex].replace('_', ' '),
      color_code: colors[regimeIndex],
      confidence: 0.6 + Math.random() * 0.3,
      metrics: {
        vix: 15 + Math.random() * 25,
        trend_score: -0.2 + Math.random() * 0.4,
        description: `${regimes[regimeIndex]} conditions detected`,
      },
    });
  }
  
  return { data };
}

export function generateStrategyCards(): StrategyCardCollection {
  return {
    strategies: [
      {
        id: 'strat_vanna_001',
        name: 'Vanna Harvester',
        class: 'Income Generator',
        level: 5,
        badges: ['Bear Market Survivor', 'Low Drawdown'],
        stats: {
          sharpe: 1.8,
          win_rate: 0.65,
          max_drawdown: -0.12,
          annual_return: 0.24,
        },
        description: 'Sells OTM Puts when VIX > 20 to capture volatility decay.',
        best_regime: 'BEAR_VOL',
      },
      {
        id: 'strat_charm_002',
        name: 'Charm Sniper',
        class: 'Precision Trader',
        level: 4,
        badges: ['High Win Rate'],
        stats: {
          sharpe: 1.5,
          win_rate: 0.72,
          max_drawdown: -0.08,
          annual_return: 0.18,
        },
        description: 'Exploits time decay acceleration in final week before expiration.',
        best_regime: 'SIDEWAYS',
      },
      {
        id: 'strat_gamma_003',
        name: 'Gamma Scalper',
        class: 'High Frequency',
        level: 6,
        badges: ['Market Neutral', 'Crash Tested'],
        stats: {
          sharpe: 2.1,
          win_rate: 0.58,
          max_drawdown: -0.15,
          annual_return: 0.32,
        },
        description: 'Delta-neutral scalping using gamma exposure during volatile sessions.',
        best_regime: 'BULL_VOL',
      },
    ],
  };
}

export function generateEquityCurve(runId: string): BacktestEquityCurve {
  const points = [];
  let equity = 100000;
  const startDate = new Date('2023-01-01');
  
  for (let i = 0; i < 252; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    const change = (Math.random() - 0.48) * 500; // Slight positive bias
    equity += change;
    
    const point: any = {
      timestamp: date.toISOString(),
      equity: Math.round(equity * 100) / 100,
      drawdown_pct: Math.min(0, (equity - 100000) / 100000),
      active_trades: Math.floor(Math.random() * 5),
    };
    
    // Add occasional trade events
    if (Math.random() < 0.05) {
      point.event = {
        type: Math.random() < 0.5 ? 'ENTRY' : 'EXIT',
        symbol: `SPY ${Math.floor(350 + Math.random() * 50)}P`,
        description: point.event?.type === 'ENTRY' ? 'Entered Short Put' : 'Closed profitable position',
      };
    }
    
    points.push(point);
  }
  
  return { run_id: runId, time_series: points };
}

export function generateDiscoveryMatrix(): DiscoveryMatrix {
  const regimes = ['BULL_QUIET', 'BULL_VOL', 'BEAR_QUIET', 'BEAR_VOL', 'SIDEWAYS', 'CRASH'];
  
  return {
    matrix: regimes.map((regime, i) => ({
      regime,
      status: i < 2 ? 'CONQUERED' : i < 4 ? 'EXPLORING' : 'UNTOUCHED',
      best_strategy_id: i < 2 ? `strat_${regime.toLowerCase()}_001` : null,
      coverage_pct: i < 2 ? 100 : i < 4 ? 30 + Math.random() * 40 : 0,
    })),
  };
}

export function generateTradeExplanation(tradeId: string): TradeExplanation {
  return {
    trade_id: tradeId,
    action: 'ENTRY',
    timestamp: '2023-01-03 14:00',
    logic_chain: [
      {
        step: 1,
        check: 'Regime Check',
        result: 'PASS',
        detail: 'Market is in BEAR_VOL (VIX=24).',
      },
      {
        step: 2,
        check: 'Trigger',
        result: 'PASS',
        detail: 'RSI (30) dropped below 20, indicating oversold.',
      },
      {
        step: 3,
        check: 'Safety',
        result: 'PASS',
        detail: 'Capital available > 50%.',
      },
    ],
    plain_english: 'I entered this Short Put because the market was in a Bear Volatile state and the RSI indicated a temporary panic selling bottom. I expect a mean reversion bounce.',
  };
}

export function generateTradeAnatomy(tradeId: string): TradeAnatomy {
  return {
    trade_id: tradeId,
    symbol: 'SPY 380 Put',
    type: 'Short Put',
    current_spot: 382.50,
    break_even: 378.20,
    max_profit: 180.00,
    max_loss: 'Unlimited',
    probability_of_profit: 0.68,
    days_to_expiration: 5,
    zones: [
      { range: [0, 378.20], type: 'LOSS', color: 'red' },
      { range: [378.20, 1000], type: 'PROFIT', color: 'green' },
    ],
    analogy: 'Like selling flood insurance. You keep the premium ($180) as long as the water level (Price) stays above 378.20.',
  };
}

export function generateGreeksCockpit(): GreeksCockpit {
  return {
    timestamp: new Date().toISOString(),
    metrics: [
      {
        name: 'Delta',
        value: 150.5,
        unit: 'Shares',
        analogy: 'Directional Speed',
        status: 'WARNING',
        message: 'Leaning too Long. Market drop will hurt.',
      },
      {
        name: 'Gamma',
        value: 5.2,
        unit: 'Acceleration',
        analogy: 'Stability',
        status: 'OK',
        message: 'Portfolio is stable.',
      },
      {
        name: 'Vega',
        value: -23.5,
        unit: 'Volatility Exposure',
        analogy: 'Fear Sensitivity',
        status: 'OK',
        message: 'Benefiting from volatility decay.',
      },
      {
        name: 'Theta',
        value: 45.0,
        unit: '$/Day',
        analogy: 'Time Decay (Income)',
        status: 'OK',
        message: 'Earning $45/day from time passing.',
      },
    ],
  };
}

export function generateScenarioSimulation(): ScenarioSimulation {
  const currentPrice = 382.50;
  
  return {
    type: 'scenario_simulation',
    current_price: currentPrice,
    scenarios: [
      { move_pct: -0.05, price: 363.37, projected_pnl: 1250.00, desc: "Crash (-5%)" },
      { move_pct: -0.02, price: 374.85, projected_pnl: 450.00, desc: "Correction (-2%)" },
      { move_pct: 0.00, price: currentPrice, projected_pnl: 0.00, desc: "Flat" },
      { move_pct: +0.02, price: 390.15, projected_pnl: -320.00, desc: "Rally (+2%)" },
      { move_pct: +0.05, price: 401.62, projected_pnl: -850.00, desc: "Strong Rally (+5%)" },
    ],
    explanation: "Because you are Short Delta (Put), you profit if the market crashes. But notice how your profit caps out at -5%? That's your spread limiting the gain."
  };
}
