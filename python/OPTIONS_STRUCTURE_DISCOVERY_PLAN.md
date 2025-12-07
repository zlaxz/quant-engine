# Options Structure Discovery Engine - Implementation Plan

**Date**: 2025-12-03
**Status**: Planning Phase
**Goal**: DISCOVER optimal options structures from data, not pre-program them

---

## The Problem

The current system has 6 hand-designed convexity profiles (`Profile1LongDatedGamma`, etc.) with hardcoded assumptions:
- Profile 1: "Long ATM straddle, 60-90 DTE" ← **This is a GUESS, not a discovery**
- Profile 2: "Short-dated gamma, 7-14 DTE" ← **Also a guess**

We have 394M rows of options data and should be using it to DISCOVER:
1. Which structures have edge (straddles? spreads? condors?)
2. Which parameters work (DTE? delta? width?)
3. In which conditions (regimes)

---

## The Vision

```
STRUCTURE SPACE × PARAMETER SPACE × REGIME SPACE → BACKTEST → DISCOVER

Structure Types:    DTE Range:        Delta/Strike:     Regimes:
- Long Call        - 7-14 DTE        - ATM (50Δ)       - Regime 0
- Long Put         - 14-30 DTE       - 25Δ OTM         - Regime 1
- Long Straddle    - 30-60 DTE       - 10Δ OTM         - Regime 2
- Long Strangle    - 60-90 DTE       - 5Δ OTM          - Regime 3
- Call Spread      - 90-120 DTE
- Put Spread
- Iron Condor
- Iron Butterfly
- Calendar Spread
- Diagonal Spread
```

---

## Architecture Overview

### New Files to Create

```
python/engine/discovery/
├── structure_dna.py      # Parameterized options structure definitions
├── structure_backtester.py   # Backtest any structure against historical data
├── structure_miner.py    # Genetic algorithm to discover optimal structures
└── options_loader.py     # Efficient loading of 394M options rows

python/scripts/
└── run_structure_discovery.py    # Main discovery script
```

### Data Flow

```
1. Options Data (394M rows) → Load by date range
                                    ↓
2. Structure DNA → Define all possible structures as parameterized templates
                                    ↓
3. Structure Miner (Genetic Algorithm)
   ├── Population: Random structure + parameter combinations
   ├── Fitness: Sharpe ratio from backtest
   ├── Selection: Keep top 20%
   ├── Crossover: Combine parameters from parents
   ├── Mutation: Tweak DTE, delta, width, etc.
   └── Converge: Find structures with actual edge
                                    ↓
4. Output: Discovered "DNA" profiles with data-driven parameters
```

---

## Phase 1: Structure DNA (`structure_dna.py`)

Define all options structures as parameterized templates that can be evolved.

### Structure Types (Enum)

```python
class StructureType(Enum):
    LONG_CALL = "long_call"
    LONG_PUT = "long_put"
    SHORT_CALL = "short_call"
    SHORT_PUT = "short_put"
    LONG_STRADDLE = "long_straddle"
    SHORT_STRADDLE = "short_straddle"
    LONG_STRANGLE = "long_strangle"
    SHORT_STRANGLE = "short_strangle"
    CALL_DEBIT_SPREAD = "call_debit_spread"    # Bull call spread
    CALL_CREDIT_SPREAD = "call_credit_spread"  # Bear call spread
    PUT_DEBIT_SPREAD = "put_debit_spread"      # Bear put spread
    PUT_CREDIT_SPREAD = "put_credit_spread"    # Bull put spread
    IRON_CONDOR = "iron_condor"
    IRON_BUTTERFLY = "iron_butterfly"
    CALENDAR_CALL = "calendar_call"
    CALENDAR_PUT = "calendar_put"
    DIAGONAL_CALL = "diagonal_call"
    DIAGONAL_PUT = "diagonal_put"
```

### Structure DNA (Dataclass)

