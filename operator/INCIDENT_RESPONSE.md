# INCIDENT RESPONSE

**Decision trees for handling trading system failures and anomalies.**

---

## Quick Reference

| Incident | First Action | See Section |
|----------|--------------|-------------|
| Connection lost | Check TWS status | Section 1 |
| Kill switch activated | Do NOT reconnect | Section 2 |
| Unexpected position | Verify before acting | Section 3 |
| Order rejected | Check pre-flight reason | Section 4 |
| Position mismatch | Run verify_positions.py | Section 5 |
| Runaway orders | Emergency flatten | Section 6 |
| Data feed failure | Halt new orders | Section 7 |

---

## Section 1: Connection Loss

```
CONNECTION LOST TO IBKR
         │
         ▼
Is TWS/Gateway running?
         │
    ┌────┴────┐
   YES       NO
    │         │
    ▼         ▼
Check API    Start TWS
settings     │
    │        ▼
    ▼     Wait 30 sec
Is "Enable   │
Socket       ▼
Clients"     Retry
checked?     connection
    │
┌───┴───┐
YES    NO
│       │
▼       ▼
Check   Enable it
port    │
numbers ▼
7497/   Restart
7496    connection
│
▼
Still failing?
│
┌───┴───┐
YES    NO
│       │
▼       ▼
Check   Success!
firewall Resume
rules   trading
│
▼
Call IBKR support
1-877-442-2757
```

### Connection Recovery Checklist
- [ ] TWS/Gateway is running
- [ ] API enabled in TWS settings
- [ ] Correct port (7497 paper, 7496 live)
- [ ] Only one connection per client_id
- [ ] Firewall allows localhost connections

---

## Section 2: Kill Switch Activated

```
KILL SWITCH TRIGGERED
         │
         ▼
    STOP. BREATHE.
         │
         ▼
Was it intentional?
         │
    ┌────┴────┐
   YES       NO
    │         │
    ▼         ▼
Good.      INVESTIGATE
Wait.      │
│          ▼
▼        What triggered it?
Review   │
why      ├─ DrawdownController?
│        │   └─ Check daily/weekly P&L
▼        │
Log      ├─ Manual trigger?
incident │   └─ Who triggered? Why?
│        │
▼        └─ Code bug?
DO NOT       └─ Check logs
RESUME
TRADING
SAME DAY
```

### Kill Switch Recovery
1. **Wait at least 30 minutes** before any action
2. Review all positions in TWS GUI directly
3. Run `verify_positions.py` to check state
4. Document in INCIDENT_LOG.md
5. **DO NOT resume trading same day**
6. Next day: Full pre-flight checklist before resuming

---

## Section 3: Unexpected Position

```
UNEXPECTED POSITION FOUND
         │
         ▼
Where did you see it?
         │
    ┌────┴────────────┐
System           Broker (TWS)
    │                 │
    ▼                 ▼
Run verify_         System shows
positions.py        different?
    │                 │
    ▼            ┌────┴────┐
Match?          YES       NO
    │             │         │
┌───┴───┐        ▼         ▼
YES    NO     BROKER IS    Match -
│       │     TRUTH        no issue
▼       ▼         │
OK    HALT        ▼
      TRADING   Update system
      │         to match
      ▼         │
      Investigate ▼
      │         Resume
      ▼         carefully
      Is it a
      fill you
      missed?
          │
     ┌────┴────┐
    YES       NO
     │         │
     ▼         ▼
    Update   ESCALATE
    system   Unknown
    state    position
             may be
             unauthorized
             access
```

### Position Verification
```bash
# Compare system to broker
python verify_positions.py

# Check TWS directly
# - Account → Portfolio
# - Should match verify_positions.py output
```

---

## Section 4: Order Rejected

```
ORDER REJECTED
         │
         ▼
Check rejection reason
         │
    ┌────┴────────────────┐
Pre-flight            Broker
rejection             rejection
    │                     │
    ▼                     ▼
Check execution_log   Check TWS
for reason            messages
    │                     │
    ▼                     │
Common reasons:       Common reasons:
- Position limit      - Insufficient margin
- Order value         - Market closed
- Rate limit          - Invalid price
- Symbol blocked      - Symbol halted
    │                     │
    ▼                     ▼
Adjust order or       Fix issue or
wait for limit        wait for
to reset              conditions
```

