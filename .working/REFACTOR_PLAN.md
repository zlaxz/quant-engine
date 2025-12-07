# Quant Engine Full Refactor Plan

**Created:** 2025-12-06
**Purpose:** Transform research system into multi-monitor trading observatory + live execution platform

---

## Executive Summary

This plan transforms the current Market Physics Engine from a research-only system into a **dual-mode trading platform**:
- **Research Mode**: Discovery, backtesting, strategy development
- **Trading Mode**: Live execution via Schwab API + ThetaData

Key deliverables:
1. Multi-window architecture for 4 monitors
2. Strategy Library with browsable strategies
3. Clean visual organization
4. Broker integrations (Schwab equities/futures/options, ThetaData live Greeks)
5. Crypto stubbed for future

---

## PHASE 1: COMPONENT CLEANUP (Day 1)

### 1.1 Components to DELETE (Unused/Legacy)

These components are dead code or superseded by JARVIS:

```
DELETE - src/components/chat/              # Old Gemini chat - superseded by JARVIS
  ├── ChatArea.tsx
  ├── ChatSidebar.tsx
  ├── ChatSessionList.tsx
  ├── MessageCard.tsx
  ├── RunResultCard.tsx
  ├── ActiveExperimentBar.tsx
  ├── CommandSuggestions.tsx
  └── HelperChatDialog.tsx

DELETE - src/components/insight/           # Old CIO insight panels
  ├── CIOInsightPanel.tsx
  ├── MemoryRecallPanel.tsx
  ├── ToolCallTreeLive.tsx
  ├── StreamingProgressBar.tsx
  └── ContextWindowIndicator.tsx

DELETE - src/components/research/          # Old research IDE components
  ├── ClaudeCodeProgressPanel.tsx
  ├── ClaudeCodeResultCard.tsx
  ├── ClaudeCodeErrorCard.tsx
  ├── ClaudeCodeCommandPreview.tsx
  ├── ClaudeCodePendingPreview.tsx
  ├── AgentSpawnMonitor.tsx
  ├── ToolCallTree.tsx
  ├── ThinkingStream.tsx
  ├── ErrorCard.tsx
  ├── MemoryRecallToast.tsx
  ├── OperationProgress.tsx
  ├── ConversationTimeline.tsx
  ├── OperationCard.tsx
  ├── RoadmapTracker.tsx
  ├── StatusStripEnhanced.tsx
  ├── FindingsPanel.tsx
  ├── LearningCenter.tsx
  ├── DecisionCard.tsx
  ├── EvidenceChain.tsx
  ├── WorkingMemoryCheckpoint.tsx
  ├── ResumeTaskDialog.tsx
  ├── ContextualEducationOverlay.tsx
  └── PythonExecutionPanel.tsx

DELETE - src/components/onboarding/        # Setup wizard (one-time)
  └── OnboardingWizard.tsx

DELETE - src/components/quant/             # Old quant panels
  ├── QuantPanel.tsx
  ├── ExperimentBrowser.tsx
  └── RunComparisonPanel.tsx

DELETE - src/contexts/ChatContext.tsx      # Chat state (unused)
DELETE - src/contexts/MissionControlContext.tsx  # Superseded

DELETE - src/lib/                          # Old lib files
  ├── autoAnalyze.ts
  ├── codeWriter.ts
  ├── contextualSuggestions.ts
  ├── directiveParser.ts
  ├── displayDirectiveParser.ts
  ├── experimentPlanning.ts
  ├── findingsStorage.ts
  ├── intentDetector.ts
  ├── memoryCuration.ts
  ├── patternDetection.ts
  ├── patternSummaries.ts
  ├── redTeamAudit.ts
  ├── researchReports.ts
  ├── riskSummaries.ts
  ├── slashCommands.ts
  ├── stageVisualizationMapper.ts
  └── auditSummaries.ts

DELETE - src/prompts/                      # All CIO prompts (not used anymore)
  └── (all files)
```

**Estimated: ~80 files deleted, ~15,000 LOC removed**

### 1.2 Components to KEEP & REFACTOR

