#!/usr/bin/env python3
"""
Structure Miner: Genetic Algorithm for Options Structure Discovery

This module evolves a population of options structures to discover
which ones have genuine edge in specific market regimes.

Key features:
1. Starts from logical seeds (not random trash)
2. Uses slippage-aware fitness function
3. Walk-forward validation to prevent overfitting
4. Saves discovered structures with full lineage

The output is a set of data-driven structures that replace hand-coded profiles.
"""

import copy
import json
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp

import numpy as np
import pandas as pd

from .structure_dna import (
    StructureDNA,
    StructureType,
    DTEBucket,
    DeltaBucket,
    create_initial_population,
    mutate_dna,
    crossover_dna,
    format_dna,
    get_seed_structures,
)
from .precision_backtester import PrecisionBacktester, BacktestResult, compute_fitness

logger = logging.getLogger("AlphaFactory.StructureMiner")


# ============================================================================
# EVOLUTION CONFIG
# ============================================================================

@dataclass
class EvolutionConfig:
    """Configuration for genetic algorithm."""
    # Population
    population_size: int = 100
    n_generations: int = 50
    seed_ratio: float = 0.20  # Fraction of pure seeds in Gen 0

    # Selection
    elite_ratio: float = 0.10      # Top 10% survive unchanged
    survivor_ratio: float = 0.30   # Top 30% can breed

    # Genetic operators
    mutation_rate: float = 0.15
    crossover_rate: float = 0.70

    # Validation
    train_ratio: float = 0.70       # Use 70% for training
    validate_ratio: float = 0.15    # 15% for validation
    test_ratio: float = 0.15        # 15% for final test

    # Walk-forward
    n_walk_forward_folds: int = 3   # Number of walk-forward periods

    # Fitness weights
    sharpe_weight: float = 0.4
    sortino_weight: float = 0.2
    calmar_weight: float = 0.2
    win_rate_weight: float = 0.1

    # Early stopping
    patience: int = 10              # Stop if no improvement for N generations
    min_fitness_threshold: float = 0.1  # Minimum fitness to keep

    # Output
    output_dir: Optional[Path] = None
    save_every_n_generations: int = 10


# ============================================================================
# EVOLUTION STATE
# ============================================================================

@dataclass
class GenerationStats:
    """Statistics for a single generation."""
    generation: int
    best_fitness: float
    median_fitness: float
    mean_fitness: float
    worst_fitness: float
    std_fitness: float
    n_unique_structures: int
    best_structure: str


@dataclass
class EvolutionState:
    """Complete state of evolution run."""
    config: EvolutionConfig
    generations: List[GenerationStats] = field(default_factory=list)
    best_ever: Optional[StructureDNA] = None
    best_ever_fitness: float = float('-inf')
    current_generation: int = 0
    convergence_count: int = 0  # Generations without improvement


# ============================================================================
# STRUCTURE MINER
# ============================================================================

