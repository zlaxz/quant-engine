# Tool System Audit Report

**Date:** 2025-12-01
**Status:** 3 CRITICAL MISMATCHES FOUND

## Executive Summary

The tool system has **2 execution paths** with different tool sets:
1. **Gemini execution** (main LLM interface) - via `executeTool()` at line 2790
2. **Agent execution** (DeepSeek/Claude agents) - via `executeAgentTool()` at line 1941

### Key Issues:
- **3 tools** in main executeTool but NOT in tool definitions (orphaned)
- **1 critical parameter mismatch** for `run_simulation`
- Agent execution path uses different tools than Gemini path

---

## [CRITICAL] Issue #1: Parameter Type Mismatch - run_simulation

**Severity:** HIGH - Will cause runtime errors
**Location:** Line 2894-2895 in toolHandlers.ts vs Line 806-826 in toolDefinitions.ts

**Definition:**
```typescript
// toolDefinitions.ts line 806
{
  name: 'run_simulation',
  parameters: {
    properties: {
      price_change: { type: SchemaType.NUMBER },
      vol_change: { type: SchemaType.NUMBER },
      days_forward: { type: SchemaType.NUMBER }  // optional
    },
    required: ['price_change', 'vol_change']
  }
}
```

**Handler:**
```typescript
// toolHandlers.ts line 2894-2895
case 'run_simulation':
  return runScenarioSimulation(args.scenario, args.params, args.portfolio);
```

**Function Signature:**
```typescript
// toolHandlers.ts line 1449
export async function runScenarioSimulation(
  scenario: 'vix_shock' | 'price_drop' | 'vol_crush',
  params?: Record<string, number>,
  portfolio?: Record<string, number>
): Promise<ToolResult>
```

**Problem:**
- Gemini passes: `{ price_change: number, vol_change: number, days_forward?: number }`
- Handler expects: `{ scenario: enum, params: object, portfolio: object }`
- **Mismatch will cause undefined parameters at runtime**

---

## [CRITICAL] Issue #2: Tools in Handlers But NOT in Definitions

**Severity:** HIGH - These tools are callable but not documented to Gemini

Three tools have handler implementations but are missing from `ALL_TOOLS`:

### 1. list_strategies
**Location:** Handler at line 2875-2876
```typescript
case 'list_strategies':
  return listStrategies();
```
**Status:** NO DEFINITION - Not in ALL_TOOLS array
**Impact:** Not available to Gemini, but DeepSeek agents could call it via agent tools

### 2. quant_engine_health
**Location:** Handler at line 2896-2897
```typescript
case 'quant_engine_health':
  return checkQuantEngineHealth();
```
**Status:** NO DEFINITION - Not in ALL_TOOLS array
**Impact:** Not available to Gemini, orphaned handler

### 3. run_command
**Location:** Handler at line 1963-1965 (agent-specific)
```typescript
case 'run_command':
  result = await runCommand(args.command);
```
**Status:** DEFINED in agent tools (line 1914-1938) but NOT in Gemini tool definitions
**Impact:** Only available to DeepSeek agents, not to Gemini

---

## [INFO] Issue #3: Two Separate Tool Execution Paths

The system has TWO tool executors:

### Path 1: Gemini Direct Execution
**Function:** `executeTool(name, args)` at line 2790
**Handler Count:** 42 case statements
**Tools Included:**
- FILE_TOOLS (6): read_file, list_directory, search_code, write_file, append_file, delete_file
- PYTHON_TOOLS (2): run_python_script, manage_environment
- GIT_TOOLS (10): status, diff, log, add, commit, branch, checkout, push, pull, fetch
- VALIDATION_TOOLS (5): run_tests, validate_strategy, dry_run_backtest, lint_code, type_check
- ANALYSIS_TOOLS (4): find_function, find_class, find_usages, code_stats
- BACKTEST_TOOLS (3): batch_backtest, sweep_params, cross_validate
- DATA_TOOLS (3): inspect_market_data, data_quality_check, get_trade_log
- CLAUDE_TOOLS (1): execute_via_claude_code
- AGENT_TOOLS (2): spawn_agent, spawn_agents_parallel
- QUANT_TOOLS (4): get_regime_heatmap, get_strategy_details, get_portfolio_greeks, run_simulation
- MAINTENANCE_TOOLS (1): cleanup_backups
- RESPONSE_TOOLS (1): respond_directly