```
KEEP - src/components/trading/             # Core trading viz
  ├── PipelineVisualization.tsx           # Refactor for popout
  ├── SwarmActivityMonitor.tsx            # Refactor for popout
  ├── PnLHeatmap.tsx                      # Refactor for popout
  ├── InteractiveFlowDiagram.tsx          # Refactor for popout
  └── KeyboardShortcuts.tsx               # Keep as-is

KEEP - src/components/dashboard/           # Useful dashboard panels
  ├── MissionMonitor.tsx                  # Rename: SystemMonitor
  ├── BacktestRunner.tsx                  # Keep for research mode
  ├── RegimeDisplay.tsx                   # Keep for both modes
  └── SystemIntegrity.tsx                 # Keep for monitoring

KEEP - src/components/visualizations/      # Keep all viz components
  ├── VisualizationContainer.tsx
  ├── DualPurposePanel.tsx
  ├── DynamicRenderer.tsx
  └── (others)

KEEP - src/components/swarm/               # Keep swarm monitoring
  ├── SwarmMonitor.tsx
  ├── SwarmStatusBar.tsx
  └── SwarmHiveMonitor.tsx

KEEP - src/components/ui/                  # All shadcn primitives
  └── (all files)

KEEP - src/hooks/useJarvisEvents.ts        # Core event system
KEEP - src/contexts/VisualizationContext.tsx
KEEP - src/contexts/ResearchDisplayContext.tsx
```

---

## PHASE 2: NEW ARCHITECTURE (Days 2-3)

### 2.1 New Directory Structure

```
src/
├── app/                           # App shell
│   ├── App.tsx                   # Root with providers
│   ├── routes.tsx                # Route definitions
│   └── providers.tsx             # Context providers
│
├── windows/                       # Window types (multi-monitor)
│   ├── main/                     # Main window
│   │   └── MainWindow.tsx
│   ├── chart/                    # Chart popout
│   │   └── ChartWindow.tsx
│   ├── positions/                # Positions popout
│   │   └── PositionsWindow.tsx
│   ├── orders/                   # Orders popout
│   │   └── OrdersWindow.tsx
│   ├── strategy/                 # Strategy detail popout
│   │   └── StrategyWindow.tsx
│   └── monitor/                  # System monitor popout
│       └── MonitorWindow.tsx
│
├── modes/                         # Operating modes
│   ├── research/                 # Research mode
│   │   ├── ResearchDashboard.tsx
│   │   ├── DiscoveryPanel.tsx
│   │   ├── BacktestPanel.tsx
│   │   └── StrategyDeveloper.tsx
│   └── trading/                  # Trading mode
│       ├── TradingDashboard.tsx
│       ├── PositionManager.tsx
│       ├── OrderEntry.tsx
│       └── RiskMonitor.tsx
│
├── features/                      # Feature modules
│   ├── strategies/               # Strategy library
│   │   ├── StrategyLibrary.tsx
│   │   ├── StrategyCard.tsx
│   │   ├── StrategyDetail.tsx
│   │   └── StrategyBuilder.tsx
│   ├── regime/                   # Regime detection
│   │   ├── RegimeIndicator.tsx
│   │   ├── RegimeHistory.tsx
│   │   └── RegimeHeatmap.tsx
│   ├── forces/                   # Force vectors
│   │   ├── ForcePanel.tsx
│   │   └── ForceChart.tsx
│   ├── swarm/                    # Swarm monitoring
│   │   ├── SwarmPanel.tsx
│   │   └── AgentGrid.tsx
│   ├── pnl/                      # P&L tracking
│   │   ├── PnLHeatmap.tsx
│   │   ├── PnLChart.tsx
│   │   └── PnLSummary.tsx
│   ├── pipeline/                 # Pipeline viz
│   │   ├── PipelineFlow.tsx
│   │   └── StageDetail.tsx
│   └── results/                  # Results viewer
│       ├── BacktestResults.tsx
│       ├── DiscoveryResults.tsx
│       └── ResultsGrid.tsx
│
├── shared/                        # Shared components
│   ├── layout/                   # Layout components
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── StatusBar.tsx
│   ├── charts/                   # Chart components
│   │   ├── CandlestickChart.tsx
│   │   ├── LineChart.tsx
│   │   ├── Heatmap.tsx
│   │   └── PayoffDiagram.tsx
│   ├── tables/                   # Table components
│   │   ├── DataTable.tsx
│   │   ├── PositionsTable.tsx
│   │   └── OrdersTable.tsx
│   └── ui/                       # UI primitives (shadcn)
│
├── services/                      # Service layer
│   ├── broker/                   # Broker integrations
│   │   ├── BrokerService.ts
│   │   ├── SchwabBroker.ts
│   │   └── types.ts
│   ├── data/                     # Data services
│   │   ├── ThetaDataService.ts
│   │   ├── MarketDataService.ts
│   │   └── HistoricalDataService.ts
│   ├── jarvis/                   # JARVIS integration
│   │   ├── JarvisService.ts
│   │   └── EventRouter.ts
│   └── storage/                  # Local storage
│       ├── SettingsStore.ts
│       └── LayoutStore.ts
│
├── hooks/                         # React hooks
│   ├── useJarvisEvents.ts
│   ├── useBroker.ts
│   ├── usePositions.ts
│   ├── useOrders.ts
│   ├── useStrategies.ts
│   └── useWindowManager.ts
│
├── types/                         # TypeScript types
│   ├── broker.ts
│   ├── strategy.ts
│   ├── position.ts
│   ├── order.ts
│   ├── market.ts
│   └── jarvis.ts
│
└── config/                        # Configuration
    ├── constants.ts
    ├── routes.ts
    └── windows.ts
```

