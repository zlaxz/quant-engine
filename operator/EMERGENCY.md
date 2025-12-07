# EMERGENCY PROCEDURES

**PRINT THIS PAGE. KEEP IT NEXT TO YOUR TRADING STATION.**

---

## KILL SWITCH - FLATTEN ALL POSITIONS

### Option 1: Python CLI (Fastest)
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python -c "
import asyncio
from engine.trading import IBKRAccountManager, TradingMode

async def kill():
    mgr = IBKRAccountManager()
    mgr.add_account('paper', TradingMode.PAPER)
    mgr.add_account('live', TradingMode.LIVE, client_id=2)
    await mgr.connect_all()
    result = await mgr.kill_switch_all('EMERGENCY')
    print(result)
    await mgr.disconnect_all()

asyncio.run(kill())
"
```

### Option 2: TWS Direct
1. Open Trader Workstation
2. Right-click portfolio → "Close All Positions"
3. File → Global Cancel

### Option 3: IBKR Mobile
1. Open IBKR Mobile app
2. Account → Positions
3. Close all positions manually

---

## EMERGENCY CONTACTS

| Contact | Number | When to Call |
|---------|--------|--------------|
| IBKR Trade Desk | 1-877-442-2757 | Can't close positions via app/TWS |
| IBKR After Hours | 1-312-542-6901 | Overnight emergency |

---

## CONNECTION PORTS

| Account | Port | Client ID |
|---------|------|-----------|
| Paper   | 7497 | 1         |
| Live    | 7496 | 2         |

---

## RISK LIMITS (VERIFY IMMEDIATELY IF BREACHED)

| Limit | Threshold | Action |
|-------|-----------|--------|
| Daily Loss | 2% ($2,000 on $100k) | Stop trading today |
| Weekly Loss | 5% ($5,000) | Reduce size 50% |
| Monthly Loss | 10% ($10,000) | Pause 1 week |
| Circuit Breaker | 15% ($15,000) | FULL SHUTDOWN |
| Max Contracts | 10 futures / 50 options | Pre-flight rejects |

---

## POSITION VERIFICATION

Quick check system vs broker:
```bash
cd /Users/zstoc/GitHub/quant-engine/operator
python verify_positions.py
```

---

## HALT TRADING (WITHOUT FLATTEN)

```python
# Halt specific account
manager.halt_trading("paper", "Manual halt")
manager.halt_trading("live", "Manual halt")

# Resume
manager.resume_trading("paper")
manager.resume_trading("live")
```

---

## IF SYSTEM IS UNRESPONSIVE

1. **Kill Python processes**: `pkill -f python`
2. **Check TWS connection**: Is TWS running? Connected?
3. **Use TWS directly**: Close positions in TWS GUI
4. **Call IBKR**: 1-877-442-2757

---

## POST-INCIDENT

1. Record incident in `operator/INCIDENT_LOG.md`
2. Run `python verify_positions.py` to confirm state
3. Review what triggered the emergency
4. Do NOT resume trading until fully understood

---

**Last Updated**: 2025-12-07
**Next Review**: Monthly or after any incident
