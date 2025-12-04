#!/usr/bin/env python3
"""
Market Maker Inventory & Behavior Analysis
==========================================
Market Physics Engine - Layer 3 (Force Calculation) + Layer 4 (Causal Inference)

Market makers transform chaotic order flow into continuous prices through
inventory management. Their hedging is not discretionary - it's mathematically
forced. This creates predictable flows we can exploit:
- Mean reversion from inventory pressure
- Volatility regimes from gamma positioning
- Pinning at expiration

Key Models:
- Ho-Stoll: Reservation price from inventory risk
- Avellaneda-Stoikov: HFT optimal quoting
- Kyle's Lambda: Price impact coefficient
- NOPE: Net Options Pricing Effect

IMPORTANT: All features are computed with LAG to avoid lookahead bias.

Research Source: MARKET-MAKER-INVENTORY-RESEARCH.md
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import norm

logger = logging.getLogger("AlphaFactory.Features.MMInventory")


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class InventoryFeatures:
    """Container for MM inventory analysis features."""
    reservation_price: float          # Ho-Stoll reservation price
    inventory_pressure: float         # Inventory deviation from neutral
    inventory_zscore: float           # Z-score of inventory proxy
    predicted_reversion: str          # BULLISH_REVERSION, BEARISH_REVERSION, NEUTRAL
    nope: float                       # Net Options Pricing Effect
    nope_percentile: float            # NOPE percentile vs history
    nope_signal: str                  # BULLISH, BEARISH, NEUTRAL
    kyle_lambda: float                # Price impact coefficient


@dataclass
class GammaRegime:
    """Gamma regime classification."""
    regime: str                       # STRONG_LONG_GAMMA, NEUTRAL_GAMMA, SHORT_GAMMA
    mm_behavior: str                  # STABILIZING, MIXED, DESTABILIZING
    strategy: str                     # MEAN_REVERSION, WAIT, TREND_FOLLOWING
    vol_expectation: str              # LOW, NORMAL, HIGH
    gex_zscore: float                 # GEX z-score


@dataclass
class OptimalQuotes:
    """Avellaneda-Stoikov optimal quotes."""
    optimal_bid: float
    optimal_ask: float
    reservation_price: float
    optimal_spread: float
    inventory_skew: float


# =============================================================================
# HO-STOLL MODEL
# =============================================================================

def ho_stoll_reservation_price(
    mid_price: float,
    inventory: float,
    risk_aversion: float = 0.001,
    volatility: float = 0.02,
    time_to_close: float = 1.0
) -> float:
    """
    Calculate Ho-Stoll reservation price.

    r(S, Q) = S - Q × ρ × σ² × (T - t)

    The reservation price is where the dealer is indifferent to trading.
    - Long inventory (Q > 0): r < S → Quotes shift DOWN to attract buyers
    - Short inventory (Q < 0): r > S → Quotes shift UP to attract sellers

    Args:
        mid_price: Current market mid-price (S)
        inventory: Current inventory position (Q, + = long, - = short)
        risk_aversion: Dealer risk aversion parameter (ρ), typically 0.0001 to 0.01
        volatility: Asset volatility per period (σ)
        time_to_close: Time remaining until inventory close (T-t), in same units as volatility

    Returns:
        Reservation price
    """
    inventory_penalty = inventory * risk_aversion * (volatility ** 2) * time_to_close
    return mid_price - inventory_penalty


def ho_stoll_optimal_quotes(
    mid_price: float,
    inventory: float,
    risk_aversion: float = 0.001,
    volatility: float = 0.02,
    time_to_close: float = 1.0,
    base_spread: float = 0.01
) -> Tuple[float, float]:
    """
    Calculate Ho-Stoll optimal bid and ask quotes.

    Both quotes shift based on inventory (not just spread width).

    Args:
        mid_price: Current market mid-price
        inventory: Current inventory position
        risk_aversion: Dealer risk aversion
        volatility: Asset volatility
        time_to_close: Time remaining
        base_spread: Base spread width

    Returns:
        Tuple of (optimal_bid, optimal_ask)
    """
    reservation = ho_stoll_reservation_price(
        mid_price, inventory, risk_aversion, volatility, time_to_close
    )

    half_spread = base_spread / 2
    optimal_bid = reservation - half_spread
    optimal_ask = reservation + half_spread

    return optimal_bid, optimal_ask


def spread_decomposition(
    observed_spread: float,
    volatility: float,
    inventory_variance: float,
    informed_prob: float = 0.1,
    order_processing_cost: float = 0.0001
) -> Dict[str, float]:
    """
    Decompose observed spread into components.

    Spread = Order Processing + Inventory Risk + Adverse Selection

    Args:
        observed_spread: Observed bid-ask spread
        volatility: Asset volatility
        inventory_variance: Variance of inventory
        informed_prob: Probability of trading with informed counterparty
        order_processing_cost: Fixed cost component

    Returns:
        Dict with spread components
    """
    # Inventory risk component scales with volatility and inventory variance
    inventory_component = 2 * volatility * np.sqrt(inventory_variance)

    # Adverse selection component
    info_component = informed_prob * observed_spread

    # Order processing is remainder (minimum is fixed cost)
    order_component = max(
        order_processing_cost,
        observed_spread - inventory_component - info_component
    )

    # Normalize to sum to observed spread
    total = order_component + inventory_component + info_component
    if total > 0:
        scale = observed_spread / total
        order_component *= scale
        inventory_component *= scale
        info_component *= scale

    return {
        'order_processing': order_component,
        'inventory_risk': inventory_component,
        'adverse_selection': info_component,
        'total': observed_spread
    }


# =============================================================================
# AVELLANEDA-STOIKOV MODEL
# =============================================================================

def avellaneda_stoikov_quotes(
    mid_price: float,
    inventory: float,
    risk_aversion: float = 0.001,
    volatility: float = 0.02,
    time_remaining: float = 1.0,
    market_depth_k: float = 1.5
) -> OptimalQuotes:
    """
    Calculate optimal bid/ask quotes per Avellaneda-Stoikov HFT model.

    Reservation price: r = S - Q × γ × σ² × (T-t)
    Optimal spread: δ = (2/γ)ln(1 + γ/k) + γσ²(T-t)

    Args:
        mid_price: Current mid-price (S)
        inventory: Current inventory (Q)
        risk_aversion: Risk aversion parameter (γ)
        volatility: Asset volatility (σ)
        time_remaining: Time to horizon (T-t)
        market_depth_k: Market depth parameter (higher = thinner book)

    Returns:
        OptimalQuotes dataclass
    """
    # Reservation price
    inventory_skew = inventory * risk_aversion * (volatility ** 2) * time_remaining
    reservation = mid_price - inventory_skew

    # Optimal spread components
    spread_component = (2 / risk_aversion) * np.log(1 + risk_aversion / market_depth_k)
    vol_component = risk_aversion * (volatility ** 2) * time_remaining  # A-S (2008): γσ²τ, no 0.5
    half_spread = spread_component + vol_component

    optimal_bid = reservation - half_spread
    optimal_ask = reservation + half_spread
    optimal_spread = 2 * half_spread

    return OptimalQuotes(
        optimal_bid=optimal_bid,
        optimal_ask=optimal_ask,
        reservation_price=reservation,
        optimal_spread=optimal_spread,
        inventory_skew=inventory_skew
    )


def avellaneda_stoikov_order_intensity(
    distance_from_mid: float,
    baseline_intensity: float = 10.0,
    market_depth_k: float = 1.5
) -> float:
    """
    Calculate order arrival intensity at given price level.

    λ(δ) = A × exp(-k × δ)

    Args:
        distance_from_mid: Distance from mid-price (δ) in PRICE UNITS (not ticks or bps!)
                          MM2: CRITICAL - Must be absolute price distance, NOT relative
                          Example: If mid=$500 and quote=$505, δ=5.0 (not 0.01 or 1%)
        baseline_intensity: Base arrival rate (A) - orders per unit time
        market_depth_k: Depth parameter (k) in units of 1/price
                       Typical: k ≈ 0.1-1.0 for equity options

    Returns:
        Order arrival intensity (orders per unit time at this price level)

    Raises:
        ValueError: If distance_from_mid is negative
    """
    # MM2: Validate inputs
    if distance_from_mid < 0:
        raise ValueError(f"distance_from_mid must be >= 0, got {distance_from_mid}")

    return baseline_intensity * np.exp(-market_depth_k * distance_from_mid)


# =============================================================================
# KYLE'S LAMBDA (PRICE IMPACT)
# =============================================================================

def kyle_lambda(
    value_uncertainty: float,
    noise_trading_vol: float
) -> float:
    """
    Calculate Kyle's price impact parameter.

    λ = (1/2) × √(Σ₀/σᵤ²)

    Higher λ = higher price impact per unit of order flow.

    Args:
        value_uncertainty: Std dev of fundamental value uncertainty (√Σ₀)
        noise_trading_vol: Std dev of noise trading volume (σᵤ)

    Returns:
        Kyle's lambda
    """
    if noise_trading_vol <= 0:
        return np.inf

    # Kyle's Lambda formula: λ = (1/2) × √(Σ₀) / σᵤ
    # value_uncertainty is √Σ₀ (std dev of fundamental value)
    # The formula uses √Σ₀ directly, not Σ₀
    return 0.5 * value_uncertainty / noise_trading_vol


def kyle_optimal_order(
    private_value: float,
    public_price: float,
    kyle_lam: float
) -> float:
    """
    Calculate informed trader's optimal order size.

    x* = (v - p₀) / (2λ)

    Args:
        private_value: Informed trader's estimate of value (v)
        public_price: Current public price (p₀)
        kyle_lam: Kyle's lambda

    Returns:
        Optimal order size
    """
    if kyle_lam <= 0:
        return 0.0

    return (private_value - public_price) / (2 * kyle_lam)


def estimate_kyle_lambda_from_data(
    returns: np.ndarray,
    signed_volume: np.ndarray,
    use_sqrt_law: bool = True
) -> Tuple[float, float]:
    """
    Estimate Kyle's lambda empirically from returns and signed volume.

    Args:
        returns: Price returns
        signed_volume: Signed order flow (buy - sell)
        use_sqrt_law: Use square root law for volume transformation

    Returns:
        Tuple of (lambda_estimate, r_squared)
    """
    returns = np.asarray(returns)
    signed_volume = np.asarray(signed_volume)

    # Align
    n = min(len(returns), len(signed_volume))
    returns = returns[:n]
    signed_volume = signed_volume[:n]

    # Remove NaN/inf
    mask = np.isfinite(returns) & np.isfinite(signed_volume)
    returns = returns[mask]
    signed_volume = signed_volume[mask]

    if len(returns) < 10:
        return np.nan, np.nan

    # Transform volume
    if use_sqrt_law:
        X = np.sign(signed_volume) * np.sqrt(np.abs(signed_volume))
    else:
        X = signed_volume

    # OLS
    X_with_const = np.column_stack([np.ones(len(X)), X])

    try:
        betas, _, _, _ = np.linalg.lstsq(X_with_const, returns, rcond=None)
        lambda_est = betas[1]

        # R-squared
        y_pred = X_with_const @ betas
        ss_res = np.sum((returns - y_pred) ** 2)
        ss_tot = np.sum((returns - np.mean(returns)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0

        return lambda_est, r_squared
    except:
        return np.nan, np.nan


# =============================================================================
# INVENTORY PROXIES AND SIGNALS
# =============================================================================

def cumulative_delta(
    buy_volume: np.ndarray,
    sell_volume: np.ndarray,
    reset_daily: bool = False,
    daily_boundaries: Optional[np.ndarray] = None
) -> np.ndarray:
    """
    Calculate cumulative delta (buy - sell volume) as inventory proxy.

    Positive cumulative delta → MM is likely short (absorbed buying)
    Negative cumulative delta → MM is likely long (absorbed selling)

    Args:
        buy_volume: Buy volume series
        sell_volume: Sell volume series
        reset_daily: Reset cumulative sum daily
        daily_boundaries: Indices where days start (if reset_daily=True)

    Returns:
        Cumulative delta series
    """
    buy_volume = np.asarray(buy_volume)
    sell_volume = np.asarray(sell_volume)

    delta = buy_volume - sell_volume

    if not reset_daily:
        return np.cumsum(delta)

    # Reset at daily boundaries
    if daily_boundaries is None:
        return np.cumsum(delta)

    cum_delta = np.zeros_like(delta, dtype=float)
    boundary_idx = 0
    cum = 0.0

    for i in range(len(delta)):
        if boundary_idx < len(daily_boundaries) and i >= daily_boundaries[boundary_idx]:
            cum = 0.0
            boundary_idx += 1
        cum += delta[i]
        cum_delta[i] = cum

    return cum_delta


def inventory_zscore(
    inventory_proxy: np.ndarray,
    window: int = 100
) -> np.ndarray:
    """
    Calculate rolling z-score of inventory proxy.

    Args:
        inventory_proxy: Inventory proxy series (e.g., cumulative delta)
        window: Rolling window for mean/std calculation

    Returns:
        Z-score series
    """
    inventory_proxy = np.asarray(inventory_proxy)
    n = len(inventory_proxy)

    zscore = np.full(n, np.nan)

    for i in range(window, n):
        window_data = inventory_proxy[i-window:i]
        mean = np.mean(window_data)
        std = np.std(window_data)

        if std > 0:
            zscore[i] = (inventory_proxy[i] - mean) / std

    return zscore


def predict_inventory_reversion(
    cumulative_delta: np.ndarray,
    threshold_std: float = 2.0,
    window: int = 100
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Predict mean reversion based on MM inventory proxy.

    High cumulative delta → MM short → Price elevated → BEARISH reversion
    Low cumulative delta → MM long → Price depressed → BULLISH reversion

    Args:
        cumulative_delta: Cumulative delta series
        threshold_std: Z-score threshold for signal
        window: Window for z-score calculation

    Returns:
        Tuple of (signal_array, zscore_array)
        Signal: +1 = bullish reversion, -1 = bearish reversion, 0 = neutral
    """
    cumulative_delta = np.asarray(cumulative_delta)
    n = len(cumulative_delta)

    zscore = inventory_zscore(cumulative_delta, window)
    signal = np.zeros(n)

    # High positive zscore → MM short → bearish reversion expected
    signal[zscore > threshold_std] = -1

    # High negative zscore → MM long → bullish reversion expected
    signal[zscore < -threshold_std] = 1

    return signal, zscore