### 2.2 Multi-Window Architecture

```typescript
// src/electron/windows/WindowManager.ts

interface WindowConfig {
  id: string;
  type: 'main' | 'chart' | 'positions' | 'orders' | 'strategy' | 'monitor';
  title: string;
  bounds?: { x: number; y: number; width: number; height: number };
  monitor?: number;  // Which display (0-3)
  route: string;
  persistent?: boolean;  // Survive restarts
}

class WindowManager {
  private windows: Map<string, BrowserWindow>;
  private layouts: Map<string, WindowConfig[]>;  // Saved layouts

  // Create window on specific monitor
  createWindow(config: WindowConfig): BrowserWindow;

  // Save current layout
  saveLayout(name: string): void;

  // Restore saved layout
  restoreLayout(name: string): void;

  // Broadcast to all windows
  broadcast(channel: string, data: any): void;

  // Get window by ID
  getWindow(id: string): BrowserWindow | undefined;

  // Close all popouts
  closeAll(): void;
}
```

**Window Types:**

| Window | Purpose | Default Monitor | Size |
|--------|---------|-----------------|------|
| Main | Primary dashboard | 1 (center) | Full |
| Chart | Price/Greeks charts | 2 (left) | Full |
| Positions | Live positions | 2 (left) | Half |
| Orders | Order entry/history | 3 (right) | Half |
| Strategy | Strategy detail | 3 (right) | Half |
| Monitor | System health | 4 (top) | Full |

**Saved Layouts:**
- `research-mode`: Main + Results + Backtest
- `trading-mode`: Main + Positions + Orders + Charts
- `discovery-mode`: Main + Swarm + Pipeline
- `four-monitor`: All windows distributed

---

## PHASE 3: STRATEGY LIBRARY (Day 4)

### 3.1 Strategy Data Model

```typescript
// src/types/strategy.ts

interface Strategy {
  id: string;
  name: string;
  description: string;
  category: 'gamma' | 'theta' | 'vega' | 'momentum' | 'mean-reversion' | 'custom';

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
  status: 'research' | 'paper' | 'live' | 'retired';

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  author: string;
  notes: string;
}

interface StrategyLeg {
  type: 'call' | 'put' | 'stock' | 'future';
  side: 'long' | 'short';
  strike?: number;  // Absolute or delta
  strikeType: 'absolute' | 'delta' | 'atm-offset';
  expiry: string;   // DTE range or specific
  quantity: number;
}

interface StrategyMetrics {
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

interface RiskConfig {
  maxPositionSize: number;      // % of portfolio
  maxLoss: number;              // Per trade
  dailyLossLimit: number;       // % of portfolio
  maxOpenPositions: number;
  liquidityMinimum: number;     // Min volume/OI
}
```

