"""
Dynamics Module for Market Physics Engine.

Implements:
- Time Derivatives (dγ/dt, dVol/dt, etc.)
- Shape Velocity (rate of change of distribution shape)
- Entropy Decay (how quickly information dissipates)
- Mean Reversion Speed (Ornstein-Uhlenbeck estimation)
- Momentum & Acceleration of Market Forces

Key Insight: The VELOCITY of change matters as much as the level.
Fast gamma decay → rapid volatility compression
Rising entropy decay rate → regime transition approaching

Author: Market Physics Engine
Layer: 2 (Dynamics)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any, Union
from scipy import stats
from scipy.optimize import minimize
from scipy.signal import savgol_filter
import warnings


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class DynamicsMetrics:
    """Time derivative and dynamics metrics."""
    level: float               # Current level
    velocity: float            # First derivative (dX/dt)
    acceleration: float        # Second derivative (d²X/dt²)
    momentum: float            # Level * velocity (signed)
    half_life: float           # Mean reversion half-life (if applicable)
    mean_reversion_speed: float  # Ornstein-Uhlenbeck kappa


@dataclass
class EntropyDynamics:
    """Entropy decay dynamics."""
    current_entropy: float
    entropy_velocity: float     # dH/dt
    decay_rate: float           # Exponential decay parameter
    half_life: float            # Time for entropy to halve
    equilibrium_entropy: float  # Long-run level
    distance_from_eq: float     # Current distance from equilibrium
    is_decaying: bool           # Whether entropy is decreasing


@dataclass
class ShapeVelocity:
    """Rate of change of distribution shape."""
    skewness_velocity: float    # d(skew)/dt
    kurtosis_velocity: float    # d(kurt)/dt
    shape_transition_prob: float  # Probability of shape class change
    shape_direction: str        # 'stable', 'becoming_P', 'becoming_B'


@dataclass
class VolatilityDynamics:
    """Volatility-specific dynamics."""
    realized_vol: float
    vol_of_vol: float           # Volatility of volatility
    vol_velocity: float         # dσ/dt
    vol_acceleration: float     # d²σ/dt²
    mean_reversion_level: float  # Long-run vol
    mean_reversion_speed: float  # Speed of reversion
    vol_regime: str             # 'expanding', 'contracting', 'stable'


@dataclass
class GammaDynamics:
    """Gamma exposure dynamics."""
    net_gamma: float
    gamma_velocity: float       # dGEX/dt
    gamma_acceleration: float   # d²GEX/dt²
    gamma_flip_velocity: float  # How fast approaching flip point
    charm_effect: float         # Time decay contribution
    vanna_effect: float         # Vol sensitivity contribution


@dataclass
class DynamicsConfig:
    """Configuration for dynamics calculations."""
    # Derivative estimation
    derivative_window: int = 5
    smoothing_window: int = 11
    smoothing_order: int = 3

    # Mean reversion
    ou_window: int = 252
    min_half_life: float = 1.0
    max_half_life: float = 252.0

    # Entropy
    entropy_lookback: int = 20
    entropy_bins: int = 20


# =============================================================================
# Time Derivative Estimation
# =============================================================================

def estimate_derivatives(
    series: np.ndarray,
    dt: float = 1.0,
    window: int = 5,
    smooth: bool = True
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Estimate first and second derivatives of a time series.

    Uses Savitzky-Golay filter for smoothed derivatives
    or simple finite differences.

    Parameters
    ----------
    series : np.ndarray
        Time series data
    dt : float
        Time step (default: 1 for daily data)
    window : int
        Window for derivative estimation
    smooth : bool
        Whether to use Savitzky-Golay smoothing

    Returns
    -------
    velocity : np.ndarray
        First derivative (dX/dt)
    acceleration : np.ndarray
        Second derivative (d²X/dt²)
    """
    series = np.asarray(series).flatten()
    n = len(series)

    if smooth and n >= window:
        # DYN5: Savitzky-Golay filter requires odd window size
        if window % 2 == 0:
            window = window + 1  # Make odd

        # Savitzky-Golay filter for smooth derivatives
        try:
            velocity = savgol_filter(series, window, 3, deriv=1, delta=dt)
            acceleration = savgol_filter(series, window, 3, deriv=2, delta=dt)
        except (ValueError, ZeroDivisionError) as e:  # DYN10: Catch specific exceptions
            # Fallback to finite differences
            velocity = np.gradient(series, dt)
            acceleration = np.gradient(velocity, dt)
    else:
        # Simple finite differences
        velocity = np.gradient(series, dt)
        acceleration = np.gradient(velocity, dt)

    return velocity, acceleration


