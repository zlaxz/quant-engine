"""
Phase 5 Validation Suite - Market Physics Engine

This test suite validates the force calculations, causal relationships,
regime-conditional strategies, and ensures no overfitting beyond Fano limits.

Test Files:
- test_force_validation.py: Component validation for each force
- test_causal_validation.py: Causal relationship verification
- test_regime_backtest.py: Per-regime strategy validation
- test_fano_sanity.py: Overfit detection via Fano limit

Usage:
    pytest python/tests/ -v
    pytest python/tests/test_force_validation.py -v
"""
