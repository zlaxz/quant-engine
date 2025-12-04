"""
Black-Scholes Greeks calculation for European options.

Implements:
- Delta: Rate of change of option price with respect to underlying price
- Gamma: Rate of change of delta with respect to underlying price
- Vega: Rate of change of option price with respect to volatility
- Theta: Rate of change of option price with respect to time
- Charm: Rate of change of delta with respect to time (dDelta/dTime)
- Vanna: Rate of change of delta with respect to volatility (dDelta/dVol = dVega/dSpot)

Assumptions:
- European-style options (no early exercise)
- No dividends
- Constant risk-free rate and volatility
- Log-normal distribution of underlying prices
"""

import numpy as np
from scipy.stats import norm
from typing import Literal, Tuple

# Minimum values to prevent numerical instability
MIN_SIGMA = 1e-6  # Minimum volatility (0.0001%)
MIN_PRICE = 1e-6  # Minimum price ($0.000001)
MIN_TIME = 1e-10  # Minimum time to prevent division issues


def _validate_inputs(S: float, K: float, T: float, sigma: float) -> Tuple[bool, str]:
    """
    Validate Black-Scholes inputs.

    Returns:
        (is_valid, error_message)
    """
    if S <= 0:
        return False, f"Spot price must be positive, got {S}"
    if K <= 0:
        return False, f"Strike must be positive, got {K}"
    if T < 0:
        return False, f"Time to expiration must be non-negative, got {T}"
    if sigma < 0:
        return False, f"Volatility must be non-negative, got {sigma}"
    return True, ""