class StructureMiner:
    """
    Genetic algorithm for discovering optimal options structures.

    Usage:
        miner = StructureMiner(config, backtester)
        discovered = miner.evolve()
    """

    def __init__(
        self,
        config: EvolutionConfig,
        backtester: PrecisionBacktester,
        random_seed: int = 42
    ):
        """
        Initialize miner.

        Args:
            config: Evolution configuration
            backtester: Pre-initialized PrecisionBacktester
            random_seed: For reproducibility
        """
        self.config = config
        self.backtester = backtester
        self.random_seed = random_seed

        random.seed(random_seed)
        np.random.seed(random_seed)

        # State
        self.state = EvolutionState(config=config)
        self.population: List[StructureDNA] = []
        self.fitness_cache: Dict[str, float] = {}  # Cache fitness by DNA hash

        # Date ranges for train/validate/test
        self._setup_date_ranges()

    def _setup_date_ranges(self):
        """Split available dates into train/validate/test."""
        all_dates = sorted(self.backtester.trading_dates)
        n_dates = len(all_dates)

        train_end = int(n_dates * self.config.train_ratio)
        val_end = int(n_dates * (self.config.train_ratio + self.config.validate_ratio))

        self.train_dates = (all_dates[0], all_dates[train_end])
        self.val_dates = (all_dates[train_end], all_dates[val_end])
        self.test_dates = (all_dates[val_end], all_dates[-1])

        logger.info(f"Date ranges:")
        logger.info(f"  Train: {self.train_dates[0].date()} to {self.train_dates[1].date()}")
        logger.info(f"  Validate: {self.val_dates[0].date()} to {self.val_dates[1].date()}")
        logger.info(f"  Test: {self.test_dates[0].date()} to {self.test_dates[1].date()}")

    def _get_dna_hash(self, dna: StructureDNA) -> str:
        """Get hashable key for DNA (for caching)."""
        return (
            f"{dna.structure_type.value}_"
            f"{dna.dte_bucket.value}_"
            f"{dna.delta_bucket.value}_"
            f"{tuple(sorted(dna.entry_regimes))}_"
            f"{dna.profit_target_pct:.2f}_"
            f"{dna.stop_loss_pct:.2f}"
        )

    def _evaluate_fitness(
        self,
        dna: StructureDNA,
        use_cache: bool = True
    ) -> float:
        """
        Evaluate fitness of a DNA structure.

        Uses training period for evaluation during evolution.
        """
        # Check cache
        if use_cache:
            key = self._get_dna_hash(dna)
            if key in self.fitness_cache:
                return self.fitness_cache[key]

        # Backtest on training period
        result = self.backtester.backtest(
            dna,
            start_date=self.train_dates[0],
            end_date=self.train_dates[1]
        )

        # Compute fitness with safe handling
        fitness = compute_fitness(
            result,
            sharpe_weight=self.config.sharpe_weight,
            sortino_weight=self.config.sortino_weight,
            calmar_weight=self.config.calmar_weight,
            win_rate_weight=self.config.win_rate_weight,
        )

        # Ensure fitness is a valid number
        if not np.isfinite(fitness):
            fitness = -np.inf

        # Cache
        if use_cache:
            self.fitness_cache[self._get_dna_hash(dna)] = fitness

        dna.fitness_score = fitness
        return fitness

    def _evaluate_population(self, n_workers: int = None) -> List[float]:
        """
        Evaluate fitness for entire population using parallel workers.

        Args:
            n_workers: Number of parallel workers (default: CPU count)
        """
        n_workers = n_workers or mp.cpu_count()

        # Check cache first, separate cached vs uncached
        cached_results = {}
        uncached_indices = []
        uncached_dnas = []

        for i, dna in enumerate(self.population):
            key = self._get_dna_hash(dna)
            if key in self.fitness_cache:
                cached_results[i] = self.fitness_cache[key]
                dna.fitness_score = self.fitness_cache[key]
            else:
                uncached_indices.append(i)
                uncached_dnas.append(dna)

        # Parallel evaluation of uncached structures
        if uncached_dnas:
            # Use parallel evaluation
            from concurrent.futures import ThreadPoolExecutor

            def eval_single(dna):
                result = self.backtester.backtest(
                    dna,
                    start_date=self.train_dates[0],
                    end_date=self.train_dates[1]
                )
                fitness = compute_fitness(
                    result,
                    sharpe_weight=self.config.sharpe_weight,
                    sortino_weight=self.config.sortino_weight,
                    calmar_weight=self.config.calmar_weight,
                    win_rate_weight=self.config.win_rate_weight,
                )
                return fitness

            # ThreadPoolExecutor for I/O bound pandas operations
            with ThreadPoolExecutor(max_workers=n_workers) as executor:
                new_fitnesses = list(executor.map(eval_single, uncached_dnas))

            # Cache results and update DNA fitness scores
            for idx, dna, fitness in zip(uncached_indices, uncached_dnas, new_fitnesses):
                key = self._get_dna_hash(dna)
                self.fitness_cache[key] = fitness
                dna.fitness_score = fitness
                cached_results[idx] = fitness

        # Build final results list in order
        return [cached_results[i] for i in range(len(self.population))]

    def _select_parents(self, fitnesses: List[float]) -> List[StructureDNA]:
        """
        Select parents for next generation using tournament selection.

        Top elite_ratio survive unchanged.
        Top survivor_ratio can breed.
        """
        n_pop = len(self.population)
        n_elite = int(n_pop * self.config.elite_ratio)
        n_survivors = int(n_pop * self.config.survivor_ratio)

        # Sort by fitness
        ranked = sorted(
            zip(self.population, fitnesses),
            key=lambda x: x[1],
            reverse=True
        )

        # Elite survive unchanged
        elite = [copy.deepcopy(dna) for dna, _ in ranked[:n_elite]]

        # Survivors can breed
        survivors = [dna for dna, _ in ranked[:n_survivors]]

        return elite, survivors

    def _create_next_generation(
        self,
        elite: List[StructureDNA],
        survivors: List[StructureDNA]
    ) -> List[StructureDNA]:
        """Create next generation through crossover and mutation."""
        next_gen = elite.copy()

        while len(next_gen) < self.config.population_size:
            if random.random() < self.config.crossover_rate and len(survivors) >= 2:
                # Crossover
                p1, p2 = random.sample(survivors, 2)
                child = crossover_dna(p1, p2)
            else:
                # Clone and mutate
                parent = random.choice(survivors)
                child = copy.deepcopy(parent)

            # Mutate
            if random.random() < self.config.mutation_rate:
                child = mutate_dna(child, self.config.mutation_rate)

            child.generation = self.state.current_generation + 1
            next_gen.append(child)

        return next_gen[:self.config.population_size]

    def _compute_generation_stats(
        self,
        fitnesses: List[float]
    ) -> GenerationStats:
        """Compute statistics for current generation."""
        fitnesses = np.array(fitnesses)

        # Find best
        best_idx = np.argmax(fitnesses)
        best_dna = self.population[best_idx]

        # Count unique structures
        unique = len(set(self._get_dna_hash(d) for d in self.population))

        return GenerationStats(
            generation=self.state.current_generation,
            best_fitness=float(fitnesses.max()),
            median_fitness=float(np.median(fitnesses)),
            mean_fitness=float(fitnesses.mean()),
            worst_fitness=float(fitnesses.min()),
            std_fitness=float(fitnesses.std()),
            n_unique_structures=unique,
            best_structure=format_dna(best_dna)
        )

    def _check_early_stopping(self, stats: GenerationStats) -> bool:
        """Check if we should stop early."""
        if stats.best_fitness > self.state.best_ever_fitness:
            self.state.best_ever_fitness = stats.best_fitness
            self.state.best_ever = copy.deepcopy(
                self.population[np.argmax([d.fitness_score for d in self.population])]
            )
            self.state.convergence_count = 0
            return False
        else:
            self.state.convergence_count += 1
            if self.state.convergence_count >= self.config.patience:
                logger.info(f"Early stopping: no improvement for {self.config.patience} generations")
                return True
            return False

    def _save_checkpoint(self):
        """Save current state to disk."""
        if not self.config.output_dir:
            return

        self.config.output_dir.mkdir(parents=True, exist_ok=True)

        # Save best structures
        top_n = 20
        ranked = sorted(self.population, key=lambda d: d.fitness_score, reverse=True)
        top_structures = [d.to_dict() for d in ranked[:top_n]]

        path = self.config.output_dir / f'checkpoint_gen_{self.state.current_generation}.json'
        with open(path, 'w') as f:
            json.dump({
                'generation': self.state.current_generation,
                'best_fitness': self.state.best_ever_fitness,
                'top_structures': top_structures,
                'generation_stats': [
                    {
                        'generation': s.generation,
                        'best_fitness': s.best_fitness,
                        'median_fitness': s.median_fitness,
                    }
                    for s in self.state.generations
                ]
            }, f, indent=2, default=str)

        logger.info(f"Saved checkpoint to {path}")

    def evolve(self) -> List[StructureDNA]:
        """
        Run genetic algorithm evolution.

        Returns:
            Top N discovered structures
        """
        logger.info("=" * 60)
        logger.info("STRUCTURE MINER: Starting Evolution")
        logger.info("=" * 60)

        # Initialize population
        self.population = create_initial_population(
            self.config.population_size,
            self.config.seed_ratio
        )
        logger.info(f"Created initial population of {len(self.population)} structures")

        # Evolution loop
        for gen in range(self.config.n_generations):
            self.state.current_generation = gen

            # Evaluate fitness
            fitnesses = self._evaluate_population()

            # Compute stats
            stats = self._compute_generation_stats(fitnesses)
            self.state.generations.append(stats)

            # Log progress
            logger.info(
                f"Gen {gen:3d}: "
                f"Best={stats.best_fitness:.3f} "
                f"Med={stats.median_fitness:.3f} "
                f"Unique={stats.n_unique_structures}"
            )

            # Check early stopping
            if self._check_early_stopping(stats):
                break

            # Save checkpoint periodically
            if gen > 0 and gen % self.config.save_every_n_generations == 0:
                self._save_checkpoint()

            # Create next generation
            elite, survivors = self._select_parents(fitnesses)
            self.population = self._create_next_generation(elite, survivors)

        # Final evaluation on validation set
        logger.info("\n" + "=" * 60)
        logger.info("VALIDATION PHASE")
        logger.info("=" * 60)

        # Re-evaluate top structures on validation data
        ranked = sorted(self.population, key=lambda d: d.fitness_score, reverse=True)
        top_structures = ranked[:20]

        validated = []
        for dna in top_structures:
            # Backtest on validation period
            result = self.backtester.backtest(
                dna,
                start_date=self.val_dates[0],
                end_date=self.val_dates[1]
            )

            val_fitness = compute_fitness(
                result,
                sharpe_weight=self.config.sharpe_weight,
                sortino_weight=self.config.sortino_weight,
                calmar_weight=self.config.calmar_weight,
                win_rate_weight=self.config.win_rate_weight,
            )

            # Check for overfitting (train >> val)
            train_fitness = dna.fitness_score
            overfit_ratio = train_fitness / val_fitness if val_fitness > 0 else float('inf')

            if overfit_ratio < 2.0 and val_fitness > self.config.min_fitness_threshold:
                validated.append((dna, val_fitness, result))
                logger.info(
                    f"  PASS: {format_dna(dna)} "
                    f"| Train={train_fitness:.3f} Val={val_fitness:.3f}"
                )
            else:
                logger.info(
                    f"  FAIL (overfit): {format_dna(dna)} "
                    f"| Train={train_fitness:.3f} Val={val_fitness:.3f}"
                )

        # Sort by validation fitness
        validated.sort(key=lambda x: x[1], reverse=True)

        # Final save
        self._save_checkpoint()

        logger.info("\n" + "=" * 60)
        logger.info(f"DISCOVERED {len(validated)} VALIDATED STRUCTURES")
        logger.info("=" * 60)

        return [dna for dna, _, _ in validated]

    def test_discovered(
        self,
        structures: List[StructureDNA]
    ) -> pd.DataFrame:
        """
        Test discovered structures on held-out test data.

        Args:
            structures: Validated structures from evolve()

        Returns:
            DataFrame with test results
        """
        logger.info("\n" + "=" * 60)
        logger.info("FINAL TEST (Out-of-Sample)")
        logger.info("=" * 60)

        results = []
        for dna in structures:
            result = self.backtester.backtest(
                dna,
                start_date=self.test_dates[0],
                end_date=self.test_dates[1]
            )

            results.append({
                'structure_type': dna.structure_type.value,
                'dte': dna.dte_bucket.value,
                'delta': dna.delta_bucket.value,
                'regimes': str(dna.entry_regimes),
                'test_sharpe': result.sharpe_ratio,
                'test_return': result.total_return,
                'test_max_dd': result.max_drawdown,
                'test_win_rate': result.win_rate,
                'test_n_trades': result.n_trades,
            })

            logger.info(
                f"  {format_dna(dna)} | "
                f"Sharpe={result.sharpe_ratio:.2f} "
                f"Return={result.total_return:.1%}"
            )

        return pd.DataFrame(results)


