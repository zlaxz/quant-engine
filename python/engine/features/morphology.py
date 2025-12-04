"""
Morphology Module for Market Physics Engine.

Implements:
- Distribution Shape Classification (P-shape, b-shape, B-shape, etc.)
- Higher Moments Analysis (skewness, kurtosis)
- Modality Detection (unimodal, bimodal via Hartigan's Dip Test)
- Vol Surface Shape Analysis (smile, skew, term structure)
- Shape Similarity & Distance Metrics

Key Insight: The SHAPE of distributions (gamma exposure, returns, vol surface)
reveals market microstructure and regime state.

P-shape = Put-heavy = Fear = Bear regime
b-shape = Balanced = Neutral
B-shape = Call-heavy = Greed = Bull regime

Author: Market Physics Engine
Layer: 1 (Algorithmic Morphology)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any, Union
from scipy import stats
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d
import warnings


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class ShapeMetrics:
    """Metrics describing distribution shape."""
    mean: float
    std: float
    skewness: float
    kurtosis: float            # Excess kurtosis (normal = 0)
    is_normal: bool            # Shapiro-Wilk test
    is_unimodal: bool
    n_modes: int
    mode_locations: np.ndarray
    dip_statistic: float       # Hartigan's Dip Test
    dip_pvalue: float
    shape_class: str           # 'P', 'b', 'B', 'bimodal', 'fat_tail', 'normal'


@dataclass
class VolSurfaceShape:
    """Vol surface shape metrics."""
    atm_vol: float
    skew_25d: float            # (25d put vol - 25d call vol) / ATM vol
    butterfly_25d: float       # (25d put + 25d call - 2*ATM) / 2
    risk_reversal: float       # 25d call vol - 25d put vol
    term_slope: float          # Slope of ATM vol vs. expiry
    curvature: float           # Second derivative of smile
    smile_shape: str           # 'smile', 'smirk', 'flat', 'inverted'
    term_shape: str            # 'contango', 'backwardation', 'flat'


@dataclass
class GammaShape:
    """Gamma exposure distribution shape."""
    net_gamma: float
    gamma_peak_strike: float
    gamma_concentration: float  # How concentrated around peak
    gamma_skew: float          # Asymmetry of gamma profile
    dealer_position: str       # 'long_gamma', 'short_gamma', 'neutral'
    flip_distance: float       # Distance to gamma flip point (% from spot)
    shape_class: str           # 'P', 'b', 'B', 'W', 'M'


@dataclass
class MorphologyConfig:
    """Configuration for morphology analysis."""
    # Dip test parameters
    dip_n_simulations: int = 1000
    dip_significance: float = 0.05

    # Shape classification thresholds
    skew_threshold: float = 0.5
    kurtosis_threshold: float = 1.0
    bimodal_threshold: float = 0.05

    # Vol surface parameters
    delta_25d: float = 0.25
    min_strikes: int = 5

    # Gamma shape parameters
    gamma_neutral_threshold: float = 0.1  # % of max gamma


# =============================================================================
# Distribution Shape Analysis
# =============================================================================

def compute_shape_metrics(
    data: np.ndarray,
    config: MorphologyConfig = None
) -> ShapeMetrics:
    """
    Compute comprehensive shape metrics for a distribution.

    Parameters
    ----------
    data : np.ndarray
        Sample data
    config : MorphologyConfig
        Analysis parameters

    Returns
    -------
    ShapeMetrics
        Complete shape analysis
    """
    if config is None:
        config = MorphologyConfig()

    data = np.asarray(data).flatten()
    data = data[~np.isnan(data)]

    if len(data) < 10:
        warnings.warn("Insufficient data for shape analysis")
        return ShapeMetrics(
            mean=np.nan, std=np.nan, skewness=np.nan, kurtosis=np.nan,
            is_normal=False, is_unimodal=True, n_modes=0,
            mode_locations=np.array([]), dip_statistic=np.nan,
            dip_pvalue=np.nan, shape_class='unknown'
        )

    # Basic moments
    mean = np.mean(data)
    std = np.std(data, ddof=1)
    skewness = stats.skew(data)
    kurtosis = stats.kurtosis(data)  # Excess kurtosis

    # Normality test
    try:
        _, shapiro_p = stats.shapiro(data[:5000])  # Shapiro limited to 5000
        is_normal = shapiro_p > 0.05
    except:
        is_normal = False

    # Modality detection
    dip_stat, dip_pvalue = hartigans_dip_test(data, config.dip_n_simulations)
    is_unimodal = dip_pvalue > config.dip_significance

    # Find modes
    mode_locations, n_modes = find_modes(data)

    # Classify shape
    shape_class = classify_distribution_shape(
        skewness, kurtosis, is_unimodal, n_modes, config
    )

    return ShapeMetrics(
        mean=mean,
        std=std,
        skewness=skewness,
        kurtosis=kurtosis,
        is_normal=is_normal,
        is_unimodal=is_unimodal,
        n_modes=n_modes,
        mode_locations=mode_locations,
        dip_statistic=dip_stat,
        dip_pvalue=dip_pvalue,
        shape_class=shape_class
    )


def hartigans_dip_test(
    data: np.ndarray,
    n_simulations: int = 1000
) -> Tuple[float, float]:
    """
    Hartigan's Dip Test for unimodality.

    Tests whether data is unimodal vs. multimodal.
    Small p-value -> reject unimodality (data is multimodal).

    The dip statistic measures the maximum difference between
    the empirical CDF and the best-fitting unimodal CDF.

    Parameters
    ----------
    data : np.ndarray
        Sample data
    n_simulations : int
        Number of bootstrap simulations for p-value

    Returns
    -------
    dip_statistic : float
        The dip test statistic
    p_value : float
        P-value from bootstrap
    """
    data = np.sort(data)
    n = len(data)

    # MOR1: Compute empirical CDF (left-continuous per Hartigan & Hartigan 1985)
    ecdf = np.arange(0, n) / n

    # Compute dip statistic
    dip = _compute_dip(data, ecdf)

    # Bootstrap p-value under uniform null
    null_dips = []
    for _ in range(n_simulations):
        uniform_sample = np.sort(np.random.uniform(0, 1, n))
        uniform_ecdf = np.arange(0, n) / n  # Left-continuous
        null_dips.append(_compute_dip(uniform_sample, uniform_ecdf))

    p_value = np.mean(np.array(null_dips) >= dip)

    return dip, p_value


def _compute_dip(sorted_data: np.ndarray, ecdf: np.ndarray) -> float:
    """
    Compute the dip statistic using proper GCM/LCM algorithm.

    Implements Hartigan & Hartigan (1985) dip test.

    GCM (Greatest Convex Minorant): The greatest convex function <= ECDF
    LCM (Least Concave Majorant): The least concave function >= ECDF

    The dip statistic is half the maximum distance between GCM and LCM.
    """
    n = len(sorted_data)
    if n < 2:
        return 0.0

    # MOR2: With left-continuous ECDF, points are (i/n, ecdf[i]) for i=0..n-1
    # We add (0, 0) at start and (1, 1) at end conceptually

    # GCM: Greatest Convex Minorant (lower envelope)
    # Build lower convex hull with non-decreasing slopes
    gcm = np.zeros(n)

    # Lower convex hull: slopes must be non-decreasing
    # Start from (0, 0)
    hull_x = [0.0]
    hull_y = [0.0]

    for i in range(n):
        x_new = i / n  # Left-continuous: x-coordinate matches ecdf index
        y_new = ecdf[i]

        # For lower hull (GCM), we need non-decreasing slopes
        # Remove last point if adding new point would create a right turn (decreasing slope)
        while len(hull_x) >= 2:
            # Slope from second-to-last to last
            slope_prev = (hull_y[-1] - hull_y[-2]) / (hull_x[-1] - hull_x[-2]) if hull_x[-1] != hull_x[-2] else float('inf')
            # Slope from last to new
            slope_new = (y_new - hull_y[-1]) / (x_new - hull_x[-1]) if x_new != hull_x[-1] else float('inf')

            # For LOWER hull (GCM), keep if slope_new >= slope_prev
            if slope_new >= slope_prev - 1e-12:  # Allow small tolerance
                break
            hull_x.pop()
            hull_y.pop()

        hull_x.append(x_new)
        hull_y.append(y_new)

    # Add endpoint (1, 1) to complete the hull
    hull_x.append(1.0)
    hull_y.append(1.0)

    # Interpolate GCM at all evaluation points
    hull_idx = 0
    for i in range(n):
        x = i / n
        # Find segment containing x
        while hull_idx < len(hull_x) - 1 and hull_x[hull_idx + 1] <= x:
            hull_idx += 1

        if hull_idx >= len(hull_x) - 1:
            gcm[i] = hull_y[-1]
        else:
            # Linear interpolation
            x1, y1 = hull_x[hull_idx], hull_y[hull_idx]
            x2, y2 = hull_x[hull_idx + 1], hull_y[hull_idx + 1]
            if x2 > x1:
                t = (x - x1) / (x2 - x1)
                gcm[i] = y1 + t * (y2 - y1)
            else:
                gcm[i] = y1

    # MOR3: LCM (Least Concave Majorant) - upper envelope
    # Build upper concave hull with non-increasing slopes
    # Build FORWARD (left to right) for clarity
    lcm = np.zeros(n)

    # Start from (0, 0)
    hull_x = [0.0]
    hull_y = [0.0]

    for i in range(n):
        x_new = i / n  # Left-continuous coordinates
        y_new = ecdf[i]

        # For UPPER concave hull (LCM), slopes must be NON-INCREASING
        # Remove points that would create increasing slopes
        while len(hull_x) >= 2:
            # Slope from second-to-last to last
            slope_prev = (hull_y[-1] - hull_y[-2]) / (hull_x[-1] - hull_x[-2]) if hull_x[-1] != hull_x[-2] else float('inf')
            # Slope from last to new
            slope_new = (y_new - hull_y[-1]) / (x_new - hull_x[-1]) if x_new != hull_x[-1] else float('inf')

            # For UPPER hull (LCM), keep if slope_new <= slope_prev (non-increasing)
            if slope_new <= slope_prev + 1e-12:  # Allow small tolerance
                break
            hull_x.pop()
            hull_y.pop()

        hull_x.append(x_new)
        hull_y.append(y_new)

    # Add endpoint (1, 1) to complete the hull
    hull_x.append(1.0)
    hull_y.append(1.0)

    # Interpolate LCM at all evaluation points
    hull_idx = 0
    for i in range(n):
        x = i / n
        # Find segment containing x
        while hull_idx < len(hull_x) - 1 and hull_x[hull_idx + 1] <= x:
            hull_idx += 1

        if hull_idx >= len(hull_x) - 1:
            lcm[i] = hull_y[-1]
        else:
            # Linear interpolation
            x1, y1 = hull_x[hull_idx], hull_y[hull_idx]
            x2, y2 = hull_x[hull_idx + 1], hull_y[hull_idx + 1]
            if x2 > x1:
                t = (x - x1) / (x2 - x1)
                lcm[i] = y1 + t * (y2 - y1)
            else:
                lcm[i] = y1

    # Dip is half of the maximum vertical distance between LCM and GCM
    # (which equals max distance from ECDF to the modal interval)
    dip = 0.5 * np.max(lcm - gcm)

    return max(dip, 0.0)


def find_modes(
    data: np.ndarray,
    bw_method: str = 'scott'
) -> Tuple[np.ndarray, int]:
    """
    Find modes in a distribution using KDE.

    Parameters
    ----------
    data : np.ndarray
        Sample data
    bw_method : str
        Bandwidth selection method

    Returns
    -------
    mode_locations : np.ndarray
        Location of each mode
    n_modes : int
        Number of modes detected
    """
    data = np.asarray(data).flatten()

    if len(data) < 10:
        return np.array([np.mean(data)]), 1

    # Kernel density estimation
    try:
        kde = stats.gaussian_kde(data, bw_method=bw_method)
    except:
        return np.array([np.mean(data)]), 1

    # Evaluate on grid
    x_min, x_max = data.min(), data.max()
    margin = 0.1 * (x_max - x_min)
    x_grid = np.linspace(x_min - margin, x_max + margin, 1000)
    density = kde(x_grid)

    # Smooth to reduce spurious peaks
    density_smooth = gaussian_filter1d(density, sigma=5)

    # Find peaks
    peaks, properties = find_peaks(density_smooth, height=0.01 * density_smooth.max())

    if len(peaks) == 0:
        # Fallback to maximum
        mode_idx = np.argmax(density_smooth)
        return np.array([x_grid[mode_idx]]), 1

    mode_locations = x_grid[peaks]
    n_modes = len(mode_locations)

    return mode_locations, n_modes


def classify_distribution_shape(
    skewness: float,
    kurtosis: float,
    is_unimodal: bool,
    n_modes: int,
    config: MorphologyConfig
) -> str:
    """
    Classify distribution shape into categories.

    Categories:
    - 'P': Left-skewed (P-shape) - bearish, put-heavy
    - 'b': Symmetric, normal-like (b-shape) - balanced
    - 'B': Right-skewed (B-shape) - bullish, call-heavy
    - 'bimodal': Two distinct modes
    - 'fat_tail': High kurtosis
    - 'normal': Approximately normal

    Parameters
    ----------
    skewness, kurtosis : float
        Distribution moments
    is_unimodal : bool
        Whether distribution is unimodal
    n_modes : int
        Number of modes
    config : MorphologyConfig
        Classification thresholds

    Returns
    -------
    str
        Shape classification
    """
    # Check bimodality first
    if not is_unimodal or n_modes >= 2:
        return 'bimodal'

    # Check for fat tails
    if abs(kurtosis) > config.kurtosis_threshold:
        if kurtosis > 0:
            return 'fat_tail'

    # Check skewness
    if skewness < -config.skew_threshold:
        return 'P'  # Left-skewed (Put-heavy)
    elif skewness > config.skew_threshold:
        return 'B'  # Right-skewed (Call-heavy)
    else:
        # Symmetric
        if abs(skewness) < 0.2 and abs(kurtosis) < 0.5:
            return 'normal'
        else:
            return 'b'  # Balanced but not strictly normal


# =============================================================================
# Vol Surface Shape Analysis
# =============================================================================

def analyze_vol_surface_shape(
    strikes: np.ndarray,
    vols: np.ndarray,
    spot: float,
    expiries: Optional[np.ndarray] = None,
    forward: Optional[float] = None
) -> VolSurfaceShape:
    """
    Analyze volatility surface shape.

    Parameters
    ----------
    strikes : np.ndarray
        Strike prices
    vols : np.ndarray
        Implied volatilities
    spot : float
        Current spot price
    expiries : np.ndarray, optional
        Time to expiration (for term structure)
    forward : float, optional
        Forward price (defaults to spot)

    Returns
    -------
    VolSurfaceShape
        Vol surface shape metrics
    """
    if forward is None:
        forward = spot

    strikes = np.asarray(strikes)
    vols = np.asarray(vols)

    # Sort by strike
    sort_idx = np.argsort(strikes)
    strikes = strikes[sort_idx]
    vols = vols[sort_idx]

    if len(strikes) < 3:
        return VolSurfaceShape(
            atm_vol=np.nan, skew_25d=np.nan, butterfly_25d=np.nan,
            risk_reversal=np.nan, term_slope=np.nan, curvature=np.nan,
            smile_shape='unknown', term_shape='unknown'
        )

    # Find ATM vol (interpolate to forward)
    atm_vol = np.interp(forward, strikes, vols)

    # Estimate 25-delta strike levels (rough approximation)
    # For 25d put: K ~ F * exp(-0.5 * σ² * T - σ * sqrt(T) * 0.675)
    # Simplified: use strikes at ~5% OTM for puts, ~5% OTM for calls
    put_25d_strike = forward * 0.95
    call_25d_strike = forward * 1.05

    put_25d_vol = np.interp(put_25d_strike, strikes, vols)
    call_25d_vol = np.interp(call_25d_strike, strikes, vols)

    # Vol surface metrics
    skew_25d = (put_25d_vol - call_25d_vol) / atm_vol if atm_vol > 0 else 0
    butterfly_25d = (put_25d_vol + call_25d_vol - 2 * atm_vol) / 2
    risk_reversal = call_25d_vol - put_25d_vol

    # Curvature (second derivative at ATM)
    moneyness = np.log(strikes / forward)
    if len(moneyness) >= 3:
        # Fit quadratic: vol = a + b*m + c*m²
        try:
            coeffs = np.polyfit(moneyness, vols, 2)
            curvature = 2 * coeffs[0]  # Second derivative
        except:
            curvature = 0
    else:
        curvature = 0

    # Classify smile shape
    if butterfly_25d > 0.01 and abs(skew_25d) < 0.05:
        smile_shape = 'smile'  # Symmetric convex
    elif skew_25d > 0.05:
        smile_shape = 'smirk'  # Put skew (typical equity)
    elif skew_25d < -0.05:
        smile_shape = 'inverted'  # Call skew (unusual)
    else:
        smile_shape = 'flat'

    # Term structure (if expiries provided)
    term_slope = 0
    term_shape = 'unknown'

    if expiries is not None and len(expiries) > 1:
        # Regress ATM vol on sqrt(T)
        sqrt_t = np.sqrt(expiries)
        try:
            slope, _, _, _, _ = stats.linregress(sqrt_t, vols)
            term_slope = slope

            if slope > 0.01:
                term_shape = 'contango'  # Normal upward
            elif slope < -0.01:
                term_shape = 'backwardation'  # Inverted
            else:
                term_shape = 'flat'
        except:
            pass

    return VolSurfaceShape(
        atm_vol=atm_vol,
        skew_25d=skew_25d,
        butterfly_25d=butterfly_25d,
        risk_reversal=risk_reversal,
        term_slope=term_slope,
        curvature=curvature,
        smile_shape=smile_shape,
        term_shape=term_shape
    )


# =============================================================================
# Gamma Exposure Shape Analysis
# =============================================================================

def analyze_gamma_shape(
    strikes: np.ndarray,
    gamma_exposure: np.ndarray,
    spot: float,
    config: MorphologyConfig = None
) -> GammaShape:
    """
    Analyze the shape of dealer gamma exposure across strikes.

    Shape interpretations:
    - 'P': Concentrated below spot (bearish positioning)
    - 'b': Balanced around spot
    - 'B': Concentrated above spot (bullish positioning)
    - 'W': Bimodal with dip at spot (straddle-heavy)
    - 'M': Bimodal with peak at spot (butterfly-heavy)

    Parameters
    ----------
    strikes : np.ndarray
        Strike prices
    gamma_exposure : np.ndarray
        Gamma exposure at each strike
    spot : float
        Current spot price
    config : MorphologyConfig
        Analysis parameters

    Returns
    -------
    GammaShape
        Gamma exposure shape analysis
    """
    if config is None:
        config = MorphologyConfig()

    strikes = np.asarray(strikes)
    gamma_exposure = np.asarray(gamma_exposure)

    # Sort by strike
    sort_idx = np.argsort(strikes)
    strikes = strikes[sort_idx]
    gamma_exposure = gamma_exposure[sort_idx]

    if len(strikes) < 3:
        return GammaShape(
            net_gamma=np.nan, gamma_peak_strike=np.nan,
            gamma_concentration=np.nan, gamma_skew=np.nan,
            dealer_position='unknown', flip_distance=np.nan,
            shape_class='unknown'
        )

    # Net gamma
    net_gamma = np.sum(gamma_exposure)

    # Find peak
    abs_gamma = np.abs(gamma_exposure)
    peak_idx = np.argmax(abs_gamma)
    gamma_peak_strike = strikes[peak_idx]

    # Concentration (how much around peak)
    total_abs_gamma = np.sum(abs_gamma)
    if total_abs_gamma > 0:
        # What fraction is within 5% of peak strike?
        near_peak = np.abs(strikes - gamma_peak_strike) / gamma_peak_strike < 0.05
        gamma_concentration = np.sum(abs_gamma[near_peak]) / total_abs_gamma
    else:
        gamma_concentration = 0

    # Gamma skew (asymmetry around spot)
    below_spot = strikes < spot
    above_spot = strikes > spot

    gamma_below = np.sum(gamma_exposure[below_spot])
    gamma_above = np.sum(gamma_exposure[above_spot])

    if abs(gamma_below) + abs(gamma_above) > 0:
        gamma_skew = (gamma_above - gamma_below) / (abs(gamma_above) + abs(gamma_below))
    else:
        gamma_skew = 0

    # Dealer position
    max_gamma = np.max(np.abs(gamma_exposure))
    if net_gamma > config.gamma_neutral_threshold * max_gamma:
        dealer_position = 'long_gamma'
    elif net_gamma < -config.gamma_neutral_threshold * max_gamma:
        dealer_position = 'short_gamma'
    else:
        dealer_position = 'neutral'

    # Find gamma flip point (where gamma changes sign)
    sign_changes = np.where(np.diff(np.sign(gamma_exposure)))[0]
    if len(sign_changes) > 0:
        # Find closest flip to spot
        flip_strikes = 0.5 * (strikes[sign_changes] + strikes[sign_changes + 1])
        flip_distance = np.min(np.abs(flip_strikes - spot)) / spot * 100
    else:
        flip_distance = np.inf

    # Shape classification
    shape_class = _classify_gamma_shape(
        gamma_exposure, strikes, spot, gamma_skew, config
    )

    return GammaShape(
        net_gamma=net_gamma,
        gamma_peak_strike=gamma_peak_strike,
        gamma_concentration=gamma_concentration,
        gamma_skew=gamma_skew,
        dealer_position=dealer_position,
        flip_distance=flip_distance,
        shape_class=shape_class
    )


def _classify_gamma_shape(
    gamma_exposure: np.ndarray,
    strikes: np.ndarray,
    spot: float,
    gamma_skew: float,
    config: MorphologyConfig
) -> str:
    """
    Classify the shape of gamma exposure profile.

    Returns: 'P', 'b', 'B', 'W', or 'M'
    """
    # Check for bimodality
    abs_gamma = np.abs(gamma_exposure)
    abs_gamma_smooth = gaussian_filter1d(abs_gamma, sigma=2)

    peaks, _ = find_peaks(abs_gamma_smooth)

    if len(peaks) >= 2:
        # Bimodal - check if W or M shape
        spot_idx = np.argmin(np.abs(strikes - spot))
        if spot_idx > 0 and spot_idx < len(gamma_exposure) - 1:
            at_spot = abs_gamma_smooth[spot_idx]
            neighbors_avg = (abs_gamma_smooth[spot_idx - 1] + abs_gamma_smooth[spot_idx + 1]) / 2
            if at_spot < 0.7 * neighbors_avg:
                return 'W'  # Valley at spot (straddle-heavy)
            elif at_spot > 1.3 * neighbors_avg:
                return 'M'  # Peak at spot (butterfly-heavy)

    # Unimodal - check skew
    if gamma_skew < -0.3:
        return 'P'  # Left-skewed (put-heavy)
    elif gamma_skew > 0.3:
        return 'B'  # Right-skewed (call-heavy)
    else:
        return 'b'  # Balanced


# =============================================================================
# Shape Distance & Similarity
# =============================================================================

def wasserstein_distance(
    data1: np.ndarray,
    data2: np.ndarray
) -> float:
    """
    Compute 1D Wasserstein (Earth Mover's) distance between distributions.

    Measures how much "work" needed to transform one distribution to another.
    Lower = more similar.

    Parameters
    ----------
    data1, data2 : np.ndarray
        Sample data from two distributions

    Returns
    -------
    float
        Wasserstein distance
    """
    return stats.wasserstein_distance(data1, data2)


def jensen_shannon_divergence(
    data1: np.ndarray,
    data2: np.ndarray,
    n_bins: int = 50
) -> float:
    """
    Compute Jensen-Shannon divergence between distributions.

    Symmetric measure: 0 = identical, 1 = maximally different.

    Parameters
    ----------
    data1, data2 : np.ndarray
        Sample data
    n_bins : int
        Number of histogram bins

    Returns
    -------
    float
        JS divergence (in [0, 1])
    """
    # Common bin edges
    all_data = np.concatenate([data1, data2])
    bins = np.linspace(np.min(all_data), np.max(all_data), n_bins + 1)

    # Compute histograms
    p, _ = np.histogram(data1, bins=bins, density=True)
    q, _ = np.histogram(data2, bins=bins, density=True)

    # Add small epsilon for numerical stability
    p = p + 1e-10
    q = q + 1e-10

    # Normalize
    p = p / p.sum()
    q = q / q.sum()

    # Mixture
    m = 0.5 * (p + q)

    # JS divergence
    js = 0.5 * stats.entropy(p, m) + 0.5 * stats.entropy(q, m)

    # Normalize to [0, 1]
    js = js / np.log(2)

    return js


def shape_similarity_score(
    metrics1: ShapeMetrics,
    metrics2: ShapeMetrics
) -> float:
    """
    Compute similarity score between two shape profiles.

    Score in [0, 1] where 1 = identical shapes.

    Parameters
    ----------
    metrics1, metrics2 : ShapeMetrics
        Shape metrics to compare

    Returns
    -------
    float
        Similarity score
    """
    # Compare moments
    skew_diff = abs(metrics1.skewness - metrics2.skewness)
    kurt_diff = abs(metrics1.kurtosis - metrics2.kurtosis)
    modes_diff = abs(metrics1.n_modes - metrics2.n_modes)

    # Shape class match
    class_match = 1.0 if metrics1.shape_class == metrics2.shape_class else 0.0

    # Weighted combination
    score = (
        0.3 * np.exp(-skew_diff) +
        0.2 * np.exp(-kurt_diff / 2) +
        0.2 * np.exp(-modes_diff) +
        0.3 * class_match
    )

    return score


# =============================================================================
# DataFrame Integration
# =============================================================================

def add_morphology_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    window: int = 60,
    prefix: str = 'morph_'
) -> pd.DataFrame:
    """
    Add rolling morphology features to DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame with returns column
    returns_col : str
        Column name for returns
    window : int
        Rolling window size
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with morphology features added:
        - morph_skewness: Rolling skewness
        - morph_kurtosis: Rolling excess kurtosis
        - morph_shape: Shape classification
        - morph_is_bimodal: Bimodality indicator
    """
    df = df.copy()

    # Rolling skewness
    df[f'{prefix}skewness'] = df[returns_col].rolling(window).skew()

    # Rolling kurtosis
    df[f'{prefix}kurtosis'] = df[returns_col].rolling(window).kurt()

    # Shape classification (compute periodically for efficiency)
    shape_classes = []
    is_bimodal = []

    config = MorphologyConfig()

    for i in range(len(df)):
        if i < window - 1:
            shape_classes.append('unknown')
            is_bimodal.append(False)
            continue

        window_data = df[returns_col].iloc[i - window + 1:i + 1].dropna().values

        if len(window_data) < 20:
            shape_classes.append('unknown')
            is_bimodal.append(False)
            continue

        # Quick classification without full dip test
        skew = stats.skew(window_data)
        kurt = stats.kurtosis(window_data)

        shape = classify_distribution_shape(
            skew, kurt,
            is_unimodal=True,  # Assume unimodal for speed
            n_modes=1,
            config=config
        )
        shape_classes.append(shape)
        is_bimodal.append(False)

    df[f'{prefix}shape'] = shape_classes
    df[f'{prefix}is_bimodal'] = is_bimodal

    # Numerical encoding of shape
    shape_map = {'P': -1, 'b': 0, 'B': 1, 'bimodal': 0, 'fat_tail': 0, 'normal': 0, 'unknown': np.nan}
    df[f'{prefix}shape_score'] = df[f'{prefix}shape'].map(shape_map)

    return df


def compute_gamma_morphology_series(
    df: pd.DataFrame,
    gamma_col: str = 'net_gex',
    spot_col: str = 'spot',
    prefix: str = 'gamma_morph_'
) -> pd.DataFrame:
    """
    Add gamma morphology features over time.

    This requires per-row gamma exposure profiles.
    Simplified version uses net gamma statistics.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame
    gamma_col : str
        Column for net gamma exposure
    spot_col : str
        Column for spot price
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with gamma morphology features
    """
    df = df.copy()

    if gamma_col not in df.columns:
        warnings.warn(f"Column {gamma_col} not found")
        return df

    gamma = df[gamma_col].values

    # Rolling statistics on gamma
    window = 20

    df[f'{prefix}gamma_mean'] = df[gamma_col].rolling(window).mean()
    df[f'{prefix}gamma_std'] = df[gamma_col].rolling(window).std()

    # Gamma regime (long/short/neutral)
    df[f'{prefix}position'] = np.where(
        gamma > df[f'{prefix}gamma_std'],
        'long_gamma',
        np.where(
            gamma < -df[f'{prefix}gamma_std'],
            'short_gamma',
            'neutral'
        )
    )

    # Position changes
    df[f'{prefix}position_change'] = df[f'{prefix}position'] != df[f'{prefix}position'].shift(1)

    return df
