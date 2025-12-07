# RISK POLICY

**Formal risk limits for quant-engine trading operations.**

---

## Hard Limits

These limits are enforced by code. Violating them triggers automatic rejection or halt.

### Position Limits (Per Trade)

| Asset Type | Max Contracts | Enforced In |
|------------|---------------|-------------|
| Options | 50 | `risk_manager.py:MAX_CONTRACTS['option']` |
| Futures | 10 | `risk_manager.py:MAX_CONTRACTS['future']` |
| Stock | 10,000 shares | `risk_manager.py:MAX_CONTRACTS['stock']` |

### Position Limits (Total)

| Asset Type | Max Position | Enforced In |
|------------|--------------|-------------|
| Any symbol | 10 contracts | `order_manager.py:PreFlightCheck.max_position_per_symbol` |
| Portfolio | 20% of account | `risk_manager.py:max_position_pct` |

### Risk Per Trade

| Metric | Limit | Enforced In |
|--------|-------|-------------|
| Max risk per trade | 2% of account | `risk_manager.py:max_risk_per_trade` |
| Max order value | $50,000 | `order_manager.py:PreFlightCheck.max_order_value` |

---

## Drawdown Circuit Breakers

The `DrawdownController` class enforces these limits automatically.

| Level | Threshold | Action | Recovery |
|-------|-----------|--------|----------|
| Daily | 2% | Stop trading for day | New day |
| Weekly | 5% | Reduce size 50% | New week |
| Monthly | 10% | Pause 1 week | After pause |
| Circuit Breaker | 15% | FULL SHUTDOWN | Manual review |
| Consecutive Losers | 5 days | Reduce size 25% | Next win |

### Configuration Location
```python
# python/engine/trading/risk_manager.py lines 89-97
DrawdownController(
    initial_equity=100000,
    daily_limit=0.02,      # 2%
    weekly_limit=0.05,     # 5%
    monthly_limit=0.10,    # 10%
    circuit_breaker=0.15,  # 15%
    max_consecutive_losers=5,
)
```

---

## VIX-Based Position Scaling

When VIX is elevated, position sizes are automatically reduced.

| VIX Level | Position Multiplier | Rationale |
|-----------|---------------------|-----------|
| ≤15 | 100% | Normal volatility |
| 15-20 | 85% | Elevated |
| 20-25 | 70% | High |
| 25-30 | 50% | Very high |
| 30-40 | 25% | Extreme |
| >40 | 10% | Crisis |

### Configuration Location
```python
# python/engine/trading/risk_manager.py lines 284-312
DrawdownController.apply_vix_scaling(vix)
```

---

## Contract Multipliers

The system accounts for contract multipliers to prevent the "x100 trap."

| Asset | Multiplier | Example |
|-------|------------|---------|
| Options | 100x | 1 contract = 100 shares |
| ES (E-mini S&P) | $50/point | |
| NQ (E-mini Nasdaq) | $20/point | |
| MES (Micro E-mini) | $5/point | |
| MNQ (Micro Nasdaq) | $2/point | |

### Configuration Location
```python
# python/engine/trading/risk_manager.py lines 316-330
CONTRACT_MULTIPLIERS = {
    'option': 100,
    'future': {'ES': 50, 'NQ': 20, 'MES': 5, 'MNQ': 2, ...},
    'stock': 1,
}
```

---

## Pre-Flight Checks

Every order passes through `PreFlightCheck` before execution.

| Check | Threshold | Behavior |
|-------|-----------|----------|
| Symbol allowed | Whitelist | Reject if not in list |
| Quantity | 1-50 | Reject if outside range |
| Position limit | 10 per symbol | Reject if exceeded |
| Order value | $50,000 | Reject if exceeded |
| Rate limit | 1 order/sec/symbol | Reject if too fast |
| Daily trades | 100 | Reject if exceeded |

### Configuration Location
```python
# python/engine/trading/order_manager.py lines 115-132
PreFlightCheck(
    max_order_value=50000.0,
    max_position_per_symbol=10,
    max_daily_trades=100,
    min_order_interval_seconds=1.0,
)
```

---

## Account-Specific Limits

Different limits for paper vs live trading.

| Account | Daily Loss Limit | Rationale |
|---------|------------------|-----------|
| Paper | $1,000 | Testing tolerance |
| Live | $500 | Capital preservation |

### Configuration Location
```python
# python/engine/trading/account_manager.py lines 705-738
create_dual_account_manager(
    paper_loss_limit=1000.0,
    live_loss_limit=500.0,
)
```

---

## Breach Procedures

### Level 1: Pre-Flight Rejection
- Order rejected before submission
- Logged to execution_log table
- No action required unless persistent

### Level 2: Daily Limit Hit
1. Trading halts automatically
2. Review positions at end of day
3. Identify cause of losses
4. Resume next trading day

### Level 3: Weekly Limit Hit
1. Position sizes reduced 50% automatically
2. Review strategy performance
3. Consider reducing exposure further
4. Full review at week end

### Level 4: Monthly Limit / Circuit Breaker
1. All trading halted
2. **DO NOT RESUME UNTIL**:
   - Full P&L review completed
   - Root cause identified
   - Strategy modifications made
   - Written approval documented

---

## Review Schedule

| Review | Frequency | Action |
|--------|-----------|--------|
| Risk limits | Monthly | Verify limits still appropriate |
| Breach history | Weekly | Review any rejections/halts |
| Circuit breaker test | Monthly | Manually test kill switch |
| VIX scaling | Quarterly | Calibrate to market conditions |

---

## Changing Limits

**DO NOT change limits during a trading session.**

To change a limit:
1. Document the change and rationale
2. Update code in appropriate file
3. Test in paper environment
4. Review with fresh eyes next day
5. Deploy to live

---

**Last Updated**: 2025-12-07
**Approved By**: Zach
**Next Review**: 2026-01-07
