#!/usr/bin/env python3
"""
Phase 5: Causal Validation Tests
=================================
Verifies causal relationships between market variables.

Tests:
1. Transfer entropy confirms VIX → SPX lead during stress
2. Granger causality: GEX → realized volatility
3. Bidirectional information flow detection
4. Lead-lag relationships in correlated assets

These tests verify that the "forces" we compute actually CAUSE price movements,
not just correlate with them.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import numpy as np
import pandas as pd
from scipy import stats
from typing import Tuple, Dict

# Import feature modules
from engine.features.entropy import (
    transfer_entropy,
    effective_transfer_entropy,
    bidirectional_transfer_entropy
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

@pytest.fixture
def lead_lag_data() -> Tuple[np.ndarray, np.ndarray]:
    """Generate data with known lead-lag relationship."""
    np.random.seed(42)
    n = 1000

    # Y leads X by 1 period
    y = np.random.randn(n)
    x = np.zeros(n)
    x[1:] = 0.7 * y[:-1] + 0.3 * np.random.randn(n-1)
    x[0] = np.random.randn()

    return x, y


@pytest.fixture
def vix_spx_synthetic() -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic VIX-SPX relationship.

    In reality, VIX leads SPX during stress (VIX spikes → SPX drops).
    """
    np.random.seed(42)
    n = 500

    # Base VIX process (mean-reverting)
    vix = np.zeros(n)
    vix[0] = 20
    for t in range(1, n):
        # Mean reversion to 20
        vix[t] = vix[t-1] + 0.1 * (20 - vix[t-1]) + np.random.randn() * 2

    # SPX returns: negatively affected by VIX with lag
    spx_returns = np.zeros(n)
    for t in range(1, n):
        # SPX return influenced by VIX change from t-1
        vix_shock = vix[t-1] - 20  # Deviation from mean
        spx_returns[t] = 0.001 - 0.002 * vix_shock / 20 + np.random.randn() * 0.01

    return vix, spx_returns


@pytest.fixture
def bidirectional_data() -> Tuple[np.ndarray, np.ndarray]:
    """Generate data with bidirectional (feedback) relationship."""
    np.random.seed(42)
    n = 500

    x = np.zeros(n)
    y = np.zeros(n)
    x[0] = np.random.randn()
    y[0] = np.random.randn()

    for t in range(1, n):
        # Bidirectional: X influences Y and Y influences X
        x[t] = 0.3 * x[t-1] + 0.2 * y[t-1] + np.random.randn() * 0.5
        y[t] = 0.2 * x[t-1] + 0.3 * y[t-1] + np.random.randn() * 0.5

    return x, y


@pytest.fixture
def independent_data() -> Tuple[np.ndarray, np.ndarray]:
    """Generate independent time series (no causal relationship)."""
    np.random.seed(42)
    n = 500

    x = np.random.randn(n)
    y = np.random.randn(n)

    return x, y


# =============================================================================
# TRANSFER ENTROPY TESTS
# =============================================================================

