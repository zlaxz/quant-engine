# Active Experiment Bar

## Overview

The Active Experiment Bar is a persistent header component that displays the current experiment context in the Quant Chat Workbench. It provides users with visual feedback about which strategy or backtest run they're currently working on.

## Location

- **Component**: `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/ActiveExperimentBar.tsx`
- **Integration**: ChatArea component
- **State Management**: ChatContext

## Features

### Visual Indicators

1. **Experiment Name**: Human-readable name of the current experiment
2. **Strategy Badge**: Shows the strategy key (e.g., `momentum_breakout_v1`)
3. **Status Indicator**: Color-coded dot showing experiment status
   - Green: Active
   - Yellow: Paused
   - Blue: Completed
4. **Last Run Info**: Displays the most recent run ID and timestamp

### Quick Actions

Four action buttons provide rapid access to common workflows:

1. **Results**: View the latest backtest results
2. **Iterate**: Pre-fills `/iterate ` command to modify strategy
3. **New Run**: Pre-fills `/backtest ` command to run a new test
4. **Clear (X)**: Removes the active experiment bar

## Data Structure

```typescript
interface ActiveExperiment {
  id: string;           // Unique experiment/run identifier
  name: string;         // Display name (e.g., "Testing momentum strategy")
  strategy: string;     // Strategy key (e.g., "spy_momentum")
  lastRunId?: string;   // Most recent backtest run ID
  lastRunTime?: string; // Timestamp of last run
  status: 'active' | 'paused' | 'completed';
}
```

## Usage

### Setting Active Experiment

The bar automatically appears when a backtest completes:

```typescript
// In /backtest command handler
if (context.setActiveExperiment) {
  context.setActiveExperiment({
    id: runData.id,
    name: `Testing ${strategyKey.replace(/_/g, ' ')}`,
    strategy: strategyKey,
    lastRunId: runData.id,
    lastRunTime: new Date().toLocaleTimeString(),
    status: 'completed' as const,
  });
}
```

### Clearing Active Experiment

```typescript
// User clicks the X button
setActiveExperiment(null);
```

### Manual Setting (Advanced)

```typescript
import { useChatContext } from '@/contexts/ChatContext';

const { setActiveExperiment } = useChatContext();

setActiveExperiment({
  id: 'exp_123',
  name: 'Testing new strategy',
  strategy: 'custom_strategy_v1',
  status: 'active',
});
```

## Integration Points

### ChatContext

The active experiment state lives in ChatContext for global access:

```typescript
// src/contexts/ChatContext.tsx
const { activeExperiment, setActiveExperiment } = useChatContext();
```

### Slash Commands

Slash commands receive the `setActiveExperiment` callback via CommandContext:

```typescript
// In ChatArea when executing commands
const result = await executeCommand(messageContent, {
  sessionId: selectedSessionId,
  workspaceId: selectedWorkspaceId,
  setActiveExperiment, // Passed to command handlers
});
```

## Styling

The bar uses consistent styling with the rest of the application:

- Background: `bg-muted/50`
- Border: `border-b border-border`
- Text: Responsive sizing with `text-sm` and `text-xs`
- Icons: Lucide React icons (FlaskConical, BarChart3, Clock, etc.)

## Future Enhancements

Potential improvements for the active experiment bar:

1. **Persistence**: Store active experiment in session storage
2. **Results Preview**: Inline metrics display without navigating away
3. **Quick Compare**: Button to compare current run with previous runs
4. **Status Updates**: Real-time status changes during long-running backtests
5. **Multiple Experiments**: Support for tracking multiple concurrent experiments
6. **Notes**: Quick annotation capability for experiment context

## Related Files

- `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/ActiveExperimentBar.tsx` - Component
- `/Users/zstoc/GitHub/quant-chat-scaffold/src/contexts/ChatContext.tsx` - State management
- `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/chat/ChatArea.tsx` - Integration
- `/Users/zstoc/GitHub/quant-chat-scaffold/src/lib/slashCommands.ts` - Command integration

## Testing

To test the active experiment bar:

1. Start a backtest: `/backtest spy_momentum 2020-01-01 2024-12-31`
2. Wait for completion - bar should automatically appear
3. Click "Results" - should show toast notification
4. Click "Iterate" - should pre-fill `/iterate ` in input
5. Click "New Run" - should pre-fill `/backtest ` in input
6. Click X - bar should disappear

## Design Rationale

The active experiment bar solves a critical UX problem: context awareness. In a research workflow, users often:

1. Run multiple backtests
2. Iterate on parameters
3. Compare results
4. Get interrupted and lose context

By persistently displaying the current experiment context, users always know what they're working on and can quickly access related actions without searching through chat history or navigating to other tabs.
