"""
Feature generation modules for Alpha Factory.

Layers:
1. raw_features - Basic OHLCV-derived features (~220)
2. regime - VIX/trend regime classification (~20)
3. domain_features - VIX term structure, vol signals (~17)
4. momentum_logic - Momentum scoring (~29)
5. cross_asset - Cross-asset ratios and correlations (~32)
6. sector_regime - Sector rotation/momentum (~25 per sector)

Total: ~320+ features from OHLCV + ~100+ harvested domain logic
"""

from .raw_features import RawFeatureGenerator
from .regime import RegimeAnalyzer, add_regime_features
from .domain_features import VolatilityFeatures, add_domain_features
from .momentum_logic import MomentumScorer, add_momentum_features
from .cross_asset import (
    AssetPairFeatures,
    SectorRotationFeatures,
    SpyVixFeatures,
    add_cross_asset_features
)
from .sector_regime import (
    SectorRegimeAnalyzer,
    RotationDetector,
    add_sector_regime_features
)

__all__ = [
    # Raw features
    'RawFeatureGenerator',
    # Regime
    'RegimeAnalyzer',
    'add_regime_features',
    # Domain
    'VolatilityFeatures',
    'add_domain_features',
    # Momentum
    'MomentumScorer',
    'add_momentum_features',
    # Cross-asset
    'AssetPairFeatures',
    'SectorRotationFeatures',
    'SpyVixFeatures',
    'add_cross_asset_features',
    # Sector regime
    'SectorRegimeAnalyzer',
    'RotationDetector',
    'add_sector_regime_features',
]