def compute_dynamics_metrics(
    series: np.ndarray,
    dt: float = 1.0,
    config: DynamicsConfig = None
) -> DynamicsMetrics:
    """
    Compute comprehensive dynamics metrics for a time series.

    Parameters
    ----------
    series : np.ndarray
        Time series data
    dt : float
        Time step
    config : DynamicsConfig
        Analysis parameters

    Returns
    -------
    DynamicsMetrics
        Complete dynamics analysis for latest point
    """
    if config is None:
        config = DynamicsConfig()

    series = np.asarray(series).flatten()
    n = len(series)

    if n < 10:
        return DynamicsMetrics(
            level=series[-1] if n > 0 else np.nan,
            velocity=np.nan, acceleration=np.nan,
            momentum=np.nan, half_life=np.nan,
            mean_reversion_speed=np.nan
        )

    # Current level
    level = series[-1]

    # Derivatives
    velocity, acceleration = estimate_derivatives(
        series, dt, config.derivative_window, smooth=True
    )

    current_velocity = velocity[-1]
    current_acceleration = acceleration[-1]

    # Momentum (level * velocity)
    momentum = level * current_velocity

    # Mean reversion estimation
    half_life, kappa = estimate_mean_reversion(series, dt, config)

    return DynamicsMetrics(
        level=level,
        velocity=current_velocity,
        acceleration=current_acceleration,
        momentum=momentum,
        half_life=half_life,
        mean_reversion_speed=kappa
    )


# =============================================================================
# Mean Reversion Estimation (Ornstein-Uhlenbeck)
# =============================================================================

def estimate_mean_reversion(
    series: np.ndarray,
    dt: float = 1.0,
    config: DynamicsConfig = None
) -> Tuple[float, float]:
    """
    Estimate mean reversion parameters using Ornstein-Uhlenbeck model.

    dX = κ(θ - X)dt + σdW

    where:
    - κ = mean reversion speed
    - θ = long-run mean
    - σ = volatility

    Half-life = ln(2) / κ

    Parameters
    ----------
    series : np.ndarray
        Time series data
    dt : float
        Time step
    config : DynamicsConfig
        Analysis parameters

    Returns
    -------
    half_life : float
        Mean reversion half-life
    kappa : float
        Mean reversion speed
    """
    if config is None:
        config = DynamicsConfig()

    series = np.asarray(series).flatten()
    n = len(series)

    if n < 20:
        return np.nan, np.nan

    # Use recent data
    window = min(config.ou_window, n)
    x = series[-window:]

    # AR(1) regression: X_t = α + β*X_{t-1} + ε
    X_lag = x[:-1]
    X_curr = x[1:]

    # Check for valid data before regression
    if len(X_lag) < 2 or len(X_curr) < 2 or np.all(X_lag == X_lag[0]) or np.all(X_curr == X_curr[0]):
        return np.nan, np.nan np.nan np.nan np.nan np.nan np.nan np.nan np.nan np.nan np.nan

    try:
        slope, intercept, _, _, _ = stats.linregress(X_lag, X_curr)
    except (ValueError, FloatingPointError) as e:  # DYN_R8_1: Specific exceptions instead of bare except
        return np.nan, np.nan

    # OU parameters from AR(1)
    # β = exp(-κ*dt)
    # α = θ(1 - β)

    if slope <= 0 or slope >= 1:
        # Not mean reverting or explosive
        return np.nan, np.nan  # DYN4: Return nan instead of (inf, 0)

    # DYN1: AR(1) regression on consecutive points gives β = exp(-κ)
    # Don't divide by dt here - it's already implicit in the data spacing
    kappa = -np.log(slope)

    # DYN_R7_3: Validate theta doesn't explode when slope very close to 1
    denominator = 1 - slope
    if abs(denominator) < 1e-6:
        return np.nan, np.nan  # Slope too close to 1, theta would explode
    theta = intercept / denominator
    if abs(theta) > 1e6:
        return np.nan, np.nan  # Theta explosion - reject unrealistic parameters

    # Half-life (in same units as data spacing)
    half_life = np.log(2) / kappa

    # DYN3: Don't clip to hide bad parameters - return nan for invalid cases
    if half_life < config.min_half_life or half_life > config.max_half_life:
        return np.nan, np.nan

    return half_life, kappa


