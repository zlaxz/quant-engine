# Inline Backtest Result Cards

**Status:** Implemented
**Date:** 2025-11-24

## Overview

Backtest results now appear as rich, interactive cards inline with chat messages instead of being hidden in a sidebar. This creates a more natural conversation flow and makes results immediately visible without requiring manual tab switching.

## Implementation

### 1. RunResultCard Component

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/RunResultCard.tsx`

A self-contained React component that displays:
- Strategy name and run ID
- Date range, regime, and profile
- Key metrics (Sharpe, CAGR, Max Drawdown, Win Rate)
- Expandable detailed metrics (Total Trades, Profit Factor)
- Color-coded status indicators (success/warning/error)
- Warning alerts (e.g., Sharpe > 3 overfitting detection)
- Action buttons (Audit, Compare, Iterate)

**Features:**
- Expandable/collapsible detail view
- Color-coded metrics (green/yellow/red based on thresholds)
- Visual indicators (trending up/down icons)
- Direct integration with slash commands

### 2. Chat Message Types

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/types/chat.ts`

New types for special inline messages:
- `BacktestResultMessage` - Structure for backtest result data
- `isBacktestResult()` - Helper function to detect backtest messages

**Format:**
```typescript
{
  type: 'backtest_result',
  runId: string,
  strategyName: string,
  dateRange: string,
  metrics: {
    sharpe?: number,
    cagr?: number,
    maxDrawdown?: number,
    winRate?: number,
    totalTrades?: number,
    profitFactor?: number
  },
  regime?: string,
  profile?: string,
  status: 'success' | 'warning' | 'error'
}
```

### 3. ChatArea Integration

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/ChatArea.tsx`

Modified message rendering to:
1. Check each message for backtest result format
2. Render `RunResultCard` for backtest results
3. Fall back to regular message rendering for normal messages

## Usage

### For LLM/Assistant

When returning backtest results, format the message content as JSON:

```json
{
  "type": "backtest_result",
  "runId": "abc123-def456-789",
  "strategyName": "SPY Momentum",
  "dateRange": "2020-01-01 to 2023-12-31",
  "metrics": {
    "sharpe": 1.85,
    "cagr": 0.18,
    "maxDrawdown": -0.095,
    "winRate": 0.62,
    "totalTrades": 145,
    "profitFactor": 1.8
  },
  "regime": "bull",
  "profile": "conservative",
  "status": "success"
}
```

The chat will automatically detect this format and render the rich card instead of plain text.

### For Slash Commands

The `/backtest` command automatically returns results in the inline card format:

1. User: `/backtest spy_momentum 2020-01-01 2023-12-31`
2. Command executes backtest via edge function
3. Command polls for completion
4. On success, returns JSON formatted message
5. ChatArea detects format and renders RunResultCard inline

**Implementation:** The `handleBacktest` function in `/Users/zstoc/GitHub/quant-chat-scaffold/src/lib/slashCommands.ts` automatically formats successful backtest results as inline card JSON.

### Card Actions

The card provides three action buttons:

1. **Audit** - Populates input with `/audit_run <runId>`
2. **Compare** - Shows toast (feature coming soon)
3. **Iterate** - Populates input with `/iterate `

## Design Decisions

### Why Inline Cards?

1. **Context Preservation** - Results appear in conversation flow
2. **Reduced Cognitive Load** - No tab switching required
3. **Historical Record** - All results visible in message history
4. **Natural Workflow** - See results immediately after request

### Status Color Coding

- **Success (Green)** - Backtest completed, metrics look reasonable
- **Warning (Yellow)** - Completed but suspicious (e.g., Sharpe > 3)
- **Error (Red)** - Backtest failed or had errors

### Metric Thresholds

- **Sharpe Ratio**
  - >= 2.0: Green (excellent)
  - >= 1.0: Yellow (good)
  - < 1.0: Red (poor)
- **Max Drawdown**
  - > 20%: Red highlight (concerning)
- **Sharpe > 3.0**: Warning banner (overfitting risk)

## Future Enhancements

1. **Equity Curve Chart** - Mini chart in expanded view
2. **Compare Feature** - Side-by-side run comparison
3. **Trade List** - Expandable trade-by-trade breakdown
4. **Export Actions** - Save results to CSV/PDF
5. **Tagging** - Add labels directly from card
6. **Quick Notes** - Add annotations to runs

## Testing

To test the implementation:

1. Start the application
2. Create a test message in database with backtest result JSON
3. Verify card renders correctly
4. Test expand/collapse functionality
5. Test action buttons (Audit, Compare, Iterate)
6. Verify color coding and warnings

## Files Changed

- Created: `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/RunResultCard.tsx`
- Created: `/Users/zstoc/GitHub/quant-chat-scaffold/src/types/chat.ts`
- Modified: `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/ChatArea.tsx`
  - Added imports for RunResultCard and isBacktestResult
  - Updated message rendering to check for and render backtest cards
- Modified: `/Users/zstoc/GitHub/quant-chat-scaffold/src/lib/slashCommands.ts`
  - Updated handleBacktest to return JSON formatted card data instead of plain text
  - Added status determination logic based on Sharpe ratio
  - Integrated profitFactor metric if available

## Build Status

- TypeScript compilation: PASSED
- Vite build: PASSED
- No type errors or warnings