### Path 2: Agent Execution
**Function:** `executeAgentTool(toolName, args)` at line 1941
**Handler Count:** 7 case statements
**Tools Included:**
- read_file
- list_directory
- search_code
- write_file
- run_python_script
- run_command (AGENT-SPECIFIC, not in Gemini)

**Note:** Agent tools are defined at lines 1914-1938 (separate from main tool definitions)

---

## Tool Count Summary

| Category | Count | In ALL_TOOLS | Status |
|----------|-------|--------------|--------|
| RESPONSE_TOOLS | 1 | ✓ | respond_directly |
| CLAUDE_TOOLS | 1 | ✓ | execute_via_claude_code |
| QUANT_TOOLS | 4 | ✓ | All 4 defined (but run_simulation has param mismatch) |
| FILE_TOOLS | 6 | ✓ | All 6 defined |
| PYTHON_TOOLS | 2 | ✓ | All 2 defined |
| GIT_TOOLS | 10 | ✓ | All 10 defined |
| VALIDATION_TOOLS | 5 | ✓ | All 5 defined |
| ANALYSIS_TOOLS | 4 | ✓ | All 4 defined |
| BACKTEST_TOOLS | 3 | ✓ | All 3 defined |
| DATA_TOOLS | 3 | ✓ | All 3 defined |
| AGENT_TOOLS | 2 | ✓ | All 2 defined |
| MAINTENANCE_TOOLS | 1 | ✓ | All 1 defined |
| **Gemini Total** | **42** | ✓ | All in ALL_TOOLS |
| **Orphaned** | **3** | ✗ | list_strategies, quant_engine_health, (run_command in agents only) |

---

## Detailed Findings

### Default Case
✓ **Present and correct** at line 2921-2922:
```typescript
default:
  return { success: false, content: '', error: `Unknown tool: ${name}` };
```

### ALL_TOOLS Array Verification
✓ **Complete** - includes all 12 tool category arrays in correct order:
1. RESPONSE_TOOLS (highest priority - direct responses)
2. CLAUDE_TOOLS (multi-model execution bridge)
3. QUANT_TOOLS (high-level quantitative engine)
4. FILE_TOOLS
5. PYTHON_TOOLS
6. GIT_TOOLS
7. VALIDATION_TOOLS
8. ANALYSIS_TOOLS
9. BACKTEST_TOOLS
10. DATA_TOOLS
11. AGENT_TOOLS
12. MAINTENANCE_TOOLS

### Parameter Type Safety

**Verified Correct Cases:**
- ✓ git_push: parameters match (optional remote, branch, force)
- ✓ git_pull: parameters match (optional remote, branch, rebase)
- ✓ git_fetch: parameters match (optional remote, prune)
- ✓ manage_environment: parameters match (action, package, upgrade)
- ✓ spawn_agents_parallel: array structure matches
- ✓ batch_backtest: all numeric and string types align

**Problem Cases:**
- ✗ run_simulation: NUMBER types expected but ENUM + OBJECT received
- ⚠️ get_portfolio_greeks: Definition has no parameters, handler returns hardcoded placeholder

---

## Recommendations

### Priority 1: Fix run_simulation Parameter Mismatch
**Severity:** CRITICAL - Will fail when Gemini calls this tool

**Options:**
A. Update definition to match handler (scenario, params, portfolio)
B. Update handler to match definition (price_change, vol_change, days_forward)
C. Create adapter that converts between signatures