```python
@dataclass
class StructureDNA:
    """A single options structure with all parameters."""
    structure_type: StructureType

    # DTE parameters
    front_dte_min: int = 7
    front_dte_max: int = 45
    back_dte_min: int = 45   # For calendars/diagonals
    back_dte_max: int = 90

    # Strike selection
    long_strike_delta: float = 0.50   # 0.50 = ATM, 0.25 = 25Δ OTM
    short_strike_delta: float = 0.30  # For spreads

    # Spread width (for verticals, condors)
    spread_width_strikes: int = 5     # 5 strike wide

    # Entry conditions
    entry_regime: list = None         # Which regimes to trade in
    min_iv_percentile: float = 0.0    # Min IV percentile (0-100)
    max_iv_percentile: float = 100.0  # Max IV percentile

    # Exit conditions
    profit_target_pct: float = 0.50   # Take profit at 50%
    stop_loss_pct: float = 1.00       # Stop at 100% loss (2x debit)
    dte_exit: int = 7                 # Close at 7 DTE

    # Position sizing
    max_position_pct: float = 0.05    # 5% of portfolio per trade
```

---

## Phase 2: Options Loader (`options_loader.py`)

Efficient loading of the massive options dataset.

### Key Functions

```python
def load_options_for_date(date: str, symbol: str = "SPY") -> pd.DataFrame:
    """Load options for a single date, filtered to one symbol."""

def load_options_range(start: str, end: str, symbol: str = "SPY") -> pd.DataFrame:
    """Load options for date range (lazy loading, chunked)."""

def get_chain_snapshot(date: str, symbol: str, spot: float) -> pd.DataFrame:
    """Get clean options chain for a single date with Greeks calculated."""

def find_contract(chain: pd.DataFrame, option_type: str,
                  target_delta: float, target_dte: int) -> dict:
    """Find closest contract matching criteria."""
```

### Performance Considerations

- Use PyArrow for fast parquet reading
- Filter to single symbol early (reduce data 100x)
- Cache chains in memory for backtest speed
- Use DTE/delta lookup tables

---

## Phase 3: Structure Backtester (`structure_backtester.py`)

Backtest any structure against historical options data.

### Key Functions

```python
def backtest_structure(
    dna: StructureDNA,
    options_data: pd.DataFrame,
    spot_data: pd.DataFrame,
    regime_data: pd.DataFrame,
    start_date: str,
    end_date: str
) -> BacktestResult:
    """
    Backtest a single structure configuration.

    Returns:
        BacktestResult with:
        - total_return
        - sharpe_ratio
        - max_drawdown
        - win_rate
        - profit_factor
        - n_trades
        - trade_log
    """
```

### Backtest Logic

1. For each day in range:
   - Check entry conditions (regime, IV percentile)
   - If entry signal, find contracts matching DNA specs
   - Calculate entry cost (bid/ask realistic)
   - Track position P&L daily
   - Check exit conditions (profit target, stop loss, DTE)
   - Exit at worst available price (conservative)

2. Aggregate results:
   - Compound returns
   - Calculate Sharpe on trade returns
   - Track max drawdown

---

## Phase 4: Structure Miner (`structure_miner.py`)

Genetic algorithm to discover optimal structures - the core innovation.

### Population Representation

Each "agent" in the population is a `StructureDNA` instance with random parameters.

### Fitness Function

```python
def fitness(dna: StructureDNA, options_data, spot_data, regime_data) -> float:
    """
    Fitness = Sharpe Ratio from out-of-sample backtest.

    We use walk-forward validation:
    - Train on first 70% of data
    - Test on last 30%
    - Only test Sharpe counts for fitness
    """
    result = backtest_structure(dna, options_data, spot_data, regime_data, ...)
    return result.sharpe_ratio
```

### Genetic Operators

```python
def crossover(parent1: StructureDNA, parent2: StructureDNA) -> StructureDNA:
    """Combine parameters from two parents."""
    # Take structure_type from random parent
    # Average numeric parameters
    # Combine regime lists

def mutate(dna: StructureDNA, mutation_rate: float = 0.1) -> StructureDNA:
    """Randomly tweak parameters."""
    # Small chance to change structure_type
    # Gaussian noise on DTE ranges
    # Adjust delta targets
    # Add/remove regimes
```

### Evolution Loop