### 3.2 Strategy Library UI

```
┌─────────────────────────────────────────────────────────────┐
│ Strategy Library                            [+ New Strategy]│
├─────────────────────────────────────────────────────────────┤
│ Categories: [All] [Gamma] [Theta] [Vega] [Custom]           │
│ Status: [All] [Research] [Paper] [Live]                     │
│ Search: [________________________]                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ GEX Flip     │ │ Gamma Scalp  │ │ Vol Harvest  │        │
│  │ ────────────│ │ ────────────│ │ ────────────│        │
│  │ Sharpe: 2.1  │ │ Sharpe: 1.8  │ │ Sharpe: 1.5  │        │
│  │ Win: 68%     │ │ Win: 72%     │ │ Win: 65%     │        │
│  │ DD: -12%     │ │ DD: -8%      │ │ DD: -15%     │        │
│  │ ────────────│ │ ────────────│ │ ────────────│        │
│  │ [Research]   │ │ [Paper]      │ │ [Live]       │        │
│  │ [View] [Run] │ │ [View] [Run] │ │ [View] [Run] │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Iron Condor  │ │ Straddle Buy │ │ Put Spread   │        │
│  │ ...          │ │ ...          │ │ ...          │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Strategy Detail View

```
┌─────────────────────────────────────────────────────────────┐
│ GEX Flip Strategy                           [Edit] [Popout] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ DESCRIPTION                                                 │
│ Trades GEX zero-crossing events. Long gamma when dealers    │
│ flip from short to long gamma. Captures momentum reversals. │
│                                                             │
│ STRUCTURE                    │ PERFORMANCE                  │
│ ┌─────────────────────────┐  │ Sharpe:      2.14           │
│ │ +1 ATM Call  (30 DTE)   │  │ Sortino:     2.87           │
│ │ +1 ATM Put   (30 DTE)   │  │ Max DD:      -11.8%         │
│ │ -1 25Δ Put   (30 DTE)   │  │ Win Rate:    68.2%          │
│ └─────────────────────────┘  │ Profit Factor: 2.1          │
│                              │ Avg Duration:  4.2 days     │
│ PAYOFF DIAGRAM              │                              │
│ ┌─────────────────────────┐  │ EQUITY CURVE                │
│ │      ╱╲                 │  │ ┌─────────────────────────┐ │
│ │     ╱  ╲                │  │ │    ╱──────╱─────        │ │
│ │ ───╱────╲───            │  │ │  ╱╱      ╱              │ │
│ │   ╱      ╲              │  │ │╱╱                       │ │
│ └─────────────────────────┘  │ └─────────────────────────┘ │
│                                                             │
│ OPTIMAL REGIMES              │ AVOID REGIMES               │
│ [High Vol] [Trending]        │ [Low Vol] [Ranging]         │
│                                                             │
│ RISK PARAMETERS                                             │
│ Max Position: 5% │ Max Loss: 2% │ Daily Limit: 3%          │
│                                                             │
│ [Run Backtest] [Paper Trade] [Go Live] [Clone] [Export]    │
└─────────────────────────────────────────────────────────────┘
```

---

## PHASE 4: BROKER INTEGRATIONS (Days 5-7)

### 4.1 Schwab API Integration

```typescript
// src/services/broker/SchwabBroker.ts

class SchwabBroker implements BrokerInterface {
  private client: SchwabClient;
  private accountId: string;

  // Authentication
  async authenticate(clientId: string, clientSecret: string, refreshToken: string): Promise<void>;
  async refreshAuth(): Promise<void>;

  // Account
  async getAccount(): Promise<Account>;
  async getPositions(): Promise<Position[]>;
  async getBuyingPower(): Promise<BuyingPower>;

