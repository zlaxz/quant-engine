"""
Duration Modeling Module for Market Physics Engine.

Implements:
- Hazard Rate Functions: Time-varying regime transition probabilities
- Hidden Semi-Markov Models (HSMM): Explicit duration distributions
- Duration-Dependent Transition Probabilities
- Regime "Aging" Analysis (Minsky Moment detection)

Key Insight: Standard HMM assumes geometric duration (most likely = 1 day).
Markets have non-geometric regime durations - bull markets "age".

Mathematical Foundations from REGIME-TRANSITIONS-RESEARCH.md

Author: Market Physics Engine
Layer: 6 (Regime Transition Prediction)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any, Callable
from scipy import stats
from scipy.special import gammaln, digamma
from scipy.optimize import minimize
import warnings


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class DurationDistribution:
    """Parameters for a duration distribution."""
    distribution: str = 'negative_binomial'  # 'geometric', 'poisson', 'negative_binomial', 'log_normal'
    # Negative Binomial / Geometric
    r: float = 2.0          # Number of failures (shape)
    p: float = 0.1          # Success probability
    # Poisson
    mu: float = 10.0        # Mean duration
    # Log-Normal
    log_mu: float = 2.0     # Log mean
    log_sigma: float = 0.5  # Log std


@dataclass
class HazardResult:
    """Results from hazard rate analysis."""
    hazard_rates: np.ndarray       # h(d) for each duration d
    survival_probs: np.ndarray     # S(d) = P(D >= d)
    cumulative_hazard: np.ndarray  # H(d) = -log(S(d))
    mean_residual_life: np.ndarray # E[D - d | D > d]
    distribution_fit: DurationDistribution
    regime_durations: np.ndarray   # Observed durations
    is_increasing_hazard: bool     # Minsky signal


@dataclass
class HSMMConfig:
    """Configuration for Hidden Semi-Markov Model."""
    n_regimes: int = 2
    duration_distribution: str = 'negative_binomial'
    max_duration: int = 252        # Max duration to consider (1 year)
    max_iter: int = 100
    tol: float = 1e-6
    min_variance: float = 1e-6


@dataclass
class HSMMResult:
    """Results from HSMM estimation."""
    regime_probabilities: np.ndarray   # T x K regime posteriors
    most_likely_regime: np.ndarray     # T x 1 Viterbi path
    duration_params: List[DurationDistribution]  # Duration dist per regime
    transition_matrix: np.ndarray      # K x K (excluding self-transitions)
    regime_means: np.ndarray
    regime_stds: np.ndarray
    expected_duration: np.ndarray      # E[D] per regime
    hazard_at_current: np.ndarray      # Hazard rate given current duration
    log_likelihood: float


# =============================================================================
# Hazard Rate Functions
# =============================================================================

def geometric_hazard(d: np.ndarray, p: float = 0.05) -> np.ndarray:
    """
    Geometric (standard HMM) hazard rate.

    h(d) = p (constant)

    This is what standard HMM assumes - memoryless.
    """
    return np.full_like(d, p, dtype=float)


def weibull_hazard(d: np.ndarray, k: float = 1.5, lam: float = 50.0) -> np.ndarray:
    """
    Weibull hazard rate.

    h(d) = (k/λ)(d/λ)^(k-1)

    k < 1: Decreasing hazard (infant mortality)
    k = 1: Constant hazard (exponential/geometric)
    k > 1: Increasing hazard (aging/wear-out) - Minsky dynamics

    For bull markets, expect k > 1 (probability of ending increases with duration).
    """
    d = np.maximum(d, 1)  # Avoid division by zero
    return (k / lam) * (d / lam) ** (k - 1)


def log_logistic_hazard(d: np.ndarray, alpha: float = 50.0, beta: float = 2.0) -> np.ndarray:
    """
    Log-logistic hazard rate.

    h(d) = (β/α)(d/α)^(β-1) / (1 + (d/α)^β)

    Non-monotonic: increases then decreases.
    Good for regimes that are initially fragile, then stabilize.
    """
    d = np.maximum(d, 1)
    t_ratio = (d / alpha) ** beta
    return (beta / alpha) * (d / alpha) ** (beta - 1) / (1 + t_ratio)


def negative_binomial_hazard(d: np.ndarray, r: float = 2.0, p: float = 0.05) -> np.ndarray:
    """
    Negative Binomial hazard rate.

    Better for market regimes - allows overdispersion.

    h(d) = P(D=d) / P(D>=d)

    r > 1 gives increasing hazard (regime aging).
    """
    d = np.asarray(d, dtype=int)
    d = np.maximum(d, 1)

    # PMF: P(D=d) = C(d-1+r-1, d-1) * (1-p)^r * p^(d-1)
    # Using scipy for numerical stability
    pmf = stats.nbinom.pmf(d - 1, r, 1 - p)  # Scipy parameterization differs
    sf = stats.nbinom.sf(d - 2, r, 1 - p)     # P(D >= d) = P(X >= d-1) = P(X > d-2) = sf(d-2)

    # DUR_R8_4: Return NaN when sf=0 (hazard undefined when survival=0)
    # Also handle division by zero when sf is zero or very small
    hazard = np.full_like(d, np.nan, dtype=float)
    valid_mask = sf > 1e-15  # Add small epsilon to avoid numerical issues
    hazard[valid_mask] = pmf[valid_mask] / sf[valid_mask]
    return hazard


def compute_hazard_rate(
    durations: np.ndarray,
    max_duration: Optional[int] = None
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Compute empirical hazard rate from observed durations.

    Kaplan-Meier style estimation.

    h(d) = n_d / R_d

    where:
    - n_d = number of regimes ending at duration d
    - R_d = number of regimes still active at duration d

    Returns
    -------
    d_values : np.ndarray
        Duration values
    hazard : np.ndarray
        Hazard rate at each duration
    """
    durations = np.asarray(durations, dtype=int)
    durations = durations[durations > 0]

    if len(durations) == 0:
        return np.array([]), np.array([])

    if max_duration is None:
        max_duration = int(np.max(durations))

    d_values = np.arange(1, max_duration + 1)
    hazard = np.zeros(max_duration)

    # Count endings at each duration
    n_at_d = np.bincount(durations, minlength=max_duration + 1)[1:]

    # Count at risk at each duration
    n_at_risk = np.zeros(max_duration)
    n_at_risk[0] = len(durations)
    for d in range(1, max_duration):
        n_at_risk[d] = n_at_risk[d-1] - n_at_d[d-1]

    # Hazard rate
    hazard = np.where(n_at_risk > 0, n_at_d / n_at_risk, 0)

    return d_values, hazard


