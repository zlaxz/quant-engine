#!/usr/bin/env python3
"""
Correlation Dynamics Analysis - DCC-GARCH, Absorption Ratio, Tail Dependence
===========================================================================
Market Physics Engine - Layer 6 (Regime Transitions) + Layer 3 (Force Calculation)

Correlation is not a fixed parameter - it's a dynamic, state-dependent process
that exhibits drift, clustering, and abrupt regime shifts. The breakdown of
diversification during stress (correlations → 1) is the greatest failure point
of modern portfolio theory.

Key Metrics:
- DCC-GARCH: Dynamic conditional correlation
- Absorption Ratio: Market fragility from eigenvalue concentration
- Eigenvalue Entropy: Dimensionality collapse detection
- Tail Dependence: Crash coupling coefficients
- Forbes-Rigobon: True contagion vs interdependence

IMPORTANT: All features are computed with LAG to avoid lookahead bias.

Research Source: CORRELATION-DYNAMICS-RESEARCH.md
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import norm, t as t_dist
from scipy.optimize import minimize

logger = logging.getLogger("AlphaFactory.Features.Correlation")


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class CorrelationFeatures:
    """Container for correlation analysis features."""
    absorption_ratio: float          # AR - eigenvalue concentration
    absorption_ratio_zscore: float   # AR z-score vs history
    eigenvalue_entropy: float        # Diversification measure
    entropy_zscore: float            # Entropy z-score
    avg_correlation: float           # Average pairwise correlation
    max_correlation: float           # Maximum pairwise correlation
    correlation_dispersion: float    # Std of pairwise correlations
    regime: str                      # HIGH_CORRELATION_CRISIS, NORMAL, DIVERSIFIED
    fragility_alert: bool            # True if AR spike + entropy drop


@dataclass
class TailDependenceResult:
    """Tail dependence analysis results."""
    lower_tail: float               # P(Y crash | X crash)
    upper_tail: float               # P(Y rally | X rally)
    asymmetry: float                # Upper - Lower
    is_gaussian: bool               # Whether tail dependence ≈ 0 (Gaussian)


# =============================================================================
# UNIVARIATE GARCH
# =============================================================================

def garch_11_filter(
    returns: np.ndarray,
    omega: float = None,
    alpha: float = 0.05,
    beta: float = 0.90
) -> Tuple[np.ndarray, Tuple[float, float, float]]:
    """
    Apply GARCH(1,1) filter to return series.

    h_t = ω + α*ε_{t-1}² + β*h_{t-1}

    Args:
        returns: Return series
        omega: Constant term (auto-estimated if None)
        alpha: ARCH coefficient (sensitivity to shocks)
        beta: GARCH coefficient (persistence)

    Returns:
        Tuple of (conditional_variances, (omega, alpha, beta))
    """
    returns = np.asarray(returns)
    T = len(returns)

    if T < 10:
        return np.full(T, np.var(returns)), (0.0, alpha, beta)

    # Estimate omega from unconditional variance if not provided
    if omega is None:
        uncond_var = np.var(returns)
        omega = uncond_var * (1 - alpha - beta)
        omega = max(omega, 1e-10)  # Ensure positive

    # Initialize with sample variance
    h = np.zeros(T)
    h[0] = np.var(returns)

    # Filter
    for t in range(1, T):
        h[t] = omega + alpha * returns[t-1]**2 + beta * h[t-1]
        h[t] = max(h[t], 1e-10)  # Ensure positive

    return h, (omega, alpha, beta)


def estimate_garch_params(
    returns: np.ndarray,
    method: str = 'mle'
) -> Tuple[float, float, float]:
    """
    Estimate GARCH(1,1) parameters via MLE.

    Args:
        returns: Return series
        method: Estimation method ('mle' or 'variance_targeting')

    Returns:
        Tuple of (omega, alpha, beta)
    """
    returns = np.asarray(returns)
    var_sample = np.var(returns)

    if method == 'variance_targeting':
        # Fix omega based on long-run variance, estimate alpha/beta
        # This is faster and more stable
        alpha_init = 0.05
        beta_init = 0.90
        omega = var_sample * (1 - alpha_init - beta_init)
        return omega, alpha_init, beta_init

    # MLE estimation
    def neg_log_likelihood(params):
        omega, alpha, beta = params

        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 1:
            return 1e10

        h, _ = garch_11_filter(returns, omega, alpha, beta)

        # Log-likelihood (normal innovations)
        ll = -0.5 * np.sum(np.log(h) + returns**2 / h)
        return -ll

    # Initial values
    x0 = [var_sample * 0.05, 0.05, 0.90]
    bounds = [(1e-10, None), (0, 0.5), (0, 0.99)]

    try:
        result = minimize(neg_log_likelihood, x0, bounds=bounds, method='L-BFGS-B')
        if result.success:
            return tuple(result.x)
    except Exception as e:
        logger.warning(f"GARCH estimation failed: {e}")

    # Fall back to variance targeting
    return var_sample * 0.05, 0.05, 0.90


# =============================================================================
# DCC-GARCH
# =============================================================================

def dcc_garch_filter(
    returns: np.ndarray,
    a: float = 0.01,
    b: float = 0.95,
    garch_params: Optional[List[Tuple[float, float, float]]] = None
) -> Tuple[List[np.ndarray], List[np.ndarray], np.ndarray]:
    """
    Apply DCC-GARCH filter to multivariate returns.

    H_t = D_t R_t D_t
    Q_t = (1-a-b)Q̄ + a(η_{t-1}η'_{t-1}) + b*Q_{t-1}
    R_t = diag(Q_t)^{-1/2} Q_t diag(Q_t)^{-1/2}

    Args:
        returns: T x N array of asset returns
        a: DCC ARCH parameter (sensitivity to shocks)
        b: DCC GARCH parameter (persistence)
        garch_params: List of (omega, alpha, beta) for each asset

    Returns:
        Tuple of (covariance_matrices, correlation_matrices, standardized_residuals)
    """
    # COR_R8_1: Validate DCC stationarity constraint (a + b < 1)
    # Violation causes explosive correlations that diverge to infinity
    if a + b >= 1:
        raise ValueError(
            f"DCC stationarity violated: a + b = {a + b} >= 1. "
            f"DCC requires a + b < 1 for stable correlations. Got a={a}, b={b}."
        )
    if a < 0 or b < 0:
        raise ValueError(f"DCC parameters must be non-negative. Got a={a}, b={b}.")

    returns = np.asarray(returns)
    T, N = returns.shape

    # COR_R7_1: Don't use unreliable correlation fallback with insufficient data
    if T < N + 10:
        raise ValueError(
            f"Insufficient data for DCC-GARCH: T={T}, N={N}. "
            f"Need at least T >= N + 10 for reliable estimates."
        )

    # Stage 1: Univariate GARCH for each asset
    h = np.zeros((T, N))

    if garch_params is None:
        garch_params = []
        for i in range(N):
            params = estimate_garch_params(returns[:, i])
            garch_params.append(params)

    for i in range(N):
        omega, alpha, beta = garch_params[i]
        h[:, i], _ = garch_11_filter(returns[:, i], omega, alpha, beta)

    # Standardized residuals
    # Add small epsilon to prevent div/0
    h_safe = np.maximum(h, 1e-10)
    sqrt_h_safe = np.sqrt(h_safe)
    # Ensure no division by zero (should be prevented by max above)
    sqrt_h_safe = np.maximum(sqrt_h_safe, 1e-10)
    # Safe division with explicit check
    with np.errstate(divide='ignore', invalid='ignore'):
        eta = returns / sqrt_h_safe
        eta = np.where(np.isfinite(eta), eta, 0.0)

    # Unconditional correlation of standardized residuals
    Q_bar = np.corrcoef(eta.T)

    # Ensure positive definiteness
    eigvals = np.linalg.eigvalsh(Q_bar)
    if np.min(eigvals) < 1e-10:
        Q_bar = Q_bar + np.eye(N) * 1e-6

    # Stage 2: DCC dynamics
    Q_list = [Q_bar.copy()]
    R_list = [Q_bar.copy()]]]]]]]]
    H_list = []

    # Initial covariance
    D_0 = np.diag(np.sqrt(h[0]))
    H_list.append(D_0 @ R_list[0] @ D_0)

    for t in range(1, T):
        # DCC update
        eta_outer = np.outer(eta[t-1], eta[t-1])
        Q_t = (1 - a - b) * Q_bar + a * eta_outer + b * Q_list[-1]
        Q_list.append(Q_t)

        # Normalize to correlation matrix (floor negative diagonals, not abs)
        q_diag = np.maximum(np.diag(Q_t), 1e-12)
        q_diag_sqrt = np.sqrt(q_diag)
        D_inv = np.diag(1.0 / q_diag_sqrt)
        R_t = D_inv @ Q_t @ D_inv

        # COR4: Ensure valid correlation matrix (preserve PSD property)
        np.fill_diagonal(R_t, 1.0)
        # Don't clip - can destroy PSD. Instead, project to nearest PSD if needed
        eigenvalues = np.linalg.eigvalsh(R_t)
        if np.any(eigenvalues < 0):
            # Project to nearest PSD correlation matrix
            eigenvalues_pos = np.maximum(eigenvalues, 1e-10)
            eigenvectors = np.linalg.eigh(R_t)[1]
            R_t = eigenvectors @ np.diag(eigenvalues_pos) @ eigenvectors.T
            # Rescale to correlation matrix
            d = np.sqrt(np.diag(R_t))
            d = np.where(d > 0, d, 1.0)
            R_t = R_t / np.outer(d, d)
            np.fill_diagonal(R_t, 1.0)
        R_list.append(R_t)

        # Build covariance matrix
        D_t = np.diag(np.sqrt(h[t]))
        H_t = D_t @ R_t @ D_t
        H_list.append(H_t)

    return H_list, R_list, eta


def rolling_dcc_correlation(
    returns: pd.DataFrame,
    a: float = 0.01,
    b: float = 0.95
) -> pd.DataFrame:
    """
    Extract rolling correlations from DCC-GARCH model.

    Args:
        returns: DataFrame with asset returns as columns
        a: DCC a parameter
        b: DCC b parameter

    Returns:
        DataFrame with pairwise correlations over time
    """
    returns_arr = returns.values
    T, N = returns_arr.shape

    _, R_list, _ = dcc_garch_filter(returns_arr, a, b)

    # COR5: Extract pairwise correlations (R_list[t] uses info up to t-1, so it's a forecast for t)
    # This is correct alignment for DCC - we want R_t aligned with returns[t]
    corr_data = {}
    for i in range(N):
        for j in range(i+1, N):
            col_i = returns.columns[i]
            col_j = returns.columns[j]
            key = f"{col_i}_{col_j}_corr"
            # NOTE: R_list has length T, aligned with returns.index
            # R_list[0] = unconditional, R_list[1] = first DCC update using eta[0]
            corr_data[key] = [R[i, j] for R in R_list]

    return pd.DataFrame(corr_data, index=returns.index)


# =============================================================================
# ABSORPTION RATIO
# =============================================================================

def absorption_ratio(
    cov_matrix: np.ndarray,
    n_factors: int = None,
    variance_threshold: float = 0.8,
    use_correlation: bool = False
) -> float:
    """
    Calculate Absorption Ratio from covariance or correlation matrix.

    AR = Σ_{i=1}^n λ_i / Σ_j λ_j

    High AR indicates tightly coupled, fragile market.
    Low AR indicates resilient, diversified market.

    Args:
        cov_matrix: N x N covariance matrix
        n_factors: Number of top eigenvalues (auto if None)
        variance_threshold: If n_factors is None, use factors explaining this much variance
        use_correlation: COR2 FIX: If True, convert to correlation matrix first
                        (removes scale effects, per Kritzman et al. 2011)

    Returns:
        Absorption ratio (0 to 1)
    """
    cov_matrix = np.asarray(cov_matrix)

    # Ensure symmetric
    cov_matrix = (cov_matrix + cov_matrix.T) / 2

    # COR2 FIX: Optionally convert to correlation to remove volatility effects
    if use_correlation:
        stds = np.sqrt(np.diag(cov_matrix))
        stds = np.where(stds > 0, stds, 1.0)  # Avoid div by zero
        cov_matrix = cov_matrix / np.outer(stds, stds)

    # COR_R7_10: Check condition number before eigenvalue decomposition
    try:
        cond_number = np.linalg.cond(cov_matrix)
        if cond_number > 1e12:  # Extremely ill-conditioned
            logger.warning(f"Covariance matrix ill-conditioned (cond={cond_number:.2e})")
            return np.nan
    except np.linalg.LinAlgError:
        return np.nan

    # Get eigenvalues
    eigenvalues = np.linalg.eigvalsh(cov_matrix)
    eigenvalues = np.sort(eigenvalues)[::-1]  # Descending order
    eigenvalues = eigenvalues[eigenvalues > 0]  # Remove non-positive

    if len(eigenvalues) == 0:
        return np.nan

    total_var = np.sum(eigenvalues)

    if total_var == 0:
        return np.nan

    # Determine n_factors if not specified
    if n_factors is None:
        cumulative = np.cumsum(eigenvalues) / total_var
        n_factors = np.argmax(cumulative >= variance_threshold) + 1
        n_factors = max(1, min(n_factors, len(eigenvalues)))

    n_factors = min(n_factors, len(eigenvalues))
    top_var = np.sum(eigenvalues[:n_factors])

    return top_var / total_var


def rolling_absorption_ratio(
    returns: pd.DataFrame,
    window: int = 60,
    n_factors: int = None
) -> pd.Series:
    """
    Calculate rolling Absorption Ratio.

    Args:
        returns: DataFrame with asset returns
        window: Rolling window for covariance estimation
        n_factors: Number of factors (auto if None)

    Returns:
        Series of Absorption Ratios
    """
    returns_arr = returns.values
    T = len(returns)

    ar_values = np.full(T, np.nan)

    for t in range(window, T):
        window_returns = returns_arr[t-window:t]
        cov = np.cov(window_returns.T)
        ar_values[t] = absorption_ratio(cov, n_factors)

    return pd.Series(ar_values, index=returns.index, name='absorption_ratio')


# =============================================================================
# EIGENVALUE ENTROPY
# =============================================================================

def eigenvalue_entropy(
    cov_matrix: np.ndarray,
    normalize: bool = True
) -> float:
    """
    Calculate entropy of eigenvalue distribution.

    H = -Σ p_i ln(p_i) where p_i = λ_i / Σλ

    Max entropy: All eigenvalues equal (uncorrelated assets)
    Min entropy: One dominant eigenvalue (perfectly correlated)

    Rapid entropy decrease = dimensionality collapse = crash warning

    Args:
        cov_matrix: N x N covariance matrix
        normalize: Normalize by max entropy (ln(N))

    Returns:
        Eigenvalue entropy
    """
    cov_matrix = np.asarray(cov_matrix)

    # Ensure symmetric
    cov_matrix = (cov_matrix + cov_matrix.T) / 2

    # Get eigenvalues
    eigenvalues = np.linalg.eigvalsh(cov_matrix)
    eigenvalues = eigenvalues[eigenvalues > 1e-10]  # Remove non-positive

    if len(eigenvalues) == 0:
        return np.nan

    # Normalize to probabilities
    total = np.sum(eigenvalues)
    if total == 0:
        return np.nan

    p = eigenvalues / total

    # Shannon entropy
    # COR_R7_9: Use safe log with epsilon to avoid 0*log(0)=nan for tiny probabilities
    p_safe = np.clip(p, 1e-15, 1.0)  # Ensure p > 0 for log
    entropy = -np.sum(p * np.log(p_safe))

    if normalize:
        # COR_R7_7: Handle single eigenvalue case where ln(1)=0 would cause div by zero
        if len(eigenvalues) == 1:
            # Single eigenvalue = zero entropy (fully concentrated)
            return 0.0
        max_entropy = np.log(len(eigenvalues))
        if max_entropy > 0:
            entropy = entropy / max_entropy

    return entropy


def rolling_eigenvalue_entropy(
    returns: pd.DataFrame,
    window: int = 60,
    normalize: bool = True
) -> pd.Series:
    """
    Calculate rolling eigenvalue entropy.

    Args:
        returns: DataFrame with asset returns
        window: Rolling window
        normalize: Normalize by max entropy

    Returns:
        Series of entropy values
    """
    returns_arr = returns.values
    T = len(returns)

    entropy_values = np.full(T, np.nan)

    for t in range(window, T):
        window_returns = returns_arr[t-window:t]
        cov = np.cov(window_returns.T)
        entropy_values[t] = eigenvalue_entropy(cov, normalize)

    return pd.Series(entropy_values, index=returns.index, name='eigenvalue_entropy')


# =============================================================================
# TAIL DEPENDENCE
# =============================================================================

def tail_dependence_t_copula(
    rho: float,
    nu: float
) -> float:
    """
    COR6: Calculate LOWER tail dependence coefficient for symmetric t-copula.

    For symmetric t-copula, lower and upper tail dependence are equal.
    λ_L = λ_U = 2 * t_{ν+1}(-sqrt((ν+1)(1-ρ)/(1+ρ)))

    where t_{ν+1} is Student's t CDF with ν+1 degrees of freedom.

    λ = 2 * t_{ν+1}(-√(ν+1) * √((1-ρ)/(1+ρ)))

    For Gaussian copula (ν → ∞), λ = 0

    Args:
        rho: Correlation parameter
        nu: Degrees of freedom (lower = fatter tails = higher dependence)

    Returns:
        Tail dependence coefficient (0 to 1)
    """
    # COR_R7_4: t-distribution requires nu >= 2 for valid variance
    if nu < 2:
        raise ValueError(f"Degrees of freedom must be >= 2 for t-copula, got {nu}")

    # Clip to avoid numerical instability (formula unstable for |rho| > 0.95)
    rho = np.clip(rho, -0.95, 0.95)

    # Guard against division by zero for rho near -1
    denominator = 1 + rho
    if denominator < 1e-6:
        return 1.0  # Perfect negative correlation -> maximal tail dependence

    arg = -np.sqrt(nu + 1) * np.sqrt((1 - rho) / denominator)
    return 2 * t_dist.cdf(arg, df=nu + 1)


def empirical_tail_dependence(
    x: np.ndarray,
    y: np.ndarray,
    quantile: float = 0.05
) -> TailDependenceResult:
    """
    Estimate empirical tail dependence coefficients.

    Lower: P(Y < q_y | X < q_x)
    Upper: P(Y > 1-q_y | X > 1-q_x)

    Args:
        x: First return series
        y: Second return series
        quantile: Tail quantile (default 5%)

    Returns:
        TailDependenceResult with lower and upper tail dependence
    """
    x = np.asarray(x)
    y = np.asarray(y)

    # Convert to uniform using empirical CDF
    n = len(x)
    u_x = stats.rankdata(x) / (n + 1)
    u_y = stats.rankdata(y) / (n + 1)

    # Lower tail dependence
    lower_x = u_x <= quantile
    lower_y = u_y <= quantile
    n_lower_x = np.sum(lower_x)
    lower_tail = np.sum(lower_x & lower_y) / n_lower_x if n_lower_x > 0 else 0.0

    # Upper tail dependence
    upper_x = u_x >= (1 - quantile)
    upper_y = u_y >= (1 - quantile)
    n_upper_x = np.sum(upper_x)
    upper_tail = np.sum(upper_x & upper_y) / n_upper_x if n_upper_x > 0 else 0.0

    # Asymmetry
    asymmetry = upper_tail - lower_tail

    # Check if approximately Gaussian (tail dependence near 0)
    is_gaussian = lower_tail < 0.1 and upper_tail < 0.1

    return TailDependenceResult(
        lower_tail=lower_tail,
        upper_tail=upper_tail,
        asymmetry=asymmetry,
        is_gaussian=is_gaussian
    )


def estimate_t_copula_params(
    x: np.ndarray,
    y: np.ndarray
) -> Tuple[float, float]:
    """
    Estimate t-copula parameters (rho, nu) via pseudo-MLE.

    Args:
        x: First return series
        y: Second return series

    Returns:
        Tuple of (rho, nu)
    """
    x = np.asarray(x)
    y = np.asarray(y)

    # COR_R7_5: Filter NaN values before rankdata/ppf pipeline
    valid_mask = ~(np.isnan(x) | np.isnan(y))
    x = x[valid_mask]
    y = y[valid_mask]

    if len(x) < 10:
        return (0.0, 4.0)  # Insufficient data, return default

    # Convert to uniform
    n = len(x)
    u = stats.rankdata(x) / (n + 1)
    v = stats.rankdata(y) / (n + 1)

    # Convert to t-scores
    # We'll search over nu
    def neg_log_likelihood(params):
        rho, nu = params

        if nu <= 2 or nu > 100 or abs(rho) >= 1:
            return 1e10

        # Transform uniforms to t-quantiles
        t_x = t_dist.ppf(u, df=nu)
        t_y = t_dist.ppf(v, df=nu)

        # t-copula log-likelihood
        # Simplified version - full MLE is more complex
        try:
            corr_term = (1 - rho**2)
            quad_form = (t_x**2 + t_y**2 - 2*rho*t_x*t_y) / corr_term

            ll = np.sum(
                np.log(1 + quad_form / nu) * (-(nu + 2) / 2) -
                np.log(1 + t_x**2 / nu) * (-(nu + 1) / 2) -
                np.log(1 + t_y**2 / nu) * (-(nu + 1) / 2)
            )

            return -ll
        except:
            return 1e10

    # Grid search + refinement
    best_ll = np.inf
    best_params = (0.5, 5.0)

    for rho_init in [0.3, 0.5, 0.7]:
        for nu_init in [4, 8, 15, 30]:
            try:
                result = minimize(
                    neg_log_likelihood,
                    [rho_init, nu_init],
                    bounds=[(-0.99, 0.99), (2.1, 100)],
                    method='L-BFGS-B'
                )
                if result.fun < best_ll:
                    best_ll = result.fun
                    best_params = tuple(result.x)
            except:
                continue

    return best_params


# =============================================================================
# FORBES-RIGOBON CORRECTION
# =============================================================================

def forbes_rigobon_correction(
    rho_crisis: float,
    var_ratio: float
) -> float:
    """
    Correct correlation for heteroscedasticity bias.

    ρ = ρ_A / √(1 + δ(1 - ρ_A²))

    Where δ = Var(crisis)/Var(normal) - 1

    This distinguishes true contagion (β changed) from
    interdependence (β unchanged, just amplified by volatility).

    Args:
        rho_crisis: Correlation measured during high-vol period
        var_ratio: Var(crisis) / Var(normal)

    Returns:
        Adjusted unconditional correlation
    """
    if var_ratio <= 0:
        return rho_crisis

    delta = var_ratio - 1

    # Prevent numerical issues
    rho_crisis = np.clip(rho_crisis, -0.9999, 0.9999)

    denominator = np.sqrt(1 + delta * (1 - rho_crisis**2))

    # COR7: Add NaN/inf validation (denominator == 0 is dead code - sqrt always positive)
    if not np.isfinite(denominator) or denominator < 1e-10:
        return np.nan

    return rho_crisis / denominator


def test_contagion(
    returns_x: np.ndarray,
    returns_y: np.ndarray,
    crisis_mask: np.ndarray
) -> Dict:
    """
    Test for true contagion vs interdependence using Forbes-Rigobon.

    Args:
        returns_x: Source country/asset returns
        returns_y: Potentially affected country/asset returns
        crisis_mask: Boolean array (True for crisis period)

    Returns:
        Dict with test results
    """
    returns_x = np.asarray(returns_x)
    returns_y = np.asarray(returns_y)
    crisis_mask = np.asarray(crisis_mask)

    # Split into periods
    x_crisis = returns_x[crisis_mask]
    x_normal = returns_x[~crisis_mask]
    y_crisis = returns_y[crisis_mask]
    y_normal = returns_y[~crisis_mask]

    # Correlations
    rho_crisis = np.corrcoef(x_crisis, y_crisis)[0, 1]
    rho_normal = np.corrcoef(x_normal, y_normal)[0, 1]

    # COR_R7_6: Variance ratio with bounds to prevent extreme/inverted conclusions
    var_crisis = np.var(x_crisis)
    var_normal = np.var(x_normal)
    if var_normal > 1e-10:
        var_ratio = var_crisis / var_normal
        # Cap variance ratio to prevent ill-conditioned corrections
        var_ratio = np.clip(var_ratio, 0.01, 100.0)
    else:
        var_ratio = 1.0  # Default to neutral when normal variance ~0

    # Adjusted correlation
    rho_adjusted = forbes_rigobon_correction(rho_crisis, var_ratio)

    # Test: is adjusted correlation significantly higher than normal?
    # Simple heuristic: if adjusted > normal + 0.1, likely true contagion
    is_contagion = rho_adjusted > rho_normal + 0.1

    return {
        'rho_crisis': rho_crisis,
        'rho_normal': rho_normal,
        'rho_adjusted': rho_adjusted,
        'var_ratio': var_ratio,
        'is_contagion': is_contagion,
        'interpretation': 'TRUE_CONTAGION' if is_contagion else 'INTERDEPENDENCE'
    }


# =============================================================================
# CORRELATION REGIME DETECTION
# =============================================================================

def correlation_regime_indicators(
    returns: np.ndarray,
    window: int = 60
) -> Dict[str, np.ndarray]:
    """
    Calculate correlation regime indicators.

    Args:
        returns: T x N array of asset returns
        window: Rolling window

    Returns:
        Dict with absorption_ratio, eigenvalue_entropy, avg_correlation
    """
    returns = np.asarray(returns)
    T, N = returns.shape

    # COR_R7_8: Validate minimum data length to avoid all-NaN output
    if T <= window:
        warnings.warn(f"Insufficient data: T={T} <= window={window}. Need at least window+1 samples.")
        return {
            'absorption_ratio': np.full(T, np.nan),
            'eigenvalue_entropy': np.full(T, np.nan),
            'avg_correlation': np.full(T, np.nan),
            'max_correlation': np.full(T, np.nan),
            'corr_dispersion': np.full(T, np.nan)
        }

    ar = np.full(T, np.nan)
    entropy = np.full(T, np.nan)
    avg_corr = np.full(T, np.nan)
    max_corr = np.full(T, np.nan)
    corr_dispersion = np.full(T, np.nan)

    for t in range(window, T):
        window_returns = returns[t-window:t]
        cov = np.cov(window_returns.T)
        corr = np.corrcoef(window_returns.T)

        ar[t] = absorption_ratio(cov)
        entropy[t] = eigenvalue_entropy(cov)

        # Average off-diagonal correlation
        mask = ~np.eye(N, dtype=bool)
        off_diag = corr[mask]
        avg_corr[t] = np.mean(off_diag)
        max_corr[t] = np.max(np.abs(off_diag))
        corr_dispersion[t] = np.std(off_diag)

    return {
        'absorption_ratio': ar,
        'eigenvalue_entropy': entropy,
        'avg_correlation': avg_corr,
        'max_correlation': max_corr,
        'correlation_dispersion': corr_dispersion
    }


def detect_correlation_regime(
    indicators: Dict[str, np.ndarray],
    lookback: int = 252,
    threshold_std: float = 2.0
) -> Dict:
    """
    Detect current correlation regime.

    Args:
        indicators: Dict from correlation_regime_indicators
        lookback: Period for z-score calculation
        threshold_std: Z-score threshold for alerts

    Returns:
        Dict with regime classification and z-scores
    """
    ar = indicators['absorption_ratio']
    entropy = indicators['eigenvalue_entropy']

    # Get valid (non-NaN) values for statistics
    ar_valid = ar[~np.isnan(ar)]
    entropy_valid = entropy[~np.isnan(entropy)]

    if len(ar_valid) < lookback:
        lookback = len(ar_valid)

    if lookback < 10:
        return {
            'regime': 'INSUFFICIENT_DATA',
            'ar_zscore': np.nan,
            'entropy_zscore': np.nan
        }

    # Use recent history for z-scores
    ar_recent = ar_valid[-lookback:]
    entropy_recent = entropy_valid[-lookback:]

    ar_current = ar_valid[-1]
    entropy_current = entropy_valid[-1]

    # COR_R7_2: Protect against division by zero when std = 0 (stable markets)
    ar_std = np.std(ar_recent)
    entropy_std = np.std(entropy_recent)

    ar_zscore = (ar_current - np.mean(ar_recent)) / ar_std if ar_std > 0 else 0.0
    entropy_zscore = (entropy_current - np.mean(entropy_recent)) / entropy_std if entropy_std > 0 else 0.0

    # Regime classification
    if ar_zscore > threshold_std and entropy_zscore < -threshold_std:
        regime = 'HIGH_CORRELATION_CRISIS'
        warning = 'Diversification failing - correlations spiking'
        fragility_alert = True
    elif ar_zscore > threshold_std:
        regime = 'ELEVATED_CORRELATION'
        warning = 'Correlations elevated but not critical'
        fragility_alert = False
    elif ar_zscore < -threshold_std:
        regime = 'LOW_CORRELATION_DIVERSIFIED'
        warning = None
        fragility_alert = False
    else:
        regime = 'NORMAL'
        warning = None
        fragility_alert = False

    return {
        'regime': regime,
        'ar_zscore': ar_zscore,
        'entropy_zscore': entropy_zscore,
        'fragility_alert': fragility_alert,
        'warning': warning,
        'ar_current': ar_current,
        'entropy_current': entropy_current
    }


# =============================================================================
# FEATURE GENERATION UTILITIES
# =============================================================================

def calculate_correlation_features(
    returns: np.ndarray,
    window: int = 60,
    lookback: int = 252
) -> CorrelationFeatures:
    """
    Calculate comprehensive correlation features.

    Args:
        returns: T x N array of asset returns
        window: Window for covariance estimation
        lookback: Lookback for z-scores

    Returns:
        CorrelationFeatures dataclass
    """
    returns = np.asarray(returns)

    if returns.ndim == 1:
        # Single asset - return neutral values
        return CorrelationFeatures(
            absorption_ratio=1.0,
            absorption_ratio_zscore=0.0,
            eigenvalue_entropy=0.0,
            entropy_zscore=0.0,
            avg_correlation=0.0,
            max_correlation=0.0,
            correlation_dispersion=0.0,
            regime='SINGLE_ASSET',
            fragility_alert=False
        )

    T, N = returns.shape

    if T < window:
        window = T

    # Calculate indicators
    indicators = correlation_regime_indicators(returns, window)

    # Current values
    ar_current = indicators['absorption_ratio'][-1]
    entropy_current = indicators['eigenvalue_entropy'][-1]
    avg_corr_current = indicators['avg_correlation'][-1]
    max_corr_current = indicators['max_correlation'][-1]
    dispersion_current = indicators['correlation_dispersion'][-1]

    # Detect regime
    regime_info = detect_correlation_regime(indicators, lookback)

    return CorrelationFeatures(
        absorption_ratio=ar_current if np.isfinite(ar_current) else 1.0,
        absorption_ratio_zscore=regime_info['ar_zscore'] if np.isfinite(regime_info['ar_zscore']) else 0.0,
        eigenvalue_entropy=entropy_current if np.isfinite(entropy_current) else 0.0,
        entropy_zscore=regime_info['entropy_zscore'] if np.isfinite(regime_info['entropy_zscore']) else 0.0,
        avg_correlation=avg_corr_current if np.isfinite(avg_corr_current) else 0.0,
        max_correlation=max_corr_current if np.isfinite(max_corr_current) else 0.0,
        correlation_dispersion=dispersion_current if np.isfinite(dispersion_current) else 0.0,
        regime=regime_info['regime'],
        fragility_alert=regime_info['fragility_alert']
    )


def add_correlation_features(
    df: pd.DataFrame,
    returns_cols: List[str],
    window: int = 60,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add correlation analysis features to a DataFrame.

    Features added:
    - absorption_ratio: Eigenvalue concentration
    - eigenvalue_entropy: Diversification measure
    - avg_correlation: Average pairwise correlation
    - max_correlation: Maximum pairwise correlation
    - correlation_dispersion: Std of correlations
    - ar_zscore: Absorption ratio z-score
    - entropy_zscore: Entropy z-score
    - corr_regime: Regime classification
    - fragility_alert: Boolean alert flag

    Args:
        df: DataFrame with return data
        returns_cols: List of column names with asset returns
        window: Rolling window for estimation
        lag: Lag to avoid lookahead bias

    Returns:
        DataFrame with correlation features added
    """
    result = df.copy()

    # Extract returns matrix
    returns = df[returns_cols].values
    T, N = returns.shape

    # Calculate rolling indicators
    indicators = correlation_regime_indicators(returns, window)

    # Add lagged features
    result['absorption_ratio'] = pd.Series(
        indicators['absorption_ratio'], index=df.index
    ).shift(lag)

    result['eigenvalue_entropy'] = pd.Series(
        indicators['eigenvalue_entropy'], index=df.index
    ).shift(lag)

    result['avg_correlation'] = pd.Series(
        indicators['avg_correlation'], index=df.index
    ).shift(lag)

    result['max_correlation'] = pd.Series(
        indicators['max_correlation'], index=df.index
    ).shift(lag)

    result['correlation_dispersion'] = pd.Series(
        indicators['correlation_dispersion'], index=df.index
    ).shift(lag)

    # COR_R7_3: Z-scores (rolling) with division-by-zero protection
    ar_rolling_std = result['absorption_ratio'].rolling(252).std()
    ar_rolling_std_safe = ar_rolling_std.replace(0, np.nan)  # Replace 0 with NaN to avoid div-by-zero
    result['ar_zscore'] = (
        (result['absorption_ratio'] - result['absorption_ratio'].rolling(252).mean()) /
        ar_rolling_std_safe
    )

    # COR_R7_3 continued: Same protection for entropy_zscore
    entropy_rolling_std = result['eigenvalue_entropy'].rolling(252).std()
    entropy_rolling_std_safe = entropy_rolling_std.replace(0, np.nan)
    result['entropy_zscore'] = (
        (result['eigenvalue_entropy'] - result['eigenvalue_entropy'].rolling(252).mean()) /
        entropy_rolling_std_safe
    )

    # Regime classification
    def classify_regime(row):
        if pd.isna(row['ar_zscore']) or pd.isna(row['entropy_zscore']):
            return 'INSUFFICIENT_DATA'
        if row['ar_zscore'] > 2.0 and row['entropy_zscore'] < -2.0:
            return 'HIGH_CORRELATION_CRISIS'
        elif row['ar_zscore'] > 2.0:
            return 'ELEVATED_CORRELATION'
        elif row['ar_zscore'] < -2.0:
            return 'LOW_CORRELATION_DIVERSIFIED'
        return 'NORMAL'

    result['corr_regime'] = result.apply(classify_regime, axis=1)

    # Fragility alert
    result['fragility_alert'] = (
        (result['ar_zscore'] > 2.0) & (result['entropy_zscore'] < -2.0)
    ).astype(int)

    return result


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    import numpy as np

    print("=== Correlation Dynamics Module Test ===\n")

    # Create sample multi-asset returns
    np.random.seed(42)
    T = 500
    N = 5

    # Generate correlated returns
    mean = np.zeros(N)
    # Base correlation matrix
    base_corr = np.array([
        [1.0, 0.6, 0.5, 0.3, 0.2],
        [0.6, 1.0, 0.7, 0.4, 0.3],
        [0.5, 0.7, 1.0, 0.5, 0.4],
        [0.3, 0.4, 0.5, 1.0, 0.6],
        [0.2, 0.3, 0.4, 0.6, 1.0]
    ])
    vols = np.array([0.02, 0.025, 0.022, 0.018, 0.03])
    cov = np.outer(vols, vols) * base_corr

    returns = np.random.multivariate_normal(mean, cov, T)

    # Add a crisis period with higher correlation
    crisis_start = 400
    crisis_cov = np.outer(vols * 2, vols * 2) * (0.3 + 0.7 * base_corr)  # Higher corr, higher vol
    returns[crisis_start:] = np.random.multivariate_normal(mean, crisis_cov, T - crisis_start)

    print("1. GARCH(1,1) Filter")
    h, params = garch_11_filter(returns[:, 0])
    print(f"   Asset 1 GARCH params: omega={params[0]:.6f}, alpha={params[1]:.4f}, beta={params[2]:.4f}")
    print(f"   Avg conditional vol: {np.sqrt(np.mean(h)):.4f}")

    print("\n2. DCC-GARCH Filter")
    H_list, R_list, eta = dcc_garch_filter(returns)
    print(f"   T={len(R_list)} correlation matrices generated")
    print(f"   Final correlation (1,2): {R_list[-1][0,1]:.4f}")
    print(f"   Pre-crisis correlation (1,2): {R_list[crisis_start-10][0,1]:.4f}")

    print("\n3. Absorption Ratio")
    ar_precris = absorption_ratio(np.cov(returns[:crisis_start].T))
    ar_crisis = absorption_ratio(np.cov(returns[crisis_start:].T))
    print(f"   Pre-crisis AR: {ar_precris:.4f}")
    print(f"   Crisis AR: {ar_crisis:.4f}")

    print("\n4. Eigenvalue Entropy")
    ent_precris = eigenvalue_entropy(np.cov(returns[:crisis_start].T))
    ent_crisis = eigenvalue_entropy(np.cov(returns[crisis_start:].T))
    print(f"   Pre-crisis entropy: {ent_precris:.4f}")
    print(f"   Crisis entropy: {ent_crisis:.4f}")

    print("\n5. Tail Dependence")
    tail_result = empirical_tail_dependence(returns[:, 0], returns[:, 1])
    print(f"   Lower tail dependence: {tail_result.lower_tail:.4f}")
    print(f"   Upper tail dependence: {tail_result.upper_tail:.4f}")
    print(f"   Asymmetry: {tail_result.asymmetry:.4f}")
    print(f"   Is Gaussian: {tail_result.is_gaussian}")

    print("\n6. t-Copula Tail Dependence")
    rho, nu = 0.6, 5.0  # Hypothetical params
    theoretical_tail = tail_dependence_t_copula(rho, nu)
    print(f"   Theoretical (rho={rho}, nu={nu}): {theoretical_tail:.4f}")

    print("\n7. Forbes-Rigobon Contagion Test")
    crisis_mask = np.zeros(T, dtype=bool)
    crisis_mask[crisis_start:] = True
    contagion = test_contagion(returns[:, 0], returns[:, 1], crisis_mask)
    print(f"   Crisis correlation: {contagion['rho_crisis']:.4f}")
    print(f"   Normal correlation: {contagion['rho_normal']:.4f}")
    print(f"   Adjusted correlation: {contagion['rho_adjusted']:.4f}")
    print(f"   Interpretation: {contagion['interpretation']}")

    print("\n8. Regime Detection")
    indicators = correlation_regime_indicators(returns, window=60)
    regime = detect_correlation_regime(indicators)
    print(f"   Current regime: {regime['regime']}")
    print(f"   AR z-score: {regime['ar_zscore']:.2f}")
    print(f"   Entropy z-score: {regime['entropy_zscore']:.2f}")
    print(f"   Fragility alert: {regime['fragility_alert']}")

    print("\n9. Full Feature Generation")
    features = calculate_correlation_features(returns)
    print(f"   Absorption Ratio: {features.absorption_ratio:.4f}")
    print(f"   Eigenvalue Entropy: {features.eigenvalue_entropy:.4f}")
    print(f"   Avg Correlation: {features.avg_correlation:.4f}")
    print(f"   Regime: {features.regime}")
    print(f"   Fragility Alert: {features.fragility_alert}")

    print("\n10. DataFrame Integration")
    df = pd.DataFrame(
        returns,
        columns=['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'],
        index=pd.date_range('2024-01-01', periods=T, freq='D')
    )

    df_with_features = add_correlation_features(
        df, returns_cols=['SPY', 'QQQ', 'IWM', 'TLT', 'GLD']
    )
    print(f"   Features added: {[c for c in df_with_features.columns if c not in df.columns]}")

    print("\n=== Correlation Module Test Complete ===")