def rolling_inventory_pressure(
    buy_volume: pd.Series,
    sell_volume: pd.Series,
    window: int = 50
) -> pd.Series:
    """
    Calculate rolling inventory pressure indicator.

    Args:
        buy_volume: Buy volume series
        sell_volume: Sell volume series
        window: Rolling window

    Returns:
        Inventory pressure series (-1 to +1)
    """
    rolling_buy = buy_volume.rolling(window).sum()
    rolling_sell = sell_volume.rolling(window).sum()

    total = rolling_buy + rolling_sell
    total = total.replace(0, np.nan)

    # Pressure: positive if net selling (MM long), negative if net buying (MM short)
    pressure = (rolling_sell - rolling_buy) / total

    return pressure


# =============================================================================
# NOPE (NET OPTIONS PRICING EFFECT)
# =============================================================================

def calculate_nope(
    call_volumes: np.ndarray,
    call_deltas: np.ndarray,
    put_volumes: np.ndarray,
    put_deltas: np.ndarray,
    underlying_volume: float
) -> float:
    """
    Calculate Net Options Pricing Effect (NOPE).

    NOPE = [Σ(Call_Vol × Call_Δ) - Σ(Put_Vol × Put_Δ)] / Stock_Vol

    Interpretation:
    - Extreme positive NOPE → Excess call buying relative to stock liquidity
      → MMs short upside delta, hedged long stock
      → When momentum stalls → MMs unwind longs → Bearish reversal

    - Extreme negative NOPE → Excess put buying
      → MMs short downside delta, hedged short stock
      → When fear subsides → MMs unwind shorts → Bullish reversal

    Args:
        call_volumes: Call option volumes by strike
        call_deltas: Call deltas by strike
        put_volumes: Put option volumes by strike
        put_deltas: Put deltas by strike (should be negative)
        underlying_volume: Underlying stock volume

    Returns:
        NOPE value
    """
    call_volumes = np.asarray(call_volumes)
    call_deltas = np.asarray(call_deltas)
    put_volumes = np.asarray(put_volumes)
    put_deltas = np.asarray(put_deltas)

    if underlying_volume <= 0:
        return np.nan

    call_delta_volume = np.sum(call_volumes * call_deltas)
    put_delta_volume = np.sum(put_volumes * put_deltas)  # Put deltas are negative

    nope = (call_delta_volume - put_delta_volume) / underlying_volume

    return nope


