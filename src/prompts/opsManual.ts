/**
 * Operational Manual - System Awareness for Chief Quant
 *
 * Provides the Chief Quant with knowledge of the local infrastructure:
 * - Hardware: Mac M4 Pro + 8TB VelocityData external drive
 * - Data: Massive.com Flat Files -> Parquet (Local)
 * - Components: bridge_server.py, data_ingestor.py, research_daemon.py
 *
 * Created: 2025-11-24
 */

export const OPS_MANUAL = `
## Operational Context (The Rig)

You have awareness of the PHYSICAL infrastructure this operation runs on. Before recommending any action, verify it is physically possible on THIS rig (e.g., do not suggest downloading 10TB to the cloud or running GPU workloads).

---

### The Data Atlas

**Location:** \`/Volumes/VelocityData/market_data/\` (8TB external SSD)

**Directory Structure:**
\`\`\`
/Volumes/VelocityData/market_data/
├── stocks_trades/
│   └── {SYMBOL}/
│       └── {YYYY}/
│           └── {YYYY-MM-DD}.parquet
├── stocks_quotes/
│   └── {SYMBOL}/{YYYY}/{YYYY-MM-DD}.parquet
├── options_trades/
│   └── {UNDERLYING}/{YYYY}/{YYYY-MM-DD}.parquet
└── options_quotes/
    └── {UNDERLYING}/{YYYY}/{YYYY-MM-DD}.parquet
\`\`\`

**Schema (Options Tick Data):**
| Column | Type | Description |
|--------|------|-------------|
| timestamp | datetime64[ns] | Nanosecond precision tick time |
| symbol | string | Full OCC symbol (e.g., SPY240119C00450000) |
| underlying | string | Underlying symbol (SPY, QQQ, etc.) |
| expiration | date | Option expiration date |
| strike | float64 | Strike price |
| type | string | 'call' or 'put' |
| price | float64 | Trade/quote price |
| size | int32 | Trade size or quote depth |
| bid | float64 | Best bid (quotes only) |
| ask | float64 | Best ask (quotes only) |
| iv | float64 | Implied volatility (if available) |
| delta | float64 | Delta Greek (if available) |
| gamma | float64 | Gamma Greek (if available) |
| theta | float64 | Theta Greek (if available) |
| vega | float64 | Vega Greek (if available) |

**Data Source:** Massive.com (Polygon.io Flat Files via S3-compatible API)

**Coverage:** High-liquidity symbols only:
- ETFs: SPY, QQQ, IWM, DIA
- Mega caps: AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META
- Sector ETFs: XLF, XLE, XLK, XLV, XLI

---

### The Control Panel (How To Do Things)

#### "How do I download market data?"

**Method 1: Via Bridge API (Recommended)**
\`\`\`bash
curl -X POST http://localhost:8080/ingest-data \\
  -H "Content-Type: application/json" \\
  -d '{"date": "2024-11-20", "tickers": ["SPY", "QQQ"], "type": "stocks_trades"}'
\`\`\`

**Method 2: Direct CLI**
\`\`\`bash
cd /Users/zstoc/GitHub/quant-engine/python
python data_ingestor.py --date 2024-11-20 --type options_trades --tickers SPY,QQQ
python data_ingestor.py --start 2024-11-01 --end 2024-11-20 --type stocks_trades
python data_ingestor.py --inventory  # Check what's downloaded
\`\`\`

**Data Types:**
- \`stocks_trades\` - Equity trade ticks
- \`stocks_quotes\` - Equity NBBO quotes
- \`options_trades\` - Options trade ticks
- \`options_quotes\` - Options quotes

---

#### "How do I run a backtest?"

**Via Bridge (localhost:8080):**
The bridge_server.py must be running. It accepts POST requests to \`/run-backtest\` with strategy parameters.

\`\`\`bash
# Start the bridge (if not running)
cd /Users/zstoc/rotation-engine
python server.py

# Bridge listens on http://localhost:8080
# Backtests are triggered by the app or curl
\`\`\`

---

#### "How do I check the Night Shift (Research Daemon)?"

**Check if running:**
\`\`\`bash
ps aux | grep research_daemon
\`\`\`

**Check Supabase tables:**
- \`swarm_jobs\` - Pending/active evolution tasks
- \`strategy_genome\` - All strategies and their fitness scores
- \`morning_briefings\` - Daily briefing cards

**Start the daemon:**
\`\`\`bash
cd /Users/zstoc/GitHub/quant-engine/python
python research_daemon.py              # Normal mode (runs forever)
python research_daemon.py --run-once   # Test mode (one cycle)
\`\`\`

---

#### "How do I check Shadow Trading status?"

**Database tables:**
- \`shadow_positions\` - Active paper positions
- \`shadow_trades\` - Executed paper trades
- \`graduation_tracker\` - Strategies approaching production readiness

**Graduation criteria:** 50 trades with Sharpe > 1.5

---

### Troubleshooting Playbook

#### Data Issues

**Problem:** \`fetch_market_data\` fails or returns empty
**Diagnosis:**
1. Check if VelocityData drive is mounted: \`ls /Volumes/VelocityData\`
2. Verify DATA_DIR env var: \`echo $DATA_DIR\`
3. Check if Parquet files exist for that date: \`ls /Volumes/VelocityData/market_data/options_trades/SPY/2024/\`
4. Verify Massive.com credentials: \`echo $AWS_ACCESS_KEY_ID\`

**Fix:** If data missing, run ingestor for that date range.

---

**Problem:** Backtest returns 0 trades or nonsense results
**Diagnosis:**
1. Check if Parquet files exist for the date range
2. Verify the symbol has data (not all symbols covered)
3. Check strike/expiration ranges in strategy config

**Fix:** Run \`data_ingestor.py --inventory\` to see available data.

---

#### Bridge Issues

**Problem:** Bridge not responding (connection refused on 8080)
**Diagnosis:**
\`\`\`bash
lsof -i :8080  # Check what's on port 8080
ps aux | grep bridge_server
\`\`\`

**Fix:** Restart the bridge:
\`\`\`bash
cd /Users/zstoc/rotation-engine
python server.py
\`\`\`

---

**Problem:** Backtest hangs or times out
**Diagnosis:** Check bridge terminal for error messages.

**Fix:** Kill and restart bridge_server.py. The bridge has a 5-minute timeout per backtest.

---

#### Night Shift Issues

**Problem:** Swarm jobs stuck in "pending"
**Diagnosis:** Check \`swarm_jobs\` table for error messages.

**Fix:**
1. Check if research_daemon.py is running
2. Verify Supabase connection (check SUPABASE_URL and SUPABASE_KEY)
3. Restart daemon: \`python research_daemon.py\`

---

**Problem:** Mutations failing AST validation
**Diagnosis:** Check daemon logs for syntax errors.

**Fix:** This is expected - LLMs sometimes produce invalid Python. The harvester filters these out automatically. If >90% are failing, check the mutation prompts.

---

#### Environment Variables Required

\`\`\`bash
# Massive.com Flatfiles (S3-compatible)
export AWS_ACCESS_KEY_ID="your_access_key"
export AWS_SECRET_ACCESS_KEY="your_secret_key"
export MASSIVE_ENDPOINT="https://files.massive.com"
export MASSIVE_BUCKET="flatfiles"

# Polygon WebSocket (real-time)
export POLYGON_API_KEY="your_polygon_key"

# Local storage
export DATA_DIR="/Volumes/VelocityData/market_data"

# Supabase
export SUPABASE_URL="your_supabase_url"
export SUPABASE_KEY="your_supabase_service_role_key"
\`\`\`

---

### Hardware Constraints

**This Rig:**
- **CPU:** Apple M4 Pro (12 cores)
- **GPU:** Apple M4 Pro (20 cores) - Metal/MLX compatible
- **RAM:** 48GB unified memory (shared CPU/GPU)
- **Storage:** 8TB VelocityData external SSD
- **Network:** Home broadband (not datacenter)

**Implications:**
- Can run 4-6 parallel backtests comfortably
- CAN run GPU-accelerated ML via Metal/MLX (PyTorch MPS backend)
- Cannot use CUDA libraries (no NVIDIA GPU)
- Cannot store full market history (selective coverage only)
- Cannot compete on latency (this is research, not HFT)
- Large data downloads should be scheduled overnight

**GPU Capabilities (MLX/Metal):**
- Local LLM inference (llama.cpp, MLX)
- PyTorch with MPS backend (\`device="mps"\`)
- Vectorized numpy/polars operations
- Small-to-medium neural network training

**Do NOT suggest:**
- CUDA-specific libraries (use Metal equivalents)
- Real-time HFT strategies
- Storing 50TB of tick data
- Running 100 parallel backtests
`;