```python
def mine_structures(
    options_data: pd.DataFrame,
    spot_data: pd.DataFrame,
    regime_data: pd.DataFrame,
    population_size: int = 100,
    n_generations: int = 50,
    n_workers: int = 16
) -> List[StructureDNA]:
    """
    Run genetic algorithm to discover best structures.

    1. Initialize random population
    2. For each generation:
       a. Evaluate fitness in parallel
       b. Select top 20%
       c. Crossover to create children
       d. Mutate children
       e. Form new population
    3. Return best structures
    """
```

---

## Phase 5: Discovery Script (`run_structure_discovery.py`)

Main entry point that ties it all together.

### Usage

```bash
python scripts/run_structure_discovery.py \
    --symbol SPY \
    --start 2020-01-01 \
    --end 2024-12-31 \
    --regime-assignments /path/to/regime_assignments.parquet \
    --population 100 \
    --generations 50 \
    --output /path/to/discovered_structures.json
```

### Output Format

```json
{
  "timestamp": "2025-12-03T...",
  "symbol": "SPY",
  "n_generations": 50,
  "population_size": 100,
  "discovered_structures": [
    {
      "rank": 1,
      "structure_type": "long_strangle",
      "front_dte_min": 21,
      "front_dte_max": 35,
      "long_strike_delta": 0.30,
      "short_strike_delta": 0.30,
      "entry_regime": [0, 2],
      "profit_target_pct": 0.75,
      "stop_loss_pct": 0.50,
      "backtest_sharpe": 1.87,
      "backtest_return_pct": 234.5,
      "win_rate_pct": 62.3,
      "n_trades": 145
    },
    ...
  ]
}
```

---

## Data Requirements

### Options Data Schema (expected from `/Volumes/VelocityData/`)

Need to verify actual schema, but expecting:
- `date`: Trade date
- `symbol`: Underlying ticker
- `option_symbol`: Full OCC symbol
- `strike`: Strike price
- `expiration_date`: Expiry
- `option_type`: C or P
- `open`, `high`, `low`, `close`: OHLC
- `volume`: Trading volume
- `open_interest`: OI
- `bid`, `ask`: Quotes (if available)
- `implied_volatility`: IV (if available)
- `delta`, `gamma`, `theta`, `vega`: Greeks (if available, else calculate)

### Spot Data (from existing MTF features)

- Daily OHLC for SPY
- Already have this in `/Volumes/VelocityData/velocity_om/features/SPY/`

### Regime Data (from Jury Swarm)

- Already have `/Volumes/VelocityData/velocity_om/features/SPY/regime_assignments.parquet`

---

## Implementation Order

1. **First**: `options_loader.py` - Understand and load the data
2. **Second**: `structure_dna.py` - Define structure space
3. **Third**: `structure_backtester.py` - Backtest single structures
4. **Fourth**: `structure_miner.py` - Genetic algorithm
5. **Fifth**: `run_structure_discovery.py` - Tie together

---

## Performance Estimates

- ~1,200 trading days (2020-2024)
- ~50 contracts per chain snapshot (filtered)
- 100 population × 50 generations = 5,000 backtests
- Each backtest = ~1,200 days of simulation
- With parallelization (16 workers): ~20-30 minutes per discovery run

---

## Success Criteria

1. **Discover non-trivial structures** - Not just "buy calls in uptrends"
2. **Out-of-sample Sharpe > 1.0** - Real edge, not curve fit
3. **Reproducible** - Same data → same discoveries
4. **Actionable** - Outputs can be traded

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Overfitting to history | Walk-forward validation, out-of-sample testing |
| Transaction costs ignored | Include bid/ask spread, slippage estimates |
| Look-ahead bias | Strict date filtering in backtester |
| Survivorship bias | Use full option chains, not just traded |
| Computational cost | Aggressive parallelization, caching |

---

## Next Steps (After Approval)

1. [ ] Read options parquet schema to confirm columns
2. [ ] Build `options_loader.py` with basic loading
3. [ ] Build `structure_dna.py` with full structure types
4. [ ] Build `structure_backtester.py` with realistic execution
5. [ ] Build `structure_miner.py` with genetic algorithm
6. [ ] Create `run_structure_discovery.py` and run first discovery
7. [ ] Analyze results, iterate on fitness function

---

**This is DATA-DRIVEN discovery, not hand-coded guesses.**
