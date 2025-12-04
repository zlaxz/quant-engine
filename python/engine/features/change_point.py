"""
Change Point Detection Module for Market Physics Engine.

Implements:
- CUSUM: Online detection for variance/mean shifts
- PELT: Offline exact detection with O(n) complexity
- BOCPD: Bayesian Online Change Point Detection

Mathematical Foundations from REGIME-TRANSITIONS-RESEARCH.md

Author: Market Physics Engine
Layer: 6 (Regime Transition Prediction)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, Any, Union
from scipy import stats
import warnings


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class CUSUMResult:
    """Results from CUSUM change point detection."""
    statistic: np.ndarray          # CUSUM statistic over time
    alarms: np.ndarray             # Boolean array of alarm points
    change_points: List[int]       # Detected change point indices
    threshold: float               # Detection threshold used
    direction: str                 # 'up', 'down', or 'both'


@dataclass
class PELTResult:
    """Results from PELT change point detection."""
    change_points: List[int]       # Detected change point indices
    n_segments: int                # Number of segments
    segment_means: np.ndarray      # Mean of each segment
    segment_vars: np.ndarray       # Variance of each segment
    cost: float                    # Total cost of segmentation
    penalty: float                 # Penalty parameter used


@dataclass
class BOCPDResult:
    """Results from Bayesian Online Change Point Detection."""
    run_length_posterior: np.ndarray    # T x T run length distribution
    change_point_probability: np.ndarray  # P(change at t) for each t
    change_points: List[int]            # Most likely change points
    hazard_rate: float                  # Constant hazard rate used
    mean_posterior: np.ndarray          # Posterior mean at each t
    var_posterior: np.ndarray           # Posterior variance at each t


@dataclass
class ChangePointConfig:
    """Configuration for change point detection."""
    # CUSUM parameters
    cusum_threshold: float = 5.0
    cusum_drift: float = 0.0
    cusum_reference_window: int = 100

    # PELT parameters
    pelt_penalty: str = 'bic'  # 'aic', 'bic', or float
    pelt_min_segment: int = 5
    pelt_model: str = 'normal'  # 'normal', 'rbf'

    # BOCPD parameters
    bocpd_hazard: float = 1/100  # Expected run length = 100
    bocpd_prior_mu: float = 0.0
    bocpd_prior_kappa: float = 1.0
    bocpd_prior_alpha: float = 1.0
    bocpd_prior_beta: float = 1.0
    bocpd_threshold: float = 0.5


# =============================================================================
# CUSUM: Online Change Point Detection
# =============================================================================

def cusum_mean_shift(
    data: np.ndarray,
    reference_mean: Optional[float] = None,
    reference_std: Optional[float] = None,
    threshold: float = 5.0,
    drift: float = 0.0
) -> CUSUMResult:
    """
    CUSUM for detecting mean shifts.

    The CUSUM statistic accumulates deviations from reference:
    S_n = max(0, S_{n-1} + (x_n - μ_0)/σ_0 - k)

    Alarm when S_n > h (threshold)

    Parameters
    ----------
    data : np.ndarray
        Time series data
    reference_mean : float, optional
        Expected mean (default: use first 20% of data)
    reference_std : float, optional
        Expected std (default: use first 20% of data)
    threshold : float
        Alarm threshold (default: 5.0)
    drift : float
        Allowance parameter k (default: 0.0)

    Returns
    -------
    CUSUMResult
        Detection results
    """
    # CP_R7_2: Validate input data for NaN
    data = np.asarray(data)
    if np.any(np.isnan(data)):
        raise ValueError("Input data contains NaN values - cusum_mean_shift cannot handle NaN")

    n = len(data)

    # Estimate reference parameters if not provided
    reference_window = max(20, n // 5)
    if reference_mean is None:
        reference_mean = np.mean(data[:reference_window])
    if reference_std is None:
        reference_std = np.std(data[:reference_window], ddof=1)
        reference_std = max(reference_std, 1e-10)  # Prevent division by zero

    # Standardize
    z = (data - reference_mean) / reference_std

    # Two-sided CUSUM
    cusum_pos = np.zeros(n)
    cusum_neg = np.zeros(n)

    for i in range(1, n):
        cusum_pos[i] = max(0, cusum_pos[i-1] + z[i] - drift)
        # CP1: Negative CUSUM uses min() not max(), tracks downward shifts
        cusum_neg[i] = min(0, cusum_neg[i-1] + z[i] + drift)

    # CP2: Combined statistic uses abs() for negative CUSUM (which is <= 0)
    cusum_stat = np.maximum(cusum_pos, np.abs(cusum_neg))

    # Detect alarms
    alarms = cusum_stat > threshold

    # Find change points (first alarm after each reset)
    change_points = []
    in_alarm = False
    for i in range(n):
        if alarms[i] and not in_alarm:
            change_points.append(i)
            in_alarm = True
        elif not alarms[i]:
            in_alarm = False

    return CUSUMResult(
        statistic=cusum_stat,
        alarms=alarms,
        change_points=change_points,
        threshold=threshold,
        direction='both'
    )


def cusum_variance_shift(
    data: np.ndarray,
    reference_var: Optional[float] = None,
    target_var: Optional[float] = None,
    threshold: float = 5.0
) -> CUSUMResult:
    """
    CUSUM for detecting variance shifts.

    From research:
    s_t = ln(σ_0/σ_1) + (x_t²/2)(1/σ_0² - 1/σ_1²)
    Z_n = max(0, Z_{n-1} + s_n)

    Parameters
    ----------
    data : np.ndarray
        Time series data (should be demeaned or returns)
    reference_var : float, optional
        Reference variance σ_0² (default: estimate from first 20%)
    target_var : float, optional
        Target variance σ_1² to detect (default: 2x reference)
    threshold : float
        Detection threshold

    Returns
    -------
    CUSUMResult
        Detection results
    """
    n = len(data)

    # Estimate reference variance
    reference_window = max(20, n // 5)
    if reference_var is None:
        reference_var = np.var(data[:reference_window], ddof=1)
        reference_var = max(reference_var, 1e-10)

    if target_var is None:
        target_var = 2.0 * reference_var  # Detect doubling of variance

    sigma_0 = np.sqrt(reference_var)
    sigma_1 = np.sqrt(target_var)

    # CP4: Compute score for each observation with correct 0.5 multiplier
    # CP_R6_6: Protect against overflow when variances are extremely small
    min_var = 1e-8
    safe_ref_var = max(reference_var, min_var)
    safe_target_var = max(target_var, min_var)

    log_ratio = np.log(sigma_0 / sigma_1)
    var_diff = 1/safe_ref_var - 1/safe_target_var

    s = log_ratio + 0.5 * data**2 * var_diff

    # Cumulative statistic
    cusum_stat = np.zeros(n)
    for i in range(1, n):
        cusum_stat[i] = max(0, cusum_stat[i-1] + s[i])

    # Detect alarms
    alarms = cusum_stat > threshold

    # Find change points
    change_points = []
    in_alarm = False
    for i in range(n):
        if alarms[i] and not in_alarm:
            change_points.append(i)
            in_alarm = True
        elif not alarms[i]:
            in_alarm = False

    return CUSUMResult(
        statistic=cusum_stat,
        alarms=alarms,
        change_points=change_points,
        threshold=threshold,
        direction='up'  # Detecting variance increase
    )


# =============================================================================
# PELT: Pruned Exact Linear Time
# =============================================================================

def _segment_cost_normal(
    data: np.ndarray,
    start: int,
    end: int
) -> float:
    """
    Compute negative log-likelihood cost for a segment under normal model.

    Cost = (n/2) * log(2π) + (n/2) * log(σ²_MLE) + n/2

    Uses MLE variance (ddof=0) for theoretical consistency with PELT.
    """
    segment = data[start:end]
    n = len(segment)

    if n < 2:
        return np.inf

    # Use MLE variance (ddof=0) for PELT cost function consistency
    var = np.var(segment, ddof=0)
    var = max(var, 1e-10)  # Numerical stability

    # CP8: Negative log-likelihood with constant terms for proper penalty calibration
    # NLL = (n/2) * [log(2π) + log(var) + 1]
    cost = (n / 2) * (np.log(2 * np.pi) + np.log(var) + 1)

    return cost


def _segment_cost_rbf(
    data: np.ndarray,
    start: int,
    end: int,
    gamma: float = 1.0
) -> float:
    """
    Compute RBF kernel-based cost for a segment.

    Measures homogeneity using kernel trick.
    """
    segment = data[start:end]
    n = len(segment)

    if n < 2:
        return np.inf

    # Pairwise kernel values
    segment = segment.reshape(-1, 1)
    sq_dists = np.sum((segment - segment.T)**2, axis=0) if segment.ndim > 1 else (segment - segment.T)**2

    # Simplified: use variance-based proxy
    var = np.var(segment)
    cost = n * var * gamma

    return cost


def pelt_detect(
    data: np.ndarray,
    penalty: Union[str, float] = 'bic',
    min_segment: int = 5,
    model: str = 'normal'
) -> PELTResult:
    """
    PELT (Pruned Exact Linear Time) change point detection.

    Minimizes: Σ C(y_{τ_{i-1}:τ_i}) + β * (m+1)

    Using pruning inequality for O(n) complexity:
    F(t) + C(y_{t:s}) + K >= F(s) => prune t

    Parameters
    ----------
    data : np.ndarray
        Time series data
    penalty : str or float
        'bic' for BIC penalty, 'aic' for AIC, or float value
    min_segment : int
        Minimum segment size
    model : str
        'normal' or 'rbf'

    Returns
    -------
    PELTResult
        Detection results
    """
    # CP_R7_4: Validate input data for NaN
    data = np.asarray(data)
    if np.any(np.isnan(data)):
        raise ValueError("Input data contains NaN values - pelt_detect cannot handle NaN")

    n = len(data)

    # CP_R5_8: Validate parameters to prevent silent failures
    if min_segment < 1:
        raise ValueError(f"min_segment must be >= 1, got {min_segment}")
    if n < 2 * min_segment:
        raise ValueError(
            f"Data length ({n}) must be >= 2 * min_segment ({2 * min_segment}) "
            "to detect at least one change point"
        )
    if isinstance(penalty, (int, float)) and penalty < 0:
        raise ValueError(f"penalty must be non-negative, got {penalty}")

    # Compute penalty
    # CP_R6_3: BIC penalty may be too small for very short series (n=2 → beta≈1.4)
    # This can cause over-segmentation. For production, ensure n >= 10 for reliable BIC.
    if penalty == 'bic':
        beta = 2 * np.log(n)
    elif penalty == 'aic':
        beta = 2
    else:
        beta = float(penalty)

    # Choose cost function
    if model == 'normal':
        cost_fn = _segment_cost_normal
    else:
        cost_fn = _segment_cost_rbf

    # Initialize
    F = np.full(n + 1, np.inf)  # F[t] = optimal cost for data[0:t]
    F[0] = 0  # Per Killick et al. (2012): F[0] = 0, penalty added when forming segments

    cp = [[] for _ in range(n + 1)]  # Change point sets
    R = [0]  # Candidate change points

    # Dynamic programming with pruning
    for t in range(min_segment, n + 1):
        # Find optimal segmentation ending at t (store costs for reuse in pruning)
        candidates = []
        cost_cache = {}  # Cache costs to avoid recomputation
        for s in R:
            if t - s >= min_segment:
                cost = F[s] + cost_fn(data, s, t) + beta
                candidates.append((cost, s))
                cost_cache[s] = cost

        if candidates:
            best_cost, best_s = min(candidates, key=lambda x: x[0])
            F[t] = best_cost
            cp[t] = cp[best_s] + [best_s] if best_s > 0 else []

        # CP5: Pruning - reuse cached costs without fallback recomputation
        R_new = []
        for s in R:
            if t - s >= min_segment:
                # Only use cached costs (no fallback to avoid defeating cache)
                if s in cost_cache and cost_cache[s] <= F[t]:
                    R_new.append(s)
        R_new.append(t)
        R = R_new

    # Get final change points
    change_points = cp[n]

    # CP6: Verify 0 should never be in change points (indicates upstream bug)
    # CP_R5_1: Use warnings.warn() instead of undefined logger
    if change_points and change_points[0] == 0:
        warnings.warn(
            "PELT algorithm produced 0 as change point - algorithm bug detected!",
            RuntimeWarning
        )
        change_points = change_points[1:]  # Remove as defensive measure

    # Compute segment statistics
    all_points = [0] + change_points + [n]
    segment_means = []
    segment_vars = []

    for i in range(len(all_points) - 1):
        segment = data[all_points[i]:all_points[i+1]]
        segment_means.append(np.mean(segment))
        # CP7: Use ddof=0 to match cost function (MLE variance)
        segment_vars.append(np.var(segment, ddof=0) if len(segment) > 1 else 0)

    return PELTResult(
        change_points=change_points,
        n_segments=len(all_points) - 1,
        segment_means=np.array(segment_means),
        segment_vars=np.array(segment_vars),
        cost=F[n],
        penalty=beta
    )


# =============================================================================
# BOCPD: Bayesian Online Change Point Detection
# =============================================================================

class BOCPD:
    """
    Bayesian Online Change Point Detection.

    Implements Adams & MacKay (2007) algorithm with
    Normal-Inverse-Gamma conjugate prior for streaming data.

    Run length posterior:
    P(r_t, x_{1:t}) = Σ_{r_{t-1}} P(r_t|r_{t-1}) P(x_t|r_{t-1}, x^{(r)}) P(r_{t-1}, x_{1:t-1})

    Predictive distribution: Student-t (handles fat tails)
    """

    def __init__(
        self,
        hazard: float = 1/100,
        prior_mu: float = 0.0,
        prior_kappa: float = 1.0,
        prior_alpha: float = 1.0,
        prior_beta: float = 1.0,
        max_run_length: int = None
    ):
        """
        Initialize BOCPD with Normal-Inverse-Gamma prior.

        Parameters
        ----------
        hazard : float
            Constant hazard rate H(τ) = hazard
            Expected run length = 1/hazard
        prior_mu : float
            Prior mean
        prior_kappa : float
            Prior precision scale
        prior_alpha : float
            Prior shape for variance
        prior_beta : float
            Prior rate for variance
        max_run_length : int, optional
            CP9 FIX: Maximum run length to track (truncates to save memory).
            Defaults to 5/hazard to capture 99.3% of probability mass.
        """
        # CP_R5_3: Validate prior parameters to prevent division by zero
        if hazard <= 0 or hazard > 1:
            raise ValueError(f"hazard must be in (0, 1], got {hazard}")
        if prior_kappa <= 0:
            raise ValueError(f"prior_kappa must be > 0, got {prior_kappa}")
        if prior_alpha <= 0:
            raise ValueError(f"prior_alpha must be > 0, got {prior_alpha}")
        if prior_beta <= 0:
            raise ValueError(f"prior_beta must be > 0, got {prior_beta}")

        self.hazard = hazard

        # CP9 FIX: Limit run length to prevent O(n²) memory
        if max_run_length is None:
            max_run_length = max(500, int(5 / hazard))  # ~5 expected run lengths

        # CP_R6_1: Validate max_run_length is sensible
        if max_run_length < 2:
            raise ValueError(f"max_run_length must be >= 2, got {max_run_length}")

        self.max_run_length = max_run_length

        # Prior hyperparameters (Normal-Inverse-Gamma)
        self.mu0 = prior_mu
        self.kappa0 = prior_kappa
        self.alpha0 = prior_alpha
        self.beta0 = prior_beta

        # Sufficient statistics for each run length
        self.reset()

    def reset(self):
        """Reset the detector state."""
        self.t = 0
        self.run_length_probs = np.array([1.0])  # P(r_t = 0) = 1 initially

        # Sufficient statistics: one set per possible run length
        self.sum_x = np.array([0.0])
        self.sum_x2 = np.array([0.0])
        self.n = np.array([0])

        # Storage for full posterior
        self.R = []  # Run length posterior over time
        self.mean_post = []
        self.var_post = []

    def _student_t_pdf(
        self,
        x: float,
        df: float,
        loc: float,
        scale: float
    ) -> float:
        """
        Student-t PDF for predictive distribution.
        """
        return stats.t.pdf(x, df=df, loc=loc, scale=scale)

    def _posterior_params(self, r: int) -> Tuple[float, float, float, float]:
        """
        Compute posterior hyperparameters for run length r.

        Returns: (mu_n, kappa_n, alpha_n, beta_n)
        """
        if r == 0 or self.n[r] == 0:
            return self.mu0, self.kappa0, self.alpha0, self.beta0

        n = self.n[r]
        sum_x = self.sum_x[r]
        sum_x2 = self.sum_x2[r]

        # Posterior updates (conjugate)
        kappa_n = self.kappa0 + n
        mu_n = (self.kappa0 * self.mu0 + sum_x) / kappa_n
        alpha_n = self.alpha0 + n / 2

        # SSE term
        # CP_R6_5: Note - for n=1, sse=0 which may underestimate uncertainty.
        # This is inherent to the model (single point has no variance).
        x_bar = sum_x / n if n > 0 else 0
        sse = sum_x2 - 2 * x_bar * sum_x + n * x_bar**2

        beta_n = self.beta0 + 0.5 * sse + \
                 (self.kappa0 * n * (x_bar - self.mu0)**2) / (2 * kappa_n)

        return mu_n, kappa_n, alpha_n, beta_n

    def _predictive_prob(self, x: float, r: int) -> float:
        """
        Compute predictive probability P(x_t | r_{t-1}, data).

        Predictive is Student-t with:
        - df = 2 * alpha_n
        - loc = mu_n
        - scale = sqrt(beta_n * (kappa_n + 1) / (alpha_n * kappa_n))
        """
        mu_n, kappa_n, alpha_n, beta_n = self._posterior_params(r)

        df = 2 * alpha_n
        loc = mu_n
        scale = np.sqrt(beta_n * (kappa_n + 1) / (alpha_n * kappa_n))

        return self._student_t_pdf(x, df, loc, scale)

    def update(self, x: float) -> Tuple[np.ndarray, float]:
        """
        Update run length posterior with new observation.

        Parameters
        ----------
        x : float
            New observation

        Returns
        -------
        run_length_probs : np.ndarray
            Updated run length posterior P(r_t | x_{1:t})
        change_prob : float
            Probability of change point at current time
        """
        self.t += 1

        # Compute predictive probabilities for all run lengths
        n_rl = len(self.run_length_probs)
        pred_probs = np.zeros(n_rl)

        for r in range(n_rl):
            pred_probs[r] = self._predictive_prob(x, r)

        # Growth probabilities: P(r_t = r_{t-1} + 1)
        growth_probs = self.run_length_probs * pred_probs * (1 - self.hazard)

        # Change point probability: P(r_t = 0)
        change_prob = np.sum(self.run_length_probs * pred_probs * self.hazard)

        # New run length distribution
        new_probs = np.zeros(n_rl + 1)
        new_probs[0] = change_prob
        new_probs[1:] = growth_probs

        # CP11: Normalize with explicit zero-sum handling
        prob_sum = np.sum(new_probs)
        if prob_sum > 1e-300:
            new_probs = new_probs / prob_sum
        else:
            # Degenerate case: reset to uniform over first 2 run lengths
            new_probs = np.zeros(n_rl + 1)
            new_probs[0] = 0.5  # Change point
            if n_rl > 0:
                new_probs[1] = 0.5  # Or continuation
            else:
                new_probs[0] = 1.0

        # Update sufficient statistics
        new_sum_x = np.zeros(n_rl + 1)
        new_sum_x2 = np.zeros(n_rl + 1)
        new_n = np.zeros(n_rl + 1, dtype=int)

        # r=0: fresh start
        new_sum_x[0] = x
        new_sum_x2[0] = x**2
        new_n[0] = 1

        # CP_R6_2: r>0: extend existing (only if n_rl > 0 to avoid empty slice)
        if n_rl > 0:
            new_sum_x[1:] = self.sum_x + x
            new_sum_x2[1:] = self.sum_x2 + x**2
            new_n[1:] = self.n + 1

        # CP9 + CP_R6_4: Truncate if exceeding max_run_length
        if len(new_probs) > self.max_run_length:
            # Truncate and renormalize (accept probability loss for very long runs)
            # Note: Merging tail mass into last position (CP_R5_6) caused issues because
            # sufficient statistics at position max_run_length-1 would represent MULTIPLE
            # run lengths, corrupting posterior mean/variance calculations.
            # Better to lose tail probability than corrupt statistics.
            new_probs = new_probs[:self.max_run_length]

            # CP_R7_1: Re-check probability sum after truncation
            prob_sum = np.sum(new_probs)
            if prob_sum > 1e-300:
                new_probs = new_probs / prob_sum
            else:
                # Complete probability collapse - reset to fresh start
                new_probs = np.ones(len(new_probs)) / len(new_probs)
            new_sum_x = new_sum_x[:self.max_run_length]
            new_sum_x2 = new_sum_x2[:self.max_run_length]
            new_n = new_n[:self.max_run_length]

        self.sum_x = new_sum_x
        self.sum_x2 = new_sum_x2
        self.n = new_n
        self.run_length_probs = new_probs

        # Store posterior for full analysis
        self.R.append(new_probs.copy())

        # Compute posterior mean and variance
        r_expected = np.sum(np.arange(len(new_probs)) * new_probs)
        r_idx = int(min(r_expected, len(new_probs) - 1))
        mu_n, kappa_n, alpha_n, beta_n = self._posterior_params(r_idx)

        self.mean_post.append(mu_n)
        self.var_post.append(beta_n / (alpha_n - 1) if alpha_n > 1 else np.inf)

        return new_probs, change_prob

    def detect_all(self, data: np.ndarray) -> BOCPDResult:
        """
        Run BOCPD on entire dataset.

        Parameters
        ----------
        data : np.ndarray
            Time series data

        Returns
        -------
        BOCPDResult
            Full detection results
        """
        # CP_R7_3: Validate input data for NaN
        data = np.asarray(data)
        if np.any(np.isnan(data)):
            raise ValueError("Input data contains NaN values - BOCPD cannot handle NaN")

        self.reset()
        n = len(data)

        change_probs = np.zeros(n)

        for t, x in enumerate(data):
            _, cp = self.update(x)
            change_probs[t] = cp

        # Build full run length matrix
        max_len = max(len(r) for r in self.R)
        R_matrix = np.zeros((n, max_len))
        for t, r in enumerate(self.R):
            R_matrix[t, :len(r)] = r

        # Find most likely change points
        change_points = []
        for t in range(1, n):
            if change_probs[t] > 0.5:  # Threshold
                change_points.append(t)

        return BOCPDResult(
            run_length_posterior=R_matrix,
            change_point_probability=change_probs,
            change_points=change_points,
            hazard_rate=self.hazard,
            mean_posterior=np.array(self.mean_post),
            var_posterior=np.array(self.var_post)
        )


def bocpd_detect(
    data: np.ndarray,
    hazard: float = 1/100,
    threshold: float = 0.5,
    **kwargs
) -> BOCPDResult:
    """
    Convenience function for BOCPD detection.

    Parameters
    ----------
    data : np.ndarray
        Time series data
    hazard : float
        Hazard rate (1/expected_run_length)
    threshold : float
        Change point probability threshold
    **kwargs
        Additional arguments passed to BOCPD constructor

    Returns
    -------
    BOCPDResult
        Detection results
    """
    detector = BOCPD(hazard=hazard, **kwargs)
    result = detector.detect_all(data)

    # Re-threshold
    result.change_points = [
        t for t in range(len(data))
        if result.change_point_probability[t] > threshold
    ]

    return result


# =============================================================================
# Unified Interface
# =============================================================================

def detect_change_points(
    data: np.ndarray,
    method: str = 'pelt',
    config: Optional[ChangePointConfig] = None
) -> Dict[str, Any]:
    """
    Unified change point detection interface.

    Parameters
    ----------
    data : np.ndarray
        Time series data
    method : str
        'cusum_mean', 'cusum_var', 'pelt', 'bocpd', or 'all'
    config : ChangePointConfig, optional
        Detection parameters

    Returns
    -------
    dict
        Detection results with keys depending on method
    """
    if config is None:
        config = ChangePointConfig()

    results = {}

    if method in ('cusum_mean', 'all'):
        results['cusum_mean'] = cusum_mean_shift(
            data,
            threshold=config.cusum_threshold,
            drift=config.cusum_drift
        )

    if method in ('cusum_var', 'all'):
        results['cusum_var'] = cusum_variance_shift(
            data,
            threshold=config.cusum_threshold
        )

    if method in ('pelt', 'all'):
        results['pelt'] = pelt_detect(
            data,
            penalty=config.pelt_penalty,
            min_segment=config.pelt_min_segment,
            model=config.pelt_model
        )

    if method in ('bocpd', 'all'):
        results['bocpd'] = bocpd_detect(
            data,
            hazard=config.bocpd_hazard,
            threshold=config.bocpd_threshold,
            prior_mu=config.bocpd_prior_mu,
            prior_kappa=config.bocpd_prior_kappa,
            prior_alpha=config.bocpd_prior_alpha,
            prior_beta=config.bocpd_prior_beta
        )

    if method not in ('cusum_mean', 'cusum_var', 'pelt', 'bocpd', 'all'):
        raise ValueError(f"Unknown method: {method}")

    return results


# =============================================================================
# DataFrame Integration
# =============================================================================

def add_change_point_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    methods: List[str] = ['cusum_mean', 'bocpd'],
    config: Optional[ChangePointConfig] = None,
    prefix: str = 'cp_'
) -> pd.DataFrame:
    """
    Add change point detection features to DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame with returns column
    returns_col : str
        Column name for returns
    methods : list
        Detection methods to use
    config : ChangePointConfig, optional
        Detection parameters
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with change point features added
    """
    if config is None:
        config = ChangePointConfig()

    df = df.copy()
    data = df[returns_col].dropna().values

    # CP_R7_5: Re-validate after extraction to ensure no NaN slipped through
    if np.any(np.isnan(data)):
        warnings.warn("NaN values found after dropna() - filtering again")
        data = data[~np.isnan(data)]

    if len(data) < 50:
        warnings.warn("Insufficient data for change point detection")
        return df

    for method in methods:
        if method == 'cusum_mean':
            result = cusum_mean_shift(
                data,
                threshold=config.cusum_threshold,
                drift=config.cusum_drift
            )
            # Create aligned series
            stat_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.statistic)
            alarm_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.alarms)

            df[f'{prefix}cusum_stat'] = stat_series.reindex(df.index)
            df[f'{prefix}cusum_alarm'] = alarm_series.reindex(df.index)

        elif method == 'cusum_var':
            result = cusum_variance_shift(
                data,
                threshold=config.cusum_threshold
            )
            stat_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.statistic)
            alarm_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.alarms)

            df[f'{prefix}cusum_var_stat'] = stat_series.reindex(df.index)
            df[f'{prefix}cusum_var_alarm'] = alarm_series.reindex(df.index)

        elif method == 'bocpd':
            result = bocpd_detect(
                data,
                hazard=config.bocpd_hazard,
                threshold=config.bocpd_threshold
            )
            cp_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.change_point_probability)
            mean_series = pd.Series(index=df.index[df[returns_col].notna()], data=result.mean_posterior)

            df[f'{prefix}bocpd_prob'] = cp_series.reindex(df.index)
            df[f'{prefix}bocpd_mean'] = mean_series.reindex(df.index)

        elif method == 'pelt':
            result = pelt_detect(
                data,
                penalty=config.pelt_penalty,
                min_segment=config.pelt_min_segment
            )
            # Create segment labels
            segments = np.zeros(len(data))
            all_points = [0] + result.change_points + [len(data)]
            for i, (start, end) in enumerate(zip(all_points[:-1], all_points[1:])):
                segments[start:end] = i

            seg_series = pd.Series(index=df.index[df[returns_col].notna()], data=segments)
            df[f'{prefix}pelt_segment'] = seg_series.reindex(df.index)

    return df


# =============================================================================
# Regime Transition Probability from Change Points
# =============================================================================

def change_point_regime_transition(
    data: np.ndarray,
    lookback: int = 20,
    hazard: float = 1/100
) -> Dict[str, np.ndarray]:
    """
    Estimate regime transition probability from change point detection.

    Combines BOCPD change probability with critical slowing down
    indicators for robust transition prediction.

    Parameters
    ----------
    data : np.ndarray
        Time series (returns)
    lookback : int
        Rolling window for statistics
    hazard : float
        BOCPD hazard rate

    Returns
    -------
    dict
        'transition_prob': Combined transition probability
        'bocpd_prob': Raw BOCPD change probability
        'cusum_stat': CUSUM statistic
        'rolling_autocorr': Critical slowing down indicator
    """
    n = len(data)

    # BOCPD
    bocpd_result = bocpd_detect(data, hazard=hazard)
    bocpd_prob = bocpd_result.change_point_probability

    # CUSUM
    cusum_result = cusum_mean_shift(data, threshold=10.0)  # High threshold for signal
    cusum_stat = cusum_result.statistic / 10.0  # Normalize to [0, 1]-ish
    cusum_stat = np.clip(cusum_stat, 0, 1)

    # CP10: Rolling autocorrelation (critical slowing down)
    rolling_ac = np.zeros(n)
    for i in range(lookback, n):
        window = data[i-lookback:i]
        if len(window) > 2:
            corr_matrix = np.corrcoef(window[:-1], window[1:])
            # Handle NaN from zero variance windows
            if not np.isnan(corr_matrix[0, 1]):
                rolling_ac[i] = corr_matrix[0, 1]
            else:
                rolling_ac[i] = 0.0  # No autocorrelation in constant signal

    # Normalize autocorrelation to [0, 1]
    ac_signal = np.clip((rolling_ac + 1) / 2, 0, 1)  # Map [-1, 1] to [0, 1]

    # Combine signals (weighted average)
    # High autocorr = system slowing = transition coming
    # High BOCPD = statistical evidence of change
    # High CUSUM = accumulating deviation
    transition_prob = 0.5 * bocpd_prob + 0.3 * ac_signal + 0.2 * cusum_stat

    return {
        'transition_prob': transition_prob,
        'bocpd_prob': bocpd_prob,
        'cusum_stat': cusum_stat,
        'rolling_autocorr': rolling_ac
    }