def _safe_d1(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate d1 with edge case handling.

    Handles:
    - sigma=0: Return +/- infinity based on moneyness (or 0 for ATM)
    - T=0: Return 0
    - S=0 or K=0: Caught by validation
    """
    if T <= MIN_TIME:
        return 0.0

    if sigma < MIN_SIGMA:
        # With zero volatility, option is deterministic
        # Deep ITM -> d1 = +inf, Deep OTM -> d1 = -inf, ATM -> d1 = 0
        intrinsic = S - K  # For calls; puts would be K - S
        if intrinsic > MIN_PRICE:
            return 10.0  # Cap at 10 to avoid inf issues
        elif intrinsic < -MIN_PRICE:
            return -10.0
        else:
            return 0.0

    return (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))


def _calculate_d1(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate d1 term in Black-Scholes formula.

    d1 = (ln(S/K) + (r + 0.5*sigma^2)*T) / (sigma * sqrt(T))

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)

    Returns:
    --------
    float
        d1 value
    """
    # Delegate to safe version which handles T=0 and sigma=0 edge cases
    return _safe_d1(S, K, T, r, sigma)


def _calculate_d2(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate d2 term in Black-Scholes formula.

    d2 = d1 - sigma * sqrt(T)

    Parameters: Same as _calculate_d1

    Returns:
    --------
    float
        d2 value
    """
    if T <= 0:
        return 0.0

    d1 = _calculate_d1(S, K, T, r, sigma)
    return d1 - sigma * np.sqrt(T)


def calculate_delta(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: Literal['call', 'put']
) -> float:
    """
    Calculate option delta using Black-Scholes model.

    Delta measures the rate of change of option price with respect to underlying price.

    Call Delta = N(d1)           (ranges from 0 to 1)
    Put Delta = N(d1) - 1        (ranges from -1 to 0)

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)
    option_type : str
        'call' or 'put'

    Returns:
    --------
    float
        Option delta
    """
    if T <= 0:
        # At expiration: ITM = 1/-1, OTM = 0
        if option_type == 'call':
            return 1.0 if S > K else 0.0
        else:
            return -1.0 if S < K else 0.0

    d1 = _calculate_d1(S, K, T, r, sigma)

    if option_type == 'call':
        return norm.cdf(d1)
    else:
        return norm.cdf(d1) - 1.0


def calculate_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate option gamma using Black-Scholes model.

    Gamma measures the rate of change of delta with respect to underlying price.
    Gamma is the same for both calls and puts.

    Gamma = n(d1) / (S * sigma * sqrt(T))

    where n(x) is the standard normal PDF.

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)

    Returns:
    --------
    float
        Option gamma
    """
    # Guard against T=0 and near-expiry explosion (sqrt(T) in denominator)
    if T <= MIN_TIME:
        # At/near expiration, gamma = 0 (delta is discontinuous)
        return 0.0

    # Guard against sigma=0 division
    if sigma < MIN_SIGMA:
        return 0.0  # Zero vol = deterministic payoff, no gamma

    d1 = _calculate_d1(S, K, T, r, sigma)
    return norm.pdf(d1) / (S * sigma * np.sqrt(T))


def calculate_vega(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate option vega using Black-Scholes model.

    Vega measures the rate of change of option price with respect to volatility.
    Vega is the same for both calls and puts.

    Vega = S * n(d1) * sqrt(T)

    where n(x) is the standard normal PDF.

    Note: This returns raw mathematical vega (per 1 unit = 100% change in σ).
    If σ moves from 0.20 to 0.21 (1%), multiply vega by 0.01 to get the P&L.

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)

    Returns:
    --------
    float
        Option vega (raw - per 1 unit/100% change in volatility)
    """
    if T <= 0:
        # At expiration, vega = 0 (no time value)
        return 0.0

    d1 = _calculate_d1(S, K, T, r, sigma)
    # Raw mathematical vega: S × N'(d1) × √T
    # This is per 1 unit (100%) change in σ - caller scales as needed
    return S * norm.pdf(d1) * np.sqrt(T)


def calculate_theta(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: Literal['call', 'put']
) -> float:
    """
    Calculate option theta using Black-Scholes model.

    Theta measures the rate of change of option price with respect to time (time decay).
    Theta is typically negative (options lose value as time passes).

    Call Theta = -(S * n(d1) * sigma) / (2 * sqrt(T)) - r * K * exp(-r*T) * N(d2)
    Put Theta = -(S * n(d1) * sigma) / (2 * sqrt(T)) + r * K * exp(-r*T) * N(-d2)

    Note: This returns theta per year. Divide by 365 for daily theta.

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)
    option_type : str
        'call' or 'put'

    Returns:
    --------
    float
        Option theta (per year)
    """
    # Guard against T=0 and near-expiry explosion (sqrt(T) in denominator)
    if T <= MIN_TIME:
        # At/near expiration, theta is undefined (no time value left)
        return 0.0

    d1 = _calculate_d1(S, K, T, r, sigma)
    d2 = _calculate_d2(S, K, T, r, sigma)

    # Common term for both calls and puts
    common_term = -(S * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))

    if option_type == 'call':
        return common_term - r * K * np.exp(-r * T) * norm.cdf(d2)
    else:
        return common_term + r * K * np.exp(-r * T) * norm.cdf(-d2)


def calculate_charm(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: Literal['call', 'put']
) -> float:
    """
    Calculate option charm using Black-Scholes model.

    Charm measures the rate of change of delta with respect to time (delta decay).
    Also known as DdeltaDtime.

    For calls: charm = -phi(d1) * (r / (sigma * sqrt(T)) - d2 / (2*T))
    For puts: charm_put = charm_call + phi(d1) / (sigma * sqrt(T))

    where phi(x) is the standard normal PDF.

    Note: Charm is typically negative for ATM calls (delta decays as time passes).
    This returns charm per year. Divide by 365 for daily charm.

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)
    option_type : str
        'call' or 'put'

    Returns:
    --------
    float
        Option charm (per year)
    """
    # Guard against T=0 and near-expiry explosion (sqrt(T) and T in denominators)
    if T <= MIN_TIME:
        # At/near expiration, charm is undefined (delta is discontinuous)
        return 0.0

    # Guard against sigma=0 division
    if sigma < MIN_SIGMA:
        return 0.0  # Zero vol = deterministic, no delta decay

    d1 = _calculate_d1(S, K, T, r, sigma)
    d2 = _calculate_d2(S, K, T, r, sigma)

    # Standard normal PDF at d1
    phi_d1 = norm.pdf(d1)

    # Call charm formula (standard Black-Scholes)
    # charm = -phi(d1) * (r / (sigma * sqrt(T)) - d2 / (2*T))
    call_charm = -phi_d1 * (r / (sigma * np.sqrt(T)) - d2 / (2 * T))

    if option_type == 'call':
        return call_charm
    else:
        # Put charm = call charm + phi(d1) / (sigma * sqrt(T))
        return call_charm + phi_d1 / (sigma * np.sqrt(T))


def calculate_vanna(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate option vanna using Black-Scholes model.

    Vanna measures the rate of change of delta with respect to volatility.
    Also measures the rate of change of vega with respect to underlying price.
    Vanna = dDelta/dVol = dVega/dSpot

    Vanna = (vega / S) * (1 - d1 / (sigma * sqrt(T)))
          = phi(d1) * sqrt(T) * (1 - d1 / (sigma * sqrt(T)))

    where phi(x) is the standard normal PDF.

    Vanna is the same for both calls and puts.

    Note: Vanna measures how delta sensitivity changes with volatility changes.
    Can be positive or negative depending on moneyness.

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)

    Returns:
    --------
    float
        Option vanna
    """
    # Guard against T=0 and near-expiry explosion (sqrt(T) in denominator)
    if T <= MIN_TIME:
        # At/near expiration, vanna = 0 (no volatility sensitivity)
        return 0.0

    # Guard against sigma=0 division
    if sigma < MIN_SIGMA:
        return 0.0  # Zero vol = deterministic, no vanna

    d1 = _calculate_d1(S, K, T, r, sigma)

    # Standard normal PDF at d1
    phi_d1 = norm.pdf(d1)

    # Vanna = phi(d1) * sqrt(T) * (1 - d1 / (sigma * sqrt(T)))
    # Or equivalently: (vega / S) * (1 - d1 / (sigma * sqrt(T)))
    sqrt_T = np.sqrt(T)
    vanna = phi_d1 * sqrt_T * (1 - d1 / (sigma * sqrt_T))

    return vanna


