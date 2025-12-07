# Operator State

**Last Updated:** [Update this when you make changes]

---

## Currently Running

| Operation | Started | Status | PID |
|-----------|---------|--------|-----|
| None | - | - | - |

---

## Recent Results

| Operation | Completed | Output Location | Key Metrics |
|-----------|-----------|-----------------|-------------|
| - | - | - | - |

---

## Data Freshness

| Data | Last Updated | Rows | Notes |
|------|--------------|------|-------|
| SPY Master Features | Check file | - | `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet` |
| SPY Options Features | Check file | - | `/Volumes/VelocityData/velocity_om/massive/features/SPY_options_features.parquet` |
| Regime Assignments | Check file | - | `/Volumes/VelocityData/velocity_om/features/SPY/regime_assignments.parquet` |

---

## Known Issues

| Issue | Severity | Workaround |
|-------|----------|------------|
| None currently tracked | - | - |

---

## Quick Status Check

```bash
# Check data mount
ls /Volumes/VelocityData/velocity_om/

# Check latest features
ls -la /Volumes/VelocityData/velocity_om/features/*.parquet

# Check swarm results
ls -la /Volumes/VelocityData/velocity_om/*_swarm_results.json

# Check JARVIS events
ls /tmp/claude-code-results/

# Check repair reports
ls /Users/zstoc/GitHub/quant-engine/scripts/reports/
```
