#!/usr/bin/env python3
"""
Portfolio DNA: Genetic Encoding for Portfolio Construction

This module defines the genetic encoding for constructing and managing
a portfolio of options strategies (StructureDNA).

The PortfolioDNA acts as a "meta-chromosome" for evolving how individual
discovered structures are combined and managed.
"""

import copy
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple
import numpy as np

# ============================================================================
# ENUMS
# ============================================================================

class WeightingMethod(Enum):
    """Methods for weighting strategies within a portfolio."""
    EQUAL_WEIGHT = 'equal_weight'
    INVERSE_VOLATILITY = 'inverse_volatility'
    REGIME_OPTIMIZED_SHARPE = 'regime_optimized_sharpe'
    REGIME_OPTIMIZED_SORTINO = 'regime_optimized_sortino'

class RebalanceFrequency(Enum):
    """How often to rebalance the portfolio."""
    DAILY = 'daily'
    WEEKLY = 'weekly'
    MONTHLY = 'monthly'
    REGIME_CHANGE = 'regime_change' # Rebalance only when market regime shifts

class PortfolioObjective(Enum):
    """Primary objective metric for portfolio optimization."""
    SHARPE_RATIO = 'sharpe_ratio'
    SORTINO_RATIO = 'sortino_ratio'
    CALMAR_RATIO = 'calmar_ratio'
    MAX_RETURN = 'max_return'
    MIN_DRAWDOWN = 'min_drawdown'

# ============================================================================
# PORTFOLIO DNA
# ============================================================================

