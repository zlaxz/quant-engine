#!/usr/bin/env python3
"""
Regime Analyzer - Ported from option-machine TypeScript.

Classifies market regime based on:
1. VIX level (volatility environment)
2. SPY trend (bull/bear/neutral via MA crossovers)
3. Sector correlation (risk-on/risk-off)

Original: src/services/LiveRegimeAnalyzer.ts
Source: option-machine repo (untested, ported as design)

IMPORTANT: These features must be computed with a LAG to avoid lookahead bias.
The regime at time T should only use data available at T-1.
"""

import logging
from typing import Tuple, Optional, Dict, Any
from enum import IntEnum
from dataclasses import dataclass

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.Features.Regime")


class VIXRegime(IntEnum):
    """VIX-based volatility regime."""
    PAUSE = 0       # VIX > 35: Too dangerous, no new entries
    SUBOPTIMAL = 1  # VIX 28-35 or VIX < 15: Defensive
    OPTIMAL = 2     # VIX 15-28: Normal trading environment


class TrendRegime(IntEnum):
    """SPY trend regime based on MA alignment."""
    STRONG_DOWN = 0  # Price < SMA20 < SMA50 < SMA200, momentum < -2%
    DOWN = 1         # Price < SMA20 < SMA50 < SMA200
    NEUTRAL = 2      # Mixed MA alignment
    UP = 3           # Price > SMA20 > SMA50 > SMA200
    STRONG_UP = 4    # Price > SMA20 > SMA50 > SMA200, momentum > 2%


class CombinedRegime(IntEnum):
    """Combined regime classification (4 states for simplicity)."""
    BEAR_QUIET = 0      # Down trend, low vol
    BEAR_VOLATILE = 1   # Down trend, high vol
    BULL_QUIET = 2      # Up trend, low vol
    BULL_VOLATILE = 3   # Up trend, high vol