def estimate_ou_parameters(
    series: np.ndarray,
    dt: float = 1.0
) -> Dict[str, float]:
    """
    Full Ornstein-Uhlenbeck parameter estimation.

    Returns kappa, theta, sigma, and derived quantities.
    """
    series = np.asarray(series).flatten()
    n = len(series)

    if n < 20:
        return {
            'kappa': np.nan, 'theta': np.nan, 'sigma': np.nan,
            'half_life': np.nan, 'long_run_mean': np.nan,
            'long_run_variance': np.nan
        }

    # AR(1) regression
    X_lag = series[:-1]
    X_curr = series[1:]

    try:
        slope, intercept, _, _, _ = stats.linregress(X_lag, X_curr)
    except (ValueError, FloatingPointError) as e:  # DYN_R8_1: Specific exceptions instead of bare except
        return {
            'kappa': np.nan, 'theta': np.nan, 'sigma': np.nan,
            'half_life': np.nan, 'long_run_mean': np.nan,
            'long_run_variance': np.nan
        }

    if slope <= 0 or slope >= 1:
        return {
            'kappa': np.nan, 'theta': np.mean(series), 'sigma': np.std(series),
            'half_life': np.nan, 'long_run_mean': np.mean(series),
            'long_run_variance': np.var(series)
        }

    # DYN1: Parameters (don't double-scale kappa with dt)
    kappa = -np.log(slope)
    theta = intercept / (1 - slope)

    # Residual volatility
    residuals = X_curr - (intercept + slope * X_lag)
    sigma_residual = np.std(residuals)

    # DYN2: OU volatility from discrete-time residuals
    # Correct formula: σ_ε = σ * sqrt(1 - exp(-2κΔt))
    # So: σ = σ_ε / sqrt(1 - exp(-2κΔt))
    # DYN_R7_1: Protect against division by zero when κ→0
    denominator_sq = 1 - np.exp(-2 * kappa * dt)
    if denominator_sq > 1e-10:
        sigma = sigma_residual / np.sqrt(denominator_sq)
    else:
        # κ too small - process is nearly random walk, OU sigma undefined
        sigma = np.nan

    # Derived quantities
    half_life = np.log(2) / kappa
    long_run_variance = sigma**2 / (2 * kappa)

    return {
        'kappa': kappa,
        'theta': theta,
        'sigma': sigma,
        'half_life': half_life,
        'long_run_mean': theta,
        'long_run_variance': long_run_variance
    }


# =============================================================================
# Entropy Dynamics
# =============================================================================