  // Orders
  async placeOrder(order: OrderRequest): Promise<OrderResult>;
  async cancelOrder(orderId: string): Promise<void>;
  async getOrders(status?: OrderStatus): Promise<Order[]>;
  async getOrderHistory(startDate: Date, endDate: Date): Promise<Order[]>;

  // Market Data (via Schwab)
  async getQuote(symbol: string): Promise<Quote>;
  async getOptionChain(underlying: string, expiry?: string): Promise<OptionChain>;

  // Streaming (WebSocket)
  subscribeQuotes(symbols: string[], callback: QuoteCallback): Subscription;
  subscribeOrders(callback: OrderCallback): Subscription;
  subscribePositions(callback: PositionCallback): Subscription;
}

// Order types
interface OrderRequest {
  symbol: string;
  quantity: number;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop' | 'stop-limit';
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';

  // Options-specific
  optionSymbol?: string;  // OCC format
  positionEffect?: 'open' | 'close';

  // Multi-leg
  legs?: OrderLeg[];
  orderStrategy?: 'single' | 'spread' | 'strangle' | 'straddle' | 'collar';
}
```

### 4.2 ThetaData Integration (Live Greeks)

```typescript
// src/services/data/ThetaDataService.ts

class ThetaDataService {
  private client: ThetaClient;

  // Real-time Greeks
  async getGreeks(symbol: string, expiry: string, strike: number, right: 'C' | 'P'): Promise<Greeks>;

  // Option chain with Greeks
  async getOptionChainWithGreeks(underlying: string, expiry?: string): Promise<OptionChainGreeks>;

  // Streaming
  subscribeGreeks(contracts: string[], callback: GreeksCallback): Subscription;

  // Historical
  async getHistoricalGreeks(contract: string, startDate: Date, endDate: Date): Promise<HistoricalGreeks[]>;

  // IV Surface
  async getIVSurface(underlying: string): Promise<IVSurface>;
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;

  // Second-order
  charm: number;
  vanna: number;
  vomma: number;

  iv: number;
  theoreticalPrice: number;
  timestamp: Date;
}
```

### 4.3 Futures Data (via Schwab or CME)

```typescript
// src/services/data/FuturesService.ts

class FuturesService {
  // Schwab supports ES, NQ, RTY, etc.
  async getQuote(symbol: string): Promise<FuturesQuote>;

  // Contract specs
  getContractSpec(symbol: string): ContractSpec;

  // Roll calendar
  getRollDates(symbol: string): RollCalendar;

  // Continuous contract
  async getContinuousContract(root: string): Promise<ContinuousContract>;
}

// Contract multipliers
const FUTURES_SPECS = {
  'ES': { multiplier: 50, tickSize: 0.25, tickValue: 12.50 },
  'NQ': { multiplier: 20, tickSize: 0.25, tickValue: 5.00 },
  'RTY': { multiplier: 50, tickSize: 0.10, tickValue: 5.00 },
  'CL': { multiplier: 1000, tickSize: 0.01, tickValue: 10.00 },
  'GC': { multiplier: 100, tickSize: 0.10, tickValue: 10.00 },
};
```

### 4.4 Crypto Stub (Future)

```typescript
// src/services/broker/CryptoBroker.ts

// STUBBED - To be implemented
class CryptoBroker implements BrokerInterface {
  constructor() {
    throw new Error('Crypto broker not yet implemented. Exchanges to support: Coinbase, Binance, Kraken');
  }

