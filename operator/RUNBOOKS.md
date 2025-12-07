# Operator Runbooks

Step-by-step procedures for common operations.

---

## Runbook 1: Daily Market Analysis

**Purpose:** Generate fresh market analysis with AI-native pipeline

**Prerequisites:**
- Data volume mounted at `/Volumes/VelocityData/`
- DEEPSEEK_API_KEY environment variable set

**Steps:**

```bash
# 1. Navigate to python directory
cd /Users/zstoc/GitHub/quant-engine/python

# 2. Run AI-native analysis on SPY
python scripts/run_ai_native.py --symbol SPY --save-result

# 3. Check output
cat /Volumes/VelocityData/velocity_om/ai_native_results/ai_native_SPY_*.json | head -100
```

**Expected Output:**
- Thesis with direction (bullish/bearish/neutral)
- Confidence score (0-100%)
- Trade expression (if confidence > threshold)
- Adversarial analysis

**If it fails:**
- Check data mount: `ls /Volumes/VelocityData/`
- Check API key: `echo $DEEPSEEK_API_KEY`
- Check Python deps: `pip list | grep -E "pandas|numpy|pysr"`

---

## Runbook 2: Full Discovery Pipeline

**Purpose:** Run complete Scout → Math → Jury → AI-Native pipeline

**Time Required:** 30-60 minutes

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Scout Swarm (feature selection) - ~5 min
python scripts/run_scout_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet
# Output: scout_swarm_results.json

# Step 2: Math Swarm (equation discovery) - ~15 min
python scripts/run_math_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/scout_swarm_results.json
# Output: math_swarm_results.json

# Step 3: Jury Swarm (regime context) - ~10 min
python scripts/run_jury_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --equations /Volumes/VelocityData/velocity_om/math_swarm_results.json
# Output: jury_swarm_results.json

# Step 4: AI-Native Analysis (final synthesis) - ~5 min
python scripts/run_ai_native.py --symbol SPY \
    --equations /Volumes/VelocityData/velocity_om/math_swarm_results.json \
    --regime /Volumes/VelocityData/velocity_om/jury_swarm_results.json \
    --save-result
```

**Checkpoints:**
- After Scout: Verify top features make sense
- After Math: Check discovered equation isn't trivial
- After Jury: Confirm regime classification
- After AI-Native: Validate thesis coherence

---

## Runbook 3: Structure Discovery (Genetic Algorithm)

**Purpose:** Discover optimal options structures

**Time Required:** 1+ hours (first run builds payoff surface)

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Option A: Quick baseline check first
python scripts/run_structure_discovery.py --baseline
# This tests seed structures without full evolution

# Option B: Full discovery
python scripts/run_structure_discovery.py --full \
    --population 100 \
    --generations 50

# Option C: With walk-forward validation
python scripts/run_structure_discovery.py --discover --walk-forward --n-folds 3
```

**Output Files:**
- `/Volumes/VelocityData/velocity_om/payoff_surfaces/SPY_payoff_surface.parquet`
- `/Volumes/VelocityData/velocity_om/discovered_structures/discovered_structures.json`
- `/Volumes/VelocityData/velocity_om/discovered_structures/structure_summary.csv`
- `/Volumes/VelocityData/velocity_om/discovered_structures/test_results.csv`

---

## Runbook 4: Code Audit with DeepSeek

**Purpose:** Audit physics engine code for bugs

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine

# Audit a single file
python scripts/deepseek_agent.py \
    "Audit python/engine/features/morphology.py for:
    - Division by zero (missing checks)
    - Empty array operations (np.mean, np.std on empty)
    - NaN propagation (missing np.isfinite)
    - Log domain errors (log of zero/negative)
    - Bounds violations (probabilities outside [0,1])" \
    auditor_fixer

# Check the repair report
ls -la scripts/reports/
cat scripts/reports/repair_*.json | jq .
```

**Key files to audit:**
- `python/engine/features/morphology.py`
- `python/engine/features/dynamics.py`
- `python/engine/features/flow.py`
- `python/engine/features/entropy.py`
- `python/engine/features/correlation.py`
- `python/engine/ai_native/force_aggregator.py`

---

## Runbook 5: JARVIS UI Demo

**Purpose:** Demonstrate all JARVIS visualization types

**Steps:**

```bash
# Terminal 1: Start Electron
cd /Users/zstoc/GitHub/quant-engine
npm run electron:dev

# Terminal 2: Run demo
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/demo_jarvis.py
```

**What you'll see:**
1. Startup notification
2. Progress bar animation
3. Correlation heatmap
4. Candlestick chart with annotations
5. Market gauge dashboard
6. GEX gauge
7. P&L waterfall chart
8. Portfolio treemap
9. Options payoff diagram
10. Force vector bar chart
11. Regime detection notification
12. Scan results table
13. Backtest metrics
14. Equity curve

---

## Runbook 6: Emergency Data Refresh

**Purpose:** Regenerate all features from raw data

**Time Required:** 2+ hours

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# 1. Rebuild master features
python scripts/run_options_features.py --symbol SPY --rebuild

# 2. Rebuild regime assignments
python -c "
from engine.features.regime import RegimeClassifier
import pandas as pd
df = pd.read_parquet('/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet')
classifier = RegimeClassifier()
regimes = classifier.classify(df)
regimes.to_parquet('/Volumes/VelocityData/velocity_om/features/SPY/regime_assignments.parquet')
print('Done:', len(regimes), 'rows')
"

# 3. Rebuild payoff surface (if needed)
python scripts/run_structure_discovery.py --build-surface
```

---

## Runbook 7: Parallel Swarm Audit

**Purpose:** Run many DeepSeek agents in parallel

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine

# Use the swarm audit script
python scripts/swarm_audit_fix_tests.py

# Or use deepseek_agent.py in parallel manually:
for file in python/engine/features/*.py; do
    python scripts/deepseek_agent.py "Audit $file for bugs" reviewer &
done
wait
```

---

## Troubleshooting Quick Reference

| Symptom | Check | Fix |
|---------|-------|-----|
| "No module named" | Python path | `cd python && export PYTHONPATH=$PWD` |
| "File not found" | Data mount | `ls /Volumes/VelocityData/` |
| Slow PySR | Julia install | Wait (one-time) or `julia --version` |
| Empty results | Data range | Check parquet date columns |
| API timeout | Network | Check internet, retry |
| No UI events | Electron | Restart with `npm run electron:dev` |
