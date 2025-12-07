# StrategyMapper Integration Guide

Step-by-step guide for integrating StrategyMapper with your backtesting system.

---

## Integration Flow

```
Factor Features → StrategyMapper → StructureDNA → Trade Simulator → P&L Attribution
       ↓               ↓                ↓              ↓                 ↓
  CSV/Parquet    Rule Engine    Structure Def   Execution Model    Greeks P&L
```

---

## Step 1: Prepare Factor Data

### Generate Features

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Run physics engine to generate factor features
python3 scripts/main_harvest.py \
    --symbol SPY \
    --start 2020-01-01 \
    --end 2024-12-01
```

**Output**: `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet`

### Required Factor Columns

The default rules expect these columns:
- `ret_range_1m`: Realized volatility measure (1-month return range)
- `xle_strength_1m`: Energy sector correlation strength
- `close`: Current closing price (for position sizing)

**Add custom factors** by modifying `engine/features/` modules.

---

## Step 2: Initialize StrategyMapper

```python
from engine.factors import StrategyMapper
import pandas as pd

# Load factor data
factors = pd.read_parquet('/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet')

# Initialize mapper with default rules
mapper = StrategyMapper()

# OR: Initialize with custom rules
from engine.factors import StrategyRule
from engine.discovery.structure_dna import StructureDNA, StructureType, DTEBucket, DeltaBucket

custom_rules = [
    StrategyRule(
        name="My Strategy",
        conditions=[("my_factor", ">", 0.5)],
        structure_dna=StructureDNA(
            structure_type=StructureType.SHORT_STRADDLE,
            dte_bucket=DTEBucket.DTE_30,
            delta_bucket=DeltaBucket.ATM,
        ),
        position_size_pct=0.05,
        priority=10,
    )
]

mapper = StrategyMapper(rules=custom_rules)
```

---

## Step 3: Backtest Loop Structure

### Basic Backtest Loop

```python
from engine.factors import StrategyMapper
import pandas as pd
from datetime import datetime

# Initialize
mapper = StrategyMapper()
factors = pd.read_parquet('path/to/features.parquet')
portfolio_value = 100000  # Starting capital

# Track positions
open_positions = []
closed_positions = []
daily_portfolio_value = []

# Backtest loop
for date in factors.index:
    factor_row = factors.loc[date]
    current_price = factor_row['close']

    # === ENTRY LOGIC ===
    # Check if we should enter a new position
    rule = mapper.select_strategy(factor_row, current_price)

    if rule:
        # Calculate position size
        contracts = mapper.get_position_size(
            rule,
            portfolio_value,
            current_price
        )

        # Create position object
        position = {
            'entry_date': date,
            'rule_name': rule.name,
            'structure_dna': rule.structure_dna,
            'contracts': contracts,
            'entry_price': current_price,
            'profit_target': rule.profit_target_pct,
            'stop_loss': rule.stop_loss_pct,
            'max_hold_days': rule.max_hold_days,
            'entry_premium': None,  # TO BE FILLED by simulator
            'current_pnl': 0,
        }

        # TODO: Execute entry in simulator
        # position['entry_premium'] = simulator.execute_structure(
        #     position['structure_dna'],
        #     position['contracts'],
        #     date,
        #     current_price
        # )

        open_positions.append(position)

    # === EXIT LOGIC ===
    # Check open positions for exits
    positions_to_close = []

    for position in open_positions:
        days_held = (date - position['entry_date']).days

        # TODO: Get current P&L from simulator
        # current_value = simulator.get_position_value(position, date)
        # pnl_pct = (current_value - position['entry_premium']) / position['entry_premium']

        # For now, use placeholder
        pnl_pct = 0.0

        # Check exit conditions
        should_exit = False
        exit_reason = None

        if pnl_pct >= position['profit_target']:
            should_exit = True
            exit_reason = 'profit_target'

        elif pnl_pct <= -position['stop_loss']:
            should_exit = True
            exit_reason = 'stop_loss'

        elif days_held >= position['max_hold_days']:
            should_exit = True
            exit_reason = 'max_hold'

        if should_exit:
            position['exit_date'] = date
            position['exit_reason'] = exit_reason
            position['exit_pnl'] = pnl_pct

            # TODO: Close position in simulator
            # simulator.close_position(position, date)

            positions_to_close.append(position)
            closed_positions.append(position)

    # Remove closed positions
    for position in positions_to_close:
        open_positions.remove(position)

    # Track portfolio value
    # TODO: Update based on actual P&L from simulator
    daily_portfolio_value.append(portfolio_value)