### Pre-Flight Rejection Codes
| Code | Meaning | Action |
|------|---------|--------|
| Position limit | >10 contracts | Reduce size or close existing |
| Order value | >$50k notional | Reduce size |
| Rate limit | Too fast | Wait 1 second |
| Daily limit | >100 trades | Wait until tomorrow |
| Symbol blocked | In blocklist | Check blocklist config |

---

## Section 5: Position Mismatch

```
SYSTEM ≠ BROKER
         │
         ▼
Run verify_positions.py
         │
         ▼
What's the discrepancy?
         │
    ┌────┴────────────────┬────────────────┐
System shows          System shows       System shows
MORE than broker      LESS than broker   DIFFERENT price
    │                     │                   │
    ▼                     ▼                   ▼
Likely: system        Likely: fill        Price sync
recorded order        happened but        issue
that didn't fill      not recorded        │
    │                     │                ▼
    ▼                     ▼               Use broker
Check order           Check TWS          price as
status in TWS         execution          truth
    │                 history
    ▼                     │
Update system             ▼
to match              Update system
broker                to match
```

### Reconciliation Steps
1. **Broker is always truth** - if mismatch, update system
2. Check TWS execution history for fills
3. Check execution_log in Supabase for system view
4. Update position_tracker state if needed
5. Document discrepancy in INCIDENT_LOG.md

---

## Section 6: Runaway Orders

```
ORDERS PLACING FASTER THAN EXPECTED
         │
         ▼
    EMERGENCY FLATTEN
    (See EMERGENCY.md)
         │
         ▼
Did orders stop?
         │
    ┌────┴────┐
   YES       NO
    │         │
    ▼         ▼
Review    Kill Python:
what      pkill -f python
caused it     │
    │         ▼
    ▼     Use TWS to
Is there  close positions
a bug in  manually
strategy      │
code?         ▼
    │     Call IBKR if
    ▼     needed
Fix bug   1-877-442-2757
before
resuming
```

### Runaway Prevention
- Rate limiting enforced (1 order/sec/symbol)
- Max 100 orders/day limit
- Pre-flight checks on every order
- If these are bypassed, there's a bug

---

## Section 7: Data Feed Failure

```
DATA FEED STOPPED
         │
         ▼
Are you getting
quotes?
         │
    ┌────┴────┐
   YES       NO
    │         │
    ▼         ▼
Just slow?  TWS connected?
    │             │
    ▼        ┌────┴────┐
May be      YES       NO
market          │         │
hours issue     ▼         ▼
    │     Check     Reconnect
    ▼     market    TWS
Continue  data      │
carefully status        ▼
    │     in TWS    Resume
    ▼         │
HALT new      ▼
entry orders  Is data
until data    subscription
confirmed     active?
              │
         ┌────┴────┐
        YES       NO
         │         │
         ▼         ▼
    May be     Resubscribe
    provider   to data
    issue      feeds
         │
         ▼
    Wait or
    use backup
    data source
```

### Data Feed Checklist
- [ ] TWS connected and logged in
- [ ] Market data subscription active
- [ ] Correct trading permissions
- [ ] Not exceeding market data limits

---

## Incident Severity Levels

| Level | Definition | Response Time | Example |
|-------|------------|---------------|---------|
| P1 | Capital at immediate risk | < 1 minute | Kill switch, runaway orders |
| P2 | Trading halted | < 5 minutes | Connection loss, data feed failure |
| P3 | Degraded operation | < 1 hour | Order rejections, position mismatch |
| P4 | Non-urgent issue | < 24 hours | Logging failure, minor bug |

---

## Post-Incident Process

After ANY incident:
1. **Stabilize** - Ensure no ongoing capital risk
2. **Document** - Add to INCIDENT_LOG.md immediately
3. **Investigate** - Find root cause
4. **Fix** - Implement fix
5. **Verify** - Test fix works
6. **Review** - Update procedures if needed

---

**Last Updated**: 2025-12-07
**Review After**: Any P1 or P2 incident