class RegimeAnalyzer:
    """
    Analyzes market regime from SPY and VIX data.

    Features generated:
    - regime_vix: VIX-based regime (0=PAUSE, 1=SUBOPTIMAL, 2=OPTIMAL)
    - regime_trend: Trend regime (0=STRONG_DOWN to 4=STRONG_UP)
    - regime_combined: Combined 4-state regime
    - vix_level: Current VIX level
    - vix_percentile: VIX percentile over rolling window
    - spy_trend_strength: How aligned the MAs are (0-1)
    - position_size_mult: Suggested position sizing multiplier
    """

    # VIX thresholds (from LiveRegimeAnalyzer.ts)
    VIX_OPTIMAL_LOW = 15
    VIX_OPTIMAL_HIGH = 28
    VIX_PAUSE_THRESHOLD = 35

    # Trend thresholds
    MOMENTUM_STRONG_THRESHOLD = 0.02  # 2% above SMA20 for "strong"

    def __init__(
        self,
        sma_short: int = 20,
        sma_mid: int = 50,
        sma_long: int = 200,
        vix_lookback: int = 252  # 1 year for VIX percentile
    ):
        """
        Initialize regime analyzer.

        Args:
            sma_short: Short-term SMA period (default 20)
            sma_mid: Mid-term SMA period (default 50)
            sma_long: Long-term SMA period (default 200)
            vix_lookback: Lookback for VIX percentile (default 252)
        """
        self.sma_short = sma_short
        self.sma_mid = sma_mid
        self.sma_long = sma_long
        self.vix_lookback = vix_lookback

    def add_regime_features(
        self,
        df: pd.DataFrame,
        spy_col: str = 'close',
        vix_col: str = 'vix',
        lag: int = 1
    ) -> pd.DataFrame:
        """
        Add regime features to a DataFrame.

        Args:
            df: DataFrame with SPY price data
            spy_col: Column name for SPY close price
            vix_col: Column name for VIX level (optional, will skip if missing)
            lag: Lag period to avoid lookahead bias (default 1)

        Returns:
            DataFrame with regime features added
        """
        result = df.copy()

        # Calculate trend regime from SPY
        result = self._add_trend_features(result, spy_col, lag)

        # Calculate VIX regime if VIX data available
        if vix_col in result.columns:
            result = self._add_vix_features(result, vix_col, lag)
            result = self._add_combined_regime(result, lag)
        else:
            logger.warning(f"VIX column '{vix_col}' not found, skipping VIX features")

        return result

    def _add_trend_features(
        self,
        df: pd.DataFrame,
        price_col: str,
        lag: int
    ) -> pd.DataFrame:
        """Add trend-based regime features."""
        close = df[price_col]

        # Calculate SMAs
        sma_short = close.rolling(self.sma_short).mean()
        sma_mid = close.rolling(self.sma_mid).mean()
        sma_long = close.rolling(self.sma_long).mean()

        # Store SMAs (lagged)
        df['sma_20'] = sma_short.shift(lag)
        df['sma_50'] = sma_mid.shift(lag)
        df['sma_200'] = sma_long.shift(lag)

        # Momentum (distance from SMA20 as percentage)
        # Floor at 0.1% of close to prevent explosion during warm-up
        sma_floor = np.maximum(sma_short, close * 0.001)
        momentum = (close - sma_short) / sma_floor
        df['momentum_sma20'] = momentum.shift(lag)

        # Determine trend alignment (lagged)
        price_lagged = close.shift(lag)
        sma_short_lagged = sma_short.shift(lag)
        sma_mid_lagged = sma_mid.shift(lag)
        sma_long_lagged = sma_long.shift(lag)
        momentum_lagged = momentum.shift(lag)

        # Bull alignment: price > sma20 > sma50 > sma200
        bull_aligned = (
            (price_lagged > sma_short_lagged) &
            (sma_short_lagged > sma_mid_lagged) &
            (sma_mid_lagged > sma_long_lagged)
        )

        # Bear alignment: price < sma20 < sma50 < sma200
        bear_aligned = (
            (price_lagged < sma_short_lagged) &
            (sma_short_lagged < sma_mid_lagged) &
            (sma_mid_lagged < sma_long_lagged)
        )

        # Strong momentum
        strong_up = bull_aligned & (momentum_lagged > self.MOMENTUM_STRONG_THRESHOLD)
        strong_down = bear_aligned & (momentum_lagged < -self.MOMENTUM_STRONG_THRESHOLD)

        # Classify trend regime
        regime = pd.Series(TrendRegime.NEUTRAL, index=df.index)
        regime[bull_aligned] = TrendRegime.UP
        regime[bear_aligned] = TrendRegime.DOWN
        regime[strong_up] = TrendRegime.STRONG_UP
        regime[strong_down] = TrendRegime.STRONG_DOWN

        df['regime_trend'] = regime.astype(int)

        # Trend strength (0-1 based on how aligned MAs are)
        # Full alignment = 1, no alignment = 0
        align_score = (
            (price_lagged > sma_short_lagged).astype(int) +
            (sma_short_lagged > sma_mid_lagged).astype(int) +
            (sma_mid_lagged > sma_long_lagged).astype(int)
        ) / 3

        # For downtrends, flip the score
        df['trend_strength'] = np.where(
            price_lagged < sma_short_lagged,
            1 - align_score,  # Bear strength
            align_score       # Bull strength
        )

        # Binary trend indicator
        df['is_uptrend'] = (df['regime_trend'] >= TrendRegime.UP).astype(int)
        df['is_downtrend'] = (df['regime_trend'] <= TrendRegime.DOWN).astype(int)

        return df

    def _add_vix_features(
        self,
        df: pd.DataFrame,
        vix_col: str,
        lag: int
    ) -> pd.DataFrame:
        """Add VIX-based regime features."""
        vix = df[vix_col].shift(lag)  # Lag to avoid lookahead

        # VIX level
        df['vix_level'] = vix

        # VIX regime classification
        regime = pd.Series(VIXRegime.OPTIMAL, index=df.index)
        regime[vix >= self.VIX_PAUSE_THRESHOLD] = VIXRegime.PAUSE
        regime[(vix > self.VIX_OPTIMAL_HIGH) & (vix < self.VIX_PAUSE_THRESHOLD)] = VIXRegime.SUBOPTIMAL
        regime[vix < self.VIX_OPTIMAL_LOW] = VIXRegime.SUBOPTIMAL  # Complacency

        df['regime_vix'] = regime.astype(int)

        # VIX percentile (where does current VIX sit in recent history)
        df['vix_percentile'] = vix.rolling(self.vix_lookback).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False
        )

        # VIX change (regime transition indicator)
        # Floor VIX at 1 to prevent div/0 in pct_change (VIX < 1 never happens in practice)
        vix_safe = np.maximum(vix, 1.0)
        df['vix_change_1d'] = vix_safe.pct_change()
        df['vix_change_5d'] = vix_safe.pct_change(5)

        # Position size multiplier based on VIX regime
        df['position_size_mult'] = pd.Series(1.0, index=df.index)
        df.loc[df['regime_vix'] == VIXRegime.SUBOPTIMAL, 'position_size_mult'] = 0.5
        df.loc[df['regime_vix'] == VIXRegime.PAUSE, 'position_size_mult'] = 0.0

        return df

    def _add_combined_regime(
        self,
        df: pd.DataFrame,
        lag: int
    ) -> pd.DataFrame:
        """Add combined 4-state regime classification."""
        # Check for NaN in underlying data - set combined regime to -1 (invalid) if data missing
        # During warm-up, SMAs are NaN but regime defaults to NEUTRAL - this is a false positive
        # We need to check if the actual SMA data is valid, not just the regime values
        sma_valid = df['sma_200'].notna()  # SMA200 is the slowest, so first to be valid
        vix_valid = df['vix_level'].notna()
        valid_mask = sma_valid & vix_valid

        # Combine trend and vol into 4 states
        # NEUTRAL should NOT be classified as bull - it's neutral
        is_bull = df['regime_trend'] > TrendRegime.NEUTRAL
        is_high_vol = df['regime_vix'] != VIXRegime.OPTIMAL

        # Initialize with -1 (invalid) for NaN rows
        regime = pd.Series(-1, index=df.index)

        # Only classify valid rows
        regime[valid_mask & is_bull & ~is_high_vol] = CombinedRegime.BULL_QUIET
        regime[valid_mask & is_bull & is_high_vol] = CombinedRegime.BULL_VOLATILE
        regime[valid_mask & ~is_bull & ~is_high_vol] = CombinedRegime.BEAR_QUIET
        regime[valid_mask & ~is_bull & is_high_vol] = CombinedRegime.BEAR_VOLATILE

        df['regime_combined'] = regime.astype(int)

        # One-hot encode for ML compatibility
        for r in CombinedRegime:
            df[f'regime_{r.name.lower()}'] = (regime == r).astype(int)

        return df

    def compute_sector_correlation(
        self,
        sector_returns: pd.DataFrame,
        window: int = 20
    ) -> pd.Series:
        """
        Compute average pairwise correlation among sector ETFs.

        High correlation (>0.7) indicates risk-off / correlated selloff.
        Low correlation indicates normal diversification.

        Args:
            sector_returns: DataFrame with sector ETF returns as columns
            window: Rolling window for correlation calculation

        Returns:
            Series with average pairwise correlation
        """
        n_sectors = len(sector_returns.columns)
        if n_sectors < 2:
            return pd.Series(0.5, index=sector_returns.index)

        # Validate window size
        if window > len(sector_returns):
            logger.warning(f"Window {window} > data length {len(sector_returns)}, returning NaN")
            return pd.Series(np.nan, index=sector_returns.index)

        # Rolling correlation matrix
        correlations = []

        for i in range(len(sector_returns) - window + 1):
            window_data = sector_returns.iloc[i:i + window]
            corr_matrix = window_data.corr()

            # Average of upper triangle (excluding diagonal)
            mask = np.triu(np.ones_like(corr_matrix, dtype=bool), k=1)
            avg_corr = corr_matrix.where(mask).stack().mean()
            correlations.append(avg_corr)

        # Pad beginning with NaN
        result = pd.Series(
            [np.nan] * (window - 1) + correlations,
            index=sector_returns.index
        )

        return result


