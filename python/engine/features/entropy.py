#!/usr/bin/env python3
"""
Entropy Module - Information Theory for Market Physics
=======================================================
Implements entropy-based measures for regime detection, causality analysis,
and predictability assessment.

Key Concepts:
- Shannon Entropy: Measures randomness/predictability of price distribution
- Permutation Entropy: Order-based entropy, robust to heteroskedasticity
- Transfer Entropy: Directed information flow (causality detection)
- KL Divergence: Distribution drift / regime shift detection
- Fano Limit: Theoretical ceiling on prediction accuracy

Reference: Information Theory research document
"""

import logging
import math
from typing import Dict, List, Optional, Tuple, Union
from dataclasses import dataclass
from collections import Counter
import itertools

import numpy as np
import pandas as pd
from scipy.stats import entropy as scipy_entropy
from scipy.special import digamma

logger = logging.getLogger("MarketPhysics.Features.Entropy")


# ============================================================================
# SHANNON ENTROPY
# ============================================================================

def shannon_entropy(
    data: np.ndarray,
    bins: int = 20,
    method: str = 'quantile',
    base: int = 2
) -> float:
    """
    Calculate Shannon entropy of data distribution.

    H(X) = -Σ p(x) log p(x)

    Args:
        data: 1D array of values (e.g., returns)
        bins: Number of bins for discretization
        method: 'quantile' (equal frequency) or 'uniform' (equal width)
        base: Logarithm base (2 for bits, e for nats)

    Returns:
        Entropy value (higher = more random/unpredictable)

    Interpretation:
        - High entropy (~log(bins)): Random walk, efficient market
        - Low entropy: Predictable structure, trending
        - Decaying entropy: Transition from disorder to order (breakout)
    """
    data = np.asarray(data).flatten()
    data = data[~np.isnan(data)]

    if len(data) < bins:
        return np.nan

    if method == 'quantile':
        # Equal frequency bins - forces uniform prior
        try:
            _, bin_edges = pd.qcut(data, bins, retbins=True, duplicates='drop')
            hist, _ = np.histogram(data, bins=bin_edges)
        except ValueError:
            # Fallback if qcut fails (too many duplicates)
            hist, _ = np.histogram(data, bins=bins)
    else:
        # Equal width bins
        hist, _ = np.histogram(data, bins=bins)

    # Remove zero counts
    hist = hist[hist > 0]

    # Normalize to probabilities
    probs = hist / hist.sum()

    # Calculate entropy
    return scipy_entropy(probs, base=base)


def normalized_entropy(
    data: np.ndarray,
    bins: int = 20,
    method: str = 'quantile'
) -> float:
    """
    Calculate normalized entropy in [0, 1].

    Normalized by maximum possible entropy (uniform distribution).

    Returns:
        0 = perfectly predictable (deterministic)
        1 = maximum uncertainty (uniform/random)
    """
    h = shannon_entropy(data, bins=bins, method=method, base=2)
    h_max = np.log2(bins)  # Max entropy for uniform distribution

    if h_max == 0:
        return np.nan

    return h / h_max


def rolling_entropy(
    data: pd.Series,
    window: int = 50,
    bins: int = 20,
    method: str = 'quantile'
) -> pd.Series:
    """
    Calculate rolling Shannon entropy.

    Args:
        data: Time series (e.g., returns)
        window: Rolling window size
        bins: Number of bins
        method: Discretization method

    Returns:
        Series of entropy values
    """
    result = pd.Series(index=data.index, dtype=float)

    for i in range(window, len(data) + 1):
        window_data = data.iloc[i-window:i].values
        result.iloc[i-1] = shannon_entropy(window_data, bins=bins, method=method)

    return result