  // TODO: Implement when ready
  // - CCXT library for unified exchange access
  // - WebSocket for real-time data
  // - Order types vary by exchange
}
```

---

## PHASE 5: MODE SWITCHING (Day 8)

### 5.1 Research Mode

```
┌─────────────────────────────────────────────────────────────┐
│ RESEARCH MODE                    [Switch to Trading] [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │ DISCOVERY PIPELINE          │ │ REGIME STATUS           │ │
│ │ ┌─────┐ ┌─────┐ ┌─────┐    │ │                         │ │
│ │ │Data │→│Scout│→│Math │→   │ │ Current: TRENDING_UP    │ │
│ │ │ ✓   │ │ ●   │ │     │    │ │ Confidence: 82%         │ │
│ │ └─────┘ └─────┘ └─────┘    │ │ Duration: 4 days        │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │ SWARM ACTIVITY              │ │ FORCE VECTORS           │ │
│ │                             │ │ γ Gamma:     +0.73      │ │
│ │ Scout: 85/100 complete      │ │ Φ Flow:      +0.42      │ │
│ │ Math:  12/100 running       │ │ Δ MM Inv:    -0.28      │ │
│ │ Jury:  0/100 pending        │ │ S Entropy:   +0.55      │ │
│ │                             │ │ ───────────────────     │ │
│ │                             │ │ NET: +1.42 BULLISH      │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
│                                                             │
│ ┌───────────────────────────────────────────────────────────┐
│ │ BACKTEST RESULTS                              [Popout ↗] │
│ │                                                           │
│ │ Strategy: GEX Flip | Period: 2020-2024 | Capital: $100k  │
│ │                                                           │
│ │ Sharpe: 2.14 | Max DD: -11.8% | Win: 68% | Trades: 247   │
│ │                                                           │
│ │ [Equity Curve Chart]                                      │
│ │                                                           │
│ └───────────────────────────────────────────────────────────┘
│                                                             │
│ ┌───────────────────────────────────────────────────────────┐
│ │ STRATEGY LIBRARY                             [View All ↗] │
│ │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │ │GEX Flip│ │Gamma   │ │Vol     │ │Iron    │ │Custom  │   │
│ │ │ 2.1 ⬆  │ │Scalp   │ │Harvest │ │Condor  │ │Builder │   │
│ │ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘   │
│ └───────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Trading Mode

```
┌─────────────────────────────────────────────────────────────┐
│ TRADING MODE                     [Switch to Research] [⚙️]  │
│ Account: $125,430.50 | Day P&L: +$1,842 | Buying Power: $45k│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │ POSITIONS                   │ │ MARKET STATUS           │ │
│ │                             │ │                         │ │
│ │ SPY 600C 12/20  +5  +$234   │ │ SPY: $598.42 (+0.8%)   │ │
│ │ SPY 595P 12/20  -3  -$89    │ │ VIX: 14.2 (-3.1%)      │ │
│ │ ES Mar25        +2  +$1,200 │ │ Regime: TRENDING_UP    │ │
│ │                             │ │                         │ │
│ │ Total P&L: +$1,345          │ │ GEX: +$2.1B (Positive) │ │
│ │ Delta: +42 | Gamma: +12     │ │ Flow: Bullish          │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │ ORDER ENTRY                 │ │ GREEKS MONITOR          │ │
│ │                             │ │                         │ │
│ │ Symbol: [SPY    ] [Options] │ │ Portfolio Greeks:       │ │
│ │ Action: [Buy ▼] [Call ▼]   │ │ Delta:  +42.3          │ │
│ │ Strike: [600   ] Exp: [12/20]│ │ Gamma:  +12.1          │ │
│ │ Qty: [5] Price: [Limit ▼]  │ │ Theta:  -$234/day      │ │
│ │ Limit: [$2.50]              │ │ Vega:   +$890          │ │
│ │                             │ │                         │ │
│ │ [Preview] [Place Order]     │ │ IV Rank: 32%           │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
│                                                             │
│ ┌───────────────────────────────────────────────────────────┐
│ │ ACTIVE STRATEGIES                                         │
│ │                                                           │
│ │ [●] GEX Flip      - Signal: WAITING    - Next: GEX > 0   │
│ │ [●] Gamma Scalp   - Signal: ACTIVE     - Delta hedge @ 2% │
│ │ [○] Vol Harvest   - Signal: PAUSED     - VIX < 15        │
│ │                                                           │
│ │ [+ Add Strategy] [Manage Strategies]                      │
│ └───────────────────────────────────────────────────────────┘
│                                                             │
│ ┌───────────────────────────────────────────────────────────┐
│ │ ORDER HISTORY / FILLS                                     │
│ │                                                           │
│ │ 10:42:31  BUY  5x SPY 600C 12/20  @ $2.48  FILLED        │
│ │ 10:41:15  SELL 3x SPY 595P 12/20  @ $1.23  FILLED        │
│ │ 09:35:00  BUY  2x ES Mar25        @ 5982   FILLED        │
│ └───────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## PHASE 6: MULTI-MONITOR LAYOUTS (Day 9)

### 6.1 Four-Monitor Setup

```
┌─────────────────────────────────────────────────────────────┐
│                        MONITOR 4 (TOP)                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ SYSTEM MONITOR                                         │  │
│  │ CPU: 45% | RAM: 8.2GB | Broker: Connected | Data: Live │  │
│  │ Swarm: 85/100 | Pipeline: Stage 3/7 | Alerts: 2       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
│    MONITOR 2 (LEFT)    │ │ MONITOR 1 (CENTER)│ │   MONITOR 3 (RIGHT)   │
│ ┌───────────────────┐ │ │ ┌───────────────┐ │ │ ┌───────────────────┐ │
│ │ CHART WINDOW      │ │ │ │ MAIN DASHBOARD│ │ │ │ POSITIONS         │ │
│ │                   │ │ │ │               │ │ │ │                   │ │
│ │ [SPY 1D Chart]    │ │ │ │ [Dashboard]   │ │ │ │ [Live Positions]  │ │
│ │                   │ │ │ │               │ │ │ │                   │ │
│ │ [IV Surface]      │ │ │ │ [Strategies]  │ │ │ ├───────────────────┤ │
│ │                   │ │ │ │               │ │ │ │ ORDERS            │ │
│ │ [Greeks Chart]    │ │ │ │ [Results]     │ │ │ │                   │ │
│ │                   │ │ │ │               │ │ │ │ [Order Entry]     │ │
│ └───────────────────┘ │ │ └───────────────┘ │ │ │ [Order History]   │ │
└───────────────────────┘ └───────────────────┘ │ └───────────────────┘ │
                                                 └───────────────────────┘
```

### 6.2 Layout Presets

| Layout Name | Windows | Use Case |
|-------------|---------|----------|
| `research` | Main + Results | Strategy development |
| `discovery` | Main + Swarm + Pipeline | Running discoveries |
| `trading-basic` | Main + Positions | Simple trading |
| `trading-full` | Main + Positions + Orders + Charts | Active trading |
| `four-monitor` | All windows distributed | Full setup |

### 6.3 Window Management UI

```typescript
// Keyboard shortcuts
Cmd+1: Focus Main window
Cmd+2: Focus/Open Chart window
Cmd+3: Focus/Open Positions window
Cmd+4: Focus/Open Orders window
Cmd+Shift+L: Open layout picker
Cmd+Shift+S: Save current layout
Cmd+Shift+R: Restore default layout

// Context menu on any panel
[Popout to New Window]
[Move to Monitor 2]
[Tile Left]
[Tile Right]
```

---

## PHASE 7: PYTHON BACKEND ADDITIONS (Days 10-12)

### 7.1 New Python Modules

```
python/engine/
├── brokers/                       # NEW: Broker integrations
│   ├── __init__.py
│   ├── broker_interface.py       # Abstract base class
│   ├── schwab_broker.py          # Schwab API client
│   ├── order_manager.py          # Order lifecycle
│   └── position_tracker.py       # Real-time positions
│
├── live/                          # NEW: Live trading
│   ├── __init__.py
│   ├── execution_engine.py       # Order execution
│   ├── risk_monitor.py           # Real-time risk
│   ├── signal_router.py          # Strategy signals → orders
│   └── heartbeat.py              # Connection monitoring
│
└── api/
    └── routes.py                  # Add new endpoints
```

### 7.2 New API Endpoints

```
# Broker endpoints
GET  /api/broker/status           # Connection status
POST /api/broker/connect          # Connect to broker
POST /api/broker/disconnect       # Disconnect

# Account endpoints
GET  /api/account                 # Account summary
GET  /api/account/positions       # All positions
GET  /api/account/buying-power    # Available capital

# Order endpoints
POST /api/orders                  # Place order
GET  /api/orders                  # List orders
GET  /api/orders/:id              # Order details
DELETE /api/orders/:id            # Cancel order

# Strategy execution
POST /api/strategies/:id/activate    # Activate strategy
POST /api/strategies/:id/deactivate  # Deactivate
GET  /api/strategies/:id/signals     # Current signals

# Market data
GET  /api/market/quote/:symbol    # Real-time quote
GET  /api/market/chain/:symbol    # Option chain
GET  /api/market/greeks/:contract # Live Greeks
```

---

## PHASE 8: TESTING & POLISH (Days 13-14)

### 8.1 Testing Checklist

- [ ] Multi-window creation/destruction
- [ ] Layout save/restore
- [ ] Window positioning across monitors
- [ ] Broker connection flow
- [ ] Order placement (paper trading)
- [ ] Real-time position updates
- [ ] Strategy library CRUD
- [ ] Backtest execution
- [ ] Mode switching
- [ ] Keyboard shortcuts
- [ ] Error handling
- [ ] Reconnection logic

### 8.2 Polish Items

- [ ] Loading states for all async operations
- [ ] Error toasts with actionable messages
- [ ] Keyboard navigation
- [ ] Dark/light mode consistency
- [ ] Window titles reflect content
- [ ] Status bar with connection indicators
- [ ] Responsive layouts (single monitor fallback)

---

## IMPLEMENTATION ORDER

| Day | Phase | Deliverable |
|-----|-------|-------------|
| 1 | Cleanup | Delete 80 unused files |
| 2-3 | Architecture | New directory structure, window manager |
| 4 | Strategy Library | Data model, UI components |
| 5-6 | Schwab Integration | Authentication, orders, positions |
| 7 | ThetaData Integration | Live Greeks, streaming |
| 8 | Mode Switching | Research/Trading modes |
| 9 | Multi-Monitor | Layout presets, window management |
| 10-11 | Python Backend | Broker modules, new endpoints |
| 12 | Integration | Connect frontend ↔ backend |
| 13-14 | Testing & Polish | QA, error handling, UX polish |

---

## RISK MITIGATION

### Known Risks

1. **Schwab API complexity** - Their API is new (post-TD merger), documentation may be incomplete
   - Mitigation: Paper trading first, conservative error handling

2. **Multi-window state sync** - Keeping windows in sync is hard
   - Mitigation: Single source of truth in main process, broadcast updates

3. **Live trading risk** - Real money at stake
   - Mitigation: Paper trading mode, confirmation dialogs, circuit breakers

4. **Scope creep** - This is a big refactor
   - Mitigation: Phase-by-phase delivery, MVP for each phase

---

## SUCCESS CRITERIA

1. **Clean Architecture**: <50 total component files (from 130+)
2. **Multi-Window**: 4-monitor layout works seamlessly
3. **Strategy Library**: Browse, view, backtest strategies
4. **Live Trading**: Place orders via Schwab, see fills
5. **Real-Time Data**: Live Greeks from ThetaData
6. **Mode Switching**: Instant switch between Research/Trading
7. **Performance**: <100ms window operations, <500ms data refresh

---

## APPENDIX: Schwab API Setup

### Prerequisites
1. Schwab developer account (developer.schwab.com)
2. Create app, get client ID + secret
3. OAuth flow for refresh token
4. Enable paper trading first

### Environment Variables
```
SCHWAB_CLIENT_ID=your_client_id
SCHWAB_CLIENT_SECRET=your_client_secret
SCHWAB_REFRESH_TOKEN=your_refresh_token
SCHWAB_ACCOUNT_ID=your_account_number
```

### OAuth Flow
1. User authorizes via Schwab login
2. Receive authorization code
3. Exchange for access + refresh tokens
4. Store refresh token securely
5. Auto-refresh access token (expires in 30 min)

---

**End of Plan**
