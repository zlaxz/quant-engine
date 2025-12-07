#!/usr/bin/env python3
"""
Strategy Mapper: Factor Conditions → Option Structure Selection

Maps factor signals to option strategy structures with proper position sizing
and risk management. Integrates with StructureDNA system for strategy execution.

Architecture:
- Rules-based mapping: Factor conditions → Strategy selection
- Notional-based sizing: Position size based on portfolio value, NOT contract count
- Integration: Uses existing StructureDNA for strategy definitions
- Extensibility: Easy to add new rules without modifying core logic

Key Principles:
1. Position sizing is ALWAYS notional-based (e.g., "5% of portfolio")
2. Rules use AND logic (all conditions must be met)
3. First matching rule wins (order matters)
4. Rules are data-driven and configurable
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Callable
import pandas as pd
import numpy as np

# Import existing StructureDNA system
# NOTE: Direct import to avoid circular dependencies in discovery module
import importlib.util
from pathlib import Path

_structure_dna_path = Path(__file__).parent.parent / 'discovery' / 'structure_dna.py'
_spec = importlib.util.spec_from_file_location('structure_dna', _structure_dna_path)
_structure_dna_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_structure_dna_module)

StructureDNA = _structure_dna_module.StructureDNA
StructureType = _structure_dna_module.StructureType
DTEBucket = _structure_dna_module.DTEBucket
DeltaBucket = _structure_dna_module.DeltaBucket

logger = logging.getLogger(__name__)


# ============================================================================
# OPERATOR FUNCTIONS (for condition evaluation)
# ============================================================================

OPERATORS = {
    '>': lambda x, y: x > y,
    '>=': lambda x, y: x >= y,
    '<': lambda x, y: x < y,
    '<=': lambda x, y: x <= y,
    '==': lambda x, y: x == y,
    '!=': lambda x, y: x != y,
    'between': lambda x, y: y[0] <= x <= y[1],  # y is tuple (min, max)
    'outside': lambda x, y: x < y[0] or x > y[1],  # y is tuple (min, max)
}


# ============================================================================
# STRATEGY RULE DEFINITION
# ============================================================================

@dataclass
class StrategyRule:
    """
    Defines a mapping from factor conditions to option structure.

    Attributes:
        name: Human-readable rule name (e.g., "High RV Sell Premium")
        conditions: List of (factor_name, operator, threshold) tuples
                   All conditions must be True (AND logic)
        structure_dna: StructureDNA object defining the option structure
        position_size_pct: Percentage of portfolio notional (e.g., 0.05 = 5%)
        max_hold_days: Maximum days to hold position before forced exit
        profit_target_pct: Exit when P&L reaches this % of premium paid/collected
        stop_loss_pct: Exit when loss reaches this % of premium
        priority: Higher priority rules are checked first (default: 0)
        enabled: If False, rule is skipped (default: True)
        description: Optional detailed description of the rule logic

    Example:
        StrategyRule(
            name="High RV Sell Premium",
            conditions=[
                ("ret_range_1m", ">", 0.02),  # ret_range > 2%
                ("xle_strength_1m", ">", 0.0),  # positive XLE correlation
            ],
            structure_dna=StructureDNA(
                structure_type=StructureType.SHORT_STRADDLE,
                dte_bucket=DTEBucket.DTE_30,
                delta_bucket=DeltaBucket.ATM,
            ),
            position_size_pct=0.05,  # 5% of portfolio
            max_hold_days=30,
            profit_target_pct=0.50,
            stop_loss_pct=1.50,
        )
    """
    name: str
    conditions: List[Tuple[str, str, float]]  # [(factor, operator, threshold), ...]
    structure_dna: StructureDNA
    position_size_pct: float = 0.05  # 5% of portfolio by default
    max_hold_days: int = 30
    profit_target_pct: float = 0.50
    stop_loss_pct: float = 1.50
    priority: int = 0  # Higher = checked first
    enabled: bool = True
    description: str = ""

    def __post_init__(self):
        """Validate rule parameters."""
        if self.position_size_pct <= 0 or self.position_size_pct > 1.0:
            raise ValueError(f"position_size_pct must be in (0, 1], got {self.position_size_pct}")
        if self.max_hold_days <= 0:
            raise ValueError(f"max_hold_days must be positive, got {self.max_hold_days}")
        if self.profit_target_pct <= 0:
            raise ValueError(f"profit_target_pct must be positive, got {self.profit_target_pct}")
        if self.stop_loss_pct <= 0:
            raise ValueError(f"stop_loss_pct must be positive, got {self.stop_loss_pct}")

    def evaluate_conditions(self, factor_row: pd.Series) -> Tuple[bool, List[str]]:
        """
        Evaluate all conditions against factor data.

        Args:
            factor_row: Single row from factor DataFrame (pd.Series)

        Returns:
            (all_conditions_met, failed_conditions)
            - all_conditions_met: True if ALL conditions pass
            - failed_conditions: List of condition descriptions that failed
        """
        failed = []

        for factor_name, operator, threshold in self.conditions:
            # Get factor value
            if factor_name not in factor_row.index:
                failed.append(f"Factor '{factor_name}' not found in data")
                continue

            factor_value = factor_row[factor_name]

            # Handle NaN
            if pd.isna(factor_value):
                failed.append(f"{factor_name} is NaN")
                continue

            # Evaluate condition
            op_func = OPERATORS.get(operator)
            if op_func is None:
                failed.append(f"Unknown operator '{operator}'")
                continue

            try:
                condition_met = op_func(factor_value, threshold)
            except Exception as e:
                failed.append(f"{factor_name} {operator} {threshold} raised {e}")
                continue

            if not condition_met:
                failed.append(f"{factor_name}={factor_value:.4f} failed {operator} {threshold}")

        all_met = len(failed) == 0
        return all_met, failed

    def to_dict(self) -> Dict:
        """Serialize to dictionary."""
        return {
            'name': self.name,
            'conditions': self.conditions,
            'structure_dna': self.structure_dna.to_dict(),
            'position_size_pct': self.position_size_pct,
            'max_hold_days': self.max_hold_days,
            'profit_target_pct': self.profit_target_pct,
            'stop_loss_pct': self.stop_loss_pct,
            'priority': self.priority,
            'enabled': self.enabled,
            'description': self.description,
        }


# ============================================================================
# STRATEGY MAPPER
# ============================================================================

class StrategyMapper:
    """
    Maps factor conditions to option strategy structures.

    Architecture:
    - Maintains ordered list of rules (checked in priority order)
    - First matching rule wins (short-circuit evaluation)
    - Returns None if no rules match (no trade signal)
    - Position sizing is notional-based (percentage of portfolio)

    Usage:
        mapper = StrategyMapper()

        # Select strategy based on current factors
        rule = mapper.select_strategy(factor_row, current_price=100.0)

        if rule:
            # Calculate position size
            contracts = mapper.get_position_size(
                rule,
                portfolio_notional=100000,
                current_price=100.0
            )

            # Execute the structure
            execute_structure(rule.structure_dna, contracts)
    """

    def __init__(self, rules: Optional[List[StrategyRule]] = None):
        """
        Initialize mapper with rules.

        Args:
            rules: List of StrategyRule objects. If None, uses default rules.
        """
        if rules is None:
            self.rules = self.get_default_rules()
        else:
            self.rules = rules

        # Sort rules by priority (highest first)
        self.rules.sort(key=lambda r: r.priority, reverse=True)

        logger.info(f"StrategyMapper initialized with {len(self.rules)} rules")

    def select_strategy(
        self,
        factor_row: pd.Series,
        current_price: float,
        verbose: bool = False
    ) -> Optional[StrategyRule]:
        """
        Select strategy based on current factor values.

        First matching rule wins. Returns None if no rules match.

        Args:
            factor_row: Current factor values (pd.Series)
            current_price: Current underlying price (for logging/debugging)
            verbose: If True, log evaluation details

        Returns:
            StrategyRule if conditions match, else None
        """
        if verbose:
            logger.info(f"Evaluating {len(self.rules)} rules for price={current_price:.2f}")

        for rule in self.rules:
            # Skip disabled rules
            if not rule.enabled:
                continue

            # Evaluate conditions
            matched, failed_conditions = rule.evaluate_conditions(factor_row)

            if matched:
                if verbose:
                    logger.info(f"✓ Matched rule: {rule.name}")
                return rule
            else:
                if verbose:
                    logger.debug(f"✗ Rule '{rule.name}' failed: {failed_conditions}")

        if verbose:
            logger.info("No rules matched - no trade signal")

        return None

    def get_position_size(
        self,
        rule: StrategyRule,
        portfolio_notional: float,
        current_price: float,
        contract_multiplier: float = 100.0
    ) -> int:
        """
        Calculate number of contracts based on notional sizing.

        CRITICAL: Position sizing is notional-based, NOT contract-count based.

        Formula:
            notional_allocation = portfolio_notional * position_size_pct
            contracts = notional_allocation / (current_price * multiplier)

        Args:
            rule: Strategy rule with position_size_pct
            portfolio_notional: Total portfolio value in dollars
            current_price: Current underlying price
            contract_multiplier: Options contract multiplier (default: 100)

        Returns:
            Number of contracts to trade (integer, minimum 1)

        Example:
            Portfolio = $100,000
            Rule position_size_pct = 0.05 (5%)
            Current price = $100
            Multiplier = 100

            notional_allocation = $100,000 * 0.05 = $5,000
            contracts = $5,000 / ($100 * 100) = 0.5 → rounds to 1 contract
        """
        # Validate inputs
        if portfolio_notional <= 0:
            raise ValueError(f"portfolio_notional must be positive, got {portfolio_notional}")
        if current_price <= 0:
            raise ValueError(f"current_price must be positive, got {current_price}")
        if contract_multiplier <= 0:
            raise ValueError(f"contract_multiplier must be positive, got {contract_multiplier}")

        # Calculate notional allocation
        notional_allocation = portfolio_notional * rule.position_size_pct

        # Calculate contract value
        contract_value = current_price * contract_multiplier

        # Calculate number of contracts (minimum 1)
        contracts = max(1, int(notional_allocation / contract_value))

        logger.debug(
            f"Position sizing: portfolio=${portfolio_notional:,.0f}, "
            f"allocation={rule.position_size_pct:.1%}, "
            f"price=${current_price:.2f}, "
            f"contracts={contracts}"
        )

        return contracts

    def add_rule(self, rule: StrategyRule) -> None:
        """
        Add a new rule to the mapper.

        Rules are re-sorted by priority after adding.

        Args:
            rule: StrategyRule to add
        """
        self.rules.append(rule)
        self.rules.sort(key=lambda r: r.priority, reverse=True)
        logger.info(f"Added rule: {rule.name} (priority={rule.priority})")

    def remove_rule(self, name: str) -> bool:
        """
        Remove rule by name.

        Args:
            name: Rule name to remove

        Returns:
            True if rule was found and removed, False otherwise
        """
        for i, rule in enumerate(self.rules):
            if rule.name == name:
                self.rules.pop(i)
                logger.info(f"Removed rule: {name}")
                return True

        logger.warning(f"Rule not found: {name}")
        return False

    def disable_rule(self, name: str) -> bool:
        """
        Disable a rule without removing it.

        Args:
            name: Rule name to disable

        Returns:
            True if rule was found and disabled, False otherwise
        """
        for rule in self.rules:
            if rule.name == name:
                rule.enabled = False
                logger.info(f"Disabled rule: {name}")
                return True

        logger.warning(f"Rule not found: {name}")
        return False

    def enable_rule(self, name: str) -> bool:
        """Enable a previously disabled rule."""
        for rule in self.rules:
            if rule.name == name:
                rule.enabled = True
                logger.info(f"Enabled rule: {name}")
                return True

        logger.warning(f"Rule not found: {name}")
        return False

    def get_rule(self, name: str) -> Optional[StrategyRule]:
        """Get rule by name."""
        for rule in self.rules:
            if rule.name == name:
                return rule
        return None

    def list_rules(self) -> pd.DataFrame:
        """
        Return DataFrame of all rules for inspection.

        Returns:
            DataFrame with columns: name, priority, enabled, structure_type,
            position_size_pct, n_conditions
        """
        data = []
        for rule in self.rules:
            data.append({
                'name': rule.name,
                'priority': rule.priority,
                'enabled': rule.enabled,
                'structure_type': rule.structure_dna.structure_type.value,
                'dte': rule.structure_dna.dte_bucket.value,
                'delta': rule.structure_dna.delta_bucket.value,
                'position_size_pct': rule.position_size_pct,
                'n_conditions': len(rule.conditions),
            })
        return pd.DataFrame(data)

    @staticmethod
    def get_default_rules() -> List[StrategyRule]:
        """
        Get sensible default rules based on factor research.

        These rules are derived from:
        1. Observed factor patterns in SPY data
        2. Known options strategies for different market regimes
        3. Conservative position sizing and risk management

        Rule Logic:
        - High ret_range + positive XLE → Sell premium (realized vol harvest)
        - Low ret_range + negative XLE → Buy gamma (expect vol expansion)
        - Extreme negative factor → Protective puts (tail hedge)
        - Default fallback → Short 30D ATM straddle (neutral premium collection)

        Returns:
            List of default StrategyRule objects
        """
        rules = []

        # ====================================================================
        # RULE 1: High Realized Vol + Positive Energy Correlation → Sell Premium
        # ====================================================================
        # Rationale: High ret_range means realized vol is elevated.
        #            Positive XLE correlation means market is calm/trending.
        #            Sell straddle to harvest premium as vol mean-reverts.
        rules.append(StrategyRule(
            name="High RV Sell Premium",
            conditions=[
                ("ret_range_1m", ">", 0.02),  # ret_range > 2% (high realized vol)
                ("xle_strength_1m", ">", 0.0),  # positive energy correlation
            ],
            structure_dna=StructureDNA(
                structure_type=StructureType.SHORT_STRADDLE,
                dte_bucket=DTEBucket.DTE_30,
                delta_bucket=DeltaBucket.ATM,
                profit_target_pct=0.50,  # Exit at 50% profit
                stop_loss_pct=1.50,  # Exit at 150% loss (wide for short premium)
                dte_exit_threshold=7,  # Close 7 days before expiration
            ),
            position_size_pct=0.05,  # 5% of portfolio
            max_hold_days=30,
            profit_target_pct=0.50,
            stop_loss_pct=1.50,
            priority=10,
            description="Sell ATM straddle when realized vol is high and market is stable"
        ))

        # ====================================================================
        # RULE 2: Low Realized Vol + Negative Energy Correlation → Buy Gamma
        # ====================================================================
        # Rationale: Low ret_range means vol is compressed.
        #            Negative XLE correlation suggests market stress/instability.
        #            Buy straddle expecting vol expansion.
        rules.append(StrategyRule(
            name="Low RV Buy Gamma",
            conditions=[
                ("ret_range_1m", "<", 0.01),  # ret_range < 1% (low realized vol)
                ("xle_strength_1m", "<", 0.0),  # negative energy correlation
            ],
            structure_dna=StructureDNA(
                structure_type=StructureType.LONG_STRADDLE,
                dte_bucket=DTEBucket.DTE_30,
                delta_bucket=DeltaBucket.ATM,
                profit_target_pct=0.75,  # Exit at 75% profit
                stop_loss_pct=0.50,  # Tight stop for long premium
                dte_exit_threshold=7,
            ),
            position_size_pct=0.03,  # 3% of portfolio (smaller for long premium)
            max_hold_days=30,
            profit_target_pct=0.75,
            stop_loss_pct=0.50,
            priority=9,
            description="Buy ATM straddle when vol is compressed and market is unstable"
        ))

        # ====================================================================
        # RULE 3: High Realized Vol → Protective Puts
        # ====================================================================
        # Rationale: High ret_range (> 4%) indicates extreme realized volatility,
        #            which signals tail risk. Buy OTM puts for protection.
        # NOTE: ret_range is always >= 0, so we check for high values (not negative)
        rules.append(StrategyRule(
            name="Extreme Negative Tail Hedge",
            conditions=[
                ("ret_range_1m", ">", 0.04),  # High realized vol (> 4%) signals tail risk
            ],
            structure_dna=StructureDNA(
                structure_type=StructureType.LONG_PUT,
                dte_bucket=DTEBucket.DTE_60,  # Longer dated for tail hedge
                delta_bucket=DeltaBucket.D10,  # Far OTM (10 delta)
                profit_target_pct=2.00,  # Let winners run
                stop_loss_pct=1.00,  # Full premium loss OK for hedge
                dte_exit_threshold=14,
            ),
            position_size_pct=0.02,  # 2% of portfolio (small allocation)
            max_hold_days=60,
            profit_target_pct=2.00,
            stop_loss_pct=1.00,
            priority=15,  # Highest priority - hedge comes first
            description="Buy OTM puts when factor signals extreme crash risk"
        ))

        # ====================================================================
        # RULE 4: Neutral / Medium Vol → Short Iron Condor
        # ====================================================================
        # Rationale: When vol is in normal range, sell iron condor for theta.
        rules.append(StrategyRule(
            name="Neutral Iron Condor",
            conditions=[
                ("ret_range_1m", "between", (0.01, 0.02)),  # Medium ret_range
            ],
            structure_dna=StructureDNA(
                structure_type=StructureType.IRON_CONDOR,
                dte_bucket=DTEBucket.DTE_45,
                delta_bucket=DeltaBucket.D25,  # 25 delta wings
                wing_width_pct=0.05,  # 5% wide wings
                profit_target_pct=0.50,
                stop_loss_pct=1.50,
                dte_exit_threshold=10,
            ),
            position_size_pct=0.04,  # 4% of portfolio
            max_hold_days=45,
            profit_target_pct=0.50,
            stop_loss_pct=1.50,
            priority=5,
            description="Sell iron condor in neutral market conditions"
        ))

        # ====================================================================
        # RULE 5: Fallback Default → Short 30D ATM Straddle
        # ====================================================================
        # Rationale: If no other rules match, default to selling premium.
        #            This is a conservative baseline strategy.
        # NOTE: This has lowest priority and always matches (no conditions).
        rules.append(StrategyRule(
            name="Default Sell Premium",
            conditions=[],  # No conditions - always matches
            structure_dna=StructureDNA(
                structure_type=StructureType.SHORT_STRADDLE,
                dte_bucket=DTEBucket.DTE_30,
                delta_bucket=DeltaBucket.ATM,
                profit_target_pct=0.40,
                stop_loss_pct=1.20,
                dte_exit_threshold=7,
            ),
            position_size_pct=0.03,  # 3% of portfolio (conservative)
            max_hold_days=30,
            profit_target_pct=0.40,
            stop_loss_pct=1.20,
            priority=0,  # Lowest priority - fallback
            description="Default strategy when no other rules match"
        ))

        return rules


# ============================================================================
# TESTING / EXAMPLES
# ============================================================================

if __name__ == '__main__':
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(levelname)s - %(message)s'
    )

    print("=" * 80)
    print("StrategyMapper Test Suite")
    print("=" * 80)

    # Initialize mapper with default rules
    mapper = StrategyMapper()

    print("\n1. List all rules:")
    print(mapper.list_rules())

    # Test data: factor values
    test_cases = [
        {
            'name': 'High RV + Positive XLE',
            'factors': pd.Series({
                'ret_range_1m': 0.025,  # High RV
                'xle_strength_1m': 0.5,  # Positive correlation
            }),
            'price': 100.0,
        },
        {
            'name': 'Low RV + Negative XLE',
            'factors': pd.Series({
                'ret_range_1m': 0.008,  # Low RV
                'xle_strength_1m': -0.3,  # Negative correlation
            }),
            'price': 100.0,
        },
        {
            'name': 'Extreme Negative Factor',
            'factors': pd.Series({
                'ret_range_1m': -0.03,  # Extreme negative
                'xle_strength_1m': -0.5,
            }),
            'price': 100.0,
        },
        {
            'name': 'Neutral / No Match',
            'factors': pd.Series({
                'ret_range_1m': 0.015,  # Medium
                'xle_strength_1m': 0.1,
            }),
            'price': 100.0,
        },
    ]

    print("\n2. Test strategy selection:")
    for i, test_case in enumerate(test_cases, 1):
        print(f"\nTest Case {i}: {test_case['name']}")
        print(f"  Factors: {dict(test_case['factors'])}")

        rule = mapper.select_strategy(
            test_case['factors'],
            test_case['price'],
            verbose=True
        )

        if rule:
            print(f"  → Selected: {rule.name}")
            print(f"     Structure: {rule.structure_dna.structure_type.value}")
            print(f"     DTE: {rule.structure_dna.dte_bucket.value}")
            print(f"     Delta: {rule.structure_dna.delta_bucket.value}")

            # Calculate position size
            portfolio = 100000  # $100k portfolio
            contracts = mapper.get_position_size(rule, portfolio, test_case['price'])
            notional = contracts * test_case['price'] * 100
            print(f"     Position: {contracts} contracts (${notional:,.0f} notional)")
        else:
            print(f"  → No strategy selected")

    print("\n3. Test rule management:")

    # Disable a rule
    print("\nDisabling 'High RV Sell Premium' rule...")
    mapper.disable_rule("High RV Sell Premium")

    # Re-test first case
    test_case = test_cases[0]
    print(f"\nRe-testing: {test_case['name']}")
    rule = mapper.select_strategy(test_case['factors'], test_case['price'], verbose=True)
    if rule:
        print(f"  → Selected: {rule.name} (different rule matched!)")

    # Re-enable
    print("\nRe-enabling 'High RV Sell Premium' rule...")
    mapper.enable_rule("High RV Sell Premium")

    print("\n4. Test adding custom rule:")

    custom_rule = StrategyRule(
        name="Custom Test Rule",
        conditions=[
            ("ret_range_1m", ">", 0.03),
            ("xle_strength_1m", "<", -0.5),
        ],
        structure_dna=StructureDNA(
            structure_type=StructureType.LONG_STRANGLE,
            dte_bucket=DTEBucket.DTE_14,
            delta_bucket=DeltaBucket.D25,
        ),
        position_size_pct=0.02,
        priority=20,  # Highest priority
    )

    mapper.add_rule(custom_rule)
    print(f"Added rule: {custom_rule.name}")
    print("\nUpdated rule list:")
    print(mapper.list_rules())

    print("\n" + "=" * 80)
    print("Tests complete!")
    print("=" * 80)
