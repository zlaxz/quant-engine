# Phase 4: External Backtest Engine Configuration

## Overview
Phase 4 adds support for connecting to an external backtest engine (rotation-engine) while maintaining a safe stub fallback.

## Environment Variable Setup

### `BACKTEST_ENGINE_URL`

This environment variable configures the URL of the external backtest engine.

**Setting the variable in Supabase:**
1. Go to Supabase Dashboard
2. Navigate to: Project Settings → Edge Functions → Environment Variables
3. Add a new secret:
   - Name: `BACKTEST_ENGINE_URL`
   - Value: `http://your-engine-host:port` (e.g., `http://localhost:8000` or `https://engine.example.com`)

**Behavior:**
- **If set and engine responds**: Uses real backtest results from external engine
- **If set but engine fails**: Falls back to stub with warning
- **If not set**: Uses stub by default (no external calls attempted)

## External Engine API Contract

The `backtest-run` edge function will POST to:
```
${BACKTEST_ENGINE_URL}/run-backtest
```

### Request Payload
```json
{
  "strategyKey": "skew_convexity_v1",
  "params": {
    "startDate": "2020-01-01",
    "endDate": "2024-12-31",
    "capital": 100000
  }
}
```

### Expected Response (200 OK)
```json
{
  "metrics": {
    "cagr": 0.12,
    "sharpe": 1.45,
    "max_drawdown": -0.11,
    "win_rate": 0.38,
    "total_trades": 150,
    "avg_trade_duration_days": 5
  },
  "equity_curve": [
    { "date": "2020-01-01", "value": 100000 },
    { "date": "2020-01-15", "value": 101500 },
    ...
  ]
}
```

### Response Validation
The edge function validates:
- Response status is 2xx
- `metrics` object exists with all required fields
- `equity_curve` array exists, non-empty, with `date` and `value` fields
- Times out after 30 seconds

### Error Handling
If external engine call fails for any reason:
- Network error
- Timeout (>30s)
- Non-2xx status code
- Invalid/missing response fields

The function automatically falls back to the stub generator and marks the run as `engine_source: 'stub_fallback'`.

## Frontend Indicators

The Quant Panel displays engine status badges:

- **"Live Engine"** (green) - Results from external engine
- **"Stub"** (gray) - No external engine configured
- **"Stub (Fallback)"** (orange) - External engine failed, using stub

## Testing Without External Engine

The system works perfectly without an external engine:
1. Leave `BACKTEST_ENGINE_URL` unset
2. Run backtests as normal
3. System uses deterministic stub results
4. UI shows "Stub" badge

## Database Tracking

All backtest runs now include `engine_source` field:
- `'stub'` - No external engine configured
- `'external'` - Successfully used external engine
- `'stub_fallback'` - External engine failed, fell back to stub

Query backtest runs by source:
```sql
SELECT * FROM backtest_runs WHERE engine_source = 'external';
SELECT * FROM backtest_runs WHERE engine_source = 'stub_fallback';
```

## Next Steps (Phase 5+)

Phase 4 provides the bridge. Future phases will:
- Implement the actual Python rotation-engine
- Deploy engine to production infrastructure
- Add authentication between edge function and engine
- Implement streaming results for long-running backtests
