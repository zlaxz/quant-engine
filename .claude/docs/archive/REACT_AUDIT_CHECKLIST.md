# React Dashboard Audit - Fix Checklist

Use this checklist to track fixes as you implement them.

---

## CRITICAL ISSUES

### Issue #1: Dependency Arrays
- [ ] ActivityFeed.tsx - Line 197-212
- [ ] ShadowPositionMonitor.tsx - Line 81-185
- [ ] MorningBriefingViewer.tsx - Line 88-90
- [ ] RegimeIndicator.tsx - Line 154-158
- [ ] DataInventory.tsx - Line 182-184
- [ ] StrategyGenomeBrowser.tsx - Line 138-140
- [ ] TokenSpendTracker.tsx - Line 140-145
- [ ] MemoryBrowser.tsx - Line 143-145

**Subtask:** Create proper interfaces for Supabase data
- [ ] Create PositionRow, GraduationRow, TradeRow interfaces in ShadowPositionMonitor.tsx
- [ ] Create TokenUsageRecord interface in TokenSpendTracker.tsx
- [ ] Type all data transformations (no more `any` types)

### Issue #2: Type Safety (any types)
- [ ] ShadowPositionMonitor.tsx - Lines 145, 151, 163
  - [ ] Replace `(positionsData || []).map((p: any) =>` with typed interface
  - [ ] Replace `(graduationData || []).map((g: any) =>` with typed interface
  - [ ] Replace `(tradesData || []).map((t: any) =>` with typed interface

- [ ] TokenSpendTracker.tsx - Lines 445+
  - [ ] Create TokenUsageRecord interface
  - [ ] Replace `data: any[]` parameter with typed interface
  - [ ] Replace `for (const d of monthData)` type references

- [ ] MemoryBrowser.tsx - Line 129
  - [ ] Type the `.map((m: any) =>` operation

### Issue #3: Error Boundary Component
- [ ] Create `/src/components/dashboard/DashboardErrorBoundary.tsx`
- [ ] Wrap ActivityFeed component
- [ ] Wrap ShadowPositionMonitor component
- [ ] Wrap MorningBriefingViewer component
- [ ] Wrap RegimeIndicator component
- [ ] Wrap DataInventory component
- [ ] Wrap StrategyGenomeBrowser component
- [ ] Wrap BacktestRunner component
- [ ] Wrap TokenSpendTracker component
- [ ] Wrap MemoryBrowser component

---

## HIGH SEVERITY ISSUES

### Issue #4: Race Conditions
- [ ] ShadowPositionMonitor.tsx - Add AbortController
- [ ] MorningBriefingViewer.tsx - Add AbortController
- [ ] StrategyGenomeBrowser.tsx - Add AbortController

**Per component:**
- [ ] Import useRef
- [ ] Create abortControllerRef
- [ ] Cancel previous request before new fetch
- [ ] Check controller.signal.aborted before setState
- [ ] Add controller.abort() to cleanup

### Issue #5: Division by Zero
- [ ] TokenSpendTracker.tsx - Line 162-168
  - [ ] Add guard: `if (budget <= 0) return { ... }`
  - [ ] Test with budget = 0
  - [ ] Verify no NaN in output

---

## MEDIUM SEVERITY ISSUES

### Issue #6: Memoization
- [ ] StrategyGenomeBrowser.tsx - Lines 181-187
  - [ ] Import useMemo
  - [ ] Wrap filteredStrategies in useMemo
  - [ ] Add dependency array [strategies, searchQuery, statusFilter]

- [ ] DataInventory.tsx - Lines 186-190
  - [ ] Import useMemo
  - [ ] Wrap filteredAssets in useMemo
  - [ ] Add dependency array [assets, searchQuery]

- [ ] MemoryBrowser.tsx - Lines 147-155
  - [ ] Import useMemo
  - [ ] Wrap filteredMemories in useMemo
  - [ ] Add dependency array [memories, searchQuery]

### Issue #7: Error Boundary (Already covered in Critical #3)
- [x] (Completed above)

### Issue #8: Accessibility - ARIA Labels

#### ActivityFeed.tsx
- [ ] Line 270-275: Add aria-label and aria-pressed to pause/resume button
- [ ] Line 261-268: Add aria-label to live indicator span
- [ ] Line 303-304: Add aria-label to event type icon

