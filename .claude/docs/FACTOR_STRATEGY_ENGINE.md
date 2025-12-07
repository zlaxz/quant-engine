# Factor Strategy Engine - Architecture Design

**Last Updated:** 2025-12-06
**Status:** Design Complete, Implementation Pending

## Executive Summary

You're solving the fundamental flaw in the current regime-based approach: **regime labels describe the past, but don't predict the future**. The Physics Engine discovered factor relationships - now we need a system that converts those into tradeable strategies and validates them across time.

---

## Core Design Philosophy

### Regime Flaw We're Fixing
```
BAD (Current):
  Regime 3 days → train on some Regime 3 → test on other Regime 3
  Problem: Only 1 sample of COVID, 1 sample of meme mania, etc.

GOOD (Factor-Based):
  Factor conditions → train 2020-2023 → test 2024
  Cross-validate: leave-one-year-out (5 folds)
  Only keep strategies that survive ALL years
```

### What Success Looks Like
- **Input**: `ret_range_50 * (sign(xle_relative_strength) - 0.9149) > threshold`
- **Output**: "When this factor crosses X, sell SPY 30-delta straddle, exit when Y"
- **Validation**: Works in 2020 (COVID), 2021 (meme), 2022 (tightening), 2023 (rally), 2024 (AI boom)

---

## Three-Set Validation Framework (Updated)

**CRITICAL**: We now use interleaved sampling instead of year-based splits:

| Set | Source | Days | Purpose |
|-----|--------|------|---------|
| Discovery | Odd months 2020-2024 | ~675 | Math Swarm finds equations |
| Validation | Even months 2020-2024 | ~600 | Threshold tuning, confirm signal |
| Walk-Forward | All of 2025 | 245 | Final deployment simulation |

**5-day embargo** between discovery and validation months prevents autocorrelation leakage.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FACTOR STRATEGY ENGINE                    │
└─────────────────────────────────────────────────────────────┘

INPUT LAYER (existing):
├─ Math Swarm Equations (factor formulas)
├─ SPY_master_features.parquet (daily factor values)
└─ Structure DNA (option strategy definitions)

FACTOR PROCESSING:
├─ FactorComputer: Evaluate equation on feature data
├─ SignalGenerator: Threshold crossing → trade signals
└─ ConditionMapper: Factor ranges → strategy selection

EXECUTION LAYER:
├─ StrategyExecutor: Convert signals → Structure DNA → trades
├─ PrecisionBacktester: Realistic execution (existing)
└─ PortfolioManager: Position sizing, multi-strategy allocation

VALIDATION LAYER:
├─ CrossValidator: Interleaved month splits (NOT year-based)
├─ PerformanceAggregator: Per-set + overall metrics
└─ SurvivalFilter: Only promote strategies that survive all sets

OUTPUT:
└─ FactorPlaybook: Validated factor → strategy mappings
```

---

## Module Design

### 1. FactorComputer (`engine/factors/factor_computer.py`)

**Purpose**: Evaluate Math Swarm equations on feature data

```python
class FactorComputer:
    """
    Convert symbolic equations into executable factor signals.
    """

    def __init__(self, equations: List[Equation], feature_data: pd.DataFrame):
        self.equations = equations  # From Math Swarm results
        self.features = feature_data  # SPY_master_features.parquet
        self.feature_mapping = self._build_mapping()

    def compute_factor(self, equation_id: str) -> pd.Series:
        """
        Evaluate equation on feature data.

        Example:
          equation: "ret_range_50 * (sign(xle_relative_strength) - 0.9149)"
          returns: Daily factor values (1594 rows)
        """

    def compute_all_factors(self) -> pd.DataFrame:
        """
        Compute all Math Swarm equations.
        Returns: DataFrame with columns [date, factor_0, factor_1, ...]
        """