**Suggested fix:** Option A (definition update) since the handler logic is more specific.

**Updated definition:**
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
        description: 'Optional scenario parameters as key-value pairs (e.g., {"vix_level": 40})'
      },
      portfolio: {
        type: SchemaType.OBJECT,
        description: 'Optional portfolio state (e.g., {"position_id": "qty"})'
      }
    },
    required: ['scenario']
  }
}
```

### Priority 2: Add Missing Tool Definitions
**Severity:** HIGH - Handlers exist but tools not available to Gemini

Add to QUANT_TOOLS in toolDefinitions.ts (around line 827):

```typescript
{
  name: 'list_strategies',
  description: 'List all available quantitative trading strategies with their profiles and descriptions',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {}
  }
},
{
  name: 'quant_engine_health',
  description: 'Check health and status of the quantitative engine (API connectivity, data freshness, performance metrics)',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {}
  }
}
```

Then update ALL_TOOLS array to verify these are included.

### Priority 3: Document Agent Tool Separation
**Severity:** MEDIUM - Clarity improvement

Add comments explaining the two-path system at line 1940 and 2790:

```typescript
// ============================================================================
// Two-Path Tool Execution Architecture
// ============================================================================
//
// Path 1: Gemini Direct Execution (executeTool)
// - Used by Chief Quant for main LLM interactions
// - Includes all 42 tools (full quantitative engine integration)
// - Located: line 2790
//
// Path 2: Agent Execution (executeAgentTool)
// - Used by DeepSeek/Claude agents for autonomous work
// - Includes only 7 core tools (sandboxed for safety)
// - Located: line 1941
// - Run_command is AGENT-ONLY (not available to Gemini)
// ============================================================================
```

---

## Implementation Checklist

- [ ] **CRITICAL:** Fix run_simulation parameter mismatch
  - [ ] Update toolDefinitions.ts run_simulation to scenario/params/portfolio
  - [ ] Verify handler can accept new parameters
  - [ ] Test Gemini can call updated tool

- [ ] **CRITICAL:** Add missing tool definitions
  - [ ] Add list_strategies to QUANT_TOOLS
  - [ ] Add quant_engine_health to QUANT_TOOLS
  - [ ] Verify both are in ALL_TOOLS array

- [ ] **IMPORTANT:** Add documentation comments
  - [ ] Document two-path architecture at line 1940
  - [ ] Document two-path architecture at line 2790
  - [ ] Add warning about agent vs Gemini tool differences

- [ ] **VERIFICATION:** Test all tools
  - [ ] Test run_simulation with actual Gemini call
  - [ ] Test list_strategies is available to Gemini
  - [ ] Test quant_engine_health is available to Gemini
  - [ ] Test agents still have exactly 7 tools
  - [ ] Test run_command only works for agents

---

## Files Affected

1. **`/Users/zstoc/GitHub/quant-engine/src/electron/tools/toolDefinitions.ts`**
   - 42 tool definitions organized in 12 categories
   - ALL_TOOLS array that combines all categories
   - TOOL_CATEGORIES object for filtering
   - **Changes needed:** Fix run_simulation definition, add list_strategies, add quant_engine_health

2. **`/Users/zstoc/GitHub/quant-engine/src/electron/tools/toolHandlers.ts`**
   - executeTool function (line 2790) with 42 cases
   - executeAgentTool function (line 1941) with 7 cases
   - Handler implementations for all tools
   - **Changes needed:** Update run_simulation handler if needed, add documentation

---

## Audit Metadata

- **Auditor:** Agent 8 - Tool System Audit
- **Lines Analyzed:** 2924 (toolHandlers), 899 (toolDefinitions)
- **Tools Checked:** 45 unique cases (42 defined + 3 orphaned)
- **Execution Paths:** 2 (Gemini + Agent)
- **Critical Issues:** 2 (run_simulation mismatch, missing definitions)
- **Warnings:** 1 (parameter type mismatch)