#### ShadowPositionMonitor.tsx
- [ ] Refresh button: Add aria-label
- [ ] Status badges: Add aria-label

#### RegimeIndicator.tsx
- [ ] Popover button: Add aria-label
- [ ] VIX indicator: Add aria-label
- [ ] Refresh button: Add aria-label

#### DataInventory.tsx
- [ ] Refresh button: Add aria-label
- [ ] Search input: Add aria-label
- [ ] Status icons: Add aria-label

#### StrategyGenomeBrowser.tsx
- [ ] Refresh button: Add aria-label
- [ ] Search input: Add aria-label
- [ ] Sort column headers: Add aria-label
- [ ] View/Promote buttons: Add aria-label

#### BacktestRunner.tsx
- [ ] Run/Stop button: Add aria-label
- [ ] Progress bar: Add aria-label
- [ ] Regime filter badges: Add aria-label

#### TokenSpendTracker.tsx
- [ ] Refresh button: Add aria-label
- [ ] Progress bars: Add aria-label
- [ ] Model icons: Add aria-label

#### MorningBriefingViewer.tsx
- [ ] Refresh button: Add aria-label
- [ ] Briefing cards: Add role="button" if clickable
- [ ] Expand/collapse icons: Add aria-label

#### MemoryBrowser.tsx
- [ ] Refresh button: Add aria-label
- [ ] Search input: Add aria-label
- [ ] Filter dropdowns: Add aria-label
- [ ] Memory cards: Add role="button"
- [ ] Protection level icons: Add aria-label

---

## LOW SEVERITY ISSUES

### Issue #9: Null Checks
- [ ] StrategyGenomeBrowser.tsx - Line 377-395
  - [ ] Change condition from `strategy.regime_affinity &&` to `Array.isArray(strategy.regime_affinity) &&`

### Issue #10: Error Messages
- [ ] StrategyGenomeBrowser.tsx - Line 132
  - [ ] Change `setError(null)` to show error message even with mock data
  - [ ] Add: `if (process.env.NODE_ENV === 'development') { ... }`

- [ ] TokenSpendTracker.tsx - Line 134
  - [ ] Same as above

- [ ] MemoryBrowser.tsx - Line 137
  - [ ] Same as above

### Issue #11: Performance - Debounce Search (Nice to Have)
- [ ] Consider adding 300ms debounce to search inputs in all 3 list components
  - [ ] DataInventory.tsx
  - [ ] StrategyGenomeBrowser.tsx
  - [ ] MemoryBrowser.tsx

---

## TESTING CHECKLIST

After each fix:

- [ ] Code compiles without errors: `npm run type-check`
- [ ] ESLint passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Tests pass: `npm run test`
- [ ] Component renders without crashing
- [ ] Functionality works as expected
- [ ] No console errors or warnings

---

## VERIFICATION CHECKLIST

Before committing:

- [ ] All CRITICAL issues fixed
- [ ] All HIGH issues fixed
- [ ] At least 80% of MEDIUM issues fixed
- [ ] No regressions introduced
- [ ] Code review completed
- [ ] QA testing passed
- [ ] Staging deployment successful

---

## DEPLOYMENT CHECKLIST

Before going to production:

- [ ] All fixes tested in staging
- [ ] Performance impact measured (no slowdowns)
- [ ] Memory leaks verified fixed (monitor for 24 hours)
- [ ] Type safety verified (run type-check before deploy)
- [ ] Accessibility audit passed (WAVE or Lighthouse)
- [ ] Error boundary tested (force an error manually)
- [ ] Race conditions tested (rapid refresh clicking)
- [ ] Database structure changes applied if needed

---

## SIGN-OFF

- [ ] Developer: _________________ Date: _______
- [ ] Code Review: _________________ Date: _______
- [ ] QA: _________________ Date: _______
- [ ] Ready for Production: YES / NO

---

## NOTES

Use this section to track:
- Issues discovered during implementation
- Additional fixes needed
- Performance improvements made
- Accessibility improvements made

Example:
- Found additional `any` type on line XYZ in YYY.tsx - fixed
- Discovered new performance issue with ABC - added to backlog
- Implemented extra memoization on DEF - improved 30% performance

**Additional Issues Found:**
1. 
2. 
3. 

**Performance Improvements Measured:**
1. 
2. 
3. 

**Accessibility Improvements:**
1. 
2. 
3. 