# Results
print(f"Total Trades: {len(closed_positions)}")
print(f"Final Portfolio Value: ${portfolio_value:,.0f}")
```

---

## Step 4: Integrate with Trade Simulator

**NOTE**: The trade simulator is the next module to build (Days 4-5 focus).

### Expected Simulator Interface

```python
class TradeSimulator:
    """
    Trade execution simulator (TO BE BUILT).

    Handles:
    - Multi-leg structure execution
    - Bid-ask spreads and slippage
    - Delta hedging
    - Greeks tracking
    - P&L attribution
    """

    def execute_structure(
        self,
        structure_dna: StructureDNA,
        contracts: int,
        date: pd.Timestamp,
        underlying_price: float
    ) -> dict:
        """
        Execute a multi-leg option structure.

        Returns:
            {
                'entry_premium': float,  # Net premium paid/collected
                'greeks': dict,  # Delta, Gamma, Vega, Theta
                'slippage': float,  # Execution costs
                'legs': List[dict],  # Individual option contracts
            }
        """
        pass

    def get_position_value(
        self,
        position: dict,
        date: pd.Timestamp,
        underlying_price: float
    ) -> float:
        """Get current mark-to-market value of position."""
        pass

    def close_position(
        self,
        position: dict,
        date: pd.Timestamp,
        underlying_price: float
    ) -> dict:
        """
        Close position and return P&L attribution.

        Returns:
            {
                'exit_premium': float,
                'total_pnl': float,
                'gamma_pnl': float,
                'vega_pnl': float,
                'theta_pnl': float,
                'hedge_pnl': float,
            }
        """
        pass
```

### Integrated Backtest with Simulator

```python
from engine.factors import StrategyMapper
from engine.trading.simulator import TradeSimulator  # TO BE BUILT
import pandas as pd

# Initialize
mapper = StrategyMapper()
simulator = TradeSimulator()
factors = pd.read_parquet('path/to/features.parquet')

portfolio_value = 100000
positions = []

for date in factors.index:
    factor_row = factors.loc[date]
    current_price = factor_row['close']

    # Entry
    rule = mapper.select_strategy(factor_row, current_price)

    if rule:
        contracts = mapper.get_position_size(rule, portfolio_value, current_price)

        # Execute with simulator
        execution = simulator.execute_structure(
            rule.structure_dna,
            contracts,
            date,
            current_price
        )

        position = {
            'entry_date': date,
            'rule': rule,
            'contracts': contracts,
            'execution': execution,
            'entry_premium': execution['entry_premium'],
        }

        positions.append(position)

    # Exit
    for position in positions[:]:
        pnl = simulator.get_position_pnl(position, date, current_price)

        if should_exit(position, pnl, date):
            exit_result = simulator.close_position(position, date, current_price)

            # Update portfolio
            portfolio_value += exit_result['total_pnl']

            # Log P&L attribution
            print(f"Closed {position['rule'].name}:")
            print(f"  Gamma P&L: ${exit_result['gamma_pnl']:,.0f}")
            print(f"  Vega P&L: ${exit_result['vega_pnl']:,.0f}")
            print(f"  Theta P&L: ${exit_result['theta_pnl']:,.0f}")

            positions.remove(position)
```

---

## Step 5: P&L Analysis

### Track Strategy Performance

```python
# Group closed positions by strategy
strategy_performance = {}

for position in closed_positions:
    strategy_name = position['rule'].name

    if strategy_name not in strategy_performance:
        strategy_performance[strategy_name] = {
            'trades': 0,
            'wins': 0,
            'losses': 0,
            'total_pnl': 0,
            'pnl_list': [],
        }

    stats = strategy_performance[strategy_name]
    stats['trades'] += 1

    if position['exit_pnl'] > 0:
        stats['wins'] += 1
    else:
        stats['losses'] += 1

    stats['total_pnl'] += position['exit_pnl']
    stats['pnl_list'].append(position['exit_pnl'])

# Print summary
for strategy, stats in strategy_performance.items():
    win_rate = stats['wins'] / stats['trades'] if stats['trades'] > 0 else 0
    avg_pnl = stats['total_pnl'] / stats['trades'] if stats['trades'] > 0 else 0

    print(f"{strategy}:")
    print(f"  Trades: {stats['trades']}")
    print(f"  Win Rate: {win_rate:.1%}")
    print(f"  Avg P&L: {avg_pnl:.2%}")
    print(f"  Total P&L: {stats['total_pnl']:.2%}")
```

---

## Step 6: Emit UI Events (JARVIS Integration)

```python
from engine.ui_bridge import emit_ui_event, ui_table, ui_pnl_chart

# During backtest - emit progress
emit_ui_event(
    activity_type="backtesting",
    message=f"Backtesting {rule.name}",
    progress=int(100 * i / len(factors))
)