def fit_duration_distribution(
    durations: np.ndarray,
    distribution: str = 'negative_binomial'
) -> DurationDistribution:
    """
    Fit a duration distribution to observed regime durations.

    Parameters
    ----------
    durations : np.ndarray
        Observed regime durations
    distribution : str
        Distribution to fit: 'geometric', 'poisson', 'negative_binomial', 'log_normal'

    Returns
    -------
    DurationDistribution
        Fitted parameters
    """
    durations = np.asarray(durations, dtype=float)
    durations = durations[durations > 0]

    result = DurationDistribution(distribution=distribution)

    if len(durations) < 3:
        warnings.warn("Insufficient data for distribution fitting")
        return result

    if distribution == 'geometric':
        # MLE: p = 1 / mean
        result.p = 1.0 / np.mean(durations)

    elif distribution == 'poisson':
        # MLE: mu = mean
        result.mu = np.mean(durations)

    elif distribution == 'negative_binomial':
        # Method of moments
        mean_d = np.mean(durations)
        var_d = np.var(durations, ddof=1)

        if var_d > mean_d:  # Overdispersed
            # DUR1/DUR2: For D = X + 1, E[X] = mean_d - 1
            result.p = (mean_d - 1) / var_d if var_d > 0 else 0.5
            result.r = (mean_d - 1) * result.p / (1 - result.p) if result.p < 1 else 1.0
        else:
            # DUR_R7_5: Explicit handling of zero/low variance case
            if var_d < 1e-10:
                warnings.warn(
                    f"Zero variance in duration data (var={var_d:.2e}). "
                    "Using geometric distribution - Minsky detection may be unreliable."
                )
            # Fallback to geometric
            result.p = 1.0 / mean_d if mean_d > 0 else 0.1
            result.r = 1.0 = 1.0

    elif distribution == 'log_normal':
        log_d = np.log(durations)
        result.log_mu = np.mean(log_d)
        result.log_sigma = np.std(log_d, ddof=1)

    return result


