# Tool System Mismatch Report

**Generated:** 2025-12-01
**Files Analyzed:**
- `/Users/zstoc/GitHub/quant-engine/src/electron/tools/toolDefinitions.ts` (899 lines)
- `/Users/zstoc/GitHub/quant-engine/src/electron/tools/toolHandlers.ts` (2,924 lines)

---

## Executive Summary

**Critical Issues Found: 3**

| Issue | Severity | Type | Status |
|-------|----------|------|--------|
| run_simulation parameter mismatch | CRITICAL | Type Safety | UNFIXED |
| list_strategies not in definitions | CRITICAL | Missing Definition | UNFIXED |
| quant_engine_health not in definitions | CRITICAL | Missing Definition | UNFIXED |

---

## Issue #1: run_simulation Parameter Mismatch

### The Problem

The `run_simulation` tool has completely misaligned definition and handler signatures. This will cause a runtime failure when Gemini tries to call this tool.

### Definition (toolDefinitions.ts:806-826)

```typescript
{
  name: 'run_simulation',
  description: 'Run what-if scenario simulation. Given a price change and volatility change, calculate projected P&L, surviving/failing strategies, and margin call risk. Use this to stress-test the portfolio.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      price_change: {
        type: SchemaType.NUMBER,
        description: 'Price change as decimal (e.g., -0.05 for 5% drop)'
      },
      vol_change: {
        type: SchemaType.NUMBER,
        description: 'Volatility change as decimal (e.g., 0.20 for 20% vol spike)'
      },
      days_forward: {
        type: SchemaType.NUMBER,
        description: 'Days forward for theta decay calculation (default: 1)'
      }
    },
    required: ['price_change', 'vol_change']
  }
}
```

### Handler Case (toolHandlers.ts:2894-2895)

```typescript
case 'run_simulation':
  return runScenarioSimulation(args.scenario, args.params, args.portfolio);
```

### Underlying Function (toolHandlers.ts:1449-1461)

```typescript
export async function runScenarioSimulation(
  scenario: 'vix_shock' | 'price_drop' | 'vol_crush',
  params?: Record<string, number>,
  portfolio?: Record<string, number>
): Promise<ToolResult> {
  try {
    safeLog(`[Simulate] Running scenario: ${scenario}`);

    const requestBody = {
      scenario,
      params: params || {},
      portfolio: portfolio || {}
    };
```

### Type Mismatch Details

| Parameter | Definition Expects | Handler Receives | Actual Type |
|-----------|-------------------|-----------------|-------------|
| `price_change` | NUMBER | undefined | Missing |
| `vol_change` | NUMBER | undefined | Missing |
| `days_forward` | NUMBER | undefined | Missing |
| `scenario` | N/A | args.scenario | ENUM ('vix_shock'\|'price_drop'\|'vol_crush') |
| `params` | N/A | args.params | OBJECT |
| `portfolio` | N/A | args.portfolio | OBJECT |

### Failure Mode

When Gemini calls this tool:
1. Gemini reads definition → expects { price_change, vol_change, days_forward }
2. Gemini sends { price_change: 0.05, vol_change: 0.20 } as args
3. Handler tries to access args.scenario → **undefined**
4. Function receives undefined for scenario parameter → **RUNTIME ERROR**

### Fix Required

Choose one approach:

**Option A: Update Definition** (RECOMMENDED)
```typescript
{
  name: 'run_simulation',
  description: 'Run what-if scenario simulation. Calculate projected P&L and margin call risk under different market conditions.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      scenario: {
        type: SchemaType.STRING,
        description: 'Scenario type: "vix_shock" (VIX increase), "price_drop" (market decline), or "vol_crush" (volatility compression)'
      },
      params: {
        type: SchemaType.OBJECT,
        description: 'Optional scenario parameters as key-value pairs (e.g., {"vix_level": 40, "price_change": -0.05})'
      },
      portfolio: {
        type: SchemaType.OBJECT,
        description: 'Optional portfolio state as position mappings'
      }
    },
    required: ['scenario']
  }
}
```