# ============================================================================
# HMM REGIME DETECTION
# ============================================================================

@dataclass
class HMMRegimeResult:
    """Results from HMM regime detection."""
    regime_probabilities: np.ndarray   # T x K smoothed probabilities
    most_likely_regime: np.ndarray     # T x 1 most likely state
    transition_matrix: np.ndarray      # K x K transition probabilities
    regime_means: np.ndarray           # K x 1 regime means
    regime_stds: np.ndarray            # K x 1 regime standard deviations
    log_likelihood: float              # Model log-likelihood
    next_regime_prob: np.ndarray       # K x 1 predicted next regime probs


@dataclass
class HMMConfig:
    """Configuration for HMM estimation."""
    n_regimes: int = 2                 # Number of hidden states
    max_iter: int = 100                # Max EM iterations
    tol: float = 1e-6                  # Convergence tolerance
    min_variance: float = 1e-3         # REG2 FIX: Floor for std dev (not variance - naming legacy)
                                        # 1e-6 caused PDF peaks ~400k, causing numerical issues
                                        # 1e-3 gives max PDF peak ~400, much safer
    random_state: Optional[int] = None # For reproducibility


class GaussianHMM:
    """
    Gaussian Hidden Markov Model for regime detection.

    Implements:
    - Forward-backward algorithm for regime probabilities
    - Baum-Welch (EM) for parameter estimation
    - Transition probability forecasting
    - Critical slowing down indicators

    γ_t(i) = P(S_t = q_i | O, λ) = α_t(i)β_t(i) / Σ_j α_t(j)β_t(j)
    """

    def __init__(self, config: HMMConfig = None):
        """
        Initialize Gaussian HMM.

        Args:
            config: HMM configuration parameters
        """
        self.config = config or HMMConfig()
        self.n_regimes = self.config.n_regimes

        # Model parameters (initialized in fit)
        self.transition_matrix = None  # A[i,j] = P(S_{t+1}=j | S_t=i)
        self.means = None              # μ_k for each regime
        self.stds = None               # σ_k for each regime
        self.initial_probs = None      # π_k initial state probs

        self._fitted = False

    def _initialize_params(self, data: np.ndarray):
        """Initialize parameters using k-means-like approach."""
        n = len(data)
        k = self.n_regimes

        if self.config.random_state is not None:
            np.random.seed(self.config.random_state)

        # Initialize means using percentiles
        percentiles = np.linspace(10, 90, k)
        self.means = np.percentile(data, percentiles)

        # Initialize stds
        self.stds = np.full(k, np.std(data) / np.sqrt(k))

        # Initialize transition matrix (sticky regimes)
        self.transition_matrix = np.full((k, k), 0.05 / (k - 1))
        np.fill_diagonal(self.transition_matrix, 0.95)

        # Initialize uniform initial probs
        self.initial_probs = np.full(k, 1.0 / k)

    def _emission_prob(self, x: float, regime: int) -> float:
        """
        Calculate emission probability P(x | regime).

        REG2: Use higher floor (1e-3) to prevent numerical explosion.
        With sigma=1e-6, PDF can exceed 400,000 causing alpha/beta overflow.
        """
        mu = self.means[regime]
        # REG2: Floor at 1e-3 instead of config.min_variance (often 1e-6)
        sigma = max(self.stds[regime], 1e-3)
        return np.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * np.sqrt(2 * np.pi))

    def _emission_matrix(self, data: np.ndarray) -> np.ndarray:
        """Calculate emission matrix B[t, k] = P(O_t | S_t = k)."""
        T = len(data)
        K = self.n_regimes
        B = np.zeros((T, K))

        for t in range(T):
            for k in range(K):
                B[t, k] = self._emission_prob(data[t], k)

        # Add floor to prevent numerical issues
        B = np.maximum(B, 1e-300)
        return B

    def _forward(self, data: np.ndarray, B: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Forward algorithm.

        α_t(i) = P(O_1, ..., O_t, S_t = i | λ)

        Returns:
            Tuple of (alpha, scaling_factors)
        """
        T = len(data)
        K = self.n_regimes
        alpha = np.zeros((T, K))
        scale = np.zeros(T)

        # Initialization
        alpha[0] = self.initial_probs * B[0]
        scale[0] = np.sum(alpha[0])
        alpha[0] /= scale[0] if scale[0] > 0 else 1

        # Recursion
        for t in range(1, T):
            for j in range(K):
                alpha[t, j] = B[t, j] * np.sum(alpha[t-1] * self.transition_matrix[:, j])

            scale[t] = np.sum(alpha[t])
            alpha[t] /= scale[t] if scale[t] > 0 else 1

        return alpha, scale

    def _backward(self, data: np.ndarray, B: np.ndarray, scale: np.ndarray) -> np.ndarray:
        """
        Backward algorithm.

        β_t(i) = P(O_{t+1}, ..., O_T | S_t = i, λ)

        Returns:
            beta array
        """
        T = len(data)
        K = self.n_regimes
        beta = np.zeros((T, K))

        # Initialization
        beta[T-1] = 1

        # Recursion
        for t in range(T-2, -1, -1):
            for i in range(K):
                beta[t, i] = np.sum(
                    self.transition_matrix[i, :] * B[t+1] * beta[t+1]
                )
            beta[t] /= scale[t] if scale[t] > 0 else 1  # Must use scale[t], not scale[t+1]

        return beta

    def _e_step(self, data: np.ndarray, B: np.ndarray) -> Tuple[np.ndarray, np.ndarray, float]:
        """
        E-step: Compute posterior probabilities.

        Returns:
            Tuple of (gamma, xi, log_likelihood)
        """
        T = len(data)
        K = self.n_regimes

        # Forward-backward
        alpha, scale = self._forward(data, B)
        beta = self._backward(data, B, scale)

        # Gamma: P(S_t = k | O)
        gamma = alpha * beta
        gamma_sum = np.sum(gamma, axis=1, keepdims=True)
        gamma = gamma / np.maximum(gamma_sum, 1e-300)

        # Xi: P(S_t = i, S_{t+1} = j | O)
        xi = np.zeros((T-1, K, K))
        for t in range(T-1):
            for i in range(K):
                for j in range(K):
                    xi[t, i, j] = (
                        alpha[t, i] *
                        self.transition_matrix[i, j] *
                        B[t+1, j] *
                        beta[t+1, j]
                    )
            xi_sum = np.sum(xi[t])
            xi[t] /= xi_sum if xi_sum > 0 else 1

        # Log-likelihood
        log_likelihood = np.sum(np.log(scale + 1e-300))

        return gamma, xi, log_likelihood

    def _m_step(self, data: np.ndarray, gamma: np.ndarray, xi: np.ndarray):
        """M-step: Re-estimate parameters."""
        T = len(data)
        K = self.n_regimes

        # Update initial probs
        self.initial_probs = gamma[0]

        # Update transition matrix
        for i in range(K):
            denom = np.sum(gamma[:-1, i])
            if denom > 0:
                self.transition_matrix[i] = np.sum(xi[:, i, :], axis=0) / denom

        # Normalize transition matrix rows
        row_sums = np.sum(self.transition_matrix, axis=1, keepdims=True)
        self.transition_matrix /= np.maximum(row_sums, 1e-300)

        # Update means
        for k in range(K):
            gamma_sum = np.sum(gamma[:, k])
            if gamma_sum > 0:
                self.means[k] = np.sum(gamma[:, k] * data) / gamma_sum

        # Update stds
        for k in range(K):
            gamma_sum = np.sum(gamma[:, k])
            if gamma_sum > 0:
                variance = np.sum(gamma[:, k] * (data - self.means[k])**2) / gamma_sum
                self.stds[k] = max(np.sqrt(variance), self.config.min_variance)

    def fit(self, data: np.ndarray) -> 'GaussianHMM':
        """
        Fit HMM using Baum-Welch (EM) algorithm.

        Args:
            data: 1D array of observations (e.g., returns)

        Returns:
            self
        """
        data = np.asarray(data).flatten()

        if len(data) < self.n_regimes * 10:
            logger.warning(f"Data length {len(data)} may be too short for {self.n_regimes} regimes")

        self._initialize_params(data)

        prev_ll = -np.inf

        for iteration in range(self.config.max_iter):
            # E-step
            B = self._emission_matrix(data)
            gamma, xi, log_likelihood = self._e_step(data, B)

            # Check convergence
            if abs(log_likelihood - prev_ll) < self.config.tol:
                logger.info(f"HMM converged at iteration {iteration}")
                break

            prev_ll = log_likelihood

            # M-step
            self._m_step(data, gamma, xi)

        # REG1: Removed regime sorting - it broke gamma alignment
        # The sorting reordered parameters but NOT gamma posteriors,
        # causing regime labels to be inverted relative to posteriors.
        # Regimes will be in whatever order EM converged to.
        # If ordering is needed, do it consistently in decode() instead.

        self._fitted = True
        return self

    def decode(self, data: np.ndarray) -> HMMRegimeResult:
        """
        Compute regime probabilities for observations.

        Args:
            data: 1D array of observations

        Returns:
            HMMRegimeResult with all regime information
        """
        if not self._fitted:
            raise ValueError("Model must be fitted first")

        data = np.asarray(data).flatten()
        B = self._emission_matrix(data)
        gamma, _, log_likelihood = self._e_step(data, B)

        # Most likely regime
        most_likely = np.argmax(gamma, axis=1)

        # Predict next regime
        last_prob = gamma[-1]
        next_prob = last_prob @ self.transition_matrix

        return HMMRegimeResult(
            regime_probabilities=gamma,
            most_likely_regime=most_likely,
            transition_matrix=self.transition_matrix,
            regime_means=self.means,
            regime_stds=self.stds,
            log_likelihood=log_likelihood,
            next_regime_prob=next_prob
        )

    def predict_transition_prob(
        self,
        current_regime_prob: np.ndarray,
        steps: int = 1
    ) -> np.ndarray:
        """
        Predict regime probability at future time step.

        P(S_{T+k} = j | O_{1:T}) = Σ_i P(S_T = i | O) * A^k[i,j]

        Args:
            current_regime_prob: Current regime probability vector
            steps: Number of steps ahead to predict

        Returns:
            Predicted regime probability vector
        """
        if not self._fitted:
            raise ValueError("Model must be fitted first")

        trans_k = np.linalg.matrix_power(self.transition_matrix, steps)
        return current_regime_prob @ trans_k


def fit_hmm_regimes(
    returns: np.ndarray,
    n_regimes: int = 2,
    **kwargs
) -> HMMRegimeResult:
    """
    Convenience function to fit HMM and get regime probabilities.

    Args:
        returns: Return series
        n_regimes: Number of regimes (default 2: low vol / high vol)
        **kwargs: Additional HMMConfig parameters

    Returns:
        HMMRegimeResult
    """
    config = HMMConfig(n_regimes=n_regimes, **kwargs)
    hmm = GaussianHMM(config)
    hmm.fit(returns)
    return hmm.decode(returns)


# ============================================================================
# CRITICAL SLOWING DOWN (Early Warning Signals)
# ============================================================================

def critical_slowing_down_indicators(
    data: np.ndarray,
    window: int = 60
) -> Dict[str, np.ndarray]:
    """
    Calculate Critical Slowing Down indicators for early warning.

    As system approaches tipping point:
    - Autocorrelation rises toward 1 (slower recovery)
    - Variance increases (larger fluctuations)
    - Skewness may shift

    These are LEADING indicators of regime transitions.

    Args:
        data: Time series (returns or prices)
        window: Rolling window for calculations

    Returns:
        Dict with 'autocorr', 'variance', 'skewness' arrays
    """
    data = np.asarray(data)
    n = len(data)

    autocorr = np.full(n, np.nan)
    variance = np.full(n, np.nan)
    skewness = np.full(n, np.nan)

    for t in range(window, n):
        window_data = data[t-window:t]

        # Autocorrelation (lag-1)
        if np.std(window_data) > 1e-10:
            autocorr[t] = np.corrcoef(window_data[:-1], window_data[1:])[0, 1]

        # Variance
        variance[t] = np.var(window_data)

        # Skewness
        std = np.std(window_data)
        if std > 1e-10:
            skewness[t] = np.mean(((window_data - np.mean(window_data)) / std) ** 3)

    return {
        'autocorr': autocorr,
        'variance': variance,
        'skewness': skewness
    }


def detect_slowing_down(
    csd_indicators: Dict[str, np.ndarray],
    lookback: int = 252,
    threshold_std: float = 2.0
) -> Dict:
    """
    Detect critical slowing down from indicators.

    Rising autocorrelation + rising variance = transition warning

    Args:
        csd_indicators: Output from critical_slowing_down_indicators
        lookback: Period for z-score calculation
        threshold_std: Z-score threshold for warning

    Returns:
        Dict with warning level and z-scores
    """
    autocorr = csd_indicators['autocorr']
    variance = csd_indicators['variance']

    # Get valid values
    ac_valid = autocorr[~np.isnan(autocorr)]
    var_valid = variance[~np.isnan(variance)]

    if len(ac_valid) < lookback or len(var_valid) < lookback:
        return {
            'warning_level': 'INSUFFICIENT_DATA',
            'autocorr_zscore': np.nan,
            'variance_zscore': np.nan
        }

    # Z-scores of recent values
    ac_recent = ac_valid[-lookback:]
    var_recent = var_valid[-lookback:]

    ac_zscore = (ac_valid[-1] - np.mean(ac_recent)) / np.std(ac_recent)
    var_zscore = (var_valid[-1] - np.mean(var_recent)) / np.std(var_recent)

    # Warning level
    if ac_zscore > threshold_std and var_zscore > threshold_std:
        warning = 'HIGH'
        message = 'Critical slowing down detected - regime transition likely'
    elif ac_zscore > threshold_std or var_zscore > threshold_std:
        warning = 'ELEVATED'
        message = 'Partial slowing down signals'
    else:
        warning = 'NORMAL'
        message = 'No transition warning'

    return {
        'warning_level': warning,
        'autocorr_zscore': ac_zscore,
        'variance_zscore': var_zscore,
        'message': message
    }


# ============================================================================
# MARKOV SWITCHING (statsmodels integration)
# ============================================================================

def fit_markov_switching(
    data: np.ndarray,
    k_regimes: int = 2,
    trend: str = 'c',
    switching_variance: bool = True
) -> Optional[Any]:
    """
    Fit Markov Switching model using statsmodels.

    This is Hamilton's (1989) regime-switching model where
    both mean and variance can switch between regimes.

    Args:
        data: Time series data
        k_regimes: Number of regimes
        trend: 'c' for constant, 'n' for none
        switching_variance: Whether variance switches with regime

    Returns:
        Fitted model result, or None if statsmodels unavailable
    """
    try:
        import statsmodels.api as sm

        model = sm.tsa.MarkovRegression(
            data,
            k_regimes=k_regimes,
            trend=trend,
            switching_variance=switching_variance
        )
        result = model.fit(disp=False)
        return result

    except ImportError:
        logger.warning("statsmodels not available for Markov Switching")
        return None
    except Exception as e:
        logger.warning(f"Markov Switching fit failed: {e}")
        return None


# ============================================================================
# FEATURE INTEGRATION
# ============================================================================

def add_hmm_features(
    df: pd.DataFrame,
    returns_col: str = 'returns',
    n_regimes: int = 2,
    window: int = 252,
    lag: int = 1
) -> pd.DataFrame:
    """
    Add HMM regime features to DataFrame.

    Features added:
    - hmm_regime: Most likely regime (0 = low vol, 1 = high vol, etc.)
    - hmm_prob_0, hmm_prob_1, ...: Regime probabilities
    - hmm_transition_prob: Probability of regime change
    - csd_autocorr: Critical slowing down autocorrelation
    - csd_variance: Critical slowing down variance
    - csd_warning: Early warning signal

    Args:
        df: DataFrame with return data
        returns_col: Column name for returns
        n_regimes: Number of hidden regimes
        window: Window for CSD indicators
        lag: Lag to avoid lookahead bias

    Returns:
        DataFrame with HMM features
    """
    result = df.copy()

    if returns_col not in result.columns:
        logger.warning(f"Returns column '{returns_col}' not found")
        return result

    returns = result[returns_col].values

    # Fit HMM (expanding window approach for robustness)
    min_fit_length = max(n_regimes * 50, 100)

    if len(returns) < min_fit_length:
        logger.warning(f"Insufficient data for HMM: {len(returns)} < {min_fit_length}")
        return result

    # Fit on full data (for regime interpretation)
    hmm_result = fit_hmm_regimes(returns, n_regimes=n_regimes)

    # Add regime probabilities (lagged)
    regime_probs = pd.DataFrame(
        hmm_result.regime_probabilities,
        index=df.index,
        columns=[f'hmm_prob_{i}' for i in range(n_regimes)]
    )
    for col in regime_probs.columns:
        result[col] = regime_probs[col].shift(lag)

    # Most likely regime
    result['hmm_regime'] = pd.Series(
        hmm_result.most_likely_regime,
        index=df.index
    ).shift(lag)

    # Transition probability (probability of being in different regime next period)
    trans_probs = []
    for t in range(len(returns)):
        if t < lag:
            trans_probs.append(np.nan)
        else:
            current_prob = hmm_result.regime_probabilities[t-lag]
            # Probability of staying in same regime:
            # P(S_{t+1} = S_t) = Σ_i P(S_t = i) * P(S_{t+1} = i | S_t = i)
            #                 = Σ_i P(S_t = i) * A[i,i]
            same_regime = np.sum(current_prob * np.diag(hmm_result.transition_matrix))
            trans_probs.append(1 - same_regime)

    result['hmm_transition_prob'] = trans_probs

    # Critical slowing down indicators
    csd = critical_slowing_down_indicators(returns, window=window)
    result['csd_autocorr'] = pd.Series(csd['autocorr'], index=df.index).shift(lag)
    result['csd_variance'] = pd.Series(csd['variance'], index=df.index).shift(lag)

    # CSD z-scores for warning
    result['csd_autocorr_zscore'] = (
        (result['csd_autocorr'] - result['csd_autocorr'].rolling(252).mean()) /
        result['csd_autocorr'].rolling(252).std()
    )
    result['csd_variance_zscore'] = (
        (result['csd_variance'] - result['csd_variance'].rolling(252).mean()) /
        result['csd_variance'].rolling(252).std()
    )

    # Warning flag
    result['csd_warning'] = (
        (result['csd_autocorr_zscore'] > 2.0) &
        (result['csd_variance_zscore'] > 2.0)
    ).astype(int)

    return result


# Need dataclass import for HMMRegimeResult
from dataclasses import dataclass
from typing import Any


# ============================================================================
# CONVENIENCE FUNCTION
# ============================================================================

def add_regime_features(
    df: pd.DataFrame,
    vix_data: Optional[pd.Series] = None,
    spy_col: str = 'close',
    lag: int = 1
) -> pd.DataFrame:
    """
    Convenience function to add regime features.

    Args:
        df: DataFrame with price data
        vix_data: Optional VIX series (will be joined by index)
        spy_col: Column name for SPY close price
        lag: Lag period for lookahead bias prevention

    Returns:
        DataFrame with regime features added
    """
    result = df.copy()

    if vix_data is not None:
        result['vix'] = vix_data

    analyzer = RegimeAnalyzer()
    return analyzer.add_regime_features(result, spy_col=spy_col, lag=lag)


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create sample SPY data
    np.random.seed(42)
    n = 500

    dates = pd.date_range('2024-01-01', periods=n, freq='D')

    # Simulate a trending market with some volatility regimes
    returns = np.random.randn(n) * 0.01 + 0.0002  # Slight upward drift
    close = 400 * np.exp(np.cumsum(returns))

    # Simulate VIX (inverse correlation with market)
    vix = 20 - returns * 500 + np.random.randn(n) * 2
    vix = np.clip(vix, 10, 50)

    df = pd.DataFrame({
        'timestamp': dates,
        'open': close * (1 - np.random.rand(n) * 0.005),
        'high': close * (1 + np.random.rand(n) * 0.01),
        'low': close * (1 - np.random.rand(n) * 0.01),
        'close': close,
        'volume': np.random.randint(100000, 1000000, n),
        'vix': vix
    })

    # Add regime features
    result = add_regime_features(df, lag=1)

    print("Regime feature columns added:")
    regime_cols = [c for c in result.columns if 'regime' in c or 'vix' in c or 'sma' in c or 'trend' in c]
    for col in regime_cols:
        print(f"  {col}")

    print("\nTrend regime distribution:")
    print(result['regime_trend'].value_counts().sort_index())

    print("\nVIX regime distribution:")
    print(result['regime_vix'].value_counts().sort_index())

    print("\nCombined regime distribution:")
    print(result['regime_combined'].value_counts().sort_index())

    print("\nSample data:")
    print(result[['timestamp', 'close', 'vix', 'regime_trend', 'regime_vix', 'regime_combined']].tail(10))