```

**Key Challenges**:
- Feature name mapping (equation uses `ret_range_50`, data has `morphology_ret_range_50`)
- Handling missing values (forward-fill? NaN means no signal?)
- Normalization (z-score factors for threshold consistency?)

---

### 2. SignalGenerator (`engine/factors/signal_generator.py`)

**Purpose**: Convert continuous factor values into discrete trade signals

```python
class SignalGenerator:
    """
    Map factor values to entry/exit signals via thresholds.
    """

    def __init__(self, factor_data: pd.DataFrame):
        self.factors = factor_data

    def generate_signals(
        self,
        factor_name: str,
        entry_threshold: float,
        exit_threshold: float,
        direction: Literal["above", "below"]
    ) -> pd.DataFrame:
        """
        Generate trade signals.

        Example:
          factor_name = "factor_0"
          entry_threshold = 1.5  # Enter when factor > 1.5
          exit_threshold = 0.5   # Exit when factor < 0.5
          direction = "above"

        Returns:
          DataFrame with columns [date, signal]
          signal: 1 (enter), 0 (hold), -1 (exit)
        """

    def optimize_thresholds(
        self,
        factor_name: str,
        train_dates: pd.DatetimeIndex,
        objective: Literal["sharpe", "return", "drawdown"]
    ) -> Dict[str, float]:
        """
        Theory-driven threshold optimization (NOT grid search).
        Uses statistical significance testing on training data only.
        """
```

**Key Design**:
- **Entry logic**: Factor crosses threshold (with cooldown to prevent whipsaws)
- **Exit logic**: Factor mean-reverts OR time-based stop (max holding period)
- **Threshold optimization**: Theory-driven (statistical significance), NOT grid search

---

### 3. StrategyMapper (`engine/factors/strategy_mapper.py`)

**Purpose**: Map factor conditions to option strategy types

```python
class StrategyMapper:
    """
    Decide WHAT to trade based on factor regime.

    Philosophy:
      - High VRP + low GEX → sell premium (straddles)
      - High skew → buy OTM puts (crash protection)
      - Rising vol → buy straddles (long gamma)
    """

    def __init__(self, factor_data: pd.DataFrame):
        self.factors = factor_data

    def select_strategy(
        self,
        signal_row: pd.Series  # Single row of factors at signal time
    ) -> StructureDNA:
        """
        Map current factor values to option strategy.
        """

    def build_strategy_rules(self) -> List[StrategyRule]:
        """
        Define the factor → strategy mapping.
        """
```

---

### 4. FactorBacktester (`engine/factors/factor_backtester.py`)

**Purpose**: Orchestrate factor → signal → execution → validation

```python
class FactorBacktester:
    """
    End-to-end backtesting with three-set validation.
    """

    def __init__(
        self,
        factor_computer: FactorComputer,
        signal_generator: SignalGenerator,
        strategy_mapper: StrategyMapper,
        precision_backtester: PrecisionBacktester  # Existing
    ):
        pass

    def run_single_strategy(
        self,
        factor_name: str,
        entry_threshold: float,
        exit_threshold: float,
        discovery_dates: pd.DatetimeIndex,
        validation_dates: pd.DatetimeIndex,
        walkforward_dates: pd.DatetimeIndex
    ) -> BacktestResult:
        """
        Run one factor strategy on three-set split.
        """

    def three_set_validate(
        self,
        factor_name: str
    ) -> ValidationResult:
        """
        Run strategy across all three sets.

        Discovery (odd months 2020-2024): Find thresholds
        Validation (even months 2020-2024): Confirm signal
        Walk-Forward (2025): Final test
        """
```

---

### 5. FactorPlaybookBuilder (`engine/factors/playbook_builder.py`)

**Purpose**: Aggregate validated strategies into executable playbook

```python
class FactorPlaybookBuilder:
    """
    Build production playbook from validated strategies.
    """

    def filter_survivors(self, min_sharpe: float = 0.5) -> List[Strategy]:
        """
        Keep only strategies that:
          1. Positive Sharpe in ALL three sets
          2. Average Sharpe > min_sharpe
          3. Max drawdown < 30%
        """

    def build_playbook(self) -> FactorPlaybook:
        """
        Generate validated factor → strategy mappings.
        """