def nope_signal(
    nope_value: float,
    nope_history: np.ndarray,
    extreme_percentile: float = 90
) -> Dict:
    """
    Generate NOPE-based trading signal.

    Args:
        nope_value: Current NOPE
        nope_history: Historical NOPE values
        extreme_percentile: Percentile for extreme classification

    Returns:
        Dict with signal information
    """
    nope_history = np.asarray(nope_history)
    nope_history = nope_history[np.isfinite(nope_history)]

    if len(nope_history) < 10:
        return {
            'signal': 'INSUFFICIENT_DATA',
            'percentile': 50.0,
            'nope_zscore': 0.0
        }

    percentile = stats.percentileofscore(nope_history, nope_value)
    zscore = (nope_value - np.mean(nope_history)) / np.std(nope_history)

    if percentile > extreme_percentile:
        signal = 'BEARISH'  # Extreme call buying → expect reversal down
        explanation = 'MMs heavily short delta (hedged long stock), unwinding imminent'
    elif percentile < (100 - extreme_percentile):
        signal = 'BULLISH'  # Extreme put buying → expect reversal up
        explanation = 'MMs heavily long delta (hedged short stock), covering imminent'
    else:
        signal = 'NEUTRAL'
        explanation = 'Normal options flow'

    return {
        'signal': signal,
        'percentile': percentile,
        'nope_zscore': zscore,
        'explanation': explanation
    }


