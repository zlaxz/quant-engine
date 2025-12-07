/**
 * Strategy Library Types
 * Data models for trading strategies
 */

export type StrategyCategory = 'gamma' | 'theta' | 'vega' | 'momentum' | 'mean-reversion' | 'custom';
export type StrategyStatus = 'research' | 'paper' | 'live' | 'retired';
export type LegType = 'call' | 'put' | 'stock' | 'future';
export type LegSide = 'long' | 'short';
export type StrikeType = 'absolute' | 'delta' | 'atm-offset';

export interface StrategyLeg {
  type: LegType;
  side: LegSide;
  strike?: number;
  strikeType: StrikeType;
  expiry: string; // DTE range or specific date
  quantity: number;
}

export interface StrategyMetrics {
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalTrades: number;
  avgDuration: string;
}

export interface RiskConfig {
  maxPositionSize: number; // % of portfolio
  maxLoss: number; // Per trade
  dailyLossLimit: number; // % of portfolio
  maxOpenPositions: number;
  liquidityMinimum: number; // Min volume/OI
}

export interface BacktestResult {
  id: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  metrics: StrategyMetrics;
  equityCurve: { date: string; value: number }[];
  trades: { date: string; pnl: number; type: string }[];
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;

  // Structure
  legs: StrategyLeg[];

  // Performance
  metrics: StrategyMetrics;
  backtestResults?: BacktestResult[];

  // Regime alignment
  optimalRegimes: string[];
  avoidRegimes: string[];

  // Risk parameters
  riskConfig: RiskConfig;

  // Status
  status: StrategyStatus;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  author: string;
  notes: string;
}