def analyze_regime_hazard(
    regime_series: np.ndarray,
    max_duration: int = 252
) -> HazardResult:
    """
    Analyze hazard rates for regime transitions.

    Parameters
    ----------
    regime_series : np.ndarray
        Time series of regime labels (integers)
    max_duration : int
        Maximum duration to analyze

    Returns
    -------
    HazardResult
        Complete hazard analysis
    """
    # Extract regime durations
    durations = extract_regime_durations(regime_series)

    if len(durations) < 3:
        warnings.warn("Insufficient regime changes for hazard analysis")
        return HazardResult(
            hazard_rates=np.array([]),
            survival_probs=np.array([]),
            cumulative_hazard=np.array([]),
            mean_residual_life=np.array([]),
            distribution_fit=DurationDistribution(),
            regime_durations=durations,
            is_increasing_hazard=False
        )

    # Compute empirical hazard
    d_values, hazard = compute_hazard_rate(durations, max_duration)

    # Compute survival function: S(d) = Π_{i=1}^{d} (1 - h(i))
    survival = np.cumprod(1 - hazard)

    # Cumulative hazard: H(d) = -log(S(d))
    cum_hazard = -np.log(np.maximum(survival, 1e-10))

    # Mean residual life: E[D - d | D > d]
    mrl = np.zeros_like(hazard)
    for d in range(len(mrl)):
        if survival[d] > 0:
            # Sum of survival probabilities from d onwards
            mrl[d] = np.sum(survival[d:]) / survival[d]

    # Fit distribution
    dist_fit = fit_duration_distribution(durations, 'negative_binomial')

    # Test for increasing hazard (Minsky dynamics)
    if len(hazard) > 10:
        # Compare early vs late hazard
        mid = len(hazard) // 2
        # DUR_R7_1: Handle empty arrays when all hazard values are 0.0
        early_positive = hazard[:mid][hazard[:mid] > 0]
        late_positive = hazard[mid:][hazard[mid:] > 0]
        if len(early_positive) > 0 and len(late_positive) > 0:
            early_hazard = np.mean(early_positive)
            late_hazard = np.mean(late_positive)
            is_increasing = late_hazard > early_hazard * 1.2  # 20% higher
        else:
            # Insufficient positive hazard values to compare
            is_increasing = False
    else:
        is_increasing = False

    return HazardResult(
        hazard_rates=hazard,
        survival_probs=survival,
        cumulative_hazard=cum_hazard,
        mean_residual_life=mrl,
        distribution_fit=dist_fit,
        regime_durations=durations,
        is_increasing_hazard=is_increasing
    )


def extract_regime_durations(regime_series: np.ndarray) -> np.ndarray:
    """
    Extract regime durations from a time series of regime labels.

    Parameters
    ----------
    regime_series : np.ndarray
        Time series of regime labels

    Returns
    -------
    np.ndarray
        Array of regime durations
    """
    regime_series = np.asarray(regime_series)

    if len(regime_series) < 2:
        return np.array([])

    # Find change points
    changes = np.where(np.diff(regime_series) != 0)[0] + 1
    changes = np.concatenate([[0], changes, [len(regime_series)]])

    # Compute durations
    durations = np.diff(changes)

    return durations


# =============================================================================
# Hidden Semi-Markov Model (HSMM)
# =============================================================================