# =============================================================================
# GAMMA REGIME ANALYSIS
# =============================================================================

def classify_gamma_regime(
    gex_value: float,
    gex_history: np.ndarray,
    low_percentile: float = 25,
    high_percentile: float = 75
) -> GammaRegime:
    """
    Classify current gamma regime based on GEX.

    High GEX (MM Long Gamma) → Stabilizing → Mean reversion, low vol
    Low/Negative GEX (MM Short Gamma) → Destabilizing → Trend following, high vol

    Args:
        gex_value: Current GEX value
        gex_history: Historical GEX values
        low_percentile: Threshold for short gamma classification
        high_percentile: Threshold for long gamma classification

    Returns:
        GammaRegime dataclass
    """
    gex_history = np.asarray(gex_history)
    gex_history = gex_history[np.isfinite(gex_history)]

    if len(gex_history) < 10:
        return GammaRegime(
            regime='INSUFFICIENT_DATA',
            mm_behavior='UNKNOWN',
            strategy='WAIT',
            vol_expectation='UNKNOWN',
            gex_zscore=0.0
        )

    percentiles = np.percentile(gex_history, [low_percentile, high_percentile])
    zscore = (gex_value - np.mean(gex_history)) / np.std(gex_history)

    if gex_value > percentiles[1]:
        return GammaRegime(
            regime='STRONG_LONG_GAMMA',
            mm_behavior='STABILIZING',
            strategy='MEAN_REVERSION',
            vol_expectation='LOW',
            gex_zscore=zscore
        )
    elif gex_value < percentiles[0]:
        return GammaRegime(
            regime='SHORT_GAMMA',
            mm_behavior='DESTABILIZING',
            strategy='TREND_FOLLOWING',
            vol_expectation='HIGH',
            gex_zscore=zscore
        )
    else:
        return GammaRegime(
            regime='NEUTRAL_GAMMA',
            mm_behavior='MIXED',
            strategy='WAIT_FOR_SIGNAL',
            vol_expectation='NORMAL',
            gex_zscore=zscore
        )


