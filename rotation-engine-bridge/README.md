# Rotation Engine Bridge Server

HTTP bridge that:
1. Executes Python backtests from Chief Quant chat
2. Ingests Massive.com (Polygon.io) market data to local 8TB drive
3. Maintains local data index in Supabase for fast queries

## Setup (One Time)

1. **Copy this folder to your rotation-engine directory:**
   ```bash
   # If rotation-engine-bridge is in your Lovable project:
   cp -r rotation-engine-bridge /Users/zstoc/rotation-engine/
   ```

2. **Navigate to rotation-engine:**
   ```bash
   cd /Users/zstoc/rotation-engine
   ```

3. **Start the bridge server:**
   ```bash
   python rotation-engine-bridge/bridge_server.py
   ```

That's it! Leave it running in a terminal window.

## Usage

Once the bridge is running, Chief Quant can execute backtests directly from chat:
- Request backtests through `/backtest` command or natural conversation
- Chief Quant receives real results from your rotation-engine
- Results automatically saved to database and displayed in chat
- No manual copying/pasting required

## What It Does

- Listens on `http://localhost:8080`
- Receives backtest requests from Supabase edge functions
- Executes your rotation-engine Python code
- Returns metrics, equity curves, and trade logs
- Handles errors gracefully

## Requirements

- Python 3.7+
- Your rotation-engine must have a CLI interface that accepts:
  - `--profile` (strategy key)
  - `--start` (start date)
  - `--end` (end date)
  - `--capital` (initial capital)
  - `--output json` (JSON output format)

## Customization

If your rotation-engine CLI uses different command structure, edit `bridge_server.py` line 40-47 to match your actual command format.

## Data Ingestion (Massive.com / Polygon.io)

The bridge includes a data ingestor for downloading Polygon.io flat files from Massive.com.

### Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set environment variables:**
   ```bash
   # Massive.com Flatfiles S3 API (from Polygon Flatfiles dashboard)
   export AWS_ACCESS_KEY_ID=your_access_key_id          # e.g., 39f80878-ab94-48eb-a3fc-...
   export AWS_SECRET_ACCESS_KEY=your_secret_access_key  # e.g., r8ttfG0r9lvunoLbhpEC...
   export MASSIVE_ENDPOINT=https://files.massive.com
   export MASSIVE_BUCKET=flatfiles

   # For WebSocket streaming (Polygon real-time)
   export POLYGON_API_KEY=your_polygon_api_key

   # Local storage
   export DATA_DIR=/path/to/8tb/drive/market_data

   # Supabase
   export SUPABASE_URL=your_supabase_url
   export SUPABASE_KEY=your_supabase_service_role_key
   ```

   **Quick setup (add to ~/.zshrc):**
   ```bash
   # Massive.com Flatfiles (S3-compatible for historical data)
   export AWS_ACCESS_KEY_ID="39f80878-ab94-48eb-a3fc-a18bd48c9656"
   export AWS_SECRET_ACCESS_KEY="r8ttfG0r9lvunoLbhpECXNjp7sRqE8LP"
   export MASSIVE_ENDPOINT="https://files.massive.com"
   export MASSIVE_BUCKET="flatfiles"

   # Polygon.io WebSocket (for real-time streaming)
   export POLYGON_API_KEY="r8ttfG0r9lvunoLbhpECXNjp7sRqE8LP"
   ```

### Direct Usage

```bash
# Download single day
python data_ingestor.py --date 2024-11-20 --type stocks_trades --tickers SPY,QQQ,NVDA

# Download date range
python data_ingestor.py --start 2024-11-01 --end 2024-11-20 --type stocks_trades

# Check local inventory
python data_ingestor.py --inventory
```

### Via Bridge API

```bash
# Trigger ingestion via HTTP endpoint
curl -X POST http://localhost:8080/ingest-data \
  -H "Content-Type: application/json" \
  -d '{"date": "2024-11-20", "tickers": ["SPY", "QQQ"], "type": "stocks_trades"}'
```

### Data Types

- `stocks_trades` - Stock trade ticks
- `stocks_quotes` - Stock NBBO quotes
- `options_trades` - Options trade ticks
- `options_quotes` - Options quotes

### Default Tickers

If no tickers specified, downloads data for high-liquidity symbols:
- Major ETFs: SPY, QQQ, IWM, DIA
- Mega caps: AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META
- Tech: AMD, NFLX, CRM, INTC
- Financials: JPM, BAC, GS, MS
- Sector ETFs: XLF, XLE, XLK, XLV, XLI

## Research Daemon ("Night Shift")

The autonomous research orchestrator that runs 24/7 to evolve strategies.

### Starting the Daemon

```bash
# Normal mode - runs continuously
python research_daemon.py

# Test mode - runs each phase once
python research_daemon.py --run-once

# Custom intervals
python research_daemon.py \
  --recruit-interval 1800 \
  --harvest-interval 300 \
  --execute-interval 600 \
  --workers 4 \
  --fitness-threshold 0.5
```