class HiddenSemiMarkov:
    """
    Hidden Semi-Markov Model with explicit duration modeling.

    Unlike standard HMM (geometric duration), HSMM models
    duration explicitly using specified distributions.

    Key equation:
    P(S_t, c_t | S_{t-1}, c_{t-1}) =
        δ(S_t = S_{t-1}) · δ(c_t = c_{t-1} - 1)  if c_{t-1} > 1
        a_{S_{t-1}, S_t} · ρ_{S_t}(d)            if c_{t-1} = 1

    where c_t is remaining duration in current state.
    """

    def __init__(self, config: HSMMConfig = None):
        """Initialize HSMM."""
        self.config = config or HSMMConfig()
        self.n_regimes = self.config.n_regimes

        # Model parameters
        self.transition_matrix = None  # P(next state | current state) for transitions
        self.means = None
        self.stds = None
        self.duration_params: List[DurationDistribution] = []

    def _duration_pmf(self, d: int, regime: int) -> float:
        """
        Compute P(duration = d) for a regime.
        """
        params = self.duration_params[regime]

        if params.distribution == 'geometric':
            return stats.geom.pmf(d, params.p)
        elif params.distribution == 'poisson':
            return stats.poisson.pmf(d, params.mu)
        elif params.distribution == 'negative_binomial':
            return stats.nbinom.pmf(d - 1, params.r, 1 - params.p)
        elif params.distribution == 'log_normal':
            if d <= 0:
                return 0
            return stats.lognorm.pdf(d, params.log_sigma, scale=np.exp(params.log_mu))
        else:
            return stats.geom.pmf(d, 0.05)  # Default

    def _emission_prob(self, x: float, regime: int) -> float:
        """
        Compute P(observation | regime).
        """
        return stats.norm.pdf(x, self.means[regime], self.stds[regime])

    def _initialize_params(self, data: np.ndarray):
        """
        Initialize model parameters from data.
        """
        n = len(data)

        # Simple k-means style initialization
        sorted_data = np.sort(data)
        n_per_regime = n // self.n_regimes

        self.means = np.zeros(self.n_regimes)
        self.stds = np.zeros(self.n_regimes)

        for k in range(self.n_regimes):
            start = k * n_per_regime
            end = (k + 1) * n_per_regime if k < self.n_regimes - 1 else n
            segment = sorted_data[start:end]
            self.means[k] = np.mean(segment)
            self.stds[k] = np.std(segment) + self.config.min_variance

        # Sort means for interpretability (regime 0 = lowest mean)
        order = np.argsort(self.means)
        self.means = self.means[order]
        self.stds = self.stds[order]

        # Transition matrix (no self-transitions in HSMM)
        off_diag = 1.0 / (self.n_regimes - 1)
        self.transition_matrix = np.full((self.n_regimes, self.n_regimes), off_diag)
        np.fill_diagonal(self.transition_matrix, 0)

        # Duration distributions
        self.duration_params = []
        for k in range(self.n_regimes):
            params = DurationDistribution(
                distribution=self.config.duration_distribution,
                r=2.0,
                p=0.05,
                mu=20.0,
                log_mu=np.log(20),
                log_sigma=0.5
            )
            self.duration_params.append(params)

    def fit(self, data: np.ndarray) -> 'HiddenSemiMarkov':
        """
        Fit HSMM using EM algorithm.

        Simplified implementation - for production use hmmlearn or pyro.
        """
        data = np.asarray(data).flatten()
        n = len(data)

        if n < 50:
            warnings.warn("Insufficient data for HSMM fitting")
            return self

        # Initialize
        self._initialize_params(data)

        # Simple Viterbi-style classification for initialization
        regime_labels = np.zeros(n, dtype=int)
        for t in range(n):
            probs = [self._emission_prob(data[t], k) for k in range(self.n_regimes)]
            regime_labels[t] = np.argmax(probs)

        # Extract durations and fit duration distributions
        durations = extract_regime_durations(regime_labels)
        if len(durations) > 5:
            for k in range(self.n_regimes):
                # Get durations for this regime
                regime_durations = []
                current_regime = regime_labels[0]
                current_duration = 1
                for t in range(1, n):
                    if regime_labels[t] == current_regime:
                        current_duration += 1
                    else:
                        if current_regime == k:
                            regime_durations.append(current_duration)
                        current_regime = regime_labels[t]
                        current_duration = 1

                if len(regime_durations) > 2:
                    self.duration_params[k] = fit_duration_distribution(
                        np.array(regime_durations),
                        self.config.duration_distribution
                    )

        # Update means/stds based on labels
        for k in range(self.n_regimes):
            mask = regime_labels == k
            if np.sum(mask) > 1:
                self.means[k] = np.mean(data[mask])
                self.stds[k] = np.std(data[mask]) + self.config.min_variance

        return self

    def decode(self, data: np.ndarray) -> HSMMResult:
        """
        Decode most likely state sequence and compute posteriors.
        """
        data = np.asarray(data).flatten()
        n = len(data)

        # Simple forward pass for regime probabilities
        regime_probs = np.zeros((n, self.n_regimes))

        for t in range(n):
            for k in range(self.n_regimes):
                regime_probs[t, k] = self._emission_prob(data[t], k)

            # Normalize
            regime_probs[t] /= regime_probs[t].sum() + 1e-300

        # Most likely regime at each time
        most_likely = np.argmax(regime_probs, axis=1)

        # Expected durations
        expected_duration = np.zeros(self.n_regimes)
        for k in range(self.n_regimes):
            params = self.duration_params[k]
            if params.distribution == 'negative_binomial':
                # E[D] = E[X] + 1 where X ~ nbinom, E[X] = r(1-p)/p
                expected_duration[k] = params.r * (1 - params.p) / params.p + 1
            elif params.distribution == 'poisson':
                # DUR3: E[D] = E[X] + 1 = μ + 1
                expected_duration[k] = params.mu + 1
            elif params.distribution == 'geometric':
                expected_duration[k] = 1 / params.p
            else:
                expected_duration[k] = np.exp(params.log_mu + params.log_sigma**2 / 2)

        # Compute hazard at current duration
        hazard_at_current = np.zeros(n)
        current_regime = most_likely[0]
        current_duration = 1

        # DUR_R7_3: Initialize hazard for first observation (t=0)
        k = current_regime
        params = self.duration_params[k]
        if params.distribution == 'negative_binomial':
            hazard_at_current[0] = negative_binomial_hazard(
                np.array([current_duration]),
                r=params.r,
                p=params.p
            )[0]
        else:
            hazard_at_current[0] = 1.0 / expected_duration[k] if expected_duration[k] > 0 else 0.0

        for t in range(1, n):
            if most_likely[t] == current_regime:
                current_duration += 1
            else:
                current_regime = most_likely[t]
                current_duration = 1

            # Hazard for current regime at current duration
            k = current_regime
            params = self.duration_params[k]
            if params.distribution == 'negative_binomial':
                hazard_at_current[t] = negative_binomial_hazard(
                    np.array([current_duration]),
                    r=params.r,
                    p=params.p
                )[0]
            else:
                hazard_at_current[t] = 1.0 / expected_duration[k]

        # Log likelihood (approximate)
        ll = np.sum(np.log(np.max(regime_probs, axis=1) + 1e-300))

        return HSMMResult(
            regime_probabilities=regime_probs,
            most_likely_regime=most_likely,
            duration_params=self.duration_params,
            transition_matrix=self.transition_matrix,
            regime_means=self.means,
            regime_stds=self.stds,
            expected_duration=expected_duration,
            hazard_at_current=hazard_at_current,
            log_likelihood=ll
        )