def gamma_flip_level(
    strikes: np.ndarray,
    call_gamma: np.ndarray,
    call_oi: np.ndarray,
    put_gamma: np.ndarray,
    put_oi: np.ndarray,
    spot_price: float
) -> Optional[float]:
    """
    Find the gamma flip level - where GEX changes sign.

    This is a critical price pivot point where MM behavior flips.

    Args:
        strikes: Strike prices
        call_gamma: Call gammas by strike
        call_oi: Call open interest by strike
        put_gamma: Put gammas by strike
        put_oi: Put open interest by strike
        spot_price: Current spot price

    Returns:
        Gamma flip strike level (or None if not found)
    """
    strikes = np.asarray(strikes)
    call_gamma = np.asarray(call_gamma)
    call_oi = np.asarray(call_oi)
    put_gamma = np.asarray(put_gamma)
    put_oi = np.asarray(put_oi)

    # GEX at each strike
    # GEX = Gamma × OI × 100 × S (contract multiplier × spot price)
    # Calls: MMs are typically short (sold calls), so gamma is positive for market
    # Puts: MMs are typically short (sold puts), but puts have negative delta effect
    # MM6 FIX: Use spot_price not strikes - GEX is dollar gamma at current spot
    gex_by_strike = (call_gamma * call_oi - put_gamma * put_oi) * 100 * spot_price

    # Find where GEX changes sign
    for i in range(1, len(strikes)):
        if gex_by_strike[i-1] * gex_by_strike[i] < 0:
            # Linear interpolation to find exact flip level
            flip = strikes[i-1] - gex_by_strike[i-1] * (strikes[i] - strikes[i-1]) / (gex_by_strike[i] - gex_by_strike[i-1])
            return float(flip)

    return None


