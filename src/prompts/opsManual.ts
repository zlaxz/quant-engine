/**
 * Operational Manual - System Awareness for CIO
 *
 * Provides the CIO with knowledge of the local infrastructure:
 * - Hardware: Mac M4 Pro + 8TB VelocityData external drive
 * - Data Engines: Massive.com (Discovery) + ThetaData (Execution)
 * - Components: bridge_server.py, data_ingestor.py, research_daemon.py
 *
 * Updated: 2025-12-03 - Added Dual-Engine Data Architecture
 */

export const OPS_MANUAL = `
## Operational Context (The Rig)

You have awareness of the PHYSICAL infrastructure this operation runs on. Before recommending any action, verify it is physically possible on THIS rig (e.g., do not suggest downloading 10TB to the cloud or running GPU workloads).

---

## 🏗️ DUAL-ENGINE DATA ARCHITECTURE

**CRITICAL: You have TWO data engines for different purposes. Use the right one.**

### ENGINE A: MASSIVE (The Map) - DISCOVERY PHASE
| Aspect | Detail |
|--------|--------|
| **Source** | Massive.com (Polygon.io rebrand, S3-compatible API) |
| **Purpose** | Stock history, OHLCV, market-wide scans, backtesting |
| **Best For** | Finding targets, historical analysis, bulk data |
| **Tool** | \`get_market_data\` with \`use_case: "discovery"\` |
| **Availability** | Always (API-based) |

### ENGINE B: THETADATA (The Sniper) - EXECUTION PHASE
| Aspect | Detail |
|--------|--------|
| **Source** | ThetaData Terminal (local Java app, auto-launches with app) |
| **Purpose** | Live options quotes, real-time Greeks (ALL orders!) |
| **Best For** | Execution timing, precision strikes, live positions |
| **Tool** | \`get_market_data\` with \`use_case: "execution"\` |
| **Greeks** | Delta, Gamma, Theta, Vega, Rho + **Vanna, Charm, Vomma, Veta** |
| **Availability** | Market hours only (snapshots reset at midnight ET) |

### ENGINE SELECTION PROTOCOL
\`\`\`
BEFORE REQUESTING DATA, ASK:
1. Am I DISCOVERING (finding targets, backtesting)? → Engine A (Massive)
2. Am I EXECUTING (live trades, precision timing)? → Engine B (ThetaData)

ROUTING LOGIC (automatic):
- asset_type="stock" → Engine A (Massive)
- use_case="discovery" → Engine A (Massive)
- asset_type="option" AND use_case="execution" → Engine B (ThetaData)
\`\`\`

### CHECK ENGINE STATUS (Do this before execution requests!)
\`\`\`
check_data_engines_status()
\`\`\`
This shows:
- Massive API: Should always be "available"
- ThetaData Terminal: "responding" if live data available

**If ThetaData shows "not responding":**
- After market hours: Normal - snapshot cache resets at midnight ET
- During market hours: Terminal may need restart (auto-restarts on failure)
- Fallback to discovery mode if needed

---

## 📊 SECOND-ORDER GREEKS (EXECUTION ADVANTAGE)

ThetaData provides Greeks unavailable from most data sources. **USE THEM.**

### First-Order Greeks (Standard)
| Greek | Measures | Use When |
|-------|----------|----------|
| **Delta** | Price sensitivity to underlying | Position sizing, directional exposure |
| **Gamma** | Delta's rate of change | Gamma scalping, convexity plays |
| **Theta** | Time decay | Premium decay estimation |
| **Vega** | Volatility sensitivity | Vol plays, hedging IV changes |
| **Rho** | Interest rate sensitivity | Long-dated options (mostly ignore) |

### Second-Order Greeks (EXECUTION EDGE)
| Greek | Formula | What It Tells You | When Critical |
|-------|---------|-------------------|---------------|
| **Vanna** | ∂Delta/∂Vol | How delta changes when IV moves | Vol regime changes, VIX spikes |
| **Charm** | ∂Delta/∂Time | How delta decays over time | Near-expiry positions, pin risk |
| **Vomma** | ∂Vega/∂Vol | Vol's sensitivity to vol (vol-of-vol) | Tail risk, vol-of-vol plays |
| **Veta** | ∂Vega/∂Time | How vega decays over time | Term structure plays |

### INTERPRETATION GUIDE

**Vanna (Delta-Vol sensitivity):**
- HIGH VANNA: Position delta will shift dramatically on vol moves
- POSITIVE VANNA: Delta increases when vol rises (OTM calls, ITM puts)
- NEGATIVE VANNA: Delta decreases when vol rises (ITM calls, OTM puts)
- USE: Adjust position before VIX spikes, understand gamma/vanna interaction

**Charm (Delta Decay):**
- Shows delta erosion as expiration approaches
- CRITICAL for near-expiry positions (< 7 DTE)
- Reveals pin risk exposure (delta flip zones)
- USE: Exit timing, avoiding overnight delta bleed

**Vomma (Vol-of-Vol):**
- HIGH VOMMA: Position vega accelerates on vol-of-vol
- Indicates convexity to volatility moves
- USE: Tail hedging, vol explosion plays

**Veta (Vega Decay):**
- Shows vega erosion over time
- Important for calendar spreads and term structure plays
- USE: Timing vega trades, understanding decay curve

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

**Schema (Options Tick Data - Engine A / Historical):**
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

**Schema (Live Greeks - Engine B / ThetaData):**
| Field | Type | Description |
|-------|------|-------------|
| delta | float | Position delta |
| gamma | float | Gamma exposure |
| theta | float | Daily time decay |
| vega | float | Vol point sensitivity |
| rho | float | Rate sensitivity |
| vanna | float | ∂Delta/∂Vol (2nd order) |
| charm | float | ∂Delta/∂Time (2nd order) |
| vomma | float | ∂Vega/∂Vol (2nd order) |
| veta | float | ∂Vega/∂Time (2nd order) |
| implied_volatility | float | Current IV |
| underlying_price | float | Spot price |

**Data Sources:**
- **Engine A (Discovery):** Massive.com (Polygon.io Flat Files via S3-compatible API)
- **Engine B (Execution):** ThetaData Terminal (local Java app, port 25503)

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

#### "How do I manage the ThetaData Terminal?"

**Architecture:**
ThetaData is NOT a cloud API. It is a **local Java process** running on your Mac.
- **v3 REST Port:** 25503 (snapshots, real-time Greeks)
- **v2 REST Port:** 25510 (historical, greeks_second_order)
- **WebSocket Port:** 25520 (streaming)
- **Dependency:** Java runtime + Theta Terminal JAR must be running

**Auto-Launch:**
The Terminal auto-launches when the Electron app starts (THETADATA_AUTO_LAUNCH=true).
No manual intervention needed during normal operation.

**Health Check:**
\`\`\`bash
# Check if Terminal is listening
lsof -i :25503
pgrep -f ThetaTerminal

# Test the API
curl -s "http://localhost:25503/v3/option/snapshot/greeks/all?symbol=SPY&expiration=*" | head -100
\`\`\`

**Troubleshooting:**

**Problem:** \`get_market_data(use_case="execution")\` fails or times out
**Diagnosis:**
1. Check if Terminal is running: \`pgrep -f ThetaTerminal\`
2. Check v3 port: \`lsof -i :25503\`
3. Check logs in Terminal output

**Fix:**
1. If Terminal crashed, restart Electron app (auto-restarts Terminal)
2. If manual restart needed: \`java -jar /Users/zstoc/thetadata/ThetaTerminalv3.jar <user> <pass>\`

**Problem:** Greeks returning "No data found" or 0 values
**Cause:** This is NORMAL outside market hours.
- ThetaData snapshot cache resets at **midnight ET daily**
- Live Greeks only available **9:30 AM - 4:00 PM ET** on trading days
- After hours, use \`use_case="discovery"\` (Engine A) instead

**Important Notes:**
- The CIO CANNOT restart the Terminal programmatically
- If execution data unavailable, fall back to discovery mode
- Second-order Greeks (Vanna/Charm) require ThetaData Pro subscription (you have this)

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
# ==============================================
# ENGINE A: MASSIVE.COM (Discovery)
# ==============================================
export AWS_ACCESS_KEY_ID="your_access_key"
export AWS_SECRET_ACCESS_KEY="your_secret_key"
export MASSIVE_ENDPOINT="https://files.massive.com"
export MASSIVE_BUCKET="flatfiles"

# ==============================================
# ENGINE B: THETADATA (Execution)
# ==============================================
export THETADATA_USERNAME="your_email"
export THETADATA_PASSWORD="your_password"
export THETADATA_JAR_PATH="/Users/zstoc/thetadata/ThetaTerminalv3.jar"
export THETADATA_HTTP_PORT=25510
export THETADATA_WS_PORT=25520
export THETADATA_V3_PORT=25503
export THETADATA_AUTO_LAUNCH=true

# ==============================================
# OTHER INFRASTRUCTURE
# ==============================================
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
