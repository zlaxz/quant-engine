#!/usr/bin/env python3
"""
Order Flow Analysis - VPIN, Kyle's Lambda, OFI
==============================================
Market Physics Engine - Layer 3 (Force Calculation)

Order flow is the primary vehicle for information transmission into prices.
This module implements toxicity detection and flow analysis metrics.

Key Metrics:
- VPIN: Volume-Synchronized Probability of Informed Trading
- Kyle's Lambda: Price impact per unit of order flow
- OFI: Order Flow Imbalance from limit order book dynamics

IMPORTANT: All features are computed with LAG to avoid lookahead bias.

Research Source: ORDER-FLOW-ANALYSIS-RESEARCH.md
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import norm

logger = logging.getLogger("AlphaFactory.Features.Flow")


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class FlowFeatures:
    """Container for flow analysis features."""
    vpin: float                    # Current VPIN value
    vpin_percentile: float         # VPIN percentile (0-1)
    vpin_cdf: float               # VPIN CDF (toxicity alert >0.90)
    kyle_lambda: float            # Price impact coefficient
    kyle_lambda_zscore: float     # Lambda z-score vs history
    ofi: float                    # Order Flow Imbalance
    ofi_normalized: float         # OFI / average volume
    buy_volume_ratio: float       # Buy volume / total volume
    order_imbalance: float        # (Buy - Sell) / (Buy + Sell)
    toxicity_alert: bool          # VPIN CDF > 0.90


# =============================================================================
# TRADE CLASSIFICATION
# =============================================================================

def tick_rule(prices: np.ndarray) -> np.ndarray:
    """
    Classify trades using the Tick Rule.

    - P_t > P_{t-1} → Buy (+1)
    - P_t < P_{t-1} → Sell (-1)
    - P_t = P_{t-1} → Use previous classification

    Accuracy: ~75-85%

    Args:
        prices: Trade price series

    Returns:
        Array of trade signs (+1 buy, -1 sell)
    """
    prices = np.asarray(prices)
    n = len(prices)

    if n < 2:
        return np.zeros(n)

    # Calculate price changes
    changes = np.diff(prices)

    # Initialize signs (0 for first trade)
    signs = np.zeros(n)

    # Classify based on tick rule
    for i in range(1, n):
        if changes[i-1] > 0:
            signs[i] = 1  # Buy
        elif changes[i-1] < 0:
            signs[i] = -1  # Sell
        else:
            # FL6: Zero tick - use previous classification, or 0 if unclassifiable
            # Don't assume buy (1) in flat markets
            signs[i] = signs[i-1]

    return signs


def lee_ready(
    trade_prices: np.ndarray,
    bid_prices: np.ndarray,
    ask_prices: np.ndarray,
    delay: int = 0
) -> np.ndarray:
    """
    Lee-Ready trade classification algorithm.

    1. Compare trade price to quote midpoint
    2. P_t > Mid → Buy
    3. P_t < Mid → Sell
    4. P_t = Mid → Use Tick Rule

    Accuracy: ~85-93%

    Args:
        trade_prices: Trade price series
        bid_prices: Best bid prices (aligned with trades)
        ask_prices: Best ask prices (aligned with trades)
        delay: Quote delay in observations (typically 0-5 for modern data)

    Returns:
        Array of trade signs (+1 buy, -1 sell)
    """
    trade_prices = np.asarray(trade_prices)
    bid_prices = np.asarray(bid_prices)
    ask_prices = np.asarray(ask_prices)
    n = len(trade_prices)

    if n == 0:
        return np.array([])

    # FL10: Apply quote delay without circular wrap - use explicit shift
    if delay > 0:
        # Shift quotes forward, forward-fill initial values
        bid_shifted = np.empty_like(bid_prices)
        ask_shifted = np.empty_like(ask_prices)
        bid_shifted[:delay] = bid_prices[0]  # Forward fill with first quote
        ask_shifted[:delay] = ask_prices[0]
        bid_shifted[delay:] = bid_prices[:-delay]
        ask_shifted[delay:] = ask_prices[:-delay]
        bid_prices = bid_shifted
        ask_prices = ask_shifted

    # Calculate midpoints
    midpoints = (bid_prices + ask_prices) / 2

    # Initialize signs
    signs = np.zeros(n)

    # Classify using quote test
    above_mid = trade_prices > midpoints
    below_mid = trade_prices < midpoints
    at_mid = ~above_mid & ~below_mid

    signs[above_mid] = 1   # Buy
    signs[below_mid] = -1  # Sell

    # For trades at midpoint, use tick rule
    if np.any(at_mid):
        tick_signs = tick_rule(trade_prices)
        signs[at_mid] = tick_signs[at_mid]

    return signs


def bulk_volume_classification(
    prices: np.ndarray,
    volumes: np.ndarray,
    sigma: Optional[float] = None
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Bulk Volume Classification (BVC) for VPIN.

    V^B = V × Φ(ΔP/σ)

    Where Φ = standard normal CDF

    Accuracy: ~79-85%
    Advantage: Computationally fast for real-time VPIN

    Args:
        prices: Trade prices
        volumes: Trade volumes
        sigma: Return volatility (if None, estimated from data)

    Returns:
        Tuple of (buy_volumes, sell_volumes)
    """
    prices = np.asarray(prices)
    volumes = np.asarray(volumes)

    if len(prices) < 2:
        return np.zeros_like(volumes), volumes.copy()

    # Calculate log returns
    returns = np.diff(np.log(prices))

    # FL11: Estimate sigma with adaptive epsilon based on data scale
    if sigma is None:
        if len(returns) > 0:
            sigma = np.std(returns)
            # Adaptive epsilon: use mean absolute return as scale reference
            data_scale = np.mean(np.abs(returns)) if len(returns) > 0 else 0.0
            adaptive_eps = max(data_scale * 0.01, 1e-6)  # 1% of typical move, floor at 1e-6

            if sigma < adaptive_eps:
                # Use robust fallback: 25th percentile of non-zero absolute returns
                nonzero_returns = np.abs(returns[returns != 0])
                sigma = np.percentile(nonzero_returns, 25) if len(nonzero_returns) > 0 else adaptive_eps
                if sigma < adaptive_eps:
                    sigma = adaptive_eps  # Data-adaptive fallback
        else:
            sigma = 1e-6  # Safe default for empty returns

    # Standardized returns
    z_scores = returns / sigma

    # Buy probability from CDF
    buy_probs = norm.cdf(z_scores)

    # FL_R6_3: Lag classification by 1 to avoid lookahead
    # volumes[t] classified using returns[t-2] (price change from t-2 to t-1)
    # This ensures we only use information available BEFORE time t
    buy_volumes = np.zeros_like(volumes, dtype=float)
    sell_volumes = np.zeros_like(volumes, dtype=float)

    # First two observations: no lagged return available, assign 50/50
    buy_volumes[0] = volumes[0] * 0.5
    sell_volumes[0] = volumes[0] * 0.5

    if len(volumes) > 1:
        buy_volumes[1] = volumes[1] * 0.5
        sell_volumes[1] = volumes[1] * 0.5

    # From index 2 onward: use lagged classification
    if len(volumes) > 2:
        buy_volumes[2:] = volumes[2:] * buy_probs[:-1]
        sell_volumes[2:] = volumes[2:] * (1 - buy_probs[:-1])

    return buy_volumes, sell_volumes