def pinning_probability(
    strike: float,
    spot_price: float,
    volatility: float,
    time_to_expiry: float,
    open_interest: float,
    total_oi: float
) -> float:
    """
    Estimate probability of price pinning to a strike at expiry.

    Pinning is stronger when:
    - ATM gamma is high (concentrates near strike)
    - OI concentration is high at strike
    - Time to expiry is short

    Args:
        strike: Strike price to evaluate
        spot_price: Current spot price
        volatility: Implied volatility
        time_to_expiry: Time to expiration (years)
        open_interest: OI at this strike
        total_oi: Total OI across all strikes

    Returns:
        Pinning probability estimate (0 to 1)
    """
    if time_to_expiry <= 0 or total_oi <= 0:
        return 0.0

    # Moneyness factor (closer to ATM = higher pinning)
    moneyness = abs(np.log(spot_price / strike))
    moneyness_prob = np.exp(-moneyness / (volatility * np.sqrt(time_to_expiry)))

    # OI concentration factor
    oi_factor = open_interest / total_oi

    # MM3: Time decay factor (pinning strengthens near expiry)
    # Constant 50 assumes time_to_expiry in YEARS
    # At T=0.1yr (5 weeks), factor=0.0067 (weak pinning)
    # At T=0.02yr (1 week), factor=0.37 (moderate pinning)
    # At T=0.004yr (1 day), factor=0.82 (strong pinning)
    decay_constant = 50.0  # Unit: 1/years, calibrated for 1-week decay
    time_factor = np.exp(-time_to_expiry * decay_constant)

    # Combined estimate
    pin_prob = moneyness_prob * oi_factor * (1 + time_factor)
    pin_prob = min(pin_prob, 1.0)

    return pin_prob


# =============================================================================
# FEATURE GENERATION UTILITIES
# =============================================================================

def calculate_inventory_features(
    buy_volume: np.ndarray,
    sell_volume: np.ndarray,
    prices: np.ndarray,
    call_data: Optional[Dict] = None,
    put_data: Optional[Dict] = None,
    underlying_volume: Optional[float] = None,
    gex: Optional[float] = None,
    gex_history: Optional[np.ndarray] = None,
    window: int = 100
) -> InventoryFeatures:
    """
    Calculate comprehensive MM inventory features.

    Args:
        buy_volume: Buy volume series
        sell_volume: Sell volume series
        prices: Price series
        call_data: Dict with 'volumes' and 'deltas' arrays
        put_data: Dict with 'volumes' and 'deltas' arrays
        underlying_volume: Stock volume (for NOPE)
        gex: Current GEX value
        gex_history: Historical GEX
        window: Window for calculations

    Returns:
        InventoryFeatures dataclass
    """
    buy_volume = np.asarray(buy_volume)
    sell_volume = np.asarray(sell_volume)
    prices = np.asarray(prices)

    # Cumulative delta and inventory pressure
    cum_delta = cumulative_delta(buy_volume, sell_volume)
    signal, zscore = predict_inventory_reversion(cum_delta, threshold_std=2.0, window=window)

    current_zscore = zscore[-1] if len(zscore) > 0 else 0.0
    current_signal = signal[-1] if len(signal) > 0 else 0

    if current_signal > 0:
        reversion_pred = 'BULLISH_REVERSION'
    elif current_signal < 0:
        reversion_pred = 'BEARISH_REVERSION'
    else:
        reversion_pred = 'NEUTRAL'

    # Reservation price estimate
    inventory_proxy = cum_delta[-1] / np.mean(buy_volume + sell_volume) if len(cum_delta) > 0 else 0
    current_price = prices[-1]
    vol_estimate = np.std(np.diff(np.log(prices[-window:]))) if len(prices) > window else 0.02
    reservation = ho_stoll_reservation_price(
        current_price,
        inventory_proxy,
        risk_aversion=0.001,
        volatility=vol_estimate
    )

    # Inventory pressure
    inv_pressure = (np.sum(sell_volume[-window:]) - np.sum(buy_volume[-window:])) / np.sum(buy_volume[-window:] + sell_volume[-window:]) if np.sum(buy_volume[-window:] + sell_volume[-window:]) > 0 else 0

    # NOPE
    nope_value = 0.0
    nope_pct = 50.0
    nope_sig = 'NEUTRAL'

    if all(x is not None for x in [call_data, put_data, underlying_volume]):
        nope_value = calculate_nope(
            call_data['volumes'],
            call_data['deltas'],
            put_data['volumes'],
            put_data['deltas'],
            underlying_volume
        )

    # Kyle's Lambda estimate
    returns = np.diff(np.log(prices))
    signed_vol = buy_volume[1:] - sell_volume[1:]
    kyle_lam, _ = estimate_kyle_lambda_from_data(returns, signed_vol)

    return InventoryFeatures(
        reservation_price=reservation,
        inventory_pressure=inv_pressure,
        inventory_zscore=current_zscore if np.isfinite(current_zscore) else 0.0,
        predicted_reversion=reversion_pred,
        nope=nope_value if np.isfinite(nope_value) else 0.0,
        nope_percentile=nope_pct,
        nope_signal=nope_sig,
        kyle_lambda=kyle_lam if np.isfinite(kyle_lam) else 0.0
    )