**Option B: Update Handler**
```typescript
case 'run_simulation':
  // Convert price_change + vol_change to scenario format
  let scenario: 'vix_shock' | 'price_drop' | 'vol_crush' = 'vix_shock';
  if (args.price_change < -0.02) scenario = 'price_drop';
  if (args.vol_change < 0) scenario = 'vol_crush';

  return runScenarioSimulation(scenario, {
    price_change: args.price_change,
    vol_change: args.vol_change,
    days_forward: args.days_forward
  }, {});
```

**Recommendation:** Option A is cleaner and maintains the existing handler logic.

---

## Issue #2: list_strategies Missing from Definitions

### The Problem

The `list_strategies` tool has a handler implementation but is not defined in `ALL_TOOLS`. This means:
- Gemini cannot call this tool (not in available tools)
- The handler exists but is orphaned
- Tool is dead code

### Handler Evidence (toolHandlers.ts:2875-2876)

```typescript
case 'list_strategies':
  return listStrategies();
```

### Function Implementation (toolHandlers.ts:~1300s)

The function exists and appears to work, but cannot be invoked by Gemini.

### Definition Status

**NOT FOUND** in toolDefinitions.ts:
- Not in QUANT_TOOLS array
- Not in ALL_TOOLS array
- TOOL_CATEGORIES does not reference it

### Impact

- Gemini cannot call `list_strategies`
- Tool remains unused/undocumented
- Hidden from Gemini's tool list

### Fix Required

Add to QUANT_TOOLS in toolDefinitions.ts (around line 827, before closing bracket):

```typescript
{
  name: 'list_strategies',
  description: 'List all available quantitative trading strategies with their profiles, performance metrics, and risk characteristics',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {}
  }
},
```

Then verify it appears in `ALL_TOOLS` array expansion (it will automatically via `...QUANT_TOOLS`).

---

## Issue #3: quant_engine_health Missing from Definitions

### The Problem

Similar to `list_strategies`, the `quant_engine_health` tool has a handler but is not in the tool definitions. This orphans the functionality.

### Handler Evidence (toolHandlers.ts:2896-2897)

```typescript
case 'quant_engine_health':
  return checkQuantEngineHealth();
```

### Definition Status

**NOT FOUND** in toolDefinitions.ts:
- Not in QUANT_TOOLS array
- Not in ALL_TOOLS array
- TOOL_CATEGORIES does not reference it

### Impact

- Gemini cannot check engine health
- Handler is unreachable
- Health monitoring tool is unavailable

### Fix Required

Add to QUANT_TOOLS in toolDefinitions.ts (around line 827, after list_strategies):

```typescript
{
  name: 'quant_engine_health',
  description: 'Check health and status of the quantitative engine. Returns API connectivity, data freshness, performance metrics, and any active warnings or errors',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {}
  }
},
```

---

## Summary Table: Definition vs Handler