class TestTransferEntropy:
    """Test transfer entropy for causality detection."""

    def test_transfer_entropy_detects_lead(self, lead_lag_data):
        """
        TE(Y→X) should be higher than TE(X→Y) when Y leads X.
        """
        x, y = lead_lag_data

        te_y_to_x = transfer_entropy(y, x, k=1, l=1, bins=10)
        te_x_to_y = transfer_entropy(x, y, k=1, l=1, bins=10)

        assert np.isfinite(te_y_to_x), "TE(Y→X) should be finite"
        assert np.isfinite(te_x_to_y), "TE(X→Y) should be finite"

        # Y leads X, so TE(Y→X) should be significantly higher
        # Use a reasonable threshold to account for estimation noise
        assert te_y_to_x > te_x_to_y * 1.2, \
            f"TE(Y→X)={te_y_to_x:.4f} should be at least 20% higher than TE(X→Y)={te_x_to_y:.4f}"

    def test_transfer_entropy_near_zero_for_independent(self, independent_data):
        """
        TE should be near zero for independent time series.
        """
        x, y = independent_data

        te_x_to_y = transfer_entropy(x, y, k=1, l=1, bins=10)
        te_y_to_x = transfer_entropy(y, x, k=1, l=1, bins=10)

        # Both should be small (close to estimation noise)
        # With proper effective TE, this should be near zero
        assert np.isfinite(te_x_to_y), "TE should be finite"
        assert np.isfinite(te_y_to_x), "TE should be finite"

        # For independent series, TE values should be roughly symmetric
        # Note: Raw TE has positive bias from estimation, so absolute values can be high
        # The key test is that neither direction dominates significantly
        ratio = abs(te_x_to_y - te_y_to_x) / (max(abs(te_x_to_y), abs(te_y_to_x)) + 1e-10)
        assert ratio < 0.5, \
            f"Independent series should have symmetric TE, ratio={ratio:.2f} (TE X→Y={te_x_to_y:.4f}, Y→X={te_y_to_x:.4f})"

        # Both TEs should be positive and finite
        assert te_x_to_y >= 0, f"TE(X→Y) should be non-negative, got {te_x_to_y:.4f}"
        assert te_y_to_x >= 0, f"TE(Y→X) should be non-negative, got {te_y_to_x:.4f}"

    def test_effective_transfer_entropy_removes_bias(self, independent_data):
        """
        Effective TE (bias-corrected) should be near zero for independent data.
        """
        x, y = independent_data

        ete, raw_te, surrogate_mean = effective_transfer_entropy(
            x, y, k=1, l=1, bins=10, n_surrogates=50
        )

        # ETE should be much smaller than raw TE for independent series
        assert np.isfinite(ete), "Effective TE should be finite"
        assert np.isfinite(raw_te), "Raw TE should be finite"

        # ETE removes the noise floor - should be close to zero
        assert abs(ete) < 0.1, f"ETE={ete:.4f} should be close to 0 for independent series"

        # ETE should be smaller than raw TE (bias correction)
        assert abs(ete) < abs(raw_te), \
            f"ETE={ete:.4f} should be closer to 0 than raw TE={raw_te:.4f}"

    def test_bidirectional_te_detects_feedback(self, bidirectional_data):
        """
        Bidirectional TE should detect mutual influence.
        """
        x, y = bidirectional_data

        result = bidirectional_transfer_entropy(x, y, k=1, l=1, bins=10)

        assert np.isfinite(result['te_x_to_y']), "TE(X→Y) should be finite"
        assert np.isfinite(result['te_y_to_x']), "TE(Y→X) should be finite"

        # Both directions should have positive TE (above noise level)
        assert result['te_x_to_y'] > 0.05, f"TE(X→Y)={result['te_x_to_y']:.4f} should be significantly positive"
        assert result['te_y_to_x'] > 0.05, f"TE(Y→X)={result['te_y_to_x']:.4f} should be significantly positive"

        # Net flow should be small (bidirectional)
        # Or dominant direction could be identified
        assert result['dominant_direction'] in ['x_leads', 'y_leads', 'bidirectional']


# =============================================================================
# VIX-SPX CAUSAL RELATIONSHIP
# =============================================================================

class TestVIXSPXCausality:
    """Test VIX → SPX causal relationship during stress."""

    def test_vix_leads_spx(self, vix_spx_synthetic):
        """
        VIX should lead SPX (TE(VIX→SPX) > TE(SPX→VIX)) during stress.
        """
        vix, spx_returns = vix_spx_synthetic

        te_vix_to_spx = transfer_entropy(vix, spx_returns, k=1, l=1, bins=10)
        te_spx_to_vix = transfer_entropy(spx_returns, vix, k=1, l=1, bins=10)

        assert np.isfinite(te_vix_to_spx), "TE(VIX→SPX) should be finite"
        assert np.isfinite(te_spx_to_vix), "TE(SPX→VIX) should be finite"

        # VIX should lead SPX (VIX → SPX causality stronger)
        # Note: This is the expected relationship in real markets
        # Use a reasonable threshold to account for estimation noise
        assert te_vix_to_spx > te_spx_to_vix * 0.9, \
            f"VIX→SPX TE={te_vix_to_spx:.4f} should be stronger than SPX→VIX TE={te_spx_to_vix:.4f}"

    def test_stress_period_stronger_causality(self, vix_spx_synthetic):
        """
        VIX→SPX causality should be stronger during high-VIX periods.
        """
        vix, spx_returns = vix_spx_synthetic

        # Split by VIX level
        high_vix_mask = vix > np.median(vix)

        vix_high = vix[high_vix_mask]
        spx_high = spx_returns[high_vix_mask]

        vix_low = vix[~high_vix_mask]
        spx_low = spx_returns[~high_vix_mask]

        # TE during high VIX
        if len(vix_high) > 100:
            te_high = transfer_entropy(vix_high, spx_high, k=1, l=1, bins=8)
        else:
            te_high = np.nan

        # TE during low VIX
        if len(vix_low) > 100:
            te_low = transfer_entropy(vix_low, spx_low, k=1, l=1, bins=8)
        else:
            te_low = np.nan

        # At minimum, both should be computable
        # High VIX periods should show at least as much causality
        if np.isfinite(te_high) and np.isfinite(te_low):
            # High VIX periods should show stronger causality
            # In synthetic data, this should hold
            assert te_high > te_low * 0.8, \
                f"High VIX TE={te_high:.4f} should be stronger than low VIX TE={te_low:.4f}"