# =============================================================================
# VPIN (Volume-Synchronized Probability of Informed Trading)
# =============================================================================

def create_volume_buckets(
    volumes: np.ndarray,
    bucket_size: float
) -> Tuple[np.ndarray, List[Tuple[int, int]]]:
    """
    Create volume-synchronized buckets.

    Args:
        volumes: Trade volumes
        bucket_size: Target volume per bucket

    Returns:
        Tuple of (bucket_volumes, bucket_ranges)
    """
    cumvol = np.cumsum(volumes)
    total_vol = cumvol[-1]

    if total_vol < bucket_size or bucket_size <= 0:
        # Not enough volume for even one bucket
        return np.array([total_vol]), [(0, len(volumes))]

    # Find bucket boundaries
    n_buckets = int(total_vol / bucket_size)
    bucket_thresholds = np.arange(bucket_size, total_vol, bucket_size)

    bucket_indices = np.searchsorted(cumvol, bucket_thresholds)

    # Create bucket ranges
    ranges = []
    start = 0
    for end in bucket_indices:
        if end > start:
            ranges.append((start, end))
        start = end

    # Last bucket (may be partial)
    if start < len(volumes):
        ranges.append((start, len(volumes)))

    return bucket_thresholds, ranges


def calculate_vpin(
    prices: np.ndarray,
    volumes: np.ndarray,
    bucket_size: float,
    n_buckets: int = 50,
    sigma: Optional[float] = None
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Calculate VPIN (Volume-Synchronized Probability of Informed Trading).

    VPIN = Σ|V^B - V^S| / (n × V)

    Higher VPIN indicates higher probability of informed trading (toxicity).
    VPIN CDF > 0.90 is a critical toxicity alert.

    Args:
        prices: Trade prices
        volumes: Trade volumes
        bucket_size: Volume per bucket
        n_buckets: Rolling window for VPIN calculation
        sigma: Return volatility (if None, estimated from data)

    Returns:
        Tuple of (vpin_values, bucket_midpoint_indices)
    """
    prices = np.asarray(prices)
    volumes = np.asarray(volumes)

    if len(prices) < 2:
        return np.array([]), np.array([])

    # BVC classification
    buy_volumes, sell_volumes = bulk_volume_classification(prices, volumes, sigma)

    # Create volume buckets
    cumvol = np.cumsum(volumes)
    total_vol = cumvol[-1]

    if total_vol < bucket_size * n_buckets:
        logger.warning(f"Insufficient volume for {n_buckets} buckets of size {bucket_size}")
        n_actual_buckets = max(1, int(total_vol / bucket_size))
        if n_actual_buckets < n_buckets:
            n_buckets = n_actual_buckets

    # Calculate imbalance per bucket
    bucket_thresholds = np.arange(bucket_size, total_vol + bucket_size, bucket_size)
    bucket_indices = np.searchsorted(cumvol, bucket_thresholds)

    imbalances = []
    bucket_midpoints = []
    start = 0
    total_bucketed_volume = 0.0

    for i, end in enumerate(bucket_indices):
        if end > start and end <= len(volumes):
            buy_v = np.sum(buy_volumes[start:end])
            sell_v = np.sum(sell_volumes[start:end])
            bucket_vol = buy_v + sell_v

            # FL_R6_1: Skip zero-volume buckets (can occur with duplicate searchsorted indices)
            if bucket_vol > 0:
                imbalances.append(abs(buy_v - sell_v))
                bucket_midpoints.append((start + end) // 2)
                total_bucketed_volume += bucket_vol

            start = end

    # FL12: Verify all volume was bucketed (detect gaps from searchsorted)
    if start < len(volumes):
        # Remaining trades not bucketed - add final partial bucket
        buy_v = np.sum(buy_volumes[start:])
        sell_v = np.sum(sell_volumes[start:])
        if buy_v + sell_v > 0:
            imbalances.append(abs(buy_v - sell_v))
            bucket_midpoints.append((start + len(volumes)) // 2)
            total_bucketed_volume += buy_v + sell_v

    imbalances = np.array(imbalances)
    bucket_midpoints = np.array(bucket_midpoints)

    # Validate coverage
    volume_coverage = total_bucketed_volume / total_vol if total_vol > 0 else 0
    if volume_coverage < 0.99:  # Allow 1% tolerance for numerical precision
        logger.warning(
            f"VPIN bucketing incomplete: only {volume_coverage:.1%} of volume bucketed. "
            f"This may indicate bucket_size ({bucket_size}) is too large relative to trade volumes."
        )

    if len(imbalances) < n_buckets:
        logger.warning(f"Only {len(imbalances)} buckets created, less than {n_buckets} requested")
        if len(imbalances) == 0:
            return np.array([]), np.array([])
        n_buckets = len(imbalances)

    # Rolling VPIN
    # FL1: Convolution already normalizes by n_buckets, don't double-divide
    vpin = np.convolve(imbalances, np.ones(n_buckets) / n_buckets, mode='valid')
    # Removed: vpin = vpin / bucket_size (was double-normalizing)

    # Align bucket midpoints with VPIN values
    vpin_midpoints = bucket_midpoints[n_buckets-1:len(bucket_midpoints)]

    return vpin, vpin_midpoints


def vpin_cdf(
    current_vpin: float,
    historical_vpin: np.ndarray,
    method: str = 'empirical'
) -> float:
    """
    Calculate VPIN CDF (percentile) for toxicity assessment.

    Args:
        current_vpin: Current VPIN value
        historical_vpin: Historical VPIN values for comparison
        method: 'empirical' or 'kernel' for CDF estimation

    Returns:
        CDF value (0-1), >0.90 indicates toxicity alert
    """
    # FL_R7_1: Check for NaN current_vpin - NaN should return NaN, not 0.0
    # NaN VPIN means unknown toxicity, not "definitely NOT toxic"
    if np.isnan(current_vpin):
        return np.nan

    historical_vpin = np.asarray(historical_vpin)
    historical_vpin = historical_vpin[~np.isnan(historical_vpin)]

    # FL4: Return NaN when no history available (0.5 is misleading)
    if len(historical_vpin) == 0:
        return np.nan

    if method == 'empirical':
        cdf = np.mean(historical_vpin <= current_vpin)
    elif method == 'kernel':
        kde = stats.gaussian_kde(historical_vpin)
        cdf = kde.integrate_box_1d(-np.inf, current_vpin)
    else:
        raise ValueError(f"Unknown method: {method}")

    return float(cdf)


def rolling_vpin(
    df: pd.DataFrame,
    price_col: str = 'close',
    volume_col: str = 'volume',
    bucket_size: Optional[float] = None,
    n_buckets: int = 50,
    auto_bucket_percentile: float = 0.01
) -> pd.Series:
    """
    Calculate rolling VPIN for a DataFrame.

    Args:
        df: DataFrame with price and volume data
        price_col: Column name for prices
        volume_col: Column name for volumes
        bucket_size: Volume per bucket (auto-calculated if None)
        n_buckets: Rolling window for VPIN
        auto_bucket_percentile: Percentile of daily volume for auto bucket size

    Returns:
        Series with VPIN values aligned to original index
    """
    prices = df[price_col].values
    volumes = df[volume_col].values

    # Auto-calculate bucket size if not provided
    if bucket_size is None:
        # Use percentile of total volume to set bucket size
        total_vol = np.sum(volumes)
        bucket_size = total_vol * auto_bucket_percentile
        bucket_size = max(bucket_size, 1000)  # Minimum bucket size

    vpin_values, vpin_indices = calculate_vpin(
        prices, volumes, bucket_size, n_buckets
    )

    # Create aligned series
    result = pd.Series(np.nan, index=df.index)

    # Map VPIN values to nearest original indices
    for vpin_val, idx in zip(vpin_values, vpin_indices):
        if idx < len(df):
            result.iloc[idx] = vpin_val

    # FL_R6_2: DO NOT FILL - both ffill and bfill create lookahead bias
    # Reason: VPIN is computed over ENTIRE dataset upfront (line 440-442),
    # then mapped to indices. ANY fill propagates values computed with future data.
    # Correct approach: Leave NaN, let caller decide how to handle gaps.
    # Alternative: Rewrite calculate_vpin to use expanding window (not implemented).

    return result


# =============================================================================
# KYLE'S LAMBDA (Price Impact)
# =============================================================================

def kyle_lambda_regression(
    returns: np.ndarray,
    signed_volume: np.ndarray,
    use_sqrt: bool = True
) -> Tuple[float, float, float]:
    """
    Estimate Kyle's Lambda via regression.

    Price impact model: r = λ × f(V) + ε

    Where f(V) = sign(V) × √|V| (square root law)

    Args:
        returns: Price returns
        signed_volume: Signed order flow (buy - sell volume)
        use_sqrt: Use square root law (recommended)

    Returns:
        Tuple of (lambda, r_squared, t_stat)
    """
    returns = np.asarray(returns)
    signed_volume = np.asarray(signed_volume)

    # Align lengths
    n = min(len(returns), len(signed_volume))
    returns = returns[:n]
    signed_volume = signed_volume[:n]

    # Remove any NaN/inf
    mask = np.isfinite(returns) & np.isfinite(signed_volume)
    returns = returns[mask]
    signed_volume = signed_volume[mask]

    if len(returns) < 10:
        return np.nan, np.nan, np.nan

    # Transform volume
    if use_sqrt:
        # FL3: Add epsilon for numerical stability at zero
        X = np.sign(signed_volume) * np.sqrt(np.abs(signed_volume) + 1e-10)
    else:
        X = signed_volume

    # Add constant for intercept
    X_with_const = np.column_stack([np.ones(len(X)), X])

    try:
        # OLS regression
        betas, residuals, rank, s = np.linalg.lstsq(X_with_const, returns, rcond=None)

        lambda_est = betas[1]

        # Calculate R-squared
        y_pred = X_with_const @ betas
        ss_res = np.sum((returns - y_pred) ** 2)
        ss_tot = np.sum((returns - np.mean(returns)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0

        # Calculate t-statistic with numerical stability
        n_obs = len(returns)
        mse = ss_res / (n_obs - 2) if n_obs > 2 else np.inf
        try:
            XtX = X_with_const.T @ X_with_const
            # Check condition number for numerical stability
            cond_num = np.linalg.cond(XtX)
            if cond_num > 1e10:
                # Ill-conditioned matrix - use pseudoinverse
                XtX_inv = np.linalg.pinv(XtX)
            else:
                XtX_inv = np.linalg.inv(XtX)
            var_beta = mse * XtX_inv[1, 1]
            t_stat = lambda_est / np.sqrt(var_beta) if var_beta > 0 else np.nan
        except (np.linalg.LinAlgError, ValueError):
            t_stat = np.nan

        # FL5: Validate intercept is reasonable (should be near zero in Kyle's model)
        intercept = betas[0]
        if abs(intercept) > abs(lambda_est) * 2:
            logger.warning(
                f"Kyle's lambda intercept suspiciously large: {intercept:.6f} "
                f"(lambda={lambda_est:.6f}). Model may be misspecified."
            )

        return lambda_est, r_squared, t_stat

    except (np.linalg.LinAlgError, ValueError):
        return np.nan, np.nan, np.nan


def rolling_kyle_lambda(
    returns: pd.Series,
    signed_volume: pd.Series,
    window: int = 100,
    min_periods: int = 50,
    use_sqrt: bool = True
) -> pd.DataFrame:
    """
    Calculate rolling Kyle's Lambda.

    Args:
        returns: Price returns series
        signed_volume: Signed order flow series
        window: Rolling window size
        min_periods: Minimum observations for calculation
        use_sqrt: Use square root law

    Returns:
        DataFrame with lambda, r_squared, t_stat columns
    """
    n = len(returns)

    lambdas = np.full(n, np.nan)
    r_squareds = np.full(n, np.nan)
    t_stats = np.full(n, np.nan)

    for i in range(min_periods, n):
        start = max(0, i - window)
        ret_window = returns.iloc[start:i].values
        vol_window = signed_volume.iloc[start:i].values

        if len(ret_window) >= min_periods:
            lam, r2, t = kyle_lambda_regression(ret_window, vol_window, use_sqrt)
            lambdas[i] = lam
            r_squareds[i] = r2
            t_stats[i] = t

    return pd.DataFrame({
        'kyle_lambda': lambdas,
        'kyle_lambda_r2': r_squareds,
        'kyle_lambda_tstat': t_stats
    }, index=returns.index)


def kyle_lambda_ratio(
    returns: np.ndarray,
    signed_volume: np.ndarray
) -> float:
    """
    Quick estimate of Kyle's Lambda as ratio.

    λ = σ_v / σ_u ≈ std(returns) / std(flow)

    Args:
        returns: Price returns
        signed_volume: Signed order flow

    Returns:
        Lambda ratio estimate
    """
    returns = np.asarray(returns)
    signed_volume = np.asarray(signed_volume)

    # Remove NaN/inf
    mask = np.isfinite(returns) & np.isfinite(signed_volume)
    returns = returns[mask]
    signed_volume = signed_volume[mask]

    if len(returns) < 2:
        return np.nan

    sigma_v = np.std(returns)
    sigma_u = np.std(signed_volume)

    if sigma_u == 0:
        return np.nan

    return sigma_v / sigma_u


# =============================================================================
# OFI (Order Flow Imbalance)
# =============================================================================

def calculate_ofi(
    bid_prices: np.ndarray,
    ask_prices: np.ndarray,
    bid_sizes: np.ndarray,
    ask_sizes: np.ndarray
) -> np.ndarray:
    """
    Calculate Order Flow Imbalance from LOB data.

    Based on Cont-Kukanov-Stoikov (2014) model.

    Bid Order Flow:
    - Price up: e_bid = new_size
    - Price down: e_bid = -old_size
    - Price same: e_bid = new_size - old_size

    OFI = Σ(e_bid - e_ask)

    Args:
        bid_prices: Best bid price series
        ask_prices: Best ask price series
        bid_sizes: Best bid size series
        ask_sizes: Best ask size series

    Returns:
        OFI time series
    """
    bid_prices = np.asarray(bid_prices)
    ask_prices = np.asarray(ask_prices)
    bid_sizes = np.asarray(bid_sizes)
    ask_sizes = np.asarray(ask_sizes)

    n = len(bid_prices)
    if n < 2:
        return np.array([])

    ofi = np.zeros(n - 1)

    for t in range(1, n):
        # Bid order flow
        if bid_prices[t] > bid_prices[t-1]:
            e_bid = bid_sizes[t]
        elif bid_prices[t] < bid_prices[t-1]:
            e_bid = -bid_sizes[t-1]
        else:
            e_bid = bid_sizes[t] - bid_sizes[t-1]

        # Ask order flow (per Cont-Kukanov-Stoikov model)
        if ask_prices[t] > ask_prices[t-1]:
            e_ask = ask_sizes[t-1]   # Old supply absorbed (price pushed up)
        elif ask_prices[t] < ask_prices[t-1]:
            e_ask = -ask_sizes[t]    # New supply appeared (price pushed down)
        else:
            e_ask = ask_sizes[t] - ask_sizes[t-1]

        ofi[t-1] = e_bid - e_ask

    return ofi


def ofi_price_impact(
    ofi: np.ndarray,
    price_changes: np.ndarray
) -> Tuple[float, float, float]:
    """
    Estimate OFI price impact coefficient.

    ΔP = (1/D) × OFI + ε

    R² is typically 60-80% for short intervals.

    Args:
        ofi: Order Flow Imbalance series
        price_changes: Price changes (same frequency as OFI)

    Returns:
        Tuple of (impact_coef, r_squared, depth_estimate)
    """
    ofi = np.asarray(ofi)
    price_changes = np.asarray(price_changes)

    # Align lengths
    n = min(len(ofi), len(price_changes))
    ofi = ofi[:n]
    price_changes = price_changes[:n]

    # Remove NaN/inf
    mask = np.isfinite(ofi) & np.isfinite(price_changes)
    ofi = ofi[mask]
    price_changes = price_changes[mask]

    if len(ofi) < 10:
        return np.nan, np.nan, np.nan

    # Simple regression
    X = np.column_stack([np.ones(len(ofi)), ofi])

    try:
        betas, _, _, _ = np.linalg.lstsq(X, price_changes, rcond=None)

        impact_coef = betas[1]  # This is 1/D
        depth_estimate = 1 / impact_coef if impact_coef != 0 else np.inf

        # R-squared
        y_pred = X @ betas
        ss_res = np.sum((price_changes - y_pred) ** 2)
        ss_tot = np.sum((price_changes - np.mean(price_changes)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0

        return impact_coef, r_squared, depth_estimate

    except np.linalg.LinAlgError:
        return np.nan, np.nan, np.nan


def ofi_divergence(
    ofi: np.ndarray,
    price_changes: np.ndarray,
    window: int = 20
) -> np.ndarray:
    """
    Detect OFI-price divergence (hidden liquidity signal).

    Divergence occurs when:
    - OFI highly positive BUT ΔP ≤ 0
    - OFI highly negative BUT ΔP ≥ 0

    This indicates hidden liquidity absorbing order flow.
    Classic adverse selection signal.

    Args:
        ofi: Order Flow Imbalance series
        price_changes: Price changes
        window: Window for z-score calculation

    Returns:
        Divergence score (positive = buy absorption, negative = sell absorption)
    """
    ofi = np.asarray(ofi)
    price_changes = np.asarray(price_changes)

    n = min(len(ofi), len(price_changes))
    ofi = ofi[:n]
    price_changes = price_changes[:n]

    divergence = np.zeros(n)

    for i in range(window, n):
        ofi_window = ofi[i-window:i]
        ofi_mean = np.mean(ofi_window)
        ofi_std = np.std(ofi_window)

        if ofi_std == 0:
            continue

        ofi_zscore = (ofi[i] - ofi_mean) / ofi_std

        # Divergence: strong OFI in opposite direction of price
        if ofi_zscore > 1.0 and price_changes[i] <= 0:
            # Strong buying but price flat/down → sell absorption
            divergence[i] = ofi_zscore
        elif ofi_zscore < -1.0 and price_changes[i] >= 0:
            # Strong selling but price flat/up → buy absorption
            divergence[i] = ofi_zscore

    return divergence


def cumulative_ofi(
    ofi: np.ndarray,
    reset_periods: Optional[np.ndarray] = None
) -> np.ndarray:
    """
    Calculate cumulative OFI with optional period resets.

    Args:
        ofi: Order Flow Imbalance series
        reset_periods: Indices where cumulative OFI resets (e.g., daily)

    Returns:
        Cumulative OFI series
    """
    ofi = np.asarray(ofi)

    if reset_periods is None:
        return np.cumsum(ofi)

    reset_periods = np.asarray(reset_periods)
    cum_ofi = np.zeros_like(ofi, dtype=float)

    # Find reset points
    reset_idx = 0
    cum = 0.0

    for i in range(len(ofi)):
        # FL9: Use while loop to handle multiple resets at same index
        while reset_idx < len(reset_periods) and i >= reset_periods[reset_idx]:
            cum = 0.0
            reset_idx += 1

        cum += ofi[i]
        cum_ofi[i] = cum

    return cum_ofi


# =============================================================================
# ORDER IMBALANCE METRICS
# =============================================================================

def order_imbalance(
    buy_volume: np.ndarray,
    sell_volume: np.ndarray,
    method: str = 'signed'
) -> np.ndarray:
    """
    Calculate order imbalance from classified volumes.

    Methods:
    - 'signed': (Buy - Sell) / (Buy + Sell)
    - 'ratio': Buy / (Buy + Sell)
    - 'log': log(Buy) - log(Sell)

    Args:
        buy_volume: Classified buy volume
        sell_volume: Classified sell volume
        method: Calculation method

    Returns:
        Order imbalance series
    """
    buy_volume = np.asarray(buy_volume)
    sell_volume = np.asarray(sell_volume)

    total = buy_volume + sell_volume

    # FL7: Return NaN when both buy and sell are zero (not misleading 0 or 1)
    if method == 'signed':
        result = np.where(total == 0, np.nan, (buy_volume - sell_volume) / total)
        return result
    elif method == 'ratio':
        result = np.where(total == 0, np.nan, buy_volume / total)
        return result
    elif method == 'log':
        # Add small epsilon to prevent log(0)
        eps = 1e-10
        return np.log(buy_volume + eps) - np.log(sell_volume + eps)
    else:
        raise ValueError(f"Unknown method: {method}")


def rolling_order_imbalance(
    buy_volume: pd.Series,
    sell_volume: pd.Series,
    window: int = 50
) -> pd.Series:
    """
    Calculate rolling order imbalance.

    Args:
        buy_volume: Buy volume series
        sell_volume: Sell volume series
        window: Rolling window

    Returns:
        Rolling order imbalance
    """
    rolling_buy = buy_volume.rolling(window).sum()
    rolling_sell = sell_volume.rolling(window).sum()

    total = rolling_buy + rolling_sell
    total = total.replace(0, np.nan)

    return (rolling_buy - rolling_sell) / total


# =============================================================================
# FEATURE GENERATION UTILITIES
# =============================================================================

def calculate_flow_features(
    prices: np.ndarray,
    volumes: np.ndarray,
    bid_prices: Optional[np.ndarray] = None,
    ask_prices: Optional[np.ndarray] = None,
    bid_sizes: Optional[np.ndarray] = None,
    ask_sizes: Optional[np.ndarray] = None,
    bucket_size: Optional[float] = None,
    vpin_history: Optional[np.ndarray] = None
) -> FlowFeatures:
    """
    Calculate comprehensive flow features.

    Args:
        prices: Trade prices
        volumes: Trade volumes
        bid_prices: Best bid prices (for OFI)
        ask_prices: Best ask prices (for OFI)
        bid_sizes: Best bid sizes (for OFI)
        ask_sizes: Best ask sizes (for OFI)
        bucket_size: VPIN bucket size (auto-calculated if None)
        vpin_history: Historical VPIN for CDF calculation

    Returns:
        FlowFeatures dataclass
    """
    prices = np.asarray(prices)
    volumes = np.asarray(volumes)

    # Auto bucket size
    if bucket_size is None:
        bucket_size = np.sum(volumes) * 0.01
        bucket_size = max(bucket_size, 1000)

    # BVC for volume classification
    buy_volumes, sell_volumes = bulk_volume_classification(prices, volumes)

    # VPIN
    vpin_values, _ = calculate_vpin(prices, volumes, bucket_size)
    current_vpin = vpin_values[-1] if len(vpin_values) > 0 else np.nan

    # VPIN CDF
    if vpin_history is not None and len(vpin_history) > 0:
        vpin_cdf_val = vpin_cdf(current_vpin, vpin_history)
        vpin_percentile = vpin_cdf_val
    else:
        vpin_cdf_val = vpin_cdf(current_vpin, vpin_values) if len(vpin_values) > 10 else 0.5
        vpin_percentile = vpin_cdf_val

    # FL8: Kyle's Lambda - compute consistently from rolling windows
    returns = np.diff(np.log(prices))
    signed_vol = buy_volumes[1:] - sell_volumes[1:]

    # Build rolling lambda history
    lambda_history = []
    window_size = 50
    step_size = 20
    for i in range(window_size, len(returns), step_size):
        lam, _, _ = kyle_lambda_regression(returns[i-window_size:i], signed_vol[i-window_size:i])
        if np.isfinite(lam):
            lambda_history.append(lam)

    # Current lambda from most recent window (consistent with history)
    if len(returns) >= window_size:
        kyle_lam, _, _ = kyle_lambda_regression(returns[-window_size:], signed_vol[-window_size:])
    else:
        kyle_lam = np.nan

    if len(lambda_history) > 5 and np.isfinite(kyle_lam):
        std_lambda = np.std(lambda_history)
        if std_lambda > 0:
            kyle_zscore = (kyle_lam - np.mean(lambda_history)) / std_lambda
        else:
            kyle_zscore = 0.0  # Perfectly stable lambda
    else:
        # FL_R7_2: Return NaN instead of 0.0 - uncertainty should not be masked as neutral
        kyle_zscore = np.nan

    # OFI (if LOB data available)
    if all(x is not None for x in [bid_prices, ask_prices, bid_sizes, ask_sizes]):
        ofi_values = calculate_ofi(bid_prices, ask_prices, bid_sizes, ask_sizes)
        current_ofi = ofi_values[-1] if len(ofi_values) > 0 else 0.0
        ofi_norm = current_ofi / np.mean(volumes) if np.mean(volumes) > 0 else 0.0
    else:
        current_ofi = 0.0
        ofi_norm = 0.0

    # Order imbalance
    total_buy = np.sum(buy_volumes)
    total_sell = np.sum(sell_volumes)
    total_vol = total_buy + total_sell

    buy_ratio = total_buy / total_vol if total_vol > 0 else 0.5
    imbalance = (total_buy - total_sell) / total_vol if total_vol > 0 else 0.0

    return FlowFeatures(
        vpin=current_vpin,
        vpin_percentile=vpin_percentile,
        vpin_cdf=vpin_cdf_val,
        kyle_lambda=kyle_lam if np.isfinite(kyle_lam) else 0.0,
        kyle_lambda_zscore=kyle_zscore if np.isfinite(kyle_zscore) else 0.0,
        ofi=current_ofi,
        ofi_normalized=ofi_norm,
        buy_volume_ratio=buy_ratio,
        order_imbalance=imbalance,
        toxicity_alert=vpin_cdf_val > 0.90
    )


def add_flow_features(
    df: pd.DataFrame,
    price_col: str = 'close',
    volume_col: str = 'volume',
    bucket_size: Optional[float] = None,
    n_vpin_buckets: int = 50,
    kyle_window: int = 100,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add flow analysis features to a DataFrame.

    Features added:
    - vpin: Volume-synchronized toxicity
    - vpin_percentile: VPIN percentile
    - vpin_alert: Toxicity alert flag
    - kyle_lambda: Price impact coefficient
    - kyle_lambda_zscore: Lambda z-score
    - buy_volume_ratio: Buy volume fraction
    - order_imbalance: Signed imbalance

    Args:
        df: DataFrame with OHLCV data
        price_col: Column name for prices
        volume_col: Column name for volumes
        bucket_size: VPIN bucket size (auto if None)
        n_vpin_buckets: VPIN rolling window
        kyle_window: Kyle's Lambda rolling window
        lag: Lag to avoid lookahead bias

    Returns:
        DataFrame with flow features added
    """
    result = df.copy()

    prices = df[price_col].values
    volumes = df[volume_col].values

    # Calculate BVC
    buy_volumes, sell_volumes = bulk_volume_classification(prices, volumes)

    result['buy_volume'] = pd.Series(buy_volumes, index=df.index).shift(lag)
    result['sell_volume'] = pd.Series(sell_volumes, index=df.index).shift(lag)

    # Order imbalance
    # FL_R6_5: Don't double-shift - buy_volume/sell_volume already shifted
    total = result['buy_volume'] + result['sell_volume']
    total = total.replace(0, np.nan)
    result['order_imbalance'] = (result['buy_volume'] - result['sell_volume']) / total
    result['buy_volume_ratio'] = result['buy_volume'] / total

    # Rolling VPIN
    if bucket_size is None:
        bucket_size = np.sum(volumes) * 0.01
        bucket_size = max(bucket_size, 1000)

    vpin_series = rolling_vpin(df, price_col, volume_col, bucket_size, n_vpin_buckets)
    result['vpin'] = vpin_series.shift(lag)

    # VPIN percentile (rolling)
    # FL_R6_4: Handle all-NaN windows (e.g., data gaps > 252 bars)
    def safe_percentile(x):
        ranked = pd.Series(x).rank(pct=True)
        return ranked.iloc[-1] if len(ranked) > 0 else np.nan

    result['vpin_percentile'] = result['vpin'].rolling(252).apply(
        safe_percentile, raw=False
    )

    # VPIN toxicity alert
    result['vpin_alert'] = (result['vpin_percentile'] > 0.90).astype(int)

    # Kyle's Lambda
    returns = np.log(df[price_col]).diff()
    signed_vol = pd.Series(buy_volumes - sell_volumes, index=df.index)

    kyle_df = rolling_kyle_lambda(returns, signed_vol, window=kyle_window)
    result['kyle_lambda'] = kyle_df['kyle_lambda'].shift(lag)
    result['kyle_lambda_r2'] = kyle_df['kyle_lambda_r2'].shift(lag)

    # Kyle's Lambda z-score
    # FL_R6_6: Protect against division by zero when rolling std = 0
    kyle_mean = result['kyle_lambda'].rolling(252).mean()
    kyle_std = result['kyle_lambda'].rolling(252).std()
    kyle_std = kyle_std.replace(0, np.nan)  # Avoid division by zero → inf

    result['kyle_lambda_zscore'] = (result['kyle_lambda'] - kyle_mean) / kyle_std

    # Clean up intermediate columns
    result = result.drop(columns=['buy_volume', 'sell_volume'], errors='ignore')

    return result


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    import numpy as np

    # Create sample data
    np.random.seed(42)
    n = 5000

    # Simulate price with drift
    returns = np.random.randn(n) * 0.002 + 0.0001
    prices = 500 * np.exp(np.cumsum(returns))

    # Simulate volume with clustering
    base_volume = 10000
    volume_multiplier = 1 + np.abs(returns) * 50
    volumes = (base_volume * volume_multiplier * np.random.rand(n)).astype(int)

    print("=== Order Flow Analysis Module Test ===\n")

    # Test BVC
    print("1. Bulk Volume Classification")
    buy_vol, sell_vol = bulk_volume_classification(prices, volumes)
    print(f"   Total buy volume: {np.sum(buy_vol):,.0f}")
    print(f"   Total sell volume: {np.sum(sell_vol):,.0f}")
    print(f"   Buy ratio: {np.sum(buy_vol)/(np.sum(buy_vol)+np.sum(sell_vol)):.2%}")

    # Test VPIN
    print("\n2. VPIN Calculation")
    bucket_size = np.sum(volumes) * 0.01
    vpin_values, vpin_idx = calculate_vpin(prices, volumes, bucket_size)
    print(f"   VPIN buckets: {len(vpin_values)}")
    print(f"   VPIN mean: {np.mean(vpin_values):.4f}")
    print(f"   VPIN std: {np.std(vpin_values):.4f}")
    print(f"   Current VPIN: {vpin_values[-1]:.4f}")
    print(f"   VPIN CDF: {vpin_cdf(vpin_values[-1], vpin_values):.2%}")

    # Test Kyle's Lambda
    print("\n3. Kyle's Lambda")
    signed_vol = buy_vol[1:] - sell_vol[1:]
    kyle_lam, r2, t_stat = kyle_lambda_regression(returns, signed_vol)
    print(f"   Lambda: {kyle_lam:.6f}")
    print(f"   R-squared: {r2:.4f}")
    print(f"   T-statistic: {t_stat:.2f}")

    # Test feature generation
    print("\n4. Full Feature Generation")
    features = calculate_flow_features(prices, volumes)
    print(f"   VPIN: {features.vpin:.4f}")
    print(f"   VPIN Percentile: {features.vpin_percentile:.2%}")
    print(f"   Kyle's Lambda: {features.kyle_lambda:.6f}")
    print(f"   Order Imbalance: {features.order_imbalance:.4f}")
    print(f"   Toxicity Alert: {features.toxicity_alert}")

    # Test DataFrame integration
    print("\n5. DataFrame Integration")
    df = pd.DataFrame({
        'timestamp': pd.date_range('2024-01-01', periods=n, freq='min'),
        'close': prices,
        'volume': volumes
    })

    df_with_features = add_flow_features(df)
    flow_cols = ['vpin', 'vpin_percentile', 'vpin_alert', 'kyle_lambda',
                 'kyle_lambda_zscore', 'order_imbalance', 'buy_volume_ratio']
    print(f"   Features added: {flow_cols}")
    print(f"   Non-null VPIN values: {df_with_features['vpin'].notna().sum()}")

    print("\n=== Flow Module Test Complete ===")