def entropy_decay_rate(
    data: pd.Series,
    window: int = 50,
    smooth: int = 5
) -> pd.Series:
    """
    Calculate entropy decay rate (dH/dt).

    Negative decay = profile consolidating = breakout imminent

    Args:
        data: Time series
        window: Window for entropy calculation
        smooth: Smoothing for derivative

    Returns:
        Series of entropy change rates

    Note:
        ENT_R7_3: First (window + smooth) values will be NaN due to rolling
        window requirements. For short series, consider using a smaller window
        or check len(data) > window + smooth before using this function.
    """
    # ENT_R7_3: Use adaptive window for short datasets
    effective_window = min(window, max(10, len(data) // 3))
    effective_smooth = min(smooth, max(2, len(data) // 10))

    ent = rolling_entropy(data, window=effective_window)
    decay = ent.diff(effective_smooth) / effective_smooth

    return decay


# ============================================================================
# PERMUTATION ENTROPY
# ============================================================================

def permutation_entropy(
    data: np.ndarray,
    order: int = 3,
    delay: int = 1,
    normalize: bool = True
) -> float:
    """
    Calculate permutation entropy.

    Encodes the ORDER of values rather than magnitude.
    Robust to heteroskedasticity and non-linear monotonic transforms.

    Args:
        order: Embedding dimension (pattern length)
        delay: Time delay between points
        normalize: If True, normalize to [0, 1]

    Returns:
        Permutation entropy value

    Example:
        For order=3, sequence [1.2, 0.5, 0.8] has pattern (1,2,0)
        because 0.5 < 0.8 < 1.2 (indices when sorted)
    """
    data = np.asarray(data).flatten()
    data = data[~np.isnan(data)]

    n = len(data)
    if n < order * delay:
        return np.nan

    # Generate all permutation patterns
    permutations = []

    for i in range(n - delay * (order - 1)):
        # Extract subsequence
        subsequence = [data[i + j * delay] for j in range(order)]
        # Get permutation pattern (rank order)
        pattern = tuple(np.argsort(subsequence))
        permutations.append(pattern)

    # Count pattern frequencies
    counter = Counter(permutations)
    total = len(permutations)

    # Calculate entropy (guard against log(0))
    probs = np.array(list(counter.values())) / total
    h = -np.sum(np.where(probs > 0, probs * np.log2(probs), 0))

    if normalize:
        # Maximum entropy for order! possible patterns
        h_max = np.log2(math.factorial(order))
        return h / h_max if h_max > 0 else np.nan

    return h


def rolling_permutation_entropy(
    data: pd.Series,
    window: int = 100,
    order: int = 3,
    delay: int = 1
) -> pd.Series:
    """
    Calculate rolling permutation entropy.
    """
    result = pd.Series(index=data.index, dtype=float)

    for i in range(window, len(data) + 1):
        window_data = data.iloc[i-window:i].values
        result.iloc[i-1] = permutation_entropy(window_data, order=order, delay=delay)

    return result


# ============================================================================
# TRANSFER ENTROPY (DIRECTED CAUSALITY)
# ============================================================================

def transfer_entropy(
    source: np.ndarray,
    target: np.ndarray,
    k: int = 1,
    l: int = 1,
    bins: int = 10
) -> float:
    """
    Calculate Transfer Entropy from source to target.

    TE(Y→X) = H(X_t+1|X_t) - H(X_t+1|X_t,Y_t)

    "How much does knowing Y's past reduce uncertainty about X's future,
    given X's past?"

    Args:
        source: Source time series (Y - potential cause)
        target: Target time series (X - potential effect)
        k: History length for target
        l: History length for source
        bins: Number of bins for discretization

    Returns:
        Transfer entropy (bits). Higher = more information flow Y→X

    Note:
        TE is asymmetric: TE(Y→X) ≠ TE(X→Y)
        Use this to detect lead-lag relationships (e.g., VIX → SPX)
    """
    source = np.asarray(source).flatten()
    target = np.asarray(target).flatten()

    # Align lengths
    n = min(len(source), len(target))
    source = source[:n]
    target = target[:n]

    # Remove NaNs
    mask = ~(np.isnan(source) | np.isnan(target))
    source = source[mask]
    target = target[mask]
    n = len(target)

    if n < max(k, l) + 2:
        return np.nan

    # Discretize
    source_d = _discretize(source, bins)
    target_d = _discretize(target, bins)

    # Build joint distributions
    joint_xxy = Counter()  # (x_next, x_past, y_past)
    joint_xx = Counter()   # (x_next, x_past)
    joint_xy = Counter()   # (x_past, y_past)
    marg_x = Counter()     # (x_past,)

    for i in range(max(k, l), n - 1):
        x_next = target_d[i + 1]
        x_past = tuple(target_d[i-k+1:i+1])
        y_past = tuple(source_d[i-l+1:i+1])

        joint_xxy[(x_next, x_past, y_past)] += 1
        joint_xx[(x_next, x_past)] += 1
        joint_xy[(x_past, y_past)] += 1
        marg_x[x_past] += 1

    total = sum(joint_xxy.values())
    if total == 0:
        return np.nan

    # Calculate TE using joint probabilities
    # TE = Σ p(x_next, x_past, y_past) * log[p(x_next|x_past,y_past) / p(x_next|x_past)]
    te = 0.0

    for (x_next, x_past, y_past), count in joint_xxy.items():
        p_xxy = count / total
        p_xx = joint_xx[(x_next, x_past)] / total
        p_xy = joint_xy[(x_past, y_past)] / total
        p_x = marg_x[x_past] / total

        # p(x_next|x_past,y_past) = p(x_next,x_past,y_past) / p(x_past,y_past)
        # p(x_next|x_past) = p(x_next,x_past) / p(x_past)

        if p_xy > 0 and p_x > 0 and p_xx > 0:
            p_cond_xy = p_xxy / p_xy  # p(x_next|x_past,y_past)
            p_cond_x = p_xx / p_x     # p(x_next|x_past)

            if p_cond_xy > 0 and p_cond_x > 0:
                te += p_xxy * np.log2(p_cond_xy / p_cond_x)

    return max(0, te)  # TE should be non-negative


def effective_transfer_entropy(
    source: np.ndarray,
    target: np.ndarray,
    k: int = 1,
    l: int = 1,
    bins: int = 10,
    n_surrogates: int = 100
) -> Tuple[float, float, float]:
    """
    Calculate Effective Transfer Entropy (bias-corrected).

    ETE = TE - mean(TE_shuffled)

    Subtracts the noise floor estimated from shuffled surrogates.

    Args:
        source, target: Time series
        k, l, bins: TE parameters
        n_surrogates: Number of surrogate shuffles

    Returns:
        Tuple of (ETE, raw_TE, surrogate_mean)
    """
    raw_te = transfer_entropy(source, target, k=k, l=l, bins=bins)

    if np.isnan(raw_te):
        return np.nan, np.nan, np.nan

    # Generate surrogate TEs by shuffling source
    surrogate_tes = []
    source_arr = np.asarray(source).copy()

    for _ in range(n_surrogates):
        np.random.shuffle(source_arr)
        te_surr = transfer_entropy(source_arr, target, k=k, l=l, bins=bins)
        if not np.isnan(te_surr):
            surrogate_tes.append(te_surr)

    if len(surrogate_tes) == 0:
        return raw_te, raw_te, 0.0

    surrogate_mean = np.mean(surrogate_tes)
    ete = raw_te - surrogate_mean

    return ete, raw_te, surrogate_mean


def bidirectional_transfer_entropy(
    x: np.ndarray,
    y: np.ndarray,
    k: int = 1,
    l: int = 1,
    bins: int = 10
) -> Dict[str, float]:
    """
    Calculate transfer entropy in both directions.

    Returns:
        Dict with 'te_x_to_y', 'te_y_to_x', 'net_flow', 'dominant_direction'

    Interpretation:
        net_flow > 0: X leads Y
        net_flow < 0: Y leads X
    """
    te_x_to_y = transfer_entropy(x, y, k=k, l=l, bins=bins)
    te_y_to_x = transfer_entropy(y, x, k=k, l=l, bins=bins)

    net_flow = te_x_to_y - te_y_to_x

    if np.isnan(net_flow):
        dominant = 'unknown'
    elif net_flow > 0.01:
        dominant = 'x_leads'
    elif net_flow < -0.01:
        dominant = 'y_leads'
    else:
        dominant = 'bidirectional'

    return {
        'te_x_to_y': te_x_to_y,
        'te_y_to_x': te_y_to_x,
        'net_flow': net_flow,
        'dominant_direction': dominant
    }


# ============================================================================
# KL DIVERGENCE (REGIME SHIFT DETECTION)
# ============================================================================

def kl_divergence(
    p: np.ndarray,
    q: np.ndarray,
    bins: int = 20,
    epsilon: float = 1e-10
) -> float:
    """
    Calculate Kullback-Leibler divergence D_KL(P || Q).

    "Information lost when Q is used to approximate P"

    Args:
        p: "True" distribution (current/observed)
        q: "Baseline" distribution (historical/reference)
        bins: Number of bins for discretization
        epsilon: Small value to avoid log(0)

    Returns:
        KL divergence (non-negative, 0 if identical)

    Use Case:
        - p = current 5-day feature distribution
        - q = training period distribution
        - High KL = regime shift / concept drift
    """
    p = np.asarray(p).flatten()
    q = np.asarray(q).flatten()

    p = p[~np.isnan(p)]
    q = q[~np.isnan(q)]

    if len(p) < bins or len(q) < bins:
        return np.nan

    # Use same bin edges for both
    all_data = np.concatenate([p, q])
    _, bin_edges = np.histogram(all_data, bins=bins)

    # Get counts (not density) to allow proper epsilon smoothing
    hist_p = np.histogram(p, bins=bin_edges)[0].astype(float)
    hist_q = np.histogram(q, bins=bin_edges)[0].astype(float)

    # ENT3: Only add epsilon to Q (denominator), mask P for zero bins
    # This avoids biasing the divergence estimate
    hist_q = hist_q + epsilon

    # Normalize to probability distribution
    hist_p = hist_p / hist_p.sum()
    hist_q = hist_q / hist_q.sum()

    # KL divergence - only sum over bins where P > 0
    mask = hist_p > 0
    kl = np.sum(hist_p[mask] * np.log(hist_p[mask] / hist_q[mask]))

    return max(0, kl)


def symmetric_kl_divergence(p: np.ndarray, q: np.ndarray, bins: int = 20) -> float:
    """
    Calculate symmetric KL divergence (Jensen-Shannon style).

    D_sym = 0.5 * [D_KL(P||Q) + D_KL(Q||P)]
    """
    kl_pq = kl_divergence(p, q, bins=bins)
    kl_qp = kl_divergence(q, p, bins=bins)

    if np.isnan(kl_pq) or np.isnan(kl_qp):
        return np.nan

    return 0.5 * (kl_pq + kl_qp)


def rolling_kl_divergence(
    data: pd.Series,
    baseline_window: int = 252,
    current_window: int = 20,
    bins: int = 20
) -> pd.Series:
    """
    Calculate rolling KL divergence vs baseline.

    Useful for detecting regime shifts in real-time.

    Args:
        data: Time series
        baseline_window: Window for baseline distribution
        current_window: Window for current distribution
        bins: Number of bins

    Returns:
        Series of KL divergence values
    """
    result = pd.Series(index=data.index, dtype=float)

    for i in range(baseline_window + current_window, len(data) + 1):
        baseline = data.iloc[i-baseline_window-current_window:i-current_window].values
        current = data.iloc[i-current_window:i].values
        result.iloc[i-1] = kl_divergence(current, baseline, bins=bins)

    return result


# ============================================================================
# ENTROPY RATE & FANO LIMIT
# ============================================================================

def entropy_rate_lz(sequence: np.ndarray, bins: int = 10) -> float:
    """
    Estimate entropy rate using Lempel-Ziv complexity.

    Based on compressibility - more complex = higher entropy rate.

    Args:
        sequence: Time series
        bins: Number of bins for discretization

    Returns:
        Estimated entropy rate (bits per symbol)
    """
    sequence = np.asarray(sequence).flatten()
    sequence = sequence[~np.isnan(sequence)]

    if len(sequence) < 10:
        return np.nan

    # Discretize to symbols
    symbols = _discretize(sequence, bins)

    # LZ76 complexity
    complexity = _lz_complexity(symbols)

    # Normalize by length
    n = len(symbols)
    if n <= 1:
        return np.nan

    # Entropy rate estimate
    h = complexity * np.log2(n) / n

    return h


def _lz_complexity(sequence: np.ndarray) -> int:
    """
    Calculate Lempel-Ziv complexity (LZ76).

    Counts number of unique substrings.
    """
    sequence = list(sequence)
    n = len(sequence)

    if n == 0:
        return 0

    complexity = 1
    prefix_len = 1

    i = 0
    while i + prefix_len <= n:
        # Check if current substring is in previous part
        current = tuple(sequence[i:i+prefix_len])
        # ENT2 FIX: Prefix is everything BEFORE position i, not including current
        prefix = sequence[:i]

        found = False
        # Search for current substring in prefix
        for j in range(len(prefix) - prefix_len + 1):
            if tuple(prefix[j:j+prefix_len]) == current:
                found = True
                break

        if found:
            prefix_len += 1
        else:
            complexity += 1
            i += prefix_len
            prefix_len = 1

    return complexity


def fano_predictability_limit(
    entropy_rate: float,
    alphabet_size: int = 2
) -> float:
    """
    Calculate Fano's theoretical predictability limit.

    Given the entropy rate of a process, this returns the maximum
    achievable prediction accuracy.

    Args:
        entropy_rate: Estimated entropy rate (bits)
        alphabet_size: Number of possible outcomes (2 for up/down)

    Returns:
        Maximum achievable accuracy (0.5 to 1.0)

    Empirical Finding:
        S&P 500 daily returns: ~60-66% max accuracy
        If backtest claims >65% → likely overfit
    """
    from scipy.optimize import brentq

    if np.isnan(entropy_rate) or entropy_rate < 0:
        return np.nan

    # ENT_R7_2: Validate alphabet_size >= 2 (Fano uses log(alphabet_size - 1))
    if alphabet_size < 2:
        raise ValueError(f"alphabet_size must be >= 2 for Fano limit, got {alphabet_size}")

    # Fano's inequality: S = H(Π) + (1-Π) * log(M-1)
    # where H(Π) = -Π*log(Π) - (1-Π)*log(1-Π)

    def equation(pi):
        if pi <= 0.001 or pi >= 0.999:
            return float('inf')

        h_pi = -pi * np.log2(pi) - (1-pi) * np.log2(1-pi)
        rhs = h_pi + (1-pi) * np.log2(alphabet_size - 1)
        return entropy_rate - rhs

    try:
        # Search for Π where equation = 0
        pi_max = brentq(equation, 0.5, 0.999)
        return pi_max
    except (ValueError, RuntimeError):
        # If no solution found, return based on entropy
        if entropy_rate >= np.log2(alphabet_size):
            return 1.0 / alphabet_size  # Random guess
        else:
            return 0.5  # Minimum meaningful


# ============================================================================
# FEATURE GENERATOR
# ============================================================================

@dataclass
class EntropyFeatures:
    """Container for entropy-based features."""
    shannon_entropy: float
    normalized_entropy: float
    permutation_entropy: float
    entropy_decay_rate: float
    kl_divergence_vs_baseline: float
    fano_limit: float


def calculate_entropy_features(
    returns: pd.Series,
    baseline_returns: Optional[pd.Series] = None,
    window: int = 50
) -> EntropyFeatures:
    """
    Calculate all entropy features for current state.

    Args:
        returns: Recent returns series
        baseline_returns: Historical returns for KL comparison
        window: Window for calculations

    Returns:
        EntropyFeatures dataclass
    """
    recent = returns.iloc[-window:].values if len(returns) >= window else returns.values

    h_shannon = shannon_entropy(recent)
    h_norm = normalized_entropy(recent)
    h_perm = permutation_entropy(recent)

    # Entropy decay (need more data)
    if len(returns) >= window + 10:
        h_series = rolling_entropy(returns, window=window)
        decay = h_series.diff(5).iloc[-1] / 5
    else:
        decay = np.nan

    # KL divergence
    if baseline_returns is not None and len(baseline_returns) >= window:
        kl = kl_divergence(recent, baseline_returns.iloc[-window:].values)
    else:
        kl = np.nan

    # Fano limit
    h_rate = entropy_rate_lz(recent)
    fano = fano_predictability_limit(h_rate, alphabet_size=2)

    return EntropyFeatures(
        shannon_entropy=h_shannon,
        normalized_entropy=h_norm,
        permutation_entropy=h_perm,
        entropy_decay_rate=decay,
        kl_divergence_vs_baseline=kl,
        fano_limit=fano
    )


def add_entropy_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    window: int = 50,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add entropy features to DataFrame.

    Args:
        df: DataFrame with returns column
        returns_col: Name of returns column
        window: Window for entropy calculations
        lag: Lag for lookahead prevention (must be >= 1 to prevent lookahead)

    Returns:
        DataFrame with entropy features added
    """
    # ENT_R7_7: Validate lag to prevent lookahead bias
    if lag < 1:
        raise ValueError(f"lag must be >= 1 to prevent lookahead bias, got {lag}")

    result = df.copy()

    if returns_col not in result.columns:
        if 'close' in result.columns:
            result[returns_col] = result['close'].pct_change()
        else:
            logger.warning(f"Column '{returns_col}' not found")
            return result

    returns = result[returns_col]

    # Rolling Shannon entropy
    result['entropy_shannon'] = rolling_entropy(returns, window=window).shift(lag)

    # Rolling permutation entropy
    result['entropy_permutation'] = rolling_permutation_entropy(
        returns, window=window
    ).shift(lag)

    # Entropy decay rate
    result['entropy_decay'] = entropy_decay_rate(returns, window=window).shift(lag)

    # Normalized entropy
    # ENT_R7_5: Use bins parameter for normalization (was hard-coded to 20)
    result['entropy_normalized'] = result['entropy_shannon'] / np.log2(bins)

    # ENT_R7_4: Adaptive rolling window for short datasets
    zscore_window = min(100, max(10, len(result) // 2))
    result['entropy_zscore'] = (
        (result['entropy_shannon'] - result['entropy_shannon'].rolling(zscore_window).mean()) /
        result['entropy_shannon'].rolling(zscore_window).std().replace(0, np.nan)  # Avoid div by zero
    )

    # Breakout signal: entropy decay exceeding threshold
    # ENT_R7_6: Explicit NaN handling - NaN decay should produce NaN signal, not 0
    result['entropy_breakout_signal'] = np.where(
        result['entropy_decay'].isna(),
        np.nan,
        (result['entropy_decay'] < -0.05).astype(float)
    )

    return result


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _discretize(data: np.ndarray, bins: int) -> np.ndarray:
    """Discretize continuous data into bins.

    Uses percentile-based binning to handle non-uniform distributions.
    Returns integer bin indices in [0, n_bins-1].
    """
    data = np.asarray(data)

    # ENT_R7_1: Handle edge case of constant data or all-NaN
    # np.std(all_nan) returns nan, and nan < 1e-10 = False, so check NaN explicitly
    if np.all(np.isnan(data)) or np.std(data) < 1e-10:
        return np.zeros(len(data), dtype=int)

    # Use percentile-based binning
    percentiles = np.linspace(0, 100, bins + 1)
    bin_edges = np.percentile(data, percentiles)

    # Ensure unique edges
    bin_edges = np.unique(bin_edges)
    n_bins = len(bin_edges) - 1
    if n_bins < 1:
        return np.zeros(len(data), dtype=int)

    # ENT1 FIX: Use interior edges [1:-1] so digitize returns 0 to n_bins-1
    # For edges [e0, e1, e2, e3], interior = [e1, e2]
    # digitize with [e1, e2] returns: 0 if x < e1, 1 if e1 <= x < e2, 2 if x >= e2
    # Then clip to [0, n_bins-1] to handle boundary cases
    interior_edges = bin_edges[1:-1]
    if len(interior_edges) == 0:
        # Only 2 edges = 1 bin, everything maps to bin 0
        return np.zeros(len(data), dtype=int)

    binned = np.digitize(data, interior_edges)
    # Clip to valid range [0, n_bins-1]
    return np.clip(binned, 0, n_bins - 1).astype(int)


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    np.random.seed(42)

    # Test with synthetic data
    n = 500

    # Random walk (high entropy)
    random_walk = np.cumsum(np.random.randn(n) * 0.01)

    # Trending (low entropy)
    trend = np.linspace(0, 1, n) + np.random.randn(n) * 0.05

    # Regime switch
    regime_switch = np.concatenate([
        np.random.randn(200) * 0.01,  # Random
        np.linspace(0, 0.5, 100),      # Trend
        np.random.randn(200) * 0.01   # Random again
    ])

    print("=== Shannon Entropy ===")
    print(f"Random walk: {shannon_entropy(np.diff(random_walk)):.3f}")
    print(f"Trending:    {shannon_entropy(np.diff(trend)):.3f}")

    print("\n=== Permutation Entropy ===")
    print(f"Random walk: {permutation_entropy(np.diff(random_walk)):.3f}")
    print(f"Trending:    {permutation_entropy(np.diff(trend)):.3f}")

    print("\n=== Transfer Entropy ===")
    # Create lead-lag relationship: y leads x by 1 period
    y = np.random.randn(n)
    x = np.roll(y, 1) + np.random.randn(n) * 0.5
    x[0] = 0

    te_result = bidirectional_transfer_entropy(y, x)
    print(f"TE(Y→X): {te_result['te_y_to_x']:.4f}")
    print(f"TE(X→Y): {te_result['te_x_to_y']:.4f}")
    print(f"Direction: {te_result['dominant_direction']}")

    print("\n=== KL Divergence ===")
    baseline = np.random.randn(200)
    shifted = np.random.randn(50) + 1.0  # Mean shifted
    print(f"KL(shifted || baseline): {kl_divergence(shifted, baseline):.3f}")
    print(f"KL(baseline || baseline): {kl_divergence(baseline[:50], baseline):.3f}")

    print("\n=== Fano Limit ===")
    h_rate = entropy_rate_lz(np.diff(random_walk))
    fano = fano_predictability_limit(h_rate)
    print(f"Entropy rate: {h_rate:.3f} bits")
    print(f"Max predictability: {fano:.1%}")

    print("\n=== Feature Generation ===")
    df = pd.DataFrame({
        'close': 100 * np.exp(np.cumsum(np.random.randn(n) * 0.01)),
        'timestamp': pd.date_range('2024-01-01', periods=n)
    })
    df = add_entropy_features(df)

    print("Columns added:")
    entropy_cols = [c for c in df.columns if 'entropy' in c]
    for col in entropy_cols:
        print(f"  {col}: {df[col].iloc[-1]:.4f}")