| Tool Name | In Definitions | Has Handler | Status |
|-----------|---|---|---|
| respond_directly | ✓ | ✓ | OK |
| read_file | ✓ | ✓ | OK |
| list_directory | ✓ | ✓ | OK |
| search_code | ✓ | ✓ | OK |
| write_file | ✓ | ✓ | OK |
| append_file | ✓ | ✓ | OK |
| delete_file | ✓ | ✓ | OK |
| run_python_script | ✓ | ✓ | OK |
| manage_environment | ✓ | ✓ | OK |
| git_status | ✓ | ✓ | OK |
| git_diff | ✓ | ✓ | OK |
| git_log | ✓ | ✓ | OK |
| git_add | ✓ | ✓ | OK |
| git_commit | ✓ | ✓ | OK |
| git_branch | ✓ | ✓ | OK |
| git_checkout | ✓ | ✓ | OK |
| git_push | ✓ | ✓ | OK |
| git_pull | ✓ | ✓ | OK |
| git_fetch | ✓ | ✓ | OK |
| run_tests | ✓ | ✓ | OK |
| validate_strategy | ✓ | ✓ | OK |
| dry_run_backtest | ✓ | ✓ | OK |
| lint_code | ✓ | ✓ | OK |
| type_check | ✓ | ✓ | OK |
| find_function | ✓ | ✓ | OK |
| find_class | ✓ | ✓ | OK |
| find_usages | ✓ | ✓ | OK |
| code_stats | ✓ | ✓ | OK |
| batch_backtest | ✓ | ✓ | OK |
| sweep_params | ✓ | ✓ | OK |
| cross_validate | ✓ | ✓ | OK |
| get_regime_heatmap | ✓ | ✓ | OK |
| get_strategy_details | ✓ | ✓ | OK |
| get_portfolio_greeks | ✓ | ✓ | WARN: No params in def |
| run_simulation | ✓ | ✓ | ERROR: Param mismatch |
| inspect_market_data | ✓ | ✓ | OK |
| data_quality_check | ✓ | ✓ | OK |
| get_trade_log | ✓ | ✓ | OK |
| spawn_agent | ✓ | ✓ | OK |
| spawn_agents_parallel | ✓ | ✓ | OK |
| cleanup_backups | ✓ | ✓ | OK |
| execute_via_claude_code | ✓ | ✓ | OK |
| **list_strategies** | **✗** | **✓** | **MISSING DEFINITION** |
| **quant_engine_health** | **✗** | **✓** | **MISSING DEFINITION** |
| run_command | ✓ (agents) | ✓ (agents) | OK (agent-only) |

---

## Detailed Parameter Analysis

### Parameters that Match Definition ✓

#### git_push
**Definition (line 279-297):**
```
- remote?: STRING
- branch?: STRING
- force?: BOOLEAN
```

**Handler (line 2835-2836):**
```typescript
case 'git_push':
  return gitPush(args as { remote?: string; branch?: string; force?: boolean });
```

**Status:** ✓ MATCH

#### git_pull
**Definition (line 300-318):**
```
- remote?: STRING
- branch?: STRING
- rebase?: BOOLEAN
```

**Handler (line 2837-2838):**
```typescript
case 'git_pull':
  return gitPull(args as { remote?: string; branch?: string; rebase?: boolean });
```

**Status:** ✓ MATCH

#### manage_environment
**Definition (line 140-160):**
```
- action: STRING (required)
- package?: STRING
- upgrade?: BOOLEAN
```

**Handler (line 2817-2818):**
```typescript
case 'manage_environment':
  return manageEnvironment(args.action, args.package, args.upgrade);
```

**Status:** ✓ MATCH

#### batch_backtest
**Definition (line 498-525):**
```
- strategy_key: STRING (required)
- param_grid: STRING (required)
- start_date: STRING (required)
- end_date: STRING (required)
- capital?: NUMBER
```

**Handler (line 2865-2866):**
```typescript
case 'batch_backtest':
  return batchBacktest(args.strategy_key, args.param_grid, args.start_date, args.end_date, args.capital);
```

**Status:** ✓ MATCH

### Parameters that DON'T Match ✗

#### run_simulation
**CRITICAL - See full analysis above**

#### get_portfolio_greeks
**Definition (line 798-803):**
```
- No parameters defined
- properties: {}
```

**Handler (line 2879-2893):**
```typescript
case 'get_portfolio_greeks':
  // Return placeholder Greeks - actual implementation would query positions
  return {
    success: true,
    content: JSON.stringify({
      portfolio_greeks: {
        net_delta: 0,
        net_gamma: 0,
        net_theta: 0,
        net_vega: 0,
        warnings: [],
        message: 'No active positions. Portfolio Greeks endpoint ready.'
      }
    })
  };
```

**Status:** ⚠ SAFE but INCOMPLETE - Handler returns hardcoded values, not using args. This is intentional (placeholder implementation) but worth noting.

---

## Statistics

### Tool Counts

