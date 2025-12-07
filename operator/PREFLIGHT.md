# PRE-FLIGHT CHECKLIST

**Complete this checklist before EVERY trading session.**

---

## Quick Automated Check

```bash
cd /Users/zstoc/GitHub/quant-engine/operator
python verify_system.py
```

If automated check passes, proceed. If any failures, resolve before trading.

---

## Manual Verification Checklist

### 1. Infrastructure

- [ ] **Data mount accessible**: `ls /Volumes/SSD_01/market_data/`
- [ ] **TWS running**: Check Trader Workstation is open and connected
- [ ] **Paper account**: Port 7497 accepting connections
- [ ] **Live account**: Port 7496 accepting connections (if live trading)
- [ ] **API settings**: TWS → Configure → API → "Enable ActiveX and Socket Clients" checked

### 2. Position State

- [ ] **Check existing positions**: Run `python verify_positions.py`
- [ ] **Paper positions known**: Document any open paper positions
- [ ] **Live positions known**: Document any open live positions
- [ ] **No unexpected positions**: If any surprise positions, STOP and investigate

### 3. Risk Limits

- [ ] **Daily loss limit set**: $2,000 (2% of $100k)
- [ ] **Max contracts configured**: 10 futures, 50 options per trade
- [ ] **DrawdownController active**: Confirm circuit breakers in place
- [ ] **Current drawdown status**: Check if any limits already hit

### 4. Market Conditions

- [ ] **Market hours**: Confirm market is open or extended hours available
- [ ] **VIX level checked**: High VIX (>30) = reduced position sizes
- [ ] **No major events**: Check for FOMC, earnings, economic releases
- [ ] **News scan**: Any overnight events affecting positions?

### 5. System State

- [ ] **Kill switch tested**: Confirm emergency_flatten() is callable
- [ ] **Logging enabled**: Supabase execution logger connected
- [ ] **Error handling**: Check recent logs for any issues
- [ ] **Memory system**: Supabase memory available

---

## Position Documentation

Before trading, document current state:

| Account | Symbol | Qty | Entry | Current | P&L |
|---------|--------|-----|-------|---------|-----|
| Paper | | | | | |
| Paper | | | | | |
| Live | | | | | |
| Live | | | | | |

---

## Go / No-Go Decision

| Criteria | Status |
|----------|--------|
| All automated checks pass | [ ] |
| No unexpected positions | [ ] |
| Risk limits confirmed | [ ] |
| Market conditions acceptable | [ ] |
| Kill switch functional | [ ] |

**ALL BOXES MUST BE CHECKED BEFORE TRADING**

---

## Pre-Flight Commands

```bash
# Quick system check
cd /Users/zstoc/GitHub/quant-engine/operator
python verify_system.py

# Position verification
python verify_positions.py

# Test connection to paper
cd /Users/zstoc/GitHub/quant-engine/python
python -c "
from engine.trading import IBKRClient, TradingMode
import asyncio
async def test():
    client = IBKRClient(TradingMode.PAPER)
    connected = await client.connect(timeout=10)
    print(f'Paper connected: {connected}')
    if connected:
        positions = await client.get_positions()
        print(f'Positions: {positions}')
        await client.disconnect()
asyncio.run(test())
"
```

---

## After Checklist Complete

1. Update `operator/STATE.md` with session start time
2. Record initial position state
3. Confirm trading objectives for session
4. Proceed with trading

---

**Last Updated**: 2025-12-07
**Review Frequency**: Before every trading session