# =============================================================================
# Duration-Dependent Transition Probabilities
# =============================================================================

def duration_dependent_transition_prob(
    current_duration: int,
    current_regime: int,
    target_regime: int,
    hazard_func: Callable[[np.ndarray], np.ndarray] = None,
    base_transition: float = 0.5
) -> float:
    """
    Compute transition probability that depends on time-in-regime.

    P(S_{t+1} = j | S_t = i, d_t = d) = h(d) · a_{ij}

    where h(d) is the hazard rate at duration d,
    and a_{ij} is the base transition probability.

    Parameters
    ----------
    current_duration : int
        Time spent in current regime
    current_regime : int
        Current regime index
    target_regime : int
        Target regime index
    hazard_func : callable
        Hazard rate function h(d)
    base_transition : float
        Base transition probability a_{ij}

    Returns
    -------
    float
        Transition probability
    """
    if current_regime == target_regime:
        # Self-transition: 1 - hazard
        if hazard_func is not None:
            h = hazard_func(np.array([current_duration]))[0]
        else:
            h = 0.05  # Default constant hazard
        return 1 - h

    else:
        # Transition to another state
        if hazard_func is not None:
            h = hazard_func(np.array([current_duration]))[0]
        else:
            h = 0.05
        return h * base_transition


def compute_minsky_moment_probability(
    regime_series: np.ndarray,
    current_duration: int,
    bull_regime: int = 1
) -> Dict[str, float]:
    """
    Compute probability of "Minsky Moment" - sudden transition from bull to bear.

    The longer a bull market continues, the higher the probability of collapse
    (increasing hazard).

    Parameters
    ----------
    regime_series : np.ndarray
        Historical regime labels
    current_duration : int
        Current time in bull regime
    bull_regime : int
        Index of bull regime

    Returns
    -------
    dict
        'transition_prob': Probability of transition in next period
        'historical_hazard': Hazard rate at current duration from history
        'expected_remaining': Expected remaining duration
        'percentile': Where current duration falls in historical distribution
    """
    # Extract bull regime durations
    durations = []
    regime_series = np.asarray(regime_series)

    current_regime = regime_series[0]
    dur = 1
    for t in range(1, len(regime_series)):
        if regime_series[t] == current_regime:
            dur += 1
        else:
            if current_regime == bull_regime:
                durations.append(dur)
            current_regime = regime_series[t]
            dur = 1

    durations = np.array(durations)

    if len(durations) < 3:
        return {
            'transition_prob': 0.05,
            'historical_hazard': 0.05,
            'expected_remaining': 20,
            'percentile': 0.5
        }

    # Fit distribution and compute hazard
    dist_fit = fit_duration_distribution(durations, 'negative_binomial')
    hazard = negative_binomial_hazard(
        np.array([current_duration]),
        r=dist_fit.r,
        p=dist_fit.p
    )[0]

    # Survival probability
    survival = np.prod([
        1 - negative_binomial_hazard(np.array([d]), dist_fit.r, dist_fit.p)[0]
        for d in range(1, current_duration)
    ]) if current_duration > 1 else 1.0

    # Expected remaining life (conditional on surviving to current_duration)
    if survival > 0:
        # DUR4: E[D] = E[X] + 1 = r(1-p)/p + 1
        expected_total = dist_fit.r * (1 - dist_fit.p) / dist_fit.p + 1
        expected_remaining = max(0, expected_total - current_duration)
    else:
        expected_remaining = 0

    # Percentile
    percentile = np.mean(durations <= current_duration)

    return {
        'transition_prob': hazard,
        'historical_hazard': hazard,
        'expected_remaining': expected_remaining,
        'percentile': percentile
    }