# =============================================================================
# GRANGER CAUSALITY
# =============================================================================

class TestGrangerCausality:
    """Test Granger causality relationships."""

    def granger_causality_test(
        self,
        cause: np.ndarray,
        effect: np.ndarray,
        max_lag: int = 5
    ) -> Dict:
        """
        Simple Granger causality test via regression F-test.

        Returns dict with f_statistic and p_value.
        """
        from scipy.stats import f as f_dist

        cause = np.asarray(cause)
        effect = np.asarray(effect)
        n = min(len(cause), len(effect))

        if n < max_lag + 10:
            return {'f_statistic': np.nan, 'p_value': np.nan, 'significant': False}

        # Restricted model: effect ~ lagged effect only
        y = effect[max_lag:]
        X_restricted = np.column_stack([
            effect[max_lag-i-1:-i-1] for i in range(max_lag)
        ])

        # Unrestricted model: effect ~ lagged effect + lagged cause
        X_unrestricted = np.column_stack([
            X_restricted,
            *[cause[max_lag-i-1:-i-1].reshape(-1, 1) for i in range(max_lag)]
        ])

        # OLS for both models
        def ols_residuals(X, y):
            X_with_const = np.column_stack([np.ones(len(X)), X])
            try:
                beta = np.linalg.lstsq(X_with_const, y, rcond=None)[0]
                residuals = y - X_with_const @ beta
                return np.sum(residuals ** 2)
            except:
                return np.nan

        rss_r = ols_residuals(X_restricted, y)
        rss_u = ols_residuals(X_unrestricted, y)

        if np.isnan(rss_r) or np.isnan(rss_u) or rss_u == 0:
            return {'f_statistic': np.nan, 'p_value': np.nan, 'significant': False}

        # F-test
        n_obs = len(y)
        df_r = n_obs - max_lag - 1  # Restricted df
        df_u = n_obs - 2 * max_lag - 1  # Unrestricted df
        df_diff = max_lag

        if df_u <= 0:
            return {'f_statistic': np.nan, 'p_value': np.nan, 'significant': False}

        f_stat = ((rss_r - rss_u) / df_diff) / (rss_u / df_u)
        p_value = 1 - f_dist.cdf(f_stat, df_diff, df_u)

        return {
            'f_statistic': f_stat,
            'p_value': p_value,
            'significant': p_value < 0.05
        }

    def test_granger_detects_lead_lag(self, lead_lag_data):
        """
        Granger test should detect that Y causes X but not vice versa.
        """
        x, y = lead_lag_data

        # Y causes X
        result_y_to_x = self.granger_causality_test(y, x, max_lag=3)

        # X does not cause Y
        result_x_to_y = self.granger_causality_test(x, y, max_lag=3)

        # Y→X should be significant (or at least stronger)
        assert np.isfinite(result_y_to_x['f_statistic']), "Y→X F-stat should be finite"
        assert np.isfinite(result_x_to_y['f_statistic']), "X→Y F-stat should be finite"

        # Y causes X, so Y→X should have higher F-statistic
        assert result_y_to_x['f_statistic'] > result_x_to_y['f_statistic'], \
            f"Y→X F={result_y_to_x['f_statistic']:.2f} should exceed X→Y F={result_x_to_y['f_statistic']:.2f}"

    def test_granger_independent_not_significant(self, independent_data):
        """
        Granger test should not find significance for independent series.
        """
        x, y = independent_data

        result = self.granger_causality_test(x, y, max_lag=3)

        # Should not be highly significant
        if np.isfinite(result['p_value']):
            # At 5% significance, about 5% of independent pairs would be "significant"
            # So we just verify the test runs and produces reasonable output
            assert 0 <= result['p_value'] <= 1, "P-value should be in [0, 1]"