def compute_entropy_dynamics(
    series: np.ndarray,
    lookback: int = 20,
    n_bins: int = 20,
    dt: float = 1.0
) -> EntropyDynamics:
    """
    Compute entropy and its dynamics over time.

    Entropy decay indicates information being processed/absorbed.
    Rising entropy = uncertainty increasing = possible regime change.

    Parameters
    ----------
    series : np.ndarray
        Time series data (e.g., returns)
    lookback : int
        Window for entropy calculation
    n_bins : int
        Histogram bins
    dt : float
        Time step

    Returns
    -------
    EntropyDynamics
        Entropy dynamics analysis
    """
    series = np.asarray(series).flatten()
    n = len(series)

    if n < lookback * 3:
        return EntropyDynamics(
            current_entropy=np.nan, entropy_velocity=np.nan,
            decay_rate=np.nan, half_life=np.nan,
            equilibrium_entropy=np.nan, distance_from_eq=np.nan,
            is_decaying=False
        )

    # Compute rolling entropy
    entropies = []
    zero_entropy_count = 0  # DYN_R7_9: Track degenerate entropy periods
    for i in range(lookback, n + 1):
        window_data = series[i - lookback:i]

        # Histogram-based entropy - use counts and normalize to get probability mass
        hist, bin_edges = np.histogram(window_data, bins=n_bins)
        # Normalize to probability mass function (sum to 1)
        hist = hist / hist.sum() if hist.sum() > 0 else hist
        hist = hist[hist > 0]  # Remove zeros
        if len(hist) > 0:
            entropy = -np.sum(hist * np.log(hist))
        else:
            entropy = 0
            zero_entropy_count += 1  # DYN_R7_9: Count degenerate periods
        entropies.append(entropy)

    # DYN_R7_9: Warn if significant portion of periods have zero entropy
    if zero_entropy_count > len(entropies) * 0.5:
        logger.warning(f"Degenerate entropy: {zero_entropy_count}/{len(entropies)} periods have zero entropy (constant values)")

    entropies = np.array(entropies)

    # Current entropy
    current_entropy = entropies[-1]

    # Entropy velocity
    if len(entropies) >= 5:
        velocity, _ = estimate_derivatives(entropies, dt, 5, smooth=True)
        entropy_velocity = velocity[-1]
    else:
        entropy_velocity = np.diff(entropies)[-1] if len(entropies) > 1 else 0

    # Estimate equilibrium entropy (long-run mean)
    equilibrium_entropy = np.mean(entropies)

    # Distance from equilibrium
    distance_from_eq = current_entropy - equilibrium_entropy

    # Decay rate (exponential fit on recent data)
    recent = entropies[-min(50, len(entropies)):]
    if len(recent) > 5:
        t = np.arange(len(recent))
        # DYN6: Check if data has sufficient variation before fitting
        diff_abs = np.abs(recent - equilibrium_entropy)
        if np.max(diff_abs) > 1e-10:
            try:
                # Fit H(t) = H_eq + (H_0 - H_eq) * exp(-λt)
                log_diff = np.log(diff_abs + 1e-10)
                slope, _, _, _, _ = stats.linregress(t, log_diff)
                decay_rate = -slope
            except (ValueError, ZeroDivisionError):  # DYN10: Specific exceptions
                decay_rate = 0
        else:
            # Flat data - no decay to measure
            decay_rate = 0
    else:
        decay_rate = 0

    # DYN7: Half-life (use nan for consistency, not inf)
    half_life = np.log(2) / decay_rate if decay_rate > 0 else np.nan

    # Is decaying?
    is_decaying = entropy_velocity < -0.01

    return EntropyDynamics(
        current_entropy=current_entropy,
        entropy_velocity=entropy_velocity,
        decay_rate=decay_rate,
        half_life=half_life,
        equilibrium_entropy=equilibrium_entropy,
        distance_from_eq=distance_from_eq,
        is_decaying=is_decaying
    )


# =============================================================================
# Shape Velocity
# =============================================================================