# =============================================================================
# DataFrame Integration
# =============================================================================

def add_duration_features(
    df: pd.DataFrame,
    regime_col: str = 'regime',
    prefix: str = 'dur_'
) -> pd.DataFrame:
    """
    Add duration-based features to DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame with regime column
    regime_col : str
        Column name for regime labels
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with duration features added:
        - dur_in_regime: Time in current regime
        - dur_hazard: Hazard rate at current duration
        - dur_survival: Survival probability
        - dur_expected_remaining: Expected remaining duration
    """
    df = df.copy()
    regime = df[regime_col].values

    n = len(regime)
    duration_in_regime = np.zeros(n)
    hazard = np.zeros(n)
    survival = np.ones(n)

    # Compute durations
    current = regime[0]
    dur = 1
    duration_in_regime[0] = 1

    # DUR_R7_4: Track whether we're coming out of NaN gap
    prev_was_nan = False

    for t in range(1, n):
        if pd.isna(regime[t]):
            duration_in_regime[t] = np.nan
            prev_was_nan = True
            continue

        # DUR_R7_4: Reset duration counter when coming out of NaN gap
        if prev_was_nan:
            # After NaN gap, reset - we don't know if regime continued or changed
            current = regime[t]
            dur = 1
            prev_was_nan = False
        elif regime[t] == current:
            dur += 1
        else:
            current = regime[t]
            dur = 1
        duration_in_regime[t] = dur

    df[f'{prefix}in_regime'] = duration_in_regime

    # Fit hazard model on historical data
    regime_array = df[regime_col].dropna().values
    hazard_result = analyze_regime_hazard(regime_array)

    if len(hazard_result.hazard_rates) > 0:
        # Compute hazard at each time point
        for t in range(n):
            d = int(duration_in_regime[t])
            if d > 0 and d <= len(hazard_result.hazard_rates):
                hazard[t] = hazard_result.hazard_rates[d - 1]
                survival[t] = hazard_result.survival_probs[d - 1]
            elif d > len(hazard_result.hazard_rates):
                # Extrapolate
                hazard[t] = hazard_result.hazard_rates[-1]
                survival[t] = hazard_result.survival_probs[-1]

    df[f'{prefix}hazard'] = hazard
    df[f'{prefix}survival'] = survival

    # Expected remaining duration
    expected_remaining = np.zeros(n)
    if len(hazard_result.mean_residual_life) > 0:
        for t in range(n):
            d = int(duration_in_regime[t])
            if d > 0 and d <= len(hazard_result.mean_residual_life):
                expected_remaining[t] = hazard_result.mean_residual_life[d - 1]

    df[f'{prefix}expected_remaining'] = expected_remaining

    # Flag increasing hazard (Minsky signal)
    df[f'{prefix}minsky_signal'] = hazard_result.is_increasing_hazard

    return df