```

---

## Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│ STEP 1: FACTOR COMPUTATION                                   │
└──────────────────────────────────────────────────────────────┘
Math Swarm Equations
  + SPY_master_features.parquet
  → FactorComputer.compute_all_factors()
  → factor_values.parquet [date, factor_0, factor_1, ...]

┌──────────────────────────────────────────────────────────────┐
│ STEP 2: THRESHOLD DISCOVERY (Discovery Set Only)             │
└──────────────────────────────────────────────────────────────┘
Odd months 2020-2024:
  → SignalGenerator.optimize_thresholds() [theory-driven]
  → Entry/exit thresholds

┌──────────────────────────────────────────────────────────────┐
│ STEP 3: SIGNAL GENERATION                                    │
└──────────────────────────────────────────────────────────────┘
factor_values + thresholds
  → SignalGenerator.generate_signals()
  → signals.parquet [date, signal]

┌──────────────────────────────────────────────────────────────┐
│ STEP 4: STRATEGY EXECUTION                                   │
└──────────────────────────────────────────────────────────────┘
signals + current factors
  → StrategyMapper.select_strategy()
  → Structure DNA for this trade
  → PrecisionBacktester.backtest()
  → BacktestResult (PnL, Sharpe, etc.)

┌──────────────────────────────────────────────────────────────┐
│ STEP 5: THREE-SET VALIDATION                                 │
└──────────────────────────────────────────────────────────────┘
Discovery → Validation → Walk-Forward
  → Aggregate results
  → Filter survivors
  → Build final playbook
```

---

## Red Team Fixes Required

| Issue | Fix | Module |
|-------|-----|--------|
| Temporal contamination | Use Discovery set only for equation finding | FactorComputer |
| Grid search overfitting | Theory-driven thresholds (statistical significance) | SignalGenerator |
| Event risk | Block entries 2 days before FOMC/CPI | SignalGenerator |
| Position sizing | Normalize by notional, not contract count | StrategyMapper |
| Overnight gaps | T+1 execution with gap modeling | PrecisionBacktester |
| Crisis spreads | Exponential widening, cap at 15x not 3x | PrecisionBacktester |

---

## Implementation Order

### Phase 1: Core Factor Pipeline
1. **FactorComputer** - Evaluate equations on feature data
2. **SignalGenerator** - Threshold-based signal generation
3. **Simple StrategyMapper** - One factor → one strategy type
4. **FactorBacktester** - Single train/test split

### Phase 2: Three-Set Validation
5. **Implement interleaved month splitting**
6. **5-day embargo between sets**
7. **Theory-driven threshold optimization**

### Phase 3: Production Hardening
8. **Event horizon filter** (FOMC/CPI blocking)
9. **Position sizing normalization**
10. **Overnight gap modeling**
11. **Crisis spread model**

### Phase 4: Short-Term Strategies
12. **1-3 day hold period strategies**
13. **Intraday pipeline** (eventual goal)

---

## File Locations

| Module | Path |
|--------|------|
| FactorComputer | `engine/factors/factor_computer.py` |
| SignalGenerator | `engine/factors/signal_generator.py` |
| StrategyMapper | `engine/factors/strategy_mapper.py` |
| FactorBacktester | `engine/factors/factor_backtester.py` |
| PlaybookBuilder | `engine/factors/playbook_builder.py` |
| Run Script | `scripts/run_factor_backtest.py` |

---

## Key Design Decisions

### 1. Threshold Optimization: Theory-Driven (NOT Grid Search)
- Use statistical significance testing
- No parameter sweeps that overfit to training data

### 2. Factor Normalization: Z-Score
- `(factor - mean) / std` using training period stats
- Prevents lookahead bias

### 3. Signal Filtering: Hysteresis + Cooldown
- Entry and exit thresholds differ
- 5-day cooldown after exit

### 4. Position Sizing: Notional-Based
- Normalize by dollar notional, not contract count
- Prevents concentration in cheap options

### 5. Exit Logic: Hybrid
- Primary: Factor threshold crossing
- Fallback: Max hold period + stop-loss

---

## Expected Output: Factor Playbook

```json
{
  "playbook_version": "1.0",
  "generated_at": "2025-12-06",
  "validation_framework": "three_set_interleaved",
  "strategies": [
    {
      "strategy_id": "strat_001",
      "factor": "ret_range_50 * sign(xle_relative_strength)",
      "entry_threshold": 1.5,
      "exit_threshold": 0.5,
      "direction": "above",
      "structure": {
        "name": "short_straddle_30d",
        "legs": [...]
      },
      "validation": {
        "discovery_sharpe": 1.1,
        "validation_sharpe": 0.9,
        "walkforward_sharpe": 1.0,
        "survival": true
      }
    }
  ]
}
```