def compute_shape_velocity(
    series: np.ndarray,
    window: int = 60,
    dt: float = 1.0
) -> ShapeVelocity:
    """
    Compute rate of change of distribution shape.

    Useful for predicting regime transitions.
    Fast shape change → transition in progress.

    Parameters
    ----------
    series : np.ndarray
        Time series data
    window : int
        Rolling window for shape calculation
    dt : float
        Time step

    Returns
    -------
    ShapeVelocity
        Shape dynamics analysis
    """
    series = np.asarray(series).flatten()
    n = len(series)

    if n < window * 2:
        return ShapeVelocity(
            skewness_velocity=np.nan, kurtosis_velocity=np.nan,
            shape_transition_prob=np.nan, shape_direction='unknown'
        )

    # Compute rolling skewness and kurtosis
    skewness = []
    kurtosis = []

    for i in range(window, n + 1):
        window_data = series[i - window:i]
        skewness.append(stats.skew(window_data))
        kurtosis.append(stats.kurtosis(window_data))

    skewness = np.array(skewness)
    kurtosis = np.array(kurtosis)

    # Compute velocities
    if len(skewness) >= 5:
        skew_vel, _ = estimate_derivatives(skewness, dt, 5, smooth=True)
        kurt_vel, _ = estimate_derivatives(kurtosis, dt, 5, smooth=True)
        skewness_velocity = skew_vel[-1]
        kurtosis_velocity = kurt_vel[-1]
    else:
        skewness_velocity = np.diff(skewness)[-1] if len(skewness) > 1 else 0
        kurtosis_velocity = np.diff(kurtosis)[-1] if len(kurtosis) > 1 else 0

    # Shape transition probability (based on velocity)
    # DYN_R7_6: Handle NaN velocities explicitly
    if np.isnan(skewness_velocity) or np.isnan(kurtosis_velocity):
        shape_change_speed = np.nan
        shape_transition_prob = np.nan
    else:
        # High |velocity| = high probability of crossing threshold
        shape_change_speed = np.sqrt(skewness_velocity**2 + kurtosis_velocity**2)
        shape_transition_prob = 1 - np.exp(-shape_change_speed * 5)

    # Direction
    if skewness_velocity < -0.1:
        shape_direction = 'becoming_P'  # More left-skewed
    elif skewness_velocity > 0.1:
        shape_direction = 'becoming_B'  # More right-skewed
    else:
        shape_direction = 'stable'

    return ShapeVelocity(
        skewness_velocity=skewness_velocity,
        kurtosis_velocity=kurtosis_velocity,
        shape_transition_prob=shape_transition_prob,
        shape_direction=shape_direction
    )


# =============================================================================
# Volatility Dynamics
# =============================================================================

def compute_volatility_dynamics(
    returns: np.ndarray,
    vol_window: int = 20,
    dt: float = 1.0,
    config: DynamicsConfig = None
) -> VolatilityDynamics:
    """
    Compute volatility-specific dynamics.

    Parameters
    ----------
    returns : np.ndarray
        Return series
    vol_window : int
        Window for realized vol calculation
    dt : float
        Time step
    config : DynamicsConfig
        Analysis parameters

    Returns
    -------
    VolatilityDynamics
        Volatility dynamics analysis
    """
    if config is None:
        config = DynamicsConfig()

    returns = np.asarray(returns).flatten()
    n = len(returns)

    if n < vol_window * 2:
        return VolatilityDynamics(
            realized_vol=np.nan, vol_of_vol=np.nan,
            vol_velocity=np.nan, vol_acceleration=np.nan,
            mean_reversion_level=np.nan, mean_reversion_speed=np.nan,
            vol_regime='unknown'
        )

    # Compute rolling volatility
    vol_series = []
    for i in range(vol_window, n + 1):
        window_returns = returns[i - vol_window:i]
        vol_series.append(np.std(window_returns) * np.sqrt(252))  # Annualized

    vol_series = np.array(vol_series)

    # Current realized vol
    realized_vol = vol_series[-1]

    # Vol of vol
    # DYN_R7_7: Increase min sample threshold from 10 to 50 for stable estimate
    vol_of_vol = np.std(vol_series) if len(vol_series) >= 50 else np.nan

    # Vol derivatives
    if len(vol_series) >= 5:
        vol_vel, vol_acc = estimate_derivatives(vol_series, dt, 5, smooth=True)
        vol_velocity = vol_vel[-1]
        vol_acceleration = vol_acc[-1]
    else:
        vol_velocity = np.nan
        vol_acceleration = np.nan

    # Mean reversion
    ou_params = estimate_ou_parameters(vol_series, dt)
    mean_reversion_level = ou_params['theta']
    mean_reversion_speed = ou_params['kappa']

    # DYN_R7_5: Vol regime - explicitly check for NaN before comparison
    if np.isnan(vol_velocity) or np.isnan(vol_of_vol):
        vol_regime = 'unknown'
    elif vol_velocity > vol_of_vol * 0.1:
        vol_regime = 'expanding'
    elif vol_velocity < -vol_of_vol * 0.1:
        vol_regime = 'contracting'
    else:
        vol_regime = 'stable'

    return VolatilityDynamics(
        realized_vol=realized_vol,
        vol_of_vol=vol_of_vol,
        vol_velocity=vol_velocity,
        vol_acceleration=vol_acceleration,
        mean_reversion_level=mean_reversion_level,
        mean_reversion_speed=mean_reversion_speed,
        vol_regime=vol_regime
    )


