# Visual Research Dashboard Audit: Phases 1-3

## Executive Summary

**Status**: Infrastructure complete but **NOT FUNCTIONAL** - no UI changes visible to user.

**Root Cause**: Chief Quant is not aware of display directives and cannot emit them. The visualization system is fully wired but dormant because nothing triggers it.

---

## Critical Issues (Blocking Functionality)

### 1. **Chief Quant System Prompt Missing Display Directive Instructions** 🚨
**Severity**: CRITICAL - System cannot function without this  
**Location**: `src/prompts/chiefQuantPrompt.ts`

**Problem**: Chief Quant's system prompt does not include ANY instructions about display directives. The AI doesn't know it can control the UI by emitting directives like `[STAGE: regime_mapping]` or `[DISPLAY: regime_timeline]`.

**Impact**: Even though all infrastructure is built, Chief Quant will never emit directives, so visualizations will never appear.

**Fix Required**:
```typescript
// Add to buildChiefQuantPrompt() after existing prompt sections:

## Visual Research Dashboard Control

You can control the visual research dashboard by embedding display directives in your responses. These directives are parsed and stripped from the displayed text but trigger UI changes.

**Available Directives**:

1. **Stage Control**: Set the current research stage
   - `[STAGE: idle]` - No active research
   - `[STAGE: regime_mapping]` - Analyzing market regimes
   - `[STAGE: strategy_discovery]` - Discovering strategies
   - `[STAGE: backtesting]` - Running backtests
   - `[STAGE: tuning]` - Optimizing parameters
   - `[STAGE: analysis]` - Analyzing results
   - `[STAGE: portfolio]` - Building portfolio
   - `[STAGE: conclusion]` - Research complete

2. **Visualization Display**: Show specific visualizations
   - Regime Mapping: `[DISPLAY: regime_timeline]`, `[DISPLAY: regime_distribution]`, `[DISPLAY: data_coverage]`
   - Strategy Discovery: `[DISPLAY: discovery_matrix]`, `[DISPLAY: discovery_funnel]`
   - Backtesting: `[DISPLAY: performance_heatmap]`, `[DISPLAY: equity_curve_overlay]`
   - Portfolio: `[DISPLAY: symphony]`, `[DISPLAY: greeks_dashboard]`

3. **Progress Updates**: Show progress of long operations
   - `[PROGRESS: 25 message=\"Analyzing Q1 2020\"]`
   - Percent: 0-100, message: optional status text

4. **Focus Control**: Change where visualizations appear
   - `[FOCUS: center]` - Full-screen overlay (default for first visualization)
   - `[FOCUS: right]` - Right panel
   - `[FOCUS: modal]` - Modal dialog
   - `[FOCUS: hidden]` - Hide all visualizations

5. **Hide All**: Clear all active visualizations
   - `[HIDE]`

**When to Use Display Directives**:
- Set stage at the beginning of multi-step research operations
- Display relevant visualizations when discussing regime analysis, strategy discovery, or results
- Update progress during long-running operations (regime classification, swarm runs)
- Hide visualizations when analysis is complete or user asks to dismiss them

**Example Usage**:
```
[STAGE: regime_mapping]
[DISPLAY: regime_timeline]

I'm analyzing the market regimes from 2020-2024. The timeline above shows...

[PROGRESS: 50 message=\"Analyzing Q2 2021\"]
```

**Important**: Directives are stripped from displayed text automatically. Users see clean output without the directive syntax.
```

---

### 2. **No Testing/Demo Mechanism** 🚨
**Severity**: HIGH - Prevents validation and development

**Problem**: No way to manually trigger visualizations for testing without:
1. Updating Chief Quant prompt (Issue #1)
2. Sending a chat message
3. Waiting for LLM response with directives
4. Hoping the LLM emits correct directives

**Impact**: Cannot validate that visualizations work correctly. Developer/user cannot preview what the system will look like when active.

**Fix Options**:
A. Add debug slash command: `/debug_viz <visualization_name>` to manually trigger visualizations
B. Add "Research Stage Simulator" panel in Settings with buttons to trigger each stage/visualization
C. Create a demo mode that cycles through all visualizations automatically

**Recommended**: Option A (slash command) - fastest to implement, fits existing command pattern.

---

### 3. **Default Focus State Prevents Display** 🚨
**Severity**: HIGH - Visualizations won't show even if triggered

**Problem**: Initial `focusArea` state is `'hidden'` in `ResearchDisplayContext.tsx`. When Chief Quant adds visualizations via `showVisualization()`, the focus changes to `'center'` only if current focus is `'hidden'`. However, `VisualizationContainer` returns `null` when `focusArea === 'hidden'`.

**Location**: 
- `src/contexts/ResearchDisplayContext.tsx` line 44
- `src/components/visualizations/VisualizationContainer.tsx` line 29

**Impact**: First visualization won't display unless Chief Quant explicitly emits `[FOCUS: center]` directive (which it doesn't know about per Issue #1).

**Fix**: In `showVisualization()`, ensure focus is set to `'center'` if currently `'hidden'`:\
```typescript
const showVisualization = useCallback((viz: VisualizationType, _params?: Record<string, string>) => {
  setState(prev => ({
    ...prev,
    activeVisualizations: [...new Set([...prev.activeVisualizations, viz])],
    focusArea: prev.focusArea === 'hidden' ? 'center' : prev.focusArea, // ✅ Already correct!
  }));
}, []);
```

**Status**: Actually this IS correctly implemented. But still worth noting as potential failure point.

---

## Medium Issues (Functionality Incomplete)

### 4. **Mock Data Not Connected to Real Data**
**Severity**: MEDIUM - Visualizations work but show fake data

**Problem**: All visualizations use mock data generators in `VisualizationContainer.tsx`:
- `generateMockRegimeData()` - lines 171-192
- `generateMockDataCoverage()` - lines 194-233
- `generateMockStrategyData()` - lines 235-271

**Impact**: Visualizations will display but won't show actual user data from backtest runs, regime classifications, or strategy results.

**Fix Required**: Create edge functions or IPC handlers to fetch real data:
- Regime timeline: Query `regime_classifications` table (not yet created per VISUAL_RESEARCH_DASHBOARD_PLAN.md Phase 2)
- Data coverage: Query `local_data_index` table for symbol/date coverage
- Strategy matrix: Query `strategy_candidates` table (not yet created per plan)

**Note**: This is expected at this stage - mock data is appropriate until database schema is extended in later phases.

---

### 5. **No Database Schema for New Features**
**Severity**: MEDIUM - Required for Phases 6-7

**Problem**: Phase 1-3 visualizations reference data structures that don't exist in the database yet:
- `research_journeys` table (Phase 6)
- `journey_stage_history` table (Phase 6)
- `regime_classifications` table (Phase 2)
- `strategy_candidates` table (Phase 3)

**Impact**: Cannot connect visualizations to real data until schema is created.

**Fix Required**: Implement database migrations per VISUAL_RESEARCH_DASHBOARD_PLAN.md Phase 2-3 specifications.

---

### 6. **Visualization Parameters Not Passed Through**
**Severity**: LOW - Feature incomplete

**Problem**: Display directives can include parameters (e.g., `[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]`) but these are not passed to visualization components.

**Location**: `src/components/visualizations/VisualizationContainer.tsx` lines 114-132

**Current Code**:
```typescript
const VisualizationComponent = ({ type }: { type: VisualizationType }) => {
  if (type === 'regime_timeline') {
    const mockData = generateMockRegimeData();
    return <RegimeTimeline data={mockData} from=\"2020-01-01\" to=\"2024-12-31\" />; // ❌ Hardcoded dates
  }
  // ...
}
```

**Fix Required**: 
1. Pass `params` from `showVisualization()` call to `VisualizationComponent`
2. Store params in display context state alongside active visualizations
3. Use params to customize visualization rendering

---

## Low Issues (Polish & UX)

### 7. **No Visual Feedback When Directives Are Parsed**
**Severity**: LOW - Developer UX issue

**Problem**: When directives are parsed in `ChatArea.tsx` lines 534-565, there's no console logging or visual indication that directives were detected and processed.

**Impact**: During development/debugging, hard to know if directives are being parsed correctly.

**Fix**: Add debug logging:
```typescript
const directives = parseDisplayDirectives(response.content);
if (directives.length > 0) {
  console.log('[ChatArea] Parsed display directives:', directives);
  // ... existing processing
}
```

---

### 8. **No Error Handling for Invalid Visualizations**
**Severity**: LOW - Robustness issue

**Problem**: If Chief Quant requests a visualization type that doesn't exist or isn't implemented yet, it fails silently or shows "Coming soon in Phase X" placeholder.

**Impact**: Users/developers won't know if a directive failed vs. was ignored.

**Fix**: Add error logging and toast notification when unknown visualization is requested.

---

## Action Items (Priority Order)

### Immediate (Required for ANY functionality):
1. ✅ **Update Chief Quant prompt** with display directive instructions (Issue #1)
2. ✅ **Add debug slash command** `/debug_viz <viz_name>` for manual testing (Issue #2)
3. ✅ **Add console logging** for directive parsing (Issue #7)

### Short-term (Required for real data):
4. **Create database migrations** for regime_classifications, strategy_candidates tables (Issue #5)
5. **Replace mock data** with real data queries (Issue #4)
6. **Wire visualization parameters** through to components (Issue #6)

### Future (Polish):
7. Add error handling for invalid visualizations (Issue #8)
8. Create Settings panel for visualization testing/simulation (Issue #2 Option B)

---

## Testing Checklist

After fixes are applied, verify:

- [ ] Chief Quant can emit `[STAGE: regime_mapping]` and stage updates
- [ ] Chief Quant can emit `[DISPLAY: regime_timeline]` and visualization appears
- [ ] `/debug_viz regime_timeline` command manually triggers visualization
- [ ] ESC key dismisses visualizations (already working per Phase 1 audit)
- [ ] Close button dismisses visualizations (already working per Phase 1 audit)
- [ ] Multiple visualizations can be displayed simultaneously
- [ ] `[HIDE]` directive clears all visualizations
- [ ] Progress updates appear during long operations
- [ ] Focus can be changed between center/right/modal

---

## Conclusion

**The infrastructure is solid and correctly implemented**, but the system is dormant because Chief Quant doesn't know it exists. Once the system prompt is updated (#1) and a debug command is added (#2), the visualizations will become functional and testable.

**Estimated Time to Fix Critical Issues**: 30-45 minutes
**Estimated Time for Full Real Data Integration**: 4-6 hours (database migrations + data queries)