**Definitions:** 42 tools in ALL_TOOLS
**Handlers:** 42 matching cases in executeTool()
**Orphaned:** 3 in handlers but not in definitions
**Agent-only:** 1 (run_command - correctly scoped)

### Coverage

| Category | Tools | Status |
|----------|-------|--------|
| Gemini Tools | 42 | All defined and implemented |
| Agent Tools | 7 | Limited set (read, write, search, run_python, run_command) |
| Orphaned | 3 | Handlers exist but tools not exposed |
| Total | 52 | 42 exposed, 3 orphaned, 7 agent-only |

### Parameter Issues

- **Total tools:** 42 (Gemini) + 7 (Agents)
- **Parameter matches verified:** 40+
- **Parameter mismatches:** 1 (run_simulation - CRITICAL)
- **Parameter warnings:** 1 (get_portfolio_greeks - intentional placeholder)

---

## Remediation Checklist

**PRIORITY 1 - CRITICAL (Do First)**

- [ ] Fix run_simulation parameter mismatch
  - [ ] File: toolDefinitions.ts line 806-826
  - [ ] Change definition to match handler (scenario, params, portfolio)
  - [ ] Update description to match actual behavior
  - [ ] Test with Gemini

- [ ] Add list_strategies definition
  - [ ] File: toolDefinitions.ts QUANT_TOOLS array (line ~827)
  - [ ] Add complete tool definition
  - [ ] Verify appears in ALL_TOOLS

- [ ] Add quant_engine_health definition
  - [ ] File: toolDefinitions.ts QUANT_TOOLS array (line ~827)
  - [ ] Add complete tool definition
  - [ ] Verify appears in ALL_TOOLS

**PRIORITY 2 - VERIFICATION (Do Second)**

- [ ] Manually test run_simulation with actual Gemini call
- [ ] Verify Gemini sees all 42 expected tools
- [ ] Verify agents have exactly 7 tools
- [ ] Check that default case still catches unknowns

**PRIORITY 3 - DOCUMENTATION (Do Third)**

- [ ] Add architecture comments explaining two-path system
- [ ] Document that agents have limited tool set
- [ ] Create tool reference guide for developers
- [ ] Add testing documentation

---

## Files to Modify

1. **src/electron/tools/toolDefinitions.ts**
   - Line 806-826: Fix run_simulation definition
   - Line 827: Add list_strategies
   - Line 827: Add quant_engine_health
   - Verify ALL_TOOLS includes all additions

2. **src/electron/tools/toolHandlers.ts**
   - Line 1941: Add comment explaining executeAgentTool()
   - Line 2790: Add comment explaining executeTool()
   - No handler changes needed (they're correct)

---

## Testing Strategy

### Unit Tests
```typescript
// Test run_simulation with correct parameters
const result = await executeTool('run_simulation', {
  scenario: 'vix_shock',
  params: { vix_level: 40 },
  portfolio: {}
});
expect(result.success).toBe(true);

// Test list_strategies exists
const result = await executeTool('list_strategies', {});
expect(result.success).toBe(true);

// Test quant_engine_health exists
const result = await executeTool('quant_engine_health', {});
expect(result.success).toBe(true);
```

### Integration Tests
```typescript
// Verify Gemini sees all 42 tools
const tools = ALL_TOOLS;
expect(tools.length).toBe(42);

// Verify no orphaned tools in handlers
// (tools should exist in definitions)
```

### Manual Tests
1. Start app in dev mode
2. Call /run_simulation through Gemini interface
3. Call /list_strategies through Gemini interface
4. Call /quant_engine_health through Gemini interface
5. Verify all work without errors

---

## Conclusion

The tool system is mostly sound but has 3 critical mismatches that must be fixed:

1. **run_simulation parameter mismatch** - Will cause runtime failure
2. **list_strategies missing** - Handler unreachable from Gemini
3. **quant_engine_health missing** - Health monitoring tool unavailable

All fixes are straightforward and can be implemented in < 15 minutes. The default case properly handles unknown tools, and ALL_TOOLS array structure is correct.