# =============================================================================
# Gamma Dynamics
# =============================================================================

def compute_gamma_dynamics(
    gamma_series: np.ndarray,
    spot_series: np.ndarray,
    dt: float = 1.0,
    config: DynamicsConfig = None
) -> GammaDynamics:
    """
    Compute gamma exposure dynamics.

    Tracks how fast gamma is changing and why.

    Parameters
    ----------
    gamma_series : np.ndarray
        Net gamma exposure over time
    spot_series : np.ndarray
        Spot price over time
    dt : float
        Time step
    config : DynamicsConfig
        Analysis parameters

    Returns
    -------
    GammaDynamics
        Gamma dynamics analysis
    """
    if config is None:
        config = DynamicsConfig()

    gamma_series = np.asarray(gamma_series).flatten()
    spot_series = np.asarray(spot_series).flatten()
    n = len(gamma_series)

    if n < 10:
        return GammaDynamics(
            net_gamma=np.nan, gamma_velocity=np.nan,
            gamma_acceleration=np.nan, gamma_flip_velocity=np.nan,
            charm_effect=np.nan, vanna_effect=np.nan
        )

    # Current gamma
    net_gamma = gamma_series[-1]

    # Gamma derivatives
    if n >= 5:
        gamma_vel, gamma_acc = estimate_derivatives(gamma_series, dt, 5, smooth=True)
        gamma_velocity = gamma_vel[-1]
        gamma_acceleration = gamma_acc[-1]
    else:
        gamma_velocity = np.nan
        gamma_acceleration = np.nan

    # DYN8: Gamma flip velocity (rate of approaching zero crossing)
    # Track whether moving TOWARD or AWAY from gamma=0 flip point
    if not np.isnan(gamma_velocity) and not np.isnan(net_gamma):
        if net_gamma > 0:
            # Positive gamma - flip velocity is negative of gamma_velocity
            # (decreasing gamma = approaching flip)
            gamma_flip_velocity = -gamma_velocity
        else:
            # Negative gamma - flip velocity is positive of gamma_velocity
            # (increasing gamma = approaching flip from below)
            gamma_flip_velocity = gamma_velocity
    else:
        gamma_flip_velocity = np.nan

    # DYN9: Decompose gamma change empirically (NOT theoretical Greeks)
    # Names: time_effect, spot_effect (clearer than charm/vanna)
    # dGamma/dt ≈ time_effect + spot_effect

    # Empirical decomposition based on time vs spot correlation
    if n >= 20:
        # Time effect (constant decay rate - empirical "charm-like")
        time_effect = np.mean(np.diff(gamma_series))

        # Spot/vol effect (residual - empirical "vanna-like")
        spot_changes = np.diff(spot_series)
        gamma_changes = np.diff(gamma_series)

        if len(spot_changes) > 5:
            # DYN_R7_2: Check for zero variance before linregress (flat market)
            spot_std = np.std(spot_changes)
            if spot_std < 1e-10:
                # Flat market - no spot effect measurable
                spot_effect = np.nan
            else:
                try:
                    slope, _, _, _, _ = stats.linregress(spot_changes, gamma_changes)
                    spot_effect = slope * spot_std
                except (ValueError, ZeroDivisionError):  # DYN10: Specific exceptions
                    spot_effect = np.nan  # Return NaN to signal uncertainty, not 0.0
        else:
            spot_effect = np.nan
    else:
        time_effect = np.nan
        spot_effect = np.nan

    return GammaDynamics(
        net_gamma=net_gamma,
        gamma_velocity=gamma_velocity,
        gamma_acceleration=gamma_acceleration,
        gamma_flip_velocity=gamma_flip_velocity,
        charm_effect=time_effect,  # DYN9: Renamed but keeping field name for compatibility
        vanna_effect=spot_effect   # DYN9: Renamed but keeping field name for compatibility
    )