# =============================================================================
# Time-Varying Transition Probability (TVTP)
# =============================================================================

def tvtp_transition_matrix(
    duration_in_regime: np.ndarray,
    current_regime: np.ndarray,
    base_matrix: np.ndarray,
    hazard_func: Callable[[np.ndarray], np.ndarray] = None
) -> np.ndarray:
    """
    Compute time-varying transition probabilities.

    From research:
    a_{ii,t} = exp(β_0 + β_1'z_{t-1}) / (1 + exp(β_0 + β_1'z_{t-1}))

    Here we use duration as the primary covariate.

    Parameters
    ----------
    duration_in_regime : np.ndarray
        Time spent in current regime at each t
    current_regime : np.ndarray
        Regime at each t
    base_matrix : np.ndarray
        Base transition matrix (K x K)
    hazard_func : callable
        Hazard function h(d)

    Returns
    -------
    np.ndarray
        T x K x K time-varying transition matrices
    """
    n = len(duration_in_regime)
    k = base_matrix.shape[0]

    if hazard_func is None:
        hazard_func = lambda d: weibull_hazard(d, k=1.5, lam=50.0)

    tvtp = np.zeros((n, k, k))

    for t in range(n):
        d = int(duration_in_regime[t])
        h = hazard_func(np.array([d]))[0]

        # Adjust transition matrix based on hazard
        for i in range(k):
            for j in range(k):
                if i == j:
                    # Stay probability decreases with hazard
                    tvtp[t, i, j] = 1 - h
                else:
                    # Transition probability scales with hazard
                    tvtp[t, i, j] = h * base_matrix[i, j]

            # DUR_R7_2: Normalize row with zero-sum protection
            row_sum = tvtp[t, i, :].sum()
            if row_sum > 1e-10:
                tvtp[t, i, :] /= row_sum
            else:
                # Zero-sum row - use uniform distribution as fallback
                tvtp[t, i, :] = 1.0 / k

    return tvtp