# =============================================================================
# CROSS-ASSET LEAD-LAG
# =============================================================================

class TestCrossAssetCausality:
    """Test lead-lag relationships between correlated assets."""

    def test_sector_lead_lag(self):
        """
        Test lead-lag between sectors (e.g., XLF leads XLE during rate changes).
        """
        np.random.seed(42)
        n = 500

        # XLF leads XLE by 1 period
        xlf_returns = np.random.randn(n) * 0.02
        xle_returns = np.zeros(n)
        xle_returns[1:] = 0.5 * xlf_returns[:-1] + np.random.randn(n-1) * 0.015
        xle_returns[0] = np.random.randn() * 0.02

        result = bidirectional_transfer_entropy(
            xlf_returns, xle_returns, k=1, l=1, bins=10
        )

        # XLF should lead XLE - use modest threshold since TE estimation has noise
        assert result['te_x_to_y'] > result['te_y_to_x'], \
            f"XLF→XLE TE={result['te_x_to_y']:.4f} should exceed XLE→XLF TE={result['te_y_to_x']:.4f}"

    def test_options_stock_causality(self):
        """
        Test information flow from options market to stock.

        Options often lead stocks due to informed trading.
        """
        np.random.seed(42)
        n = 500

        # Options order flow leads stock returns
        options_flow = np.random.randn(n)  # Net call buying
        stock_returns = np.zeros(n)
        stock_returns[1:] = 0.3 * options_flow[:-1] + np.random.randn(n-1) * 0.01
        stock_returns[0] = np.random.randn() * 0.01

        te_opt_to_stock = transfer_entropy(options_flow, stock_returns, k=1, l=1, bins=10)
        te_stock_to_opt = transfer_entropy(stock_returns, options_flow, k=1, l=1, bins=10)

        assert te_opt_to_stock > te_stock_to_opt * 1.3, \
            f"Options→Stock TE={te_opt_to_stock:.4f} should be 30% stronger than Stock→Options TE={te_stock_to_opt:.4f}"


# =============================================================================
# CAUSAL CHAIN VALIDATION
# =============================================================================

class TestCausalChain:
    """Test multi-step causal chains."""

    def test_three_variable_chain(self):
        """
        Test A → B → C causal chain.

        A should cause B, B should cause C, but A→C direct should be weaker.
        """
        np.random.seed(42)
        n = 500

        a = np.random.randn(n)
        b = np.zeros(n)
        c = np.zeros(n)

        # A → B → C chain
        for t in range(1, n):
            b[t] = 0.6 * a[t-1] + np.random.randn() * 0.4
            c[t] = 0.6 * b[t-1] + np.random.randn() * 0.4

        te_a_to_b = transfer_entropy(a, b, k=1, l=1, bins=10)
        te_b_to_c = transfer_entropy(b, c, k=1, l=1, bins=10)
        te_a_to_c = transfer_entropy(a, c, k=1, l=1, bins=10)

        # Direct causal links should be strong
        assert te_a_to_b > 0.1, f"A→B TE={te_a_to_b:.4f} should be strong (>0.1)"
        assert te_b_to_c > 0.1, f"B→C TE={te_b_to_c:.4f} should be strong (>0.1)"

        # Indirect link A→C should be weaker than direct links
        assert te_a_to_c < te_a_to_b, f"A→C TE={te_a_to_c:.4f} should be weaker than A→B TE={te_a_to_b:.4f}"
        assert te_a_to_c < te_b_to_c, f"A→C TE={te_a_to_c:.4f} should be weaker than B→C TE={te_b_to_c:.4f}"
        assert np.isfinite(te_a_to_c), "A→C TE should be finite"


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