# =============================================================================
# DataFrame Integration
# =============================================================================

def add_dynamics_features(
    df: pd.DataFrame,
    columns: List[str],
    prefix: str = 'dyn_',
    dt: float = 1.0,
    config: DynamicsConfig = None
) -> pd.DataFrame:
    """
    Add dynamics features (velocity, acceleration) for specified columns.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame
    columns : list
        Columns to compute dynamics for
    prefix : str
        Column name prefix
    dt : float
        Time step
    config : DynamicsConfig
        Analysis parameters

    Returns
    -------
    pd.DataFrame
        DataFrame with dynamics features added
    """
    if config is None:
        config = DynamicsConfig()

    df = df.copy()

    for col in columns:
        if col not in df.columns:
            warnings.warn(f"Column {col} not found")
            continue

        series = df[col].values

        # Compute derivatives
        velocity, acceleration = estimate_derivatives(
            series, dt, config.derivative_window, smooth=True
        )

        df[f'{prefix}{col}_velocity'] = velocity
        df[f'{prefix}{col}_acceleration'] = acceleration

        # Momentum
        df[f'{prefix}{col}_momentum'] = series * velocity

    return df


def add_entropy_dynamics_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    lookback: int = 20,
    prefix: str = 'entropy_'
) -> pd.DataFrame:
    """
    Add rolling entropy dynamics features.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame
    returns_col : str
        Column for returns
    lookback : int
        Window for entropy
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with entropy features
    """
    df = df.copy()
    returns = df[returns_col].values
    n = len(returns)

    # Compute rolling entropy
    entropies = np.full(n, np.nan)
    n_bins = 20

    for i in range(lookback, n):
        window_data = returns[i - lookback:i]
        window_data = window_data[~np.isnan(window_data)]

        if len(window_data) > 5:
            # Use counts and normalize to probability mass (not density)
            hist, _ = np.histogram(window_data, bins=n_bins)
            hist = hist / hist.sum() if hist.sum() > 0 else hist
            hist = hist[hist > 0]
            entropies[i] = -np.sum(hist * np.log(hist)) if len(hist) > 0 else 0

    df[f'{prefix}value'] = entropies

    # Entropy velocity
    entropy_vel = np.gradient(entropies)
    df[f'{prefix}velocity'] = entropy_vel

    # Entropy acceleration
    df[f'{prefix}acceleration'] = np.gradient(entropy_vel)

    # Is decaying
    df[f'{prefix}is_decaying'] = entropy_vel < -0.01

    return df


def add_volatility_dynamics_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    vol_window: int = 20,
    prefix: str = 'vol_dyn_'
) -> pd.DataFrame:
    """
    Add volatility dynamics features.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame
    returns_col : str
        Column for returns
    vol_window : int
        Window for vol calculation
    prefix : str
        Column name prefix

    Returns
    -------
    pd.DataFrame
        DataFrame with vol dynamics features
    """
    df = df.copy()
    returns = df[returns_col].values
    n = len(returns)

    # Rolling volatility
    # DYN_R7_8: Standard annualized volatility = std(daily_returns) * sqrt(252)
    # This is consistent with analyze_volatility_dynamics() at line 641
    vol = df[returns_col].rolling(vol_window).std() * np.sqrt(252)
    df[f'{prefix}realized_vol'] = vol

    # Vol velocity
    vol_vel = np.gradient(vol.values)
    df[f'{prefix}velocity'] = vol_vel

    # Vol regime
    vol_std = vol.rolling(60).std()
    df[f'{prefix}regime'] = np.where(
        vol_vel > vol_std * 0.5,
        'expanding',
        np.where(
            vol_vel < -vol_std * 0.5,
            'contracting',
            'stable'
        )
    )

    return df