def calculate_price(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: Literal['call', 'put']
) -> float:
    """
    Calculate option price using Black-Scholes model.

    Call = S * N(d1) - K * exp(-r*T) * N(d2)
    Put = K * exp(-r*T) * N(-d2) - S * N(-d1)

    Parameters:
    -----------
    S : float
        Current underlying price
    K : float
        Strike price
    T : float
        Time to expiration in years
    r : float
        Risk-free interest rate (annualized)
    sigma : float
        Implied volatility (annualized)
    option_type : str
        'call' or 'put'

    Returns:
    --------
    float
        Theoretical option price
    """
    if T <= 0:
        # At expiration, price is intrinsic value
        if option_type == 'call':
            return max(0.0, S - K)
        else:
            return max(0.0, K - S)

    d1 = _calculate_d1(S, K, T, r, sigma)
    d2 = _calculate_d2(S, K, T, r, sigma)

    if option_type == 'call':
        return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    else:
        return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def calculate_all_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: Literal['call', 'put']
) -> dict:
    """
    Calculate price and all Greeks for an option in one call.

    Parameters: Same as individual Greek functions

    Returns:
    --------
    dict
        Dictionary with keys: 'price', 'delta', 'gamma', 'vega', 'theta', 'charm', 'vanna'
    """
    return {
        'price': calculate_price(S, K, T, r, sigma, option_type),
        'delta': calculate_delta(S, K, T, r, sigma, option_type),
        'gamma': calculate_gamma(S, K, T, r, sigma),
        'vega': calculate_vega(S, K, T, r, sigma),
        'theta': calculate_theta(S, K, T, r, sigma, option_type),
        'charm': calculate_charm(S, K, T, r, sigma, option_type),
        'vanna': calculate_vanna(S, K, T, r, sigma)
    }