# After backtest - show results table
ui_table(
    title="Strategy Performance Summary",
    columns=[
        {"key": "strategy", "label": "Strategy", "type": "text"},
        {"key": "trades", "label": "Trades", "type": "number"},
        {"key": "win_rate", "label": "Win Rate", "type": "percent"},
        {"key": "total_pnl", "label": "Total P&L", "type": "percent"},
    ],
    rows=[
        {
            "strategy": strategy,
            "trades": stats['trades'],
            "win_rate": stats['wins'] / stats['trades'],
            "total_pnl": stats['total_pnl'],
        }
        for strategy, stats in strategy_performance.items()
    ]
)

# Show P&L chart
ui_pnl_chart(
    title="Portfolio Value Over Time",
    dates=[str(d) for d in factors.index],
    values=daily_portfolio_value,
    baseline=100000
)
```

---

## Step 7: Optimize Rules (Optional)

### Grid Search for Optimal Thresholds

```python
from itertools import product
import numpy as np

# Define parameter grid
ret_range_thresholds = np.linspace(0.01, 0.03, 5)
xle_strength_thresholds = np.linspace(-0.5, 0.5, 5)

best_sharpe = -np.inf
best_params = None

for ret_thresh, xle_thresh in product(ret_range_thresholds, xle_strength_thresholds):
    # Create rule with these parameters
    rule = StrategyRule(
        name="Test Rule",
        conditions=[
            ("ret_range_1m", ">", ret_thresh),
            ("xle_strength_1m", ">", xle_thresh),
        ],
        structure_dna=StructureDNA(
            structure_type=StructureType.SHORT_STRADDLE,
            dte_bucket=DTEBucket.DTE_30,
            delta_bucket=DeltaBucket.ATM,
        ),
        position_size_pct=0.05,
    )

    # Run backtest
    mapper = StrategyMapper(rules=[rule])
    results = run_backtest(mapper, factors)

    # Check Sharpe
    if results['sharpe'] > best_sharpe:
        best_sharpe = results['sharpe']
        best_params = (ret_thresh, xle_thresh)

print(f"Best parameters: ret_range={best_params[0]:.3f}, xle_strength={best_params[1]:.3f}")
print(f"Best Sharpe: {best_sharpe:.2f}")
```

---

## Common Patterns

### Pattern 1: Regime-Aware Strategy Selection

```python
# Get current regime from factor data
current_regime = factor_row['regime_label']

# Add regime condition to rules
rule = StrategyRule(
    name="Trending Up Strategy",
    conditions=[
        ("regime_label", "==", 1),  # Regime 1 = Trending Up
        ("ret_range_1m", ">", 0.015),
    ],
    # ... structure definition
)
```

### Pattern 2: Portfolio-Level Position Limits

```python
# Track open position count
max_concurrent_positions = 3

if rule and len(open_positions) < max_concurrent_positions:
    # Enter new position
    pass
```

### Pattern 3: Dynamic Position Sizing

```python
# Adjust position size based on conviction
factor_strength = abs(factor_row['ret_range_1m'])

if factor_strength > 0.03:
    # High conviction - increase allocation
    rule.position_size_pct *= 1.5
elif factor_strength < 0.015:
    # Low conviction - decrease allocation
    rule.position_size_pct *= 0.5
```

---

## Troubleshooting

### Issue: No strategies being selected

**Check:**
1. Factor column names match rule conditions
2. Factor values are not NaN
3. Thresholds are reasonable for your data range

**Debug:**
```python
rule = mapper.select_strategy(factor_row, current_price, verbose=True)
# Verbose=True logs why rules failed
```

### Issue: Position sizing too small/large

**Check:**
1. `portfolio_value` is correct
2. `current_price` is accurate
3. `position_size_pct` is reasonable (0.02-0.10 typical)

**Debug:**
```python
contracts = mapper.get_position_size(rule, portfolio_value, current_price)
notional = contracts * current_price * 100
print(f"Contracts: {contracts}, Notional: ${notional:,.0f}, % of Portfolio: {notional/portfolio_value:.1%}")
```

### Issue: Too many positions opening

**Solutions:**
1. Add portfolio-level position limits
2. Increase rule priority to favor specific strategies
3. Add position entry cooldown (min days between entries)

---

## Next Steps

1. **Build Trade Simulator** (Days 4-5 focus)
   - Multi-leg execution with slippage
   - Greeks calculation and tracking
   - Delta hedging logic
   - P&L attribution

2. **Validate Rules**
   - Backtest default rules on historical data
   - Compute Sharpe ratios per strategy
   - Identify which rules are profitable

3. **Optimize Parameters**
   - Grid search for optimal thresholds
   - Validate on out-of-sample data
   - Refine position sizing

4. **Deploy Live**
   - Connect to real options data
   - Monitor rule hit rates
   - Track actual vs expected P&L

---

**The StrategyMapper is ready. Build the Trade Simulator next to complete the execution layer.**