### Four Capabilities

1. **Recruiter** (`replenish_pool`)
   - Monitors strategy pool size
   - Dispatches cloud swarm when pool < 50 strategies
   - Mutates top 5 performers to find local convexity extrema

2. **Harvester** (`harvest_mutations`)
   - Polls completed evolution tasks
   - Parses Python code from LLM output
   - Validates syntax via AST
   - Saves valid mutations to `strategy_genome`

3. **Execution Engine** (`execute_candidates`)
   - Runs 4 parallel backtests (M4 Pro optimized)
   - Uses local Parquet data from 8TB drive
   - Calculates fitness = Sharpe × Sortino × Convexity
   - Promotes/fails strategies based on threshold

4. **Publisher** (`publish_briefings`)
   - Generates daily "Morning Briefing" cards
   - Plain-English narratives for top strategies
   - Inserts into `morning_briefings` table

### Fitness Calculation

```
Fitness = Sharpe × Sortino × Convexity × (1 + MaxDrawdown)
```

Where:
- **Sharpe**: Risk-adjusted returns (annualized)
- **Sortino**: Downside-only volatility adjustment
- **Convexity**: Asymmetric returns score (gains in volatile markets)
- **MaxDrawdown**: Penalty for large drawdowns (negative value)

### Intervals

| Phase | Default | Description |
|-------|---------|-------------|
| Recruit | 3600s (1hr) | Check pool size, dispatch swarm |
| Harvest | 300s (5min) | Collect completed mutations |
| Execute | 600s (10min) | Run parallel backtests |
| Publish | Daily @ 6AM | Generate morning briefings |

## Shadow Trading (Paper Trading Validation)

The Shadow Trader validates strategies in real-time paper trading before graduation to live.

### How It Works

1. **WebSocket Connection**: Connects to Polygon.io via `massive_socket.py`
2. **Signal Submission**: Strategies submit trade signals to the ShadowTrader
3. **Execution Simulation**: Realistic friction applied:
   - **Spread**: Always buy at Ask, sell at Bid (no mid-price fantasy)
   - **Latency**: 50-200ms random delay between signal and fill
   - **Liquidity**: Orders rejected if size > available quote size
4. **Position Tracking**: All positions tracked in `shadow_positions` table
5. **Graduation**: After 50 trades with Sharpe > 1.5, strategy graduates

### Starting with Shadow Trading

```bash
# Start daemon with shadow trading enabled (default)
python research_daemon.py

# Shadow trading auto-starts when daemon runs
# Requires POLYGON_API_KEY environment variable
```

### Graduation Criteria

A strategy graduates from shadow to production when:
- Minimum **50 paper trades** completed
- Rolling Sharpe ratio **> 1.5**
- Win rate, average P&L, and max drawdown all tracked

Graduation triggers:
- Notification inserted into `morning_briefings`
- Strategy flagged as `graduation_ready` in `graduation_tracker`
- Manual approval still required for live trading

### Environment Variables

```bash
# Required for shadow trading
export POLYGON_API_KEY="your_polygon_api_key"

# Shadow-specific symbols (optional, defaults to SPY,QQQ)
export SHADOW_SYMBOLS="SPY,QQQ,IWM"
```

### Database Tables

- `shadow_positions` - Active and closed paper positions
- `shadow_trades` - All executed paper trades with slippage metrics
- `graduation_tracker` - Per-strategy graduation progress

### Submitting Signals (Programmatic)

```python
from research_daemon import ShadowSignal

signal = ShadowSignal(
    strategy_id="uuid-here",
    symbol="SPY",
    side="buy",
    quantity=100,
    signal_price=450.50,
    regime="LOW_VOL_GRIND"
)

await shadow_trader.submit_signal(signal)
```

## Troubleshooting

**Bridge not connecting?**
- Verify bridge_server.py is running (you should see "Ready to execute backtests")
- Check port 8080 isn't already in use
- Ensure you're in the rotation-engine directory when running

**Backtests failing?**
- Check bridge_server.py terminal for error messages
- Verify your rotation-engine CLI works independently
- Confirm command format matches your engine's interface

**Data ingestion failing?**
- Verify MASSIVE_KEY is set correctly
- Check DATA_DIR exists and is writable
- Ensure sufficient disk space on target drive
- Check bridge terminal for detailed error messages

**Fallback behavior:**
- If bridge isn't running, system falls back to stub results
- You'll see "stub_fallback" in the engine_source field
- No crashes - just fake data until bridge is started

**Shadow trading not connecting?**
- Verify POLYGON_API_KEY is set in environment
- Check WebSocket connectivity: `python massive_socket.py --symbols SPY --duration 10`
- Ensure market is open (WebSocket only streams during market hours)
- Check daemon logs for "MassiveSocket ready" message

**Orders being rejected?**
- Liquidity check: Order size may exceed available quote size
- Check spread in logs - wide spreads indicate illiquid conditions
- Verify symbol is subscribed: look for "Subscribed to: [T.SPY, Q.SPY]"
