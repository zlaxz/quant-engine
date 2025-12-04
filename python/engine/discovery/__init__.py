"""
Discovery Module - Autonomous Market Scanning & Structure Discovery

This module enables:
1. Autonomous market scanning for opportunities
2. Options structure discovery via genetic algorithm
3. Payoff surface pre-computation for fast backtesting
"""

from .morphology_scan import (
    MorphologyScanner,
    MarketOpportunity,
    OpportunityType,
    scan_for_opportunities,
)

from .structure_dna import (
    StructureDNA,
    StructureType,
    DTEBucket,
    DeltaBucket,
    create_initial_population,
    get_seed_structures,
    mutate_dna,
    crossover_dna,
)

from .payoff_surface_builder import (
    PayoffSurfaceBuilder,
    PayoffSurfaceLookup,
    parse_occ_ticker,
    ParsedOption,
)

from .fast_backtester import (
    FastBacktester,
    BacktestResult,
    compute_fitness,
)

from .structure_miner import (
    StructureMiner,
    EvolutionConfig,
    run_walk_forward,
)

__all__ = [
    # Morphology scanning
    'MorphologyScanner',
    'MarketOpportunity',
    'OpportunityType',
    'scan_for_opportunities',
    # Structure DNA
    'StructureDNA',
    'StructureType',
    'DTEBucket',
    'DeltaBucket',
    'create_initial_population',
    'get_seed_structures',
    'mutate_dna',
    'crossover_dna',
    # Payoff surface
    'PayoffSurfaceBuilder',
    'PayoffSurfaceLookup',
    'parse_occ_ticker',
    'ParsedOption',
    # Fast backtester
    'FastBacktester',
    'BacktestResult',
    'compute_fitness',
    # Structure miner
    'StructureMiner',
    'EvolutionConfig',
    'run_walk_forward',
]