@dataclass
class PortfolioDNA:
    """
    Genetic encoding for a portfolio of options strategies.

    This DNA defines the meta-rules and objectives for portfolio construction.
    """
    # Strategies to consider (references to StructureDNA unique identifiers)
    # This will be populated externally by the miner or selected from a pool
    strategy_selection_rules: Dict = field(default_factory=dict) # e.g., {'min_fitness': 0.5, 'max_strategies': 10}

    # Weighting scheme
    weighting_method: WeightingMethod = WeightingMethod.REGIME_OPTIMIZED_SHARPE
    
    # Portfolio Objective (used by optimizer)
    objective: PortfolioObjective = PortfolioObjective.SHARPE_RATIO
    
    # Rebalancing
    rebalance_frequency: RebalanceFrequency = RebalanceFrequency.MONTHLY
    rebalance_window_days: int = 60 # Lookback window for rolling optimization

    # Risk Management
    max_strategy_allocation_pct: float = 0.20 # Max 20% of capital in any single strategy
    portfolio_stop_loss_pct: float = 0.10     # Portfolio-level stop loss
    portfolio_profit_target_pct: float = 0.20 # Portfolio-level profit target

    # Genetic information
    generation: int = 0
    fitness_score: float = 0.0

    def to_dict(self) -> Dict:
        """Serialize to dictionary."""
        return {
            'strategy_selection_rules': self.strategy_selection_rules,
            'weighting_method': self.weighting_method.value,
            'objective': self.objective.value,
            'rebalance_frequency': self.rebalance_frequency.value,
            'rebalance_window_days': self.rebalance_window_days,
            'max_strategy_allocation_pct': self.max_strategy_allocation_pct,
            'portfolio_stop_loss_pct': self.portfolio_stop_loss_pct,
            'portfolio_profit_target_pct': self.portfolio_profit_target_pct,
            'generation': self.generation,
            'fitness_score': self.fitness_score,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> 'PortfolioDNA':
        """Deserialize from dictionary."""
        return cls(
            strategy_selection_rules=d.get('strategy_selection_rules', {}),
            weighting_method=WeightingMethod(d.get('weighting_method', 'regime_optimized_sharpe')),
            objective=PortfolioObjective(d.get('objective', 'sharpe_ratio')),
            rebalance_frequency=RebalanceFrequency(d.get('rebalance_frequency', 'monthly')),
            rebalance_window_days=d.get('rebalance_window_days', 60),
            max_strategy_allocation_pct=d.get('max_strategy_allocation_pct', 0.20),
            portfolio_stop_loss_pct=d.get('portfolio_stop_loss_pct', 0.10),
            portfolio_profit_target_pct=d.get('portfolio_profit_target_pct', 0.20),
            generation=d.get('generation', 0),
            fitness_score=d.get('fitness_score', 0.0),
        )

# ============================================================================
# GENETIC OPERATORS
# ============================================================================

def create_random_portfolio_dna() -> PortfolioDNA:
    """Create a random PortfolioDNA."""
    return PortfolioDNA(
        strategy_selection_rules={
            'min_fitness': random.uniform(0.0, 0.5),
            'max_strategies': random.randint(3, 15),
            'exclude_correlated': random.choice([True, False])
        },
        weighting_method=random.choice(list(WeightingMethod)),
        objective=random.choice(list(PortfolioObjective)),
        rebalance_frequency=random.choice(list(RebalanceFrequency)),
        rebalance_window_days=random.choice([30, 60, 90, 120]),
        max_strategy_allocation_pct=random.uniform(0.10, 0.50),
        portfolio_stop_loss_pct=random.uniform(0.05, 0.25),
        portfolio_profit_target_pct=random.uniform(0.10, 0.50),
    )


def mutate_portfolio_dna(dna: PortfolioDNA, mutation_rate: float = 0.1) -> PortfolioDNA:
    """Mutate a PortfolioDNA."""
    new = copy.deepcopy(dna)

    if random.random() < mutation_rate:
        new.weighting_method = random.choice(list(WeightingMethod))
    if random.random() < mutation_rate:
        new.objective = random.choice(list(PortfolioObjective))
    if random.random() < mutation_rate:
        new.rebalance_frequency = random.choice(list(RebalanceFrequency))
    if random.random() < mutation_rate:
        new.rebalance_window_days = random.choice([30, 60, 90, 120])
    if random.random() < mutation_rate:
        new.max_strategy_allocation_pct = np.clip(new.max_strategy_allocation_pct + random.gauss(0, 0.05), 0.05, 0.5)
    if random.random() < mutation_rate:
        new.portfolio_stop_loss_pct = np.clip(new.portfolio_stop_loss_pct + random.gauss(0, 0.02), 0.01, 0.3)
    if random.random() < mutation_rate:
        new.portfolio_profit_target_pct = np.clip(new.portfolio_profit_target_pct + random.gauss(0, 0.05), 0.05, 0.5)
    
    # Mutate strategy selection rules
    if random.random() < mutation_rate and 'min_fitness' in new.strategy_selection_rules:
        new.strategy_selection_rules['min_fitness'] = np.clip(new.strategy_selection_rules['min_fitness'] + random.gauss(0, 0.1), 0.0, 0.8)
    if random.random() < mutation_rate and 'max_strategies' in new.strategy_selection_rules:
        new.strategy_selection_rules['max_strategies'] = max(2, new.strategy_selection_rules['max_strategies'] + random.randint(-2, 2))
    if random.random() < mutation_rate and 'exclude_correlated' in new.strategy_selection_rules:
        new.strategy_selection_rules['exclude_correlated'] = not new.strategy_selection_rules['exclude_correlated']

    return new


def crossover_portfolio_dna(parent1: PortfolioDNA, parent2: PortfolioDNA) -> PortfolioDNA:
    """Crossover two PortfolioDNAs."""
    child = PortfolioDNA(
        strategy_selection_rules=random.choice([parent1.strategy_selection_rules, parent2.strategy_selection_rules]),
        weighting_method=random.choice([parent1.weighting_method, parent2.weighting_method]),
        objective=random.choice([parent1.objective, parent2.objective]),
        rebalance_frequency=random.choice([parent1.rebalance_frequency, parent2.rebalance_frequency]),
        rebalance_window_days=random.choice([parent1.rebalance_window_days, parent2.rebalance_window_days]),
        max_strategy_allocation_pct=random.choice([parent1.max_strategy_allocation_pct, parent2.max_strategy_allocation_pct]),
        portfolio_stop_loss_pct=random.choice([parent1.portfolio_stop_loss_pct, parent2.portfolio_stop_loss_pct]),
        portfolio_profit_target_pct=random.choice([parent1.portfolio_profit_target_pct, parent2.portfolio_profit_target_pct]),
    )
    return child


# ============================================================================
# TESTING
# ============================================================================

if __name__ == '__main__':
    dna1 = create_random_portfolio_dna()
    dna2 = create_random_portfolio_dna()

    print("--- Random DNA 1 ---")
    print(dna1.to_dict())

    print("\n--- Random DNA 2 ---")
    print(dna2.to_dict())

    mutated_dna = mutate_portfolio_dna(dna1)
    print("\n--- Mutated DNA 1 ---")
    print(mutated_dna.to_dict())

    crossed_dna = crossover_portfolio_dna(dna1, dna2)
    print("\n--- Crossover DNA ---")
    print(crossed_dna.to_dict())