# ============================================================================
# WALK-FORWARD VALIDATION
# ============================================================================

def run_walk_forward(
    miner: StructureMiner,
    n_folds: int = 3
) -> List[StructureDNA]:
    """
    Run walk-forward optimization.

    Splits data into N folds and evolves on each, keeping only
    structures that perform well across all folds.

    Args:
        miner: Configured StructureMiner
        n_folds: Number of walk-forward folds

    Returns:
        Structures that survived all folds
    """
    all_dates = sorted(miner.backtester.trading_dates)
    n_dates = len(all_dates)
    fold_size = n_dates // n_folds

    all_discovered = []

    for fold in range(n_folds):
        logger.info(f"\n{'=' * 60}")
        logger.info(f"WALK-FORWARD FOLD {fold + 1}/{n_folds}")
        logger.info(f"{'=' * 60}")

        # Define train/val for this fold
        # Each fold trains on expanding window, validates on next period
        train_start = 0  # Always start from beginning (expanding window)
        train_end = min((fold + 1) * fold_size, n_dates - fold_size // 2)  # Leave room for validation
        val_start = train_end
        val_end = min(val_start + fold_size // 2, n_dates - 1)  # Clamp to valid index

        # Safety check - skip fold if not enough data
        if train_end >= n_dates - 1 or val_end <= val_start:
            logger.warning(f"Skipping fold {fold + 1} - not enough data for validation")
            continue

        miner.train_dates = (all_dates[train_start], all_dates[train_end])
        miner.val_dates = (all_dates[val_start], all_dates[val_end])

        logger.info(f"Train: {miner.train_dates[0].date()} to {miner.train_dates[1].date()}")
        logger.info(f"Val: {miner.val_dates[0].date()} to {miner.val_dates[1].date()}")

        # Reset and evolve
        miner.population = create_initial_population(
            miner.config.population_size,
            miner.config.seed_ratio
        )
        miner.fitness_cache = {}
        miner.state = EvolutionState(config=miner.config)

        discovered = miner.evolve()
        all_discovered.extend(discovered)

    # Count occurrences across folds
    structure_counts = {}
    for dna in all_discovered:
        key = miner._get_dna_hash(dna)
        structure_counts[key] = structure_counts.get(key, 0) + 1

    # Keep structures that appeared in majority of folds
    min_occurrences = max(1, n_folds // 2)
    robust_structures = [
        dna for dna in all_discovered
        if structure_counts[miner._get_dna_hash(dna)] >= min_occurrences
    ]

    # Deduplicate
    seen = set()
    unique_robust = []
    for dna in robust_structures:
        key = miner._get_dna_hash(dna)
        if key not in seen:
            seen.add(key)
            unique_robust.append(dna)

    logger.info(f"\n{'=' * 60}")
    logger.info(f"WALK-FORWARD COMPLETE: {len(unique_robust)} robust structures")
    logger.info(f"{'=' * 60}")

    return unique_robust


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    parser = argparse.ArgumentParser(description='Structure Miner - Discover Options Structures')
    parser.add_argument('--data', type=str, required=True,
                        help='Path to price data parquet')
    parser.add_argument('--regimes', type=str, required=True,
                        help='Path to regime assignments parquet')
    parser.add_argument('--output', type=str, default='./discovered_structures',
                        help='Output directory')
    parser.add_argument('--population', type=int, default=100,
                        help='Population size')
    parser.add_argument('--generations', type=int, default=50,
                        help='Number of generations')
    parser.add_argument('--walk-forward', action='store_true',
                        help='Use walk-forward validation')
    parser.add_argument('--n-folds', type=int, default=3,
                        help='Number of walk-forward folds')

    args = parser.parse_args()

    # Initialize backtester
    backtester = PrecisionBacktester(
        data_path=Path(args.data),
        regime_path=Path(args.regimes)
    )

    # Configure evolution
    config = EvolutionConfig(
        population_size=args.population,
        n_generations=args.generations,
        output_dir=Path(args.output)
    )

    # Create miner
    miner = StructureMiner(config, backtester)

    if args.walk_forward:
        # Walk-forward optimization
        discovered = run_walk_forward(miner, args.n_folds)
    else:
        # Standard evolution
        discovered = miner.evolve()

    # Test on held-out data
    test_results = miner.test_discovered(discovered)

    # Save final results
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)

    test_results.to_csv(output_path / 'test_results.csv', index=False)

    # Save discovered structures
    discovered_dicts = [d.to_dict() for d in discovered]
    with open(output_path / 'discovered_structures.json', 'w') as f:
        json.dump(discovered_dicts, f, indent=2, default=str)

    print(f"\nResults saved to {output_path}")