def add_inventory_features(
    df: pd.DataFrame,
    buy_volume_col: str = 'buy_volume',
    sell_volume_col: str = 'sell_volume',
    price_col: str = 'close',
    window: int = 100,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add MM inventory analysis features to a DataFrame.

    Features added:
    - cumulative_delta: Running buy-sell imbalance
    - inventory_zscore: Z-score of cumulative delta
    - inventory_signal: Reversion signal (-1, 0, +1)
    - inventory_pressure: Rolling buy/sell pressure
    - reservation_spread: Deviation of reservation price from mid

    Args:
        df: DataFrame with volume and price data
        buy_volume_col: Buy volume column name
        sell_volume_col: Sell volume column name
        price_col: Price column name
        window: Rolling window
        lag: Lag to avoid lookahead bias

    Returns:
        DataFrame with inventory features added
    """
    result = df.copy()

    # Check if required columns exist
    if buy_volume_col not in df.columns or sell_volume_col not in df.columns:
        logger.warning(f"Buy/sell volume columns not found: {buy_volume_col}, {sell_volume_col}")
        return result

    buy_vol = df[buy_volume_col].values
    sell_vol = df[sell_volume_col].values
    prices = df[price_col].values

    # Cumulative delta
    cum_delta = cumulative_delta(buy_vol, sell_vol)
    result['cumulative_delta'] = pd.Series(cum_delta, index=df.index).shift(lag)

    # Inventory z-score
    inv_zscore = inventory_zscore(cum_delta, window)
    result['inventory_zscore'] = pd.Series(inv_zscore, index=df.index).shift(lag)

    # Inventory signal
    signal, _ = predict_inventory_reversion(cum_delta, threshold_std=2.0, window=window)
    result['inventory_signal'] = pd.Series(signal, index=df.index).shift(lag)

    # Rolling inventory pressure
    result['inventory_pressure'] = rolling_inventory_pressure(
        df[buy_volume_col], df[sell_volume_col], window
    ).shift(lag)

    # Estimate volatility for reservation price
    returns = np.log(df[price_col]).diff()
    rolling_vol = returns.rolling(window).std()

    # Reservation price spread
    def calc_reservation_spread(row):
        if pd.isna(row['cumulative_delta']) or pd.isna(rolling_vol.loc[row.name]):
            return np.nan

        # Normalize inventory
        avg_vol = df[buy_volume_col].rolling(window).mean().loc[row.name]
        if pd.isna(avg_vol) or avg_vol <= 0:
            return 0

        inv = row['cumulative_delta'] / avg_vol
        vol = rolling_vol.loc[row.name]
        price = row[price_col]

        reservation = ho_stoll_reservation_price(price, inv, 0.001, vol, 1.0)
        return (reservation - price) / price

    result['reservation_spread'] = result.apply(calc_reservation_spread, axis=1)

    return result


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    import numpy as np

    print("=== Market Maker Inventory Module Test ===\n")

    # Simulate trading data
    np.random.seed(42)
    n = 1000

    # Price simulation
    returns = np.random.randn(n) * 0.002 + 0.0001
    prices = 500 * np.exp(np.cumsum(returns))

    # Volume simulation with imbalance trends
    base_vol = 10000
    buy_volume = (base_vol * (1 + np.random.rand(n) * 0.5)).astype(int)
    sell_volume = (base_vol * (1 + np.random.rand(n) * 0.5)).astype(int)

    # Add a period of heavy buying (MM goes short)
    buy_volume[400:500] = (buy_volume[400:500] * 2).astype(int)

    print("1. Ho-Stoll Reservation Price")
    reservation = ho_stoll_reservation_price(
        mid_price=500,
        inventory=1000,  # Long 1000 shares
        risk_aversion=0.001,
        volatility=0.02,
        time_to_close=1.0
    )
    print(f"   Mid price: $500.00")
    print(f"   Inventory: +1000 shares (long)")
    print(f"   Reservation price: ${reservation:.2f}")
    print(f"   Spread shift: {500 - reservation:.4f} (down to attract buyers)")

    print("\n2. Avellaneda-Stoikov Optimal Quotes")
    quotes = avellaneda_stoikov_quotes(
        mid_price=500,
        inventory=-500,  # Short 500 shares
        risk_aversion=0.001,
        volatility=0.02,
        time_remaining=1.0,
        market_depth_k=1.5
    )
    print(f"   Optimal bid: ${quotes.optimal_bid:.2f}")
    print(f"   Optimal ask: ${quotes.optimal_ask:.2f}")
    print(f"   Optimal spread: ${quotes.optimal_spread:.4f}")
    print(f"   Inventory skew: ${quotes.inventory_skew:.4f}")

    print("\n3. Spread Decomposition")
    decomp = spread_decomposition(
        observed_spread=0.05,
        volatility=0.02,
        inventory_variance=0.0001,
        informed_prob=0.15
    )
    print(f"   Order processing: ${decomp['order_processing']:.4f}")
    print(f"   Inventory risk: ${decomp['inventory_risk']:.4f}")
    print(f"   Adverse selection: ${decomp['adverse_selection']:.4f}")

    print("\n4. Kyle's Lambda")
    kyle_lam = kyle_lambda(value_uncertainty=0.10, noise_trading_vol=0.50)
    print(f"   Lambda: {kyle_lam:.4f}")
    print(f"   Optimal order for $1 mispricing: {kyle_optimal_order(501, 500, kyle_lam):.0f} shares")

    print("\n5. Inventory Z-Score and Reversion Prediction")
    cum_delta = cumulative_delta(buy_volume, sell_volume)
    signal, zscore = predict_inventory_reversion(cum_delta, threshold_std=2.0)
    print(f"   Current cumulative delta: {cum_delta[-1]:,.0f}")
    print(f"   Current z-score: {zscore[-1]:.2f}")
    signal_map = {1: 'BULLISH_REVERSION', -1: 'BEARISH_REVERSION', 0: 'NEUTRAL'}
    print(f"   Signal: {signal_map.get(signal[-1], 'NEUTRAL')}")

    print("\n6. NOPE Calculation")
    # Simulate option data
    call_volumes = np.array([1000, 2000, 3000, 2000, 1000])  # 5 strikes
    call_deltas = np.array([0.9, 0.7, 0.5, 0.3, 0.1])
    put_volumes = np.array([500, 1000, 2000, 1500, 800])
    put_deltas = np.array([-0.1, -0.3, -0.5, -0.7, -0.9])
    underlying_vol = 50000

    nope = calculate_nope(call_volumes, call_deltas, put_volumes, put_deltas, underlying_vol)
    print(f"   NOPE: {nope:.4f}")

    nope_history = np.random.randn(100) * 0.02  # Simulated history
    nope_info = nope_signal(nope, nope_history)
    print(f"   NOPE percentile: {nope_info['percentile']:.1f}%")
    print(f"   NOPE signal: {nope_info['signal']}")

    print("\n7. Gamma Regime Classification")
    gex_history = np.random.randn(252) * 1e9  # Simulated GEX history
    current_gex = 2.5e9  # High positive GEX
    regime = classify_gamma_regime(current_gex, gex_history)
    print(f"   Regime: {regime.regime}")
    print(f"   MM behavior: {regime.mm_behavior}")
    print(f"   Strategy: {regime.strategy}")
    print(f"   Vol expectation: {regime.vol_expectation}")

    print("\n8. Pinning Probability")
    pin_prob = pinning_probability(
        strike=500,
        spot_price=499.5,
        volatility=0.20,
        time_to_expiry=1/252,  # 1 day
        open_interest=50000,
        total_oi=200000
    )
    print(f"   Strike: $500, Spot: $499.50, 1 DTE")
    print(f"   Pinning probability: {pin_prob:.2%}")

    print("\n9. Full Feature Calculation")
    features = calculate_inventory_features(
        buy_volume, sell_volume, prices, window=100
    )
    print(f"   Reservation price: ${features.reservation_price:.2f}")
    print(f"   Inventory pressure: {features.inventory_pressure:.4f}")
    print(f"   Inventory z-score: {features.inventory_zscore:.2f}")
    print(f"   Predicted reversion: {features.predicted_reversion}")
    print(f"   Kyle's lambda: {features.kyle_lambda:.6f}")

    print("\n10. DataFrame Integration")
    df = pd.DataFrame({
        'timestamp': pd.date_range('2024-01-01', periods=n, freq='min'),
        'close': prices,
        'buy_volume': buy_volume,
        'sell_volume': sell_volume
    })

    df_with_features = add_inventory_features(df)
    inv_cols = ['cumulative_delta', 'inventory_zscore', 'inventory_signal',
                'inventory_pressure', 'reservation_spread']
    print(f"   Features added: {inv_cols}")
    print(f"   Sample inventory z-score: {df_with_features['inventory_zscore'].iloc[-1]:.2f}")

    print("\n=== MM Inventory Module Test Complete ===")