// Demo strategies for development
export const DEMO_STRATEGIES: Strategy[] = [
  {
    id: 'gex-flip',
    name: 'GEX Flip',
    description: 'Trades GEX zero-crossing events. Long gamma when dealers flip from short to long gamma. Captures momentum reversals.',
    category: 'gamma',
    legs: [
      { type: 'call', side: 'long', strikeType: 'atm-offset', strike: 0, expiry: '30 DTE', quantity: 1 },
      { type: 'put', side: 'long', strikeType: 'atm-offset', strike: 0, expiry: '30 DTE', quantity: 1 },
      { type: 'put', side: 'short', strikeType: 'delta', strike: 25, expiry: '30 DTE', quantity: 1 },
    ],
    metrics: {
      sharpe: 2.14,
      sortino: 2.87,
      calmar: 1.82,
      maxDrawdown: -0.118,
      winRate: 0.682,
      avgWin: 0.032,
      avgLoss: -0.018,
      profitFactor: 2.1,
      totalTrades: 247,
      avgDuration: '4.2 days',
    },
    optimalRegimes: ['HIGH_VOL', 'TRENDING'],
    avoidRegimes: ['LOW_VOL', 'RANGING'],
    riskConfig: {
      maxPositionSize: 0.05,
      maxLoss: 0.02,
      dailyLossLimit: 0.03,
      maxOpenPositions: 3,
      liquidityMinimum: 1000,
    },
    status: 'paper',
    createdAt: new Date('2024-06-15'),
    updatedAt: new Date('2024-12-01'),
    author: 'System',
    notes: 'Best performance during volatility regime transitions.',
  },
  {
    id: 'gamma-scalp',
    name: 'Gamma Scalp',
    description: 'Delta-neutral straddle with systematic gamma scalping. Profits from realized volatility exceeding implied.',
    category: 'gamma',
    legs: [
      { type: 'call', side: 'long', strikeType: 'atm-offset', strike: 0, expiry: '14 DTE', quantity: 1 },
      { type: 'put', side: 'long', strikeType: 'atm-offset', strike: 0, expiry: '14 DTE', quantity: 1 },
    ],
    metrics: {
      sharpe: 1.85,
      sortino: 2.31,
      calmar: 1.45,
      maxDrawdown: -0.082,
      winRate: 0.72,
      avgWin: 0.024,
      avgLoss: -0.015,
      profitFactor: 1.95,
      totalTrades: 312,
      avgDuration: '2.1 days',
    },
    optimalRegimes: ['HIGH_VOL', 'VOLATILE_RANGING'],
    avoidRegimes: ['LOW_VOL', 'TRENDING_UP'],
    riskConfig: {
      maxPositionSize: 0.08,
      maxLoss: 0.015,
      dailyLossLimit: 0.025,
      maxOpenPositions: 2,
      liquidityMinimum: 2000,
    },
    status: 'research',
    createdAt: new Date('2024-08-20'),
    updatedAt: new Date('2024-11-15'),
    author: 'System',
    notes: 'Requires frequent delta adjustments. Works best with tight spreads.',
  },
  {
    id: 'vol-harvest',
    name: 'Vol Harvest',
    description: 'Sells premium when IV rank is elevated. Iron condor structure with defined risk.',
    category: 'theta',
    legs: [
      { type: 'put', side: 'short', strikeType: 'delta', strike: 16, expiry: '45 DTE', quantity: 1 },
      { type: 'put', side: 'long', strikeType: 'delta', strike: 10, expiry: '45 DTE', quantity: 1 },
      { type: 'call', side: 'short', strikeType: 'delta', strike: 16, expiry: '45 DTE', quantity: 1 },
      { type: 'call', side: 'long', strikeType: 'delta', strike: 10, expiry: '45 DTE', quantity: 1 },
    ],
    metrics: {
      sharpe: 1.52,
      sortino: 1.89,
      calmar: 1.21,
      maxDrawdown: -0.145,
      winRate: 0.65,
      avgWin: 0.018,
      avgLoss: -0.028,
      profitFactor: 1.75,
      totalTrades: 156,
      avgDuration: '18 days',
    },
    optimalRegimes: ['HIGH_IV_RANK', 'RANGING'],
    avoidRegimes: ['LOW_IV_RANK', 'TRENDING'],
    riskConfig: {
      maxPositionSize: 0.10,
      maxLoss: 0.025,
      dailyLossLimit: 0.04,
      maxOpenPositions: 4,
      liquidityMinimum: 500,
    },
    status: 'live',
    createdAt: new Date('2024-03-10'),
    updatedAt: new Date('2024-12-05'),
    author: 'System',
    notes: 'Core income strategy. Roll at 21 DTE or 50% profit.',
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    description: 'Classic iron condor with systematic entry and management rules. Profits from time decay in range-bound markets.',
    category: 'theta',
    legs: [
      { type: 'put', side: 'short', strikeType: 'delta', strike: 20, expiry: '30 DTE', quantity: 1 },
      { type: 'put', side: 'long', strikeType: 'delta', strike: 10, expiry: '30 DTE', quantity: 1 },
      { type: 'call', side: 'short', strikeType: 'delta', strike: 20, expiry: '30 DTE', quantity: 1 },
      { type: 'call', side: 'long', strikeType: 'delta', strike: 10, expiry: '30 DTE', quantity: 1 },
    ],
    metrics: {
      sharpe: 1.35,
      sortino: 1.62,
      calmar: 1.05,
      maxDrawdown: -0.168,
      winRate: 0.58,
      avgWin: 0.022,
      avgLoss: -0.032,
      profitFactor: 1.45,
      totalTrades: 89,
      avgDuration: '12 days',
    },
    optimalRegimes: ['LOW_VOL', 'RANGING'],
    avoidRegimes: ['HIGH_VOL', 'TRENDING'],
    riskConfig: {
      maxPositionSize: 0.08,
      maxLoss: 0.03,
      dailyLossLimit: 0.05,
      maxOpenPositions: 5,
      liquidityMinimum: 300,
    },
    status: 'research',
    createdAt: new Date('2024-09-01'),
    updatedAt: new Date('2024-11-20'),
    author: 'System',
    notes: 'Entry when IV rank > 50%. Exit at 50% profit or 21 DTE.',
  },
];
