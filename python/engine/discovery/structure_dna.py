#!/usr/bin/env python3
"""
Structure DNA: Parameterized Options Structure Definitions

This module defines the genetic encoding for options structures.
Each structure is represented as a "DNA" object with:
- Structure type (straddle, spread, condor, etc.)
- DTE bucket (7d, 14d, 30d, etc.)
- Delta/strike selection (ATM, 25D, 10D, 5D)
- Entry regime filter
- Exit parameters

The DNA is evolvable by the Structure Miner genetic algorithm.
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

class StructureType(Enum):
    """18 supported options structure types."""
    # Single leg
    LONG_CALL = 'long_call'
    LONG_PUT = 'long_put'
    SHORT_CALL = 'short_call'
    SHORT_PUT = 'short_put'

    # Straddles/Strangles
    LONG_STRADDLE = 'long_straddle'
    SHORT_STRADDLE = 'short_straddle'
    LONG_STRANGLE = 'long_strangle'
    SHORT_STRANGLE = 'short_strangle'

    # Vertical spreads
    CALL_DEBIT_SPREAD = 'call_debit_spread'      # Long call + short higher call
    CALL_CREDIT_SPREAD = 'call_credit_spread'    # Short call + long higher call
    PUT_DEBIT_SPREAD = 'put_debit_spread'        # Long put + short lower put
    PUT_CREDIT_SPREAD = 'put_credit_spread'      # Short put + long lower put

    # Iron structures
    IRON_CONDOR = 'iron_condor'                  # Short strangle + long wings
    IRON_BUTTERFLY = 'iron_butterfly'            # Short straddle + long wings

    # Calendar/Diagonal
    CALL_CALENDAR = 'call_calendar'              # Long far + short near (same strike)
    PUT_CALENDAR = 'put_calendar'
    CALL_DIAGONAL = 'call_diagonal'              # Long far OTM + short near ATM
    PUT_DIAGONAL = 'put_diagonal'


class DTEBucket(Enum):
    """DTE buckets for structure selection."""
    DTE_7 = 7
    DTE_14 = 14
    DTE_21 = 21
    DTE_30 = 30
    DTE_45 = 45
    DTE_60 = 60
    DTE_90 = 90
    DTE_120 = 120


class DeltaBucket(Enum):
    """Delta buckets for strike selection."""
    ATM = 'ATM'      # 50 delta
    D25 = '25D'      # 25 delta (~3% OTM)
    D10 = '10D'      # 10 delta (~6% OTM)
    D5 = '5D'        # 5 delta (~10% OTM)


# ============================================================================
# STRUCTURE DNA
# ============================================================================

@dataclass
class StructureDNA:
    """
    Genetic encoding for an options structure.

    This is the "chromosome" that the genetic algorithm evolves.
    """
    # Core structure definition
    structure_type: StructureType
    dte_bucket: DTEBucket
    delta_bucket: DeltaBucket

    # Multi-leg parameters (for spreads, condors, etc.)
    spread_width_pct: float = 0.05       # Width between strikes as % of spot
    wing_width_pct: float = 0.10         # Distance to wing strikes (condors/butterflies)
    back_month_offset: int = 30          # Additional DTE for calendar/diagonal back leg

    # Entry conditions
    entry_regimes: List[int] = field(default_factory=lambda: [0, 1, 2, 3])
    min_iv_rank: float = 0.0             # Minimum IV rank (0-1)
    max_iv_rank: float = 1.0             # Maximum IV rank
    min_vix: float = 0.0                 # Minimum VIX level
    max_vix: float = 100.0               # Maximum VIX level

    # Exit conditions
    profit_target_pct: float = 0.50      # Exit at 50% profit
    stop_loss_pct: float = 1.00          # Exit at 100% loss
    dte_exit_threshold: int = 7          # Exit when DTE falls below this
    regime_exit: bool = True             # Exit on regime change

    # Computed properties
    generation: int = 0                  # Which GA generation this came from
    parent_ids: List[str] = field(default_factory=list)  # For lineage tracking
    fitness_score: float = 0.0           # Last computed fitness

    def __post_init__(self):
        """Ensure valid values."""
        if not self.entry_regimes:
            self.entry_regimes = [0, 1, 2, 3]

    @property
    def structure_key(self) -> str:
        """
        Generate lookup key for payoff surface.

        Format: {DIRECTION}_{TYPE}_{DELTA}_{DTE}DTE
        Example: LONG_STRADDLE_ATM_30DTE
        """
        stype = self.structure_type.value.upper()
        delta = self.delta_bucket.value
        dte = self.dte_bucket.value
        return f"{stype}_{delta}_{dte}DTE"

    @property
    def n_legs(self) -> int:
        """Number of option legs in this structure."""
        LEG_COUNTS = {
            StructureType.LONG_CALL: 1,
            StructureType.LONG_PUT: 1,
            StructureType.SHORT_CALL: 1,
            StructureType.SHORT_PUT: 1,
            StructureType.LONG_STRADDLE: 2,
            StructureType.SHORT_STRADDLE: 2,
            StructureType.LONG_STRANGLE: 2,
            StructureType.SHORT_STRANGLE: 2,
            StructureType.CALL_DEBIT_SPREAD: 2,
            StructureType.CALL_CREDIT_SPREAD: 2,
            StructureType.PUT_DEBIT_SPREAD: 2,
            StructureType.PUT_CREDIT_SPREAD: 2,
            StructureType.IRON_CONDOR: 4,
            StructureType.IRON_BUTTERFLY: 4,
            StructureType.CALL_CALENDAR: 2,
            StructureType.PUT_CALENDAR: 2,
            StructureType.CALL_DIAGONAL: 2,
            StructureType.PUT_DIAGONAL: 2,
        }
        return LEG_COUNTS.get(self.structure_type, 1)

    @property
    def is_long_premium(self) -> bool:
        """True if this structure pays premium (long options)."""
        LONG_PREMIUM = {
            StructureType.LONG_CALL,
            StructureType.LONG_PUT,
            StructureType.LONG_STRADDLE,
            StructureType.LONG_STRANGLE,
            StructureType.CALL_DEBIT_SPREAD,
            StructureType.PUT_DEBIT_SPREAD,
            StructureType.CALL_CALENDAR,  # Net debit typically
            StructureType.PUT_CALENDAR,
            StructureType.CALL_DIAGONAL,
            StructureType.PUT_DIAGONAL,
        }
        return self.structure_type in LONG_PREMIUM

    @property
    def estimated_slippage(self) -> float:
        """
        Estimate slippage cost as % of premium.

        Based on:
        - Number of legs (more legs = more slippage)
        - Delta bucket (OTM options have wider spreads)
        - DTE (shorter DTE = tighter spreads usually)
        """
        # Base spread by delta
        DELTA_SPREAD = {
            DeltaBucket.ATM: 0.02,   # ~2% of premium
            DeltaBucket.D25: 0.04,   # ~4%
            DeltaBucket.D10: 0.08,   # ~8%
            DeltaBucket.D5: 0.15,    # ~15%
        }
        base = DELTA_SPREAD.get(self.delta_bucket, 0.05)

        # Multiply by legs
        return base * self.n_legs

    def to_dict(self) -> Dict:
        """Serialize to dictionary."""
        return {
            'structure_type': self.structure_type.value,
            'dte_bucket': self.dte_bucket.value,
            'delta_bucket': self.delta_bucket.value,
            'spread_width_pct': self.spread_width_pct,
            'wing_width_pct': self.wing_width_pct,
            'back_month_offset': self.back_month_offset,
            'entry_regimes': self.entry_regimes,
            'min_iv_rank': self.min_iv_rank,
            'max_iv_rank': self.max_iv_rank,
            'min_vix': self.min_vix,
            'max_vix': self.max_vix,
            'profit_target_pct': self.profit_target_pct,
            'stop_loss_pct': self.stop_loss_pct,
            'dte_exit_threshold': self.dte_exit_threshold,
            'regime_exit': self.regime_exit,
            'generation': self.generation,
            'fitness_score': self.fitness_score,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> 'StructureDNA':
        """Deserialize from dictionary."""
        return cls(
            structure_type=StructureType(d['structure_type']),
            dte_bucket=DTEBucket(d['dte_bucket']),
            delta_bucket=DeltaBucket(d['delta_bucket']),
            spread_width_pct=d.get('spread_width_pct', 0.05),
            wing_width_pct=d.get('wing_width_pct', 0.10),
            back_month_offset=d.get('back_month_offset', 30),
            entry_regimes=d.get('entry_regimes', [0, 1, 2, 3]),
            min_iv_rank=d.get('min_iv_rank', 0.0),
            max_iv_rank=d.get('max_iv_rank', 1.0),
            min_vix=d.get('min_vix', 0.0),
            max_vix=d.get('max_vix', 100.0),
            profit_target_pct=d.get('profit_target_pct', 0.50),
            stop_loss_pct=d.get('stop_loss_pct', 1.00),
            dte_exit_threshold=d.get('dte_exit_threshold', 7),
            regime_exit=d.get('regime_exit', True),
            generation=d.get('generation', 0),
            fitness_score=d.get('fitness_score', 0.0),
        )


# ============================================================================
# GENETIC OPERATORS
# ============================================================================

def create_random_dna() -> StructureDNA:
    """Create a random structure DNA."""
    return StructureDNA(
        structure_type=random.choice(list(StructureType)),
        dte_bucket=random.choice(list(DTEBucket)),
        delta_bucket=random.choice(list(DeltaBucket)),
        spread_width_pct=random.uniform(0.02, 0.15),
        wing_width_pct=random.uniform(0.05, 0.20),
        back_month_offset=random.choice([14, 21, 30, 45, 60]),
        entry_regimes=random.sample([0, 1, 2, 3], k=random.randint(1, 4)),
        min_iv_rank=random.uniform(0.0, 0.5),
        max_iv_rank=random.uniform(0.5, 1.0),
        profit_target_pct=random.uniform(0.20, 1.00),
        stop_loss_pct=random.uniform(0.50, 2.00),
        dte_exit_threshold=random.choice([3, 5, 7, 10, 14]),
        regime_exit=random.choice([True, False]),
    )


def mutate_dna(dna: StructureDNA, mutation_rate: float = 0.1) -> StructureDNA:
    """
    Mutate a DNA with given probability per gene.

    Returns new DNA (does not modify original).
    """
    new = copy.deepcopy(dna)

    # Structure type mutation
    if random.random() < mutation_rate:
        new.structure_type = random.choice(list(StructureType))

    # DTE bucket mutation
    if random.random() < mutation_rate:
        new.dte_bucket = random.choice(list(DTEBucket))

    # Delta bucket mutation
    if random.random() < mutation_rate:
        new.delta_bucket = random.choice(list(DeltaBucket))

    # Numeric parameters - small perturbation
    if random.random() < mutation_rate:
        new.spread_width_pct = np.clip(
            new.spread_width_pct + random.gauss(0, 0.02),
            0.01, 0.30
        )

    if random.random() < mutation_rate:
        new.wing_width_pct = np.clip(
            new.wing_width_pct + random.gauss(0, 0.03),
            0.03, 0.30
        )

    if random.random() < mutation_rate:
        new.back_month_offset = max(7, new.back_month_offset + random.randint(-14, 14))

    # Entry regimes - add or remove one
    if random.random() < mutation_rate:
        if len(new.entry_regimes) < 4 and random.random() > 0.5:
            available = [r for r in [0, 1, 2, 3] if r not in new.entry_regimes]
            if available:
                new.entry_regimes.append(random.choice(available))
        elif len(new.entry_regimes) > 1:
            new.entry_regimes.remove(random.choice(new.entry_regimes))

    # IV rank bounds
    if random.random() < mutation_rate:
        new.min_iv_rank = np.clip(new.min_iv_rank + random.gauss(0, 0.1), 0, 0.9)
    if random.random() < mutation_rate:
        new.max_iv_rank = np.clip(new.max_iv_rank + random.gauss(0, 0.1), new.min_iv_rank + 0.1, 1.0)

    # Exit parameters
    if random.random() < mutation_rate:
        new.profit_target_pct = np.clip(new.profit_target_pct + random.gauss(0, 0.1), 0.10, 2.0)

    if random.random() < mutation_rate:
        new.stop_loss_pct = np.clip(new.stop_loss_pct + random.gauss(0, 0.2), 0.25, 3.0)

    if random.random() < mutation_rate:
        new.dte_exit_threshold = max(1, new.dte_exit_threshold + random.randint(-3, 3))

    if random.random() < mutation_rate:
        new.regime_exit = not new.regime_exit

    return new


def crossover_dna(parent1: StructureDNA, parent2: StructureDNA) -> StructureDNA:
    """
    Create child DNA by crossing over two parents.

    Uses uniform crossover - each gene comes from random parent.
    """
    child = StructureDNA(
        structure_type=random.choice([parent1.structure_type, parent2.structure_type]),
        dte_bucket=random.choice([parent1.dte_bucket, parent2.dte_bucket]),
        delta_bucket=random.choice([parent1.delta_bucket, parent2.delta_bucket]),
        spread_width_pct=random.choice([parent1.spread_width_pct, parent2.spread_width_pct]),
        wing_width_pct=random.choice([parent1.wing_width_pct, parent2.wing_width_pct]),
        back_month_offset=random.choice([parent1.back_month_offset, parent2.back_month_offset]),
        entry_regimes=random.choice([parent1.entry_regimes[:], parent2.entry_regimes[:]]),
        min_iv_rank=random.choice([parent1.min_iv_rank, parent2.min_iv_rank]),
        max_iv_rank=random.choice([parent1.max_iv_rank, parent2.max_iv_rank]),
        profit_target_pct=random.choice([parent1.profit_target_pct, parent2.profit_target_pct]),
        stop_loss_pct=random.choice([parent1.stop_loss_pct, parent2.stop_loss_pct]),
        dte_exit_threshold=random.choice([parent1.dte_exit_threshold, parent2.dte_exit_threshold]),
        regime_exit=random.choice([parent1.regime_exit, parent2.regime_exit]),
    )
    child.parent_ids = [id(parent1), id(parent2)]
    return child


# ============================================================================
# SEED STRUCTURES (NOT RANDOM TRASH)
# ============================================================================

def get_seed_structures() -> List[StructureDNA]:
    """
    Get logical seed structures for Generation 0.

    These come from:
    1. HighVelocitySigmaAgent observed patterns
    2. Existing Profile 1-6 logic
    3. Known-logical options strategies

    The GA evolves FROM these, not from random noise.
    """
    seeds = []

    # === From Profile 1: Long-dated gamma (60-90 DTE straddles) ===
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_STRADDLE,
        dte_bucket=DTEBucket.DTE_60,
        delta_bucket=DeltaBucket.ATM,
        entry_regimes=[1, 3],  # Trend up, compression
        profit_target_pct=0.50,
        stop_loss_pct=0.50,
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_STRADDLE,
        dte_bucket=DTEBucket.DTE_90,
        delta_bucket=DeltaBucket.ATM,
        entry_regimes=[1, 3],
        profit_target_pct=0.75,
        stop_loss_pct=0.50,
    ))

    # === From Profile 2: Short-dated gamma (7-14 DTE) ===
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_STRADDLE,
        dte_bucket=DTEBucket.DTE_14,
        delta_bucket=DeltaBucket.ATM,
        entry_regimes=[0, 2],  # Low vol, expansion
        profit_target_pct=0.30,
        stop_loss_pct=0.40,
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_STRANGLE,
        dte_bucket=DTEBucket.DTE_7,
        delta_bucket=DeltaBucket.D25,
        entry_regimes=[2],  # Expansion only
        profit_target_pct=0.50,
        stop_loss_pct=0.30,
    ))

    # === Mean reversion structures (short vol after spike) ===
    seeds.append(StructureDNA(
        structure_type=StructureType.SHORT_STRANGLE,
        dte_bucket=DTEBucket.DTE_30,
        delta_bucket=DeltaBucket.D10,
        entry_regimes=[0],  # Low vol regime
        min_iv_rank=0.0,
        max_iv_rank=0.30,  # Only when IV is low
        profit_target_pct=0.50,
        stop_loss_pct=2.00,  # Wide stop for short premium
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.IRON_CONDOR,
        dte_bucket=DTEBucket.DTE_45,
        delta_bucket=DeltaBucket.D10,
        entry_regimes=[0, 1],  # Low vol, trend up
        wing_width_pct=0.05,
        profit_target_pct=0.50,
        stop_loss_pct=1.50,
    ))

    # === Trend-following structures ===
    seeds.append(StructureDNA(
        structure_type=StructureType.CALL_DEBIT_SPREAD,
        dte_bucket=DTEBucket.DTE_45,
        delta_bucket=DeltaBucket.ATM,
        spread_width_pct=0.05,
        entry_regimes=[1],  # Trend up only
        profit_target_pct=0.75,
        stop_loss_pct=0.50,
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.PUT_DEBIT_SPREAD,
        dte_bucket=DTEBucket.DTE_45,
        delta_bucket=DeltaBucket.ATM,
        spread_width_pct=0.05,
        entry_regimes=[2],  # Expansion (often down)
        profit_target_pct=0.75,
        stop_loss_pct=0.50,
    ))

    # === Calendar spreads (volatility term structure) ===
    seeds.append(StructureDNA(
        structure_type=StructureType.CALL_CALENDAR,
        dte_bucket=DTEBucket.DTE_30,
        delta_bucket=DeltaBucket.ATM,
        back_month_offset=30,
        entry_regimes=[0, 1],  # Low vol or trending
        profit_target_pct=0.30,
        stop_loss_pct=0.50,
    ))

    # === High IV crush plays ===
    seeds.append(StructureDNA(
        structure_type=StructureType.SHORT_STRADDLE,
        dte_bucket=DTEBucket.DTE_21,
        delta_bucket=DeltaBucket.ATM,
        entry_regimes=[2, 3],  # After vol spike
        min_iv_rank=0.70,  # Only when IV is high
        max_iv_rank=1.00,
        profit_target_pct=0.30,
        stop_loss_pct=1.00,
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.IRON_BUTTERFLY,
        dte_bucket=DTEBucket.DTE_30,
        delta_bucket=DeltaBucket.ATM,
        wing_width_pct=0.08,
        entry_regimes=[2, 3],
        min_iv_rank=0.60,
        profit_target_pct=0.40,
        stop_loss_pct=1.00,
    ))

    # === Directional plays for specific regimes ===
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_CALL,
        dte_bucket=DTEBucket.DTE_30,
        delta_bucket=DeltaBucket.D25,
        entry_regimes=[1],  # Strong uptrend
        profit_target_pct=1.00,
        stop_loss_pct=0.50,
    ))
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_PUT,
        dte_bucket=DTEBucket.DTE_30,
        delta_bucket=DeltaBucket.D25,
        entry_regimes=[2],  # Expansion/crash
        profit_target_pct=1.50,
        stop_loss_pct=0.50,
    ))

    # === Tail hedges ===
    seeds.append(StructureDNA(
        structure_type=StructureType.LONG_PUT,
        dte_bucket=DTEBucket.DTE_60,
        delta_bucket=DeltaBucket.D5,
        entry_regimes=[0, 1, 2, 3],  # Always on
        profit_target_pct=5.00,  # Let winners run
        stop_loss_pct=1.00,
    ))

    return seeds


def get_mutated_seeds(n: int = 80, mutation_rate: float = 0.2) -> List[StructureDNA]:
    """
    Get mutations of seed structures.

    Creates a population that is mostly variations of logical seeds,
    not random noise.

    Args:
        n: Number of mutated structures to create
        mutation_rate: How much to mutate each seed

    Returns:
        List of mutated DNA structures
    """
    seeds = get_seed_structures()
    mutated = []

    for _ in range(n):
        base = random.choice(seeds)
        mutant = mutate_dna(base, mutation_rate)
        mutant.generation = 0
        mutated.append(mutant)

    return mutated


def create_initial_population(
    population_size: int = 100,
    seed_ratio: float = 0.20
) -> List[StructureDNA]:
    """
    Create initial population for GA.

    Args:
        population_size: Total population size
        seed_ratio: What fraction should be pure seeds (vs mutated seeds)

    Returns:
        List of DNA structures ready for evolution
    """
    seeds = get_seed_structures()
    n_seeds = int(population_size * seed_ratio)
    n_mutated = population_size - n_seeds

    # Repeat seeds to fill quota
    pure_seeds = []
    while len(pure_seeds) < n_seeds:
        pure_seeds.extend(seeds)
    pure_seeds = pure_seeds[:n_seeds]

    # Create mutated versions
    mutated = get_mutated_seeds(n_mutated)

    population = pure_seeds + mutated
    random.shuffle(population)

    return population


# ============================================================================
# STRUCTURE KEY MAPPING
# ============================================================================

def get_payoff_surface_keys_for_dna(dna: StructureDNA) -> List[str]:
    """
    Get all payoff surface keys that this DNA might use.

    Some structures need multiple lookups:
    - Spread: ATM call + OTM call
    - Condor: Multiple delta levels

    Returns list of structure_key strings to look up.
    """
    stype = dna.structure_type
    delta = dna.delta_bucket.value
    dte = dna.dte_bucket.value

    # Simple structures - single lookup
    SIMPLE = {
        StructureType.LONG_CALL: f"LONG_CALL_{delta}_{dte}DTE",
        StructureType.LONG_PUT: f"LONG_PUT_{delta}_{dte}DTE",
        StructureType.SHORT_CALL: f"SHORT_CALL_{delta}_{dte}DTE",
        StructureType.SHORT_PUT: f"SHORT_PUT_{delta}_{dte}DTE",
        StructureType.LONG_STRADDLE: f"LONG_STRADDLE_{delta}_{dte}DTE",
        StructureType.SHORT_STRADDLE: f"SHORT_STRADDLE_{delta}_{dte}DTE",
        StructureType.LONG_STRANGLE: f"LONG_STRANGLE_{delta}_{dte}DTE",
        StructureType.SHORT_STRANGLE: f"SHORT_STRANGLE_{delta}_{dte}DTE",
    }

    if stype in SIMPLE:
        return [SIMPLE[stype]]

    # Complex structures - multiple lookups needed
    # These are approximations - real backtester will need more sophistication
    if stype == StructureType.CALL_DEBIT_SPREAD:
        return [f"LONG_CALL_ATM_{dte}DTE", f"SHORT_CALL_25D_{dte}DTE"]

    if stype == StructureType.CALL_CREDIT_SPREAD:
        return [f"SHORT_CALL_ATM_{dte}DTE", f"LONG_CALL_25D_{dte}DTE"]

    if stype == StructureType.PUT_DEBIT_SPREAD:
        return [f"LONG_PUT_ATM_{dte}DTE", f"SHORT_PUT_25D_{dte}DTE"]

    if stype == StructureType.PUT_CREDIT_SPREAD:
        return [f"SHORT_PUT_ATM_{dte}DTE", f"LONG_PUT_25D_{dte}DTE"]

    if stype == StructureType.IRON_CONDOR:
        return [
            f"SHORT_CALL_25D_{dte}DTE",
            f"LONG_CALL_10D_{dte}DTE",
            f"SHORT_PUT_25D_{dte}DTE",
            f"LONG_PUT_10D_{dte}DTE",
        ]

    if stype == StructureType.IRON_BUTTERFLY:
        return [
            f"SHORT_STRADDLE_ATM_{dte}DTE",
            f"LONG_CALL_25D_{dte}DTE",
            f"LONG_PUT_25D_{dte}DTE",
        ]

    # Calendar spreads need different DTE
    back_dte = min(120, dte + dna.back_month_offset)
    if stype == StructureType.CALL_CALENDAR:
        return [f"SHORT_CALL_{delta}_{dte}DTE", f"LONG_CALL_{delta}_{back_dte}DTE"]

    if stype == StructureType.PUT_CALENDAR:
        return [f"SHORT_PUT_{delta}_{dte}DTE", f"LONG_PUT_{delta}_{back_dte}DTE"]

    if stype == StructureType.CALL_DIAGONAL:
        return [f"SHORT_CALL_ATM_{dte}DTE", f"LONG_CALL_25D_{back_dte}DTE"]

    if stype == StructureType.PUT_DIAGONAL:
        return [f"SHORT_PUT_ATM_{dte}DTE", f"LONG_PUT_25D_{back_dte}DTE"]

    # Fallback
    return [f"LONG_STRADDLE_ATM_{dte}DTE"]


# ============================================================================
# SLIPPAGE MODEL
# ============================================================================

def estimate_slippage_cost(dna: StructureDNA, premium: float = 1.0) -> float:
    """
    Estimate slippage cost for this structure.

    Args:
        dna: Structure DNA
        premium: Approximate premium value for scaling

    Returns:
        Estimated slippage as dollar amount per contract
    """
    # Base spread by delta
    DELTA_SPREAD_PCT = {
        DeltaBucket.ATM: 0.03,   # 3% of premium
        DeltaBucket.D25: 0.06,   # 6%
        DeltaBucket.D10: 0.12,   # 12%
        DeltaBucket.D5: 0.25,    # 25%
    }

    base_pct = DELTA_SPREAD_PCT.get(dna.delta_bucket, 0.05)

    # Scale by number of legs
    total_pct = base_pct * dna.n_legs

    # Short DTE has tighter spreads (for liquid options)
    if dna.dte_bucket.value <= 14:
        total_pct *= 0.8
    elif dna.dte_bucket.value >= 90:
        total_pct *= 1.3

    return premium * total_pct


# ============================================================================
# DISPLAY
# ============================================================================

def format_dna(dna: StructureDNA) -> str:
    """Format DNA as human-readable string."""
    return (
        f"{dna.structure_type.value.upper()} | "
        f"{dna.delta_bucket.value} | "
        f"{dna.dte_bucket.value}DTE | "
        f"Regimes: {dna.entry_regimes} | "
        f"Fitness: {dna.fitness_score:.3f}"
    )


# ============================================================================
# TESTING
# ============================================================================

if __name__ == '__main__':
    print("=== Seed Structures ===")
    for seed in get_seed_structures():
        print(f"  {format_dna(seed)}")
        print(f"    Key: {seed.structure_key}")
        print(f"    Legs: {seed.n_legs}, Slippage: {seed.estimated_slippage:.1%}")
        print()

    print("\n=== Initial Population (10 samples) ===")
    pop = create_initial_population(100)
    for dna in pop[:10]:
        print(f"  {format_dna(dna)}")

    print("\n=== Mutation Test ===")
    original = get_seed_structures()[0]
    print(f"Original: {format_dna(original)}")
    for i in range(3):
        mutant = mutate_dna(original, 0.3)
        print(f"Mutant {i+1}: {format_dna(mutant)}")

    print("\n=== Crossover Test ===")
    p1 = get_seed_structures()[0]
    p2 = get_seed_structures()[5]
    print(f"Parent 1: {format_dna(p1)}")
    print(f"Parent 2: {format_dna(p2)}")
    child = crossover_dna(p1, p2)
    print(f"Child:    {format_dna(child)}")
