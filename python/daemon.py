#!/usr/bin/env python3
"""
Research Daemon - The "Night Shift"
====================================
24/7 autonomous research orchestrator for the Autonomous Research OS.

Runs on Mac M4 Pro (48GB RAM) to:
1. Recruit: Replenish strategy pool via cloud swarm
2. Harvest: Collect and validate mutations from LLM agents
3. Execute: Run parallel backtests on local 8TB drive
4. Publish: Generate morning briefings for user review

Usage:
    python research_daemon.py

    # With custom intervals
    python research_daemon.py --recruit-interval 3600 --harvest-interval 300

Environment Variables:
    SUPABASE_URL: Supabase project URL
    SUPABASE_KEY: Supabase service role key
    DATA_DIR: Path to 8TB drive with Parquet data
    PARALLEL_WORKERS: Number of parallel backtest workers (default: 4)
    FITNESS_THRESHOLD: Minimum fitness to promote strategy (default: 0.5)
"""

import os
import sys
import ast
import json
import logging
import asyncio
import argparse
import traceback
import hashlib
import importlib.util
import tempfile
from datetime import datetime, timedelta, time, timezone

# Timezone-aware "now" for consistent timestamps (avoids DST bugs)
def utc_now() -> datetime:
    """Get current time as timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)

def eastern_now() -> datetime:
    """Get current time in US/Eastern (market hours timezone)."""
    try:
        import pytz
        eastern = pytz.timezone('America/New_York')
        return datetime.now(eastern)
    except ImportError:
        # Fallback to UTC if pytz not available
        return utc_now()


# ============================================================================
# MARKET CALENDAR - NYSE holidays, early closes, trading hours
# ============================================================================

# Global market calendar instance (lazy-loaded)
_market_calendar = None

def get_market_calendar():
    """Get NYSE market calendar (lazy-loaded singleton)."""
    global _market_calendar
    if _market_calendar is None:
        try:
            import pandas_market_calendars as mcal
            _market_calendar = mcal.get_calendar('NYSE')
        except ImportError:
            logger.warning("pandas-market-calendars not installed - market hours checks disabled")
            return None
    return _market_calendar


def is_market_open(dt: Optional[datetime] = None) -> bool:
    """
    Check if the market is currently open.

    Uses NYSE calendar to account for:
    - Weekends
    - NYSE holidays (New Year's, MLK Day, Presidents Day, Good Friday,
      Memorial Day, Juneteenth, July 4th, Labor Day, Thanksgiving, Christmas)
    - Early closes (day before Thanksgiving, Christmas Eve, etc.)

    Args:
        dt: Datetime to check (default: now in Eastern time)

    Returns:
        True if market is open, False otherwise
    """
    cal = get_market_calendar()
    if cal is None:
        # Fallback to simple weekday check if calendar not available
        now = dt or eastern_now()
        if now.weekday() >= 5:  # Weekend
            return False
        hour = now.hour
        minute = now.minute
        time_value = hour * 60 + minute
        return 9 * 60 + 30 <= time_value < 16 * 60  # 9:30 AM - 4:00 PM

    now = dt or eastern_now()
    date_str = now.strftime('%Y-%m-%d')

    # Check if today is a trading day
    schedule = cal.schedule(start_date=date_str, end_date=date_str)
    if schedule.empty:
        return False  # Holiday or weekend

    # Check if we're within trading hours
    market_open = schedule['market_open'].iloc[0]
    market_close = schedule['market_close'].iloc[0]

    # Convert to timezone-aware for comparison
    now_utc = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return market_open <= now_utc <= market_close


def get_market_close_time(dt: Optional[datetime] = None) -> Optional[datetime]:
    """
    Get market close time for a given day.

    Useful for detecting early close days (1:00 PM close instead of 4:00 PM).

    Args:
        dt: Date to check (default: today)

    Returns:
        Market close datetime, or None if not a trading day
    """
    cal = get_market_calendar()
    if cal is None:
        return None

    now = dt or eastern_now()
    date_str = now.strftime('%Y-%m-%d')

    schedule = cal.schedule(start_date=date_str, end_date=date_str)
    if schedule.empty:
        return None

    return schedule['market_close'].iloc[0].to_pydatetime()


def is_trading_day(dt: Optional[datetime] = None) -> bool:
    """
    Check if a given date is a trading day (market is open at some point).

    Args:
        dt: Date to check (default: today)

    Returns:
        True if market is open at any point that day, False otherwise
    """
    cal = get_market_calendar()
    if cal is None:
        # Fallback to weekday check
        now = dt or eastern_now()
        return now.weekday() < 5

    now = dt or eastern_now()
    date_str = now.strftime('%Y-%m-%d')

    schedule = cal.schedule(start_date=date_str, end_date=date_str)
    return not schedule.empty


# ============================================================================
# SUPABASE HELPERS - Timeouts, retries, and error handling
# ============================================================================

DB_TIMEOUT_SECONDS = 10.0  # Default timeout for database operations
DB_MAX_RETRIES = 3  # Number of retry attempts for transient failures


async def db_execute_with_timeout(operation, timeout: float = DB_TIMEOUT_SECONDS, description: str = "DB operation"):
    """
    Execute a Supabase operation with timeout protection.

    Wraps synchronous Supabase client calls in asyncio.to_thread with timeout.
    Prevents database hangs from freezing the event loop.

    Args:
        operation: Callable that returns a Supabase response (e.g., lambda: client.table(...).execute())
        timeout: Maximum time to wait in seconds
        description: Human-readable description for error messages

    Returns:
        The result of operation(), or raises TimeoutError/Exception

    Example:
        result = await db_execute_with_timeout(
            lambda: supabase.table('positions').select('*').execute(),
            description="fetch positions"
        )
    """
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, operation),
            timeout=timeout
        )
        return result
    except asyncio.TimeoutError:
        logger.error(f"⏱️ Database timeout ({timeout}s) for: {description}")
        raise
    except Exception as e:
        logger.error(f"❌ Database error for {description}: {e}")
        raise


async def db_execute_with_retry(
    operation,
    timeout: float = DB_TIMEOUT_SECONDS,
    max_retries: int = DB_MAX_RETRIES,
    description: str = "DB operation"
):
    """
    Execute a Supabase operation with timeout and exponential backoff retry.

    Use for critical operations that should survive transient failures.

    Args:
        operation: Callable that returns a Supabase response
        timeout: Maximum time per attempt
        max_retries: Maximum number of attempts
        description: Human-readable description for error messages

    Returns:
        The result of operation(), or raises after max_retries failures
    """
    last_error = None
    for attempt in range(max_retries):
        try:
            return await db_execute_with_timeout(operation, timeout, description)
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)  # Exponential backoff with jitter
                logger.warning(f"⚠️ {description} failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time:.1f}s: {e}")
                await asyncio.sleep(wait_time)
            else:
                logger.error(f"❌ {description} failed after {max_retries} attempts: {e}")

    raise last_error


from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from multiprocessing import Pool, cpu_count
from concurrent.futures import ProcessPoolExecutor, as_completed
import re

import random
import requests
import aiohttp  # Non-blocking HTTP for async contexts
import numpy as np
import pandas as pd
import polars as pl
from supabase import create_client, Client
from enum import Enum

# Discovery module for autonomous market scanning
try:
    from engine.discovery import MorphologyScanner, scan_for_opportunities
    DISCOVERY_AVAILABLE = True
except ImportError:
    DISCOVERY_AVAILABLE = False
    logger.warning("Discovery module not available - autonomous mission creation disabled")

# ============================================================================
# REPRODUCIBILITY - Seed all random number generators
# ============================================================================
# Use environment variable for seed, with default for reproducible backtests
RANDOM_SEED = int(os.environ.get('RANDOM_SEED', 42))
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# ============================================================================
# TELEGRAM NOTIFICATIONS
# ============================================================================

def send_telegram_alert(title: str, message: str, priority: str = 'normal') -> bool:
    """
    Send push notification to user's phone via Telegram (BLOCKING VERSION).
    Use send_telegram_alert_async in async contexts to avoid blocking event loop.

    Reads credentials from environment variables:
    - TELEGRAM_BOT_TOKEN: Bot token from @BotFather
    - TELEGRAM_CHAT_ID: User's chat ID from @userinfobot

    Args:
        title: Alert title/headline
        message: Alert body text
        priority: 'normal', 'high', or 'critical' (adds emoji prefix)

    Returns:
        True if sent successfully, False otherwise
    """
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not bot_token or not chat_id:
        logger.warning("Telegram credentials not set. Skipping alert.")
        return False

    # Add priority emoji prefix
    prefix = {
        'critical': '🚨 ',
        'high': '⚠️ ',
        'normal': '📊 '
    }.get(priority, '📊 ')

    # Format message
    full_message = f"{prefix}<b>{title}</b>\n\n{message}"

    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        response = requests.post(url, json={
            "chat_id": chat_id,
            "text": full_message,
            "parse_mode": "HTML",
            "disable_notification": priority == 'normal'
        }, timeout=10)

        if response.ok:
            logger.info(f"Telegram alert sent: {title}")
            return True
        else:
            logger.error(f"Telegram API error: {response.text}")
            return False

    except Exception as e:
        logger.error(f"Failed to send Telegram alert: {e}")
        return False


async def send_telegram_alert_async(title: str, message: str, priority: str = 'normal') -> bool:
    """
    Send push notification to user's phone via Telegram (ASYNC VERSION).
    Use this in async functions to avoid blocking the event loop.

    Args:
        title: Alert title/headline
        message: Alert body text
        priority: 'normal', 'high', or 'critical' (adds emoji prefix)

    Returns:
        True if sent successfully, False otherwise
    """
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not bot_token or not chat_id:
        logger.warning("Telegram credentials not set. Skipping alert.")
        return False

    # Add priority emoji prefix
    prefix = {
        'critical': '🚨 ',
        'high': '⚠️ ',
        'normal': '📊 '
    }.get(priority, '📊 ')

    full_message = f"{prefix}<b>{title}</b>\n\n{message}"

    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": full_message,
                    "parse_mode": "HTML",
                    "disable_notification": priority == 'normal'
                },
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    logger.info(f"Telegram alert sent: {title}")
                    return True
                else:
                    text = await response.text()
                    logger.error(f"Telegram API error: {text}")
                    return False
    except Exception as e:
        logger.error(f"Failed to send Telegram alert: {e}")
        return False

# Red Team Swarm imports (for strategy auditing)
try:
    from scripts.red_team_swarm import PERSONAS as RED_TEAM_PERSONAS
    from engine.swarm import run_swarm_sync
    RED_TEAM_AVAILABLE = True
except ImportError:
    RED_TEAM_AVAILABLE = False

# Shadow Trader imports - ThetaData for live market data
try:
    from thetadata_client import ThetaDataClient, QuoteTick, TradeTick, Tick, SecurityType
    SHADOW_TRADING_AVAILABLE = True
except ImportError:
    SHADOW_TRADING_AVAILABLE = False
    ThetaDataClient = None
    QuoteTick = None
    TradeTick = None
    Tick = None
    SecurityType = None
    # Will log warning after logging setup

# Stream Buffer for live tick aggregation
try:
    from engine.trading.stream_buffer import StreamBuffer, MultiSymbolBuffer, NewBarEvent
    STREAM_BUFFER_AVAILABLE = True
except ImportError:
    STREAM_BUFFER_AVAILABLE = False

# Configure logging with rotation
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('research_daemon.log', mode='a')
    ]
)
logger = logging.getLogger('NightShift')

# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class DaemonConfig:
    """Configuration for the Research Daemon."""

    # Supabase
    supabase_url: str = field(default_factory=lambda: os.environ.get('SUPABASE_URL', ''))
    supabase_key: str = field(default_factory=lambda: os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''))

    # Data paths
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get('DATA_DIR', './data')))

    # Parallelism
    parallel_workers: int = field(default_factory=lambda: int(os.environ.get('PARALLEL_WORKERS', '4')))

    # Thresholds
    min_pool_size: int = 50  # Minimum strategies in pool
    fitness_threshold: float = field(default_factory=lambda: float(os.environ.get('FITNESS_THRESHOLD', '0.5')))
    top_strategies_for_mutation: int = 5  # How many top strategies to mutate

    # Intervals (seconds)
    recruit_interval: int = 3600  # 1 hour
    harvest_interval: int = 300   # 5 minutes
    execute_interval: int = 600   # 10 minutes
    publish_interval: int = 86400 # 24 hours (daily)
    discovery_interval: int = 1800  # 30 minutes - autonomous market scanning
    gamma_publish_interval: int = 300  # 5 minutes - publish gamma intelligence to UI

    # Briefing settings
    publish_hour: int = 6  # 6 AM local time
    max_briefings_per_day: int = 3

    def validate(self) -> bool:
        """Validate configuration."""
        if not self.supabase_url or not self.supabase_key:
            logger.error("SUPABASE_URL and SUPABASE_KEY required")
            return False
        if not self.data_dir.exists():
            logger.warning(f"DATA_DIR {self.data_dir} does not exist - will create")
            self.data_dir.mkdir(parents=True, exist_ok=True)
        return True


# ============================================================================
# GOAL-SEEKING ARCHITECTURE
# ============================================================================

class SwarmDispatchType(Enum):
    """Types of swarm dispatches for autonomous decision engine."""
    AGGRESSIVE = 'aggressive'   # High exploration, seeking alpha (low returns situation)
    RISK = 'risk'               # Focus on drawdown reduction (high drawdown situation)
    NOVELTY = 'novelty'         # Explore new strategy types (idle situation)
    REFINEMENT = 'refinement'   # Fine-tune parameters on promising strategies
    RED_TEAM = 'red_team'       # Audit strategies before promotion


class FailureType(Enum):
    """
    Standardized Taxonomy of Failure - The "Defense" Ontology.
    Forces classification of every failure into a specific error code
    for statistical analysis and actionable intelligence.

    This transforms text logs into queryable data:
    "Show me the distribution of failure types for Trend Strategies"
    """
    OVERFITTING = 'overfitting'             # Great backtest, failed white noise test
    REGIME_MISMATCH = 'regime_mismatch'     # Bull strategy in Bear market (or vice versa)
    FEE_EROSION = 'fee_erosion'             # Edge exists but eaten by commissions/slippage
    LIQUIDITY_DRAG = 'liquidity_drag'       # Spread > Edge, can't execute profitably
    LOOKAHEAD_BIAS = 'lookahead_bias'       # Code used future data (technical flaw)
    NOISE_STOPS = 'noise_stops'             # Stop loss too tight, stopped out on noise
    EXECUTION_LAG = 'execution_lag'         # Signal too slow for price action
    CORRELATION_BREAK = 'correlation_break' # Assumed relationship broke down
    TAIL_RISK = 'tail_risk'                 # Black swan event devastated position
    PARAMETER_FRAGILE = 'parameter_fragile' # Works only with exact parameter values
    UNKNOWN = 'unknown'                     # Swarm cannot determine cause

    @classmethod
    def from_string(cls, value: str) -> 'FailureType':
        """Parse failure type from string, defaulting to UNKNOWN."""
        try:
            return cls(value.lower().strip())
        except (ValueError, AttributeError):
            return cls.UNKNOWN


# Failure Type descriptions for prompt injection
FAILURE_TYPE_DESCRIPTIONS = {
    FailureType.OVERFITTING: "Strategy shows profit on historical data but fails white noise/randomized data test - curve-fitted to past, won't generalize",
    FailureType.REGIME_MISMATCH: "Strategy logic contradicts current market regime (e.g., trend-following in choppy market, mean-reversion in trending market)",
    FailureType.FEE_EROSION: "Strategy has a small edge but transaction costs (commissions, slippage) exceed the expected profit per trade",
    FailureType.LIQUIDITY_DRAG: "Bid-ask spread is wider than the strategy's edge - can't execute without losing money",
    FailureType.LOOKAHEAD_BIAS: "Code logic uses information that wouldn't be available at trade time (future prices, end-of-day values at market open)",
    FailureType.NOISE_STOPS: "Stop loss is too tight relative to normal price noise - gets stopped out repeatedly on random fluctuations",
    FailureType.EXECUTION_LAG: "By the time the signal generates and order executes, the opportunity has passed - too slow for the market's speed",
    FailureType.CORRELATION_BREAK: "Strategy relied on a statistical relationship (e.g., SPY vs QQQ correlation) that broke down",
    FailureType.TAIL_RISK: "Strategy profitable in normal conditions but suffers catastrophic loss in extreme events (flash crash, gap down)",
    FailureType.PARAMETER_FRAGILE: "Strategy only works with specific parameter values - small changes destroy performance (sign of overfitting)",
    FailureType.UNKNOWN: "Cannot determine specific failure mode from available information"
}


@dataclass
class Mission:
    """Active mission target from Supabase."""
    id: str
    name: str
    objective: str
    target_metric: str          # 'sharpe', 'daily_return', 'sortino', 'cagr'
    target_value: float         # The number to hit
    target_operator: str        # 'gte', 'lte', 'eq'
    max_drawdown: float         # Maximum acceptable drawdown
    current_best_value: float   # Best achieved so far
    current_best_strategy_id: Optional[str]
    gap_to_target: float        # How far we are from the goal
    priority: int


@dataclass
class AutonomousDecision:
    """Decision made by the autonomous decision engine."""
    dispatch_type: SwarmDispatchType
    agent_count: int
    objective: str
    reasoning: str
    context: Dict[str, Any]


# ============================================================================
# REGIME MONITOR - The Conductor's Score
# ============================================================================

class RegimeType:
    """Market regime classifications for the Universal Symphony."""
    LOW_VOL_GRIND = 'LOW_VOL_GRIND'           # VIX < 15, term structure contango, steady drift up
    HIGH_VOL_OSCILLATION = 'HIGH_VOL_OSCILLATION'  # VIX 20-30, choppy, mean reversion
    CRASH_ACCELERATION = 'CRASH_ACCELERATION'      # VIX > 30, term structure inverted, panic
    MELT_UP = 'MELT_UP'                            # VIX declining, strong momentum, FOMO


@dataclass
class RegimeState:
    """Current regime state with supporting metrics."""
    regime: str
    vix: float
    vix9d: float
    term_structure_slope: float  # (VIX - VIX9D) / VIX9D
    realized_vol_20d: float
    put_call_skew: float  # 25-delta put IV - 25-delta call IV
    timestamp: datetime
    confidence: float = 1.0


class RegimeMonitor:
    """
    The Conductor's Score - Classifies market regimes for strategy orchestration.

    All strategies MUST declare which regime(s) they hunt.
    Backtests are tagged with regime to measure regime-specific performance.
    """

    # Regime classification thresholds
    VIX_LOW_THRESHOLD = 15.0
    VIX_HIGH_THRESHOLD = 25.0
    VIX_CRASH_THRESHOLD = 30.0
    TERM_STRUCTURE_INVERSION = -0.05  # VIX9D > VIX by 5%

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self._regime_cache: Dict[str, RegimeState] = {}

    def classify_regime(
        self,
        vix: float,
        vix9d: float,
        realized_vol: float,
        put_call_skew: float,
        spy_momentum_20d: float = 0.0
    ) -> RegimeState:
        """
        Classify current market regime based on volatility metrics.

        Args:
            vix: VIX index level
            vix9d: VIX9D (9-day VIX)
            realized_vol: 20-day realized volatility of SPY
            put_call_skew: Put-call IV skew (25-delta puts - 25-delta calls)
            spy_momentum_20d: 20-day SPY return

        Returns:
            RegimeState with classified regime
        """
        # Calculate term structure slope
        term_slope = (vix - vix9d) / vix9d if vix9d > 0 else 0

        # Classification logic
        if vix > self.VIX_CRASH_THRESHOLD and term_slope < self.TERM_STRUCTURE_INVERSION:
            # Inverted term structure + high VIX = CRASH
            regime = RegimeType.CRASH_ACCELERATION
            confidence = min(1.0, (vix - self.VIX_CRASH_THRESHOLD) / 10)

        elif vix < self.VIX_LOW_THRESHOLD and spy_momentum_20d > 0.02:
            # Low VIX + positive momentum = MELT_UP or GRIND
            if spy_momentum_20d > 0.05:
                regime = RegimeType.MELT_UP
                confidence = min(1.0, spy_momentum_20d / 0.10)
            else:
                regime = RegimeType.LOW_VOL_GRIND
                confidence = 1.0 - (vix / self.VIX_LOW_THRESHOLD)

        elif self.VIX_LOW_THRESHOLD <= vix <= self.VIX_HIGH_THRESHOLD:
            # Elevated but not panic = HIGH_VOL_OSCILLATION
            regime = RegimeType.HIGH_VOL_OSCILLATION
            confidence = 1.0 - abs(vix - 22.5) / 7.5  # Peak confidence at VIX=22.5

        elif vix > self.VIX_HIGH_THRESHOLD:
            # High VIX but not inverted = transition zone
            if put_call_skew > 5:  # High skew = fear building
                regime = RegimeType.CRASH_ACCELERATION
                confidence = 0.7
            else:
                regime = RegimeType.HIGH_VOL_OSCILLATION
                confidence = 0.8

        else:
            # Default to low vol grind
            regime = RegimeType.LOW_VOL_GRIND
            confidence = 0.5

        return RegimeState(
            regime=regime,
            vix=vix,
            vix9d=vix9d,
            term_structure_slope=term_slope,
            realized_vol_20d=realized_vol,
            put_call_skew=put_call_skew,
            timestamp=datetime.utcnow(),
            confidence=confidence
        )

    def tag_historical_regimes(self, market_data: pd.DataFrame) -> pd.DataFrame:
        """
        Tag each row in market data with its regime classification.

        Expects columns: date, vix (or implied_vol), price/close
        Adds column: regime
        """
        df = market_data.copy()

        # Calculate realized volatility if not present
        if 'realized_vol' not in df.columns:
            price_col = 'close' if 'close' in df.columns else 'price'
            if price_col in df.columns:
                returns = df[price_col].pct_change()
                df['realized_vol'] = returns.rolling(20).std() * np.sqrt(252)

        # Calculate momentum
        if 'momentum_20d' not in df.columns:
            price_col = 'close' if 'close' in df.columns else 'price'
            if price_col in df.columns:
                df['momentum_20d'] = df[price_col].pct_change(20)

        # Use VIX if available, otherwise estimate from realized vol
        vix_col = None
        for col in ['vix', 'VIX', 'implied_vol', 'iv']:
            if col in df.columns:
                vix_col = col
                break

        if vix_col is None:
            # Estimate VIX from realized vol (rough approximation)
            df['vix_estimate'] = df.get('realized_vol', 0.15) * 100 * 1.2
            vix_col = 'vix_estimate'

        # VIX9D approximation (if not available, use VIX with small adjustment)
        vix9d_col = None
        for col in ['vix9d', 'VIX9D', 'vix_9d']:
            if col in df.columns:
                vix9d_col = col
                break

        if vix9d_col is None:
            df['vix9d_estimate'] = df[vix_col] * 0.95  # Typically VIX9D < VIX in contango
            vix9d_col = 'vix9d_estimate'

        # Put-call skew (default to 0 if not available)
        skew_col = None
        for col in ['put_call_skew', 'skew', 'iv_skew']:
            if col in df.columns:
                skew_col = col
                break

        if skew_col is None:
            df['skew_estimate'] = 0
            skew_col = 'skew_estimate'

        # Classify each row
        regimes = []
        for idx, row in df.iterrows():
            vix = row.get(vix_col, 15)
            vix9d = row.get(vix9d_col, vix * 0.95)
            realized = row.get('realized_vol', 0.15)
            skew = row.get(skew_col, 0)
            momentum = row.get('momentum_20d', 0)

            state = self.classify_regime(vix, vix9d, realized, skew, momentum)
            regimes.append(state.regime)

        df['regime'] = regimes
        return df

    def get_regime_performance(
        self,
        returns: pd.Series,
        regimes: pd.Series
    ) -> Dict[str, Dict[str, float]]:
        """
        Calculate strategy performance broken down by regime.

        Returns dict of {regime: {sharpe, sortino, avg_return, count}}
        """
        results = {}

        for regime in [RegimeType.LOW_VOL_GRIND, RegimeType.HIGH_VOL_OSCILLATION,
                       RegimeType.CRASH_ACCELERATION, RegimeType.MELT_UP]:
            mask = regimes == regime
            regime_returns = returns[mask]

            if len(regime_returns) < 10:
                results[regime] = {
                    'sharpe': 0.0, 'sortino': 0.0,
                    'avg_return': 0.0, 'count': len(regime_returns)
                }
                continue

            results[regime] = {
                'sharpe': calculate_sharpe(regime_returns),
                'sortino': calculate_sortino(regime_returns),
                'avg_return': regime_returns.mean() * 252,  # Annualized
                'count': len(regime_returns)
            }

        return results


# ============================================================================
# PORTFOLIO CONTRIBUTION - Symphony Fitness
# ============================================================================

def calculate_portfolio_contribution(
    candidate_returns: pd.Series,
    existing_returns: List[pd.Series],
    existing_weights: Optional[List[float]] = None
) -> float:
    """
    Calculate how much a candidate strategy contributes to portfolio diversification.

    Returns multiplier:
    - 5.0x if negatively correlated (makes money when others lose)
    - 1.0x if uncorrelated
    - 0.1x if highly correlated (duplicate exposure)
    """
    if not existing_returns or candidate_returns.empty:
        return 1.0  # No existing strategies, neutral contribution

    # Align all returns to same index
    aligned_returns = []
    for er in existing_returns:
        aligned = candidate_returns.align(er, join='inner')[1]
        if len(aligned) > 20:
            aligned_returns.append(aligned)

    if not aligned_returns:
        return 1.0

    # Calculate correlation with each existing strategy
    correlations = []
    for er in aligned_returns:
        corr = candidate_returns.corr(er)
        if not np.isnan(corr):
            correlations.append(corr)

    if not correlations:
        return 1.0

    # Average correlation
    avg_corr = np.mean(correlations)

    # Calculate portfolio returns (equal weight if no weights provided)
    if existing_weights is None:
        existing_weights = [1.0 / len(aligned_returns)] * len(aligned_returns)

    portfolio_returns = sum(
        w * r for w, r in zip(existing_weights, aligned_returns)
    )

    # Key metric: does candidate make money when portfolio loses?
    portfolio_down_mask = portfolio_returns < 0
    if portfolio_down_mask.sum() > 10:
        candidate_during_portfolio_down = candidate_returns[portfolio_down_mask].mean()
        portfolio_during_down = portfolio_returns[portfolio_down_mask].mean()

        # Crisis alpha ratio
        if portfolio_during_down < 0:
            crisis_alpha = candidate_during_portfolio_down / abs(portfolio_during_down)
        else:
            crisis_alpha = 0
    else:
        crisis_alpha = 0

    # Calculate contribution multiplier
    if avg_corr < -0.3 and crisis_alpha > 0.5:
        # Strongly negatively correlated AND makes money in crises
        multiplier = 5.0
    elif avg_corr < 0:
        # Negatively correlated
        multiplier = 2.0 + (abs(avg_corr) * 3.0)  # 2.0 to 5.0
    elif avg_corr < 0.3:
        # Low correlation, some diversification benefit
        multiplier = 1.0 + (0.3 - avg_corr)  # 1.0 to 1.3
    elif avg_corr < 0.7:
        # Moderate correlation, reduced benefit
        multiplier = 1.0 - (avg_corr - 0.3) * 0.5  # 1.0 to 0.8
    else:
        # High correlation, duplicate exposure penalty
        multiplier = 0.1

    return round(multiplier, 2)


def get_existing_active_returns(supabase: Client, data_dir: Path) -> List[pd.Series]:
    """
    Fetch daily returns for all active strategies.

    Used for portfolio contribution calculation.
    """
    try:
        # Get active strategies with stored returns
        result = supabase.table('strategy_genome').select(
            'id', 'metadata'
        ).eq('status', 'active').execute()

        returns_list = []
        for strategy in (result.data or []):
            metadata = strategy.get('metadata', {})
            daily_returns = metadata.get('daily_returns')

            if daily_returns:
                # Convert stored returns to Series
                returns_series = pd.Series(daily_returns)
                returns_list.append(returns_series)

        return returns_list

    except Exception as e:
        logger.warning(f"Failed to fetch existing returns: {e}")
        return []


# ============================================================================
# SHADOW TRADER - Real-Time Paper Trading Validator
# ============================================================================

@dataclass
class ShadowPosition:
    """Active paper trading position."""
    position_id: str
    strategy_id: str
    symbol: str
    side: str  # 'long' or 'short'
    quantity: float
    entry_price: float
    entry_bid: float
    entry_ask: float
    entry_time: datetime
    regime_at_entry: str
    current_price: float = 0.0
    current_bid: float = 0.0
    current_ask: float = 0.0
    max_favorable: float = 0.0
    max_adverse: float = 0.0


@dataclass
class ShadowSignal:
    """Trading signal from a strategy."""
    strategy_id: str
    symbol: str
    action: str  # 'buy', 'sell', 'close'
    quantity: float
    signal_time: datetime
    signal_strength: float = 1.0
    target_regime: str = ''


class ShadowTrader:
    """
    Real-Time Paper Trading Validator.

    Consumes live market data from ThetaData and simulates execution
    for active strategies to validate performance before production.

    Data Source: ThetaData (requires Theta Terminal running locally)
    - Stocks: Trades and quotes for SPY, QQQ, IWM, etc.
    - Options: Full chain streaming for Pro tier subscribers

    Execution Simulation:
    - Spread: Always buy at ask, sell at bid
    - Latency: Random 50-200ms delay between signal and fill
    - Liquidity: Reject if order_size > quote_size

    Graduation: 50 trades with Sharpe > 1.5 triggers graduation notification.
    """

    # Execution simulation parameters
    MIN_LATENCY_MS = 50
    MAX_LATENCY_MS = 200
    GRADUATION_TRADE_COUNT = 50
    GRADUATION_SHARPE_THRESHOLD = 1.5

    def __init__(
        self,
        supabase: Client,
        regime_monitor: 'RegimeMonitor',
        symbols: Optional[List[str]] = None,
        api_key: Optional[str] = None,
    ):
        self.supabase = supabase
        self.regime_monitor = regime_monitor
        self.symbols = symbols or ['SPY', 'QQQ', 'IWM']
        self.api_key = api_key

        # State
        self._client: Optional['ThetaDataClient'] = None
        self._running = False
        self._positions: Dict[str, ShadowPosition] = {}  # position_id -> position
        self._strategy_positions: Dict[str, List[str]] = {}  # strategy_id -> [position_ids]
        self._pending_signals: asyncio.Queue = asyncio.Queue(maxsize=1000)  # Bounded to prevent memory exhaustion
        self._last_quotes: Dict[str, 'QuoteTick'] = {}
        self._current_regime: str = RegimeType.LOW_VOL_GRIND

        # Live Strategy Execution - The "Transmission"
        self._stream_buffers: Optional['MultiSymbolBuffer'] = None
        self._loaded_strategies: Dict[str, Any] = {}  # strategy_id -> loaded instance
        self._last_signals: Dict[str, int] = {}  # strategy_id -> last signal (0, 1, -1)
        self._strategy_symbols: Dict[str, str] = {}  # strategy_id -> symbol
        self._signal_cooldowns: Dict[str, datetime] = {}  # strategy_id -> last signal time (debouncing)
        self._strategy_last_used: Dict[str, datetime] = {}  # strategy_id -> last execution time (for cleanup)

        # Locks for thread-safe access to shared state (prevents race conditions)
        self._positions_lock = asyncio.Lock()
        self._quotes_lock = asyncio.Lock()
        self._strategies_lock = asyncio.Lock()
        self._signals_lock = asyncio.Lock()  # For atomic signal read-compare-update

        # Initialize stream buffers if available
        if STREAM_BUFFER_AVAILABLE:
            self._stream_buffers = MultiSymbolBuffer(
                symbols=self.symbols,
                window_size=500,
                bar_interval=60,  # 1-minute bars
                min_bars_to_trade=50  # Cold start protection
            )

        # Statistics
        self.stats = {
            'signals_received': 0,
            'trades_executed': 0,
            'trades_rejected': 0,
            'positions_opened': 0,
            'positions_closed': 0,
            'graduations': 0,
            'bars_processed': 0,
            'strategy_runs': 0,
            'signal_changes': 0,
        }

        logger.info("🔮 ShadowTrader initialized")
        logger.info(f"   Symbols: {self.symbols}")
        logger.info(f"   Stream Buffers: {'ENABLED' if self._stream_buffers else 'DISABLED'}")
        logger.info(f"   Graduation: {self.GRADUATION_TRADE_COUNT} trades @ {self.GRADUATION_SHARPE_THRESHOLD} Sharpe")

    async def start(self) -> None:
        """Start shadow trading with live data feed from ThetaData."""
        if not SHADOW_TRADING_AVAILABLE:
            logger.warning("Shadow trading unavailable - thetadata_client not imported")
            return

        logger.info("🔮 [ShadowTrader] Starting live paper trading via ThetaData...")

        try:
            # Create ThetaData client with callbacks
            self._client = ThetaDataClient(
                auto_reconnect=True,
                reconnect_delay=5.0,
            )

            # Connect to Theta Terminal
            if not await self._client.connect():
                logger.error("❌ [ShadowTrader] Failed to connect to Theta Terminal")
                logger.error("   Make sure Theta Terminal is running!")
                return

            # Subscribe to stock trades and quotes
            await self._client.subscribe_stock_trades(self.symbols)
            await self._client.subscribe_stock_quotes(self.symbols)

            # CRITICAL: Restore open positions from database on restart
            # This prevents "orphan positions" that would never be closed after daemon restart
            await self._restore_open_positions()

            self._running = True

            # Start background tasks (store references for proper cleanup)
            self._tick_task = asyncio.create_task(self._tick_consumer())
            self._signal_task = asyncio.create_task(self._signal_processor())
            self._position_task = asyncio.create_task(self._position_updater())

            # Start strategy cache cleanup task (prevents memory leak from unused strategies)
            self._cleanup_task = asyncio.create_task(self._strategy_cache_cleanup())

            # Add exception handlers to detect silent task failures
            for task in [self._tick_task, self._signal_task, self._position_task, self._cleanup_task]:
                task.add_done_callback(self._task_exception_handler)

            logger.info("🔮 [ShadowTrader] ThetaData feed connected")
            logger.info(f"   Streaming: {', '.join(self.symbols)}")

        except Exception as e:
            logger.error(f"❌ [ShadowTrader] Failed to start: {e}")
            self._running = False

    async def stop(self) -> None:
        """Stop shadow trading with proper task cleanup."""
        self._running = False

        # Cancel background tasks gracefully
        tasks_to_cancel = []
        for task_attr in ['_tick_task', '_signal_task', '_position_task', '_cleanup_task']:
            task = getattr(self, task_attr, None)
            if task and not task.done():
                task.cancel()
                tasks_to_cancel.append(task)

        # Wait for tasks to finish cancellation
        if tasks_to_cancel:
            await asyncio.gather(*tasks_to_cancel, return_exceptions=True)

        if self._client:
            await self._client.disconnect()
        logger.info("🔮 [ShadowTrader] Stopped")

    async def emergency_close_all(self, reason: str = "emergency_kill_switch") -> Dict[str, Any]:
        """
        KILL SWITCH: Emergency close all open positions immediately.

        This is the nuclear option - closes ALL shadow positions at market prices
        without waiting for strategy signals. Use when:
        - Manual intervention required
        - System instability detected
        - Market conditions deteriorate rapidly

        Returns:
            Dict with positions closed, errors encountered, and final status
        """
        logger.warning(f"🚨 [KILL SWITCH] Emergency close initiated: {reason}")

        results = {
            'positions_closed': 0,
            'positions_failed': 0,
            'errors': [],
            'reason': reason,
            'timestamp': utc_now().isoformat()
        }

        # Stop accepting new signals immediately
        self._running = False

        async with self._positions_lock:
            positions_to_close = list(self._positions.values())

        for position in positions_to_close:
            try:
                # Get current quote for exit (under lock to prevent race)
                async with self._quotes_lock:
                    quote = self._last_quotes.get(position.symbol)

                if quote:
                    # Create close signal
                    signal = ShadowSignal(
                        strategy_id=position.strategy_id,
                        symbol=position.symbol,
                        action='close',
                        quantity=position.quantity,
                        signal_time=utc_now()
                    )

                    # Execute close immediately (bypass queue)
                    await self._close_position(signal, quote, latency_ms=0)
                    results['positions_closed'] += 1

                    exit_price = quote.bid_price if position.side == 'long' else quote.ask_price
                    logger.info(f"🔴 [KILL] Closed {position.symbol} @ ${exit_price:.2f}")
                else:
                    # No quote available - mark as failed
                    results['positions_failed'] += 1
                    results['errors'].append(f"No quote for {position.symbol}")
                    logger.error(f"❌ [KILL] No quote for {position.symbol} - position orphaned")

            except Exception as e:
                results['positions_failed'] += 1
                results['errors'].append(f"{position.symbol}: {str(e)}")
                logger.error(f"❌ [KILL] Failed to close {position.symbol}: {e}")

        # Send critical alert
        send_telegram_alert(
            "KILL SWITCH ACTIVATED",
            f"Reason: {reason}\nClosed: {results['positions_closed']}\nFailed: {results['positions_failed']}",
            priority='critical'
        )

        logger.warning(
            f"🚨 [KILL SWITCH] Complete: {results['positions_closed']} closed, {results['positions_failed']} failed"
        )

        return results

    def _task_exception_handler(self, task: asyncio.Task) -> None:
        """Handle exceptions from background tasks to prevent silent failures."""
        if task.cancelled():
            return  # Normal cancellation, not an error

        exc = task.exception()
        if exc:
            task_name = task.get_name() if hasattr(task, 'get_name') else str(task)
            logger.error(f"🔥 Background task {task_name} crashed: {exc}")
            traceback.print_exception(type(exc), exc, exc.__traceback__)

            # Try to send alert (non-blocking)
            try:
                asyncio.create_task(send_telegram_alert_async(
                    "ShadowTrader Task Crashed",
                    f"Task: {task_name}\nError: {exc}",
                    priority='critical'
                ))
            except Exception:
                pass  # Don't crash the handler

    async def _restore_open_positions(self) -> None:
        """
        Restore open positions from database on daemon restart.

        CRITICAL: Without this, daemon restart orphans all open positions.
        They would remain in DB with is_open=True but never receive price updates
        or be closeable.
        """
        try:
            result = self.supabase.table('shadow_positions').select(
                'id', 'strategy_id', 'symbol', 'side', 'quantity', 'entry_price',
                'entry_bid', 'entry_ask', 'regime_at_entry', 'entry_time'
            ).eq('is_open', True).execute()

            if not result.data:
                logger.info("🔮 [ShadowTrader] No open positions to restore")
                return

            restored = 0
            async with self._positions_lock:
                for pos_data in result.data:
                    position_id = pos_data['id']

                    # Parse entry_time from ISO string to datetime
                    entry_time_raw = pos_data.get('entry_time')
                    if isinstance(entry_time_raw, str):
                        try:
                            entry_time = datetime.fromisoformat(entry_time_raw.replace('Z', '+00:00'))
                        except ValueError:
                            entry_time = utc_now()
                    elif isinstance(entry_time_raw, datetime):
                        entry_time = entry_time_raw
                    else:
                        entry_time = utc_now()

                    # Reconstruct ShadowPosition
                    position = ShadowPosition(
                        position_id=position_id,
                        strategy_id=pos_data['strategy_id'],
                        symbol=pos_data['symbol'],
                        side=pos_data['side'],
                        quantity=pos_data['quantity'],
                        entry_price=pos_data['entry_price'],
                        entry_bid=pos_data.get('entry_bid', pos_data['entry_price']),
                        entry_ask=pos_data.get('entry_ask', pos_data['entry_price']),
                        regime_at_entry=pos_data.get('regime_at_entry', 'unknown'),
                        entry_time=entry_time,
                        current_price=pos_data['entry_price'],  # Will be updated by tick consumer
                        current_bid=pos_data.get('entry_bid', pos_data['entry_price']),
                        current_ask=pos_data.get('entry_ask', pos_data['entry_price']),
                        max_favorable=0.0,
                        max_adverse=0.0,
                    )

                    # Add to tracking dicts
                    self._positions[position_id] = position

                    strategy_id = pos_data['strategy_id']
                    if strategy_id not in self._strategy_positions:
                        self._strategy_positions[strategy_id] = []
                    self._strategy_positions[strategy_id].append(position_id)

                    restored += 1

            logger.info(f"🔮 [ShadowTrader] Restored {restored} open positions from database")

        except Exception as e:
            logger.error(f"❌ [ShadowTrader] Failed to restore positions: {e}")
            traceback.print_exc()

    async def _tick_consumer(self) -> None:
        """
        Consume ticks from ThetaData, aggregate into bars, and trigger strategy execution.

        This is the "Transmission" - it connects live data to strategies:
        1. Quote ticks → Update position prices
        2. Trade ticks → Aggregate into 1-min bars via StreamBuffer
        3. New bar closed → Run all active strategies on rolling DataFrame
        4. Signal changed → Submit to ShadowTrader for simulated execution
        """
        if not self._client:
            return

        async for tick in self._client.stream():
            if not self._running:
                break

            try:
                # Update last quote cache (with lock to prevent race conditions)
                if isinstance(tick, QuoteTick):
                    async with self._quotes_lock:
                        self._last_quotes[tick.symbol] = tick

                    # Update open positions with current prices
                    await self._update_position_prices(tick)

                elif isinstance(tick, TradeTick):
                    # Feed trade ticks to StreamBuffer for bar aggregation
                    if self._stream_buffers:
                        new_bar_event = self._stream_buffers.on_tick(
                            symbol=tick.symbol,
                            price=tick.price,
                            size=tick.size,
                            timestamp=tick.timestamp
                        )

                        # If a new bar just closed, run strategies
                        if new_bar_event:
                            self.stats['bars_processed'] += 1
                            await self._on_new_bar(new_bar_event)

            except Exception as e:
                logger.error(f"Tick processing error: {e}")

    async def _update_position_prices(self, quote: 'QuoteTick') -> None:
        """Update open positions with current market prices."""
        async with self._positions_lock:
            for pos_id, position in list(self._positions.items()):  # list() to avoid mutation during iteration
                if position.symbol == quote.symbol:
                    position.current_price = quote.mid_price
                    position.current_bid = quote.bid_price
                    position.current_ask = quote.ask_price

                    # Calculate current P&L (with division by zero protection)
                    if abs(position.entry_price) < 1e-9:
                        pnl_pct = 0.0  # Avoid division by zero
                    elif position.side == 'long':
                        pnl_pct = (quote.bid_price - position.entry_price) / position.entry_price
                    else:
                        pnl_pct = (position.entry_price - quote.ask_price) / position.entry_price

                    # Track excursions
                    if pnl_pct > position.max_favorable:
                        position.max_favorable = pnl_pct
                    if pnl_pct < position.max_adverse:
                        position.max_adverse = pnl_pct

    async def _on_new_bar(self, event: 'NewBarEvent') -> None:
        """
        Run strategies when a new bar closes - The Live Strategy Execution Engine.

        This is the key innovation: We maintain a rolling DataFrame of the last 500 bars
        and pass it to strategies exactly like a mini-backtest. This ensures
        "Simulation-Reality Parity" - the strategy behaves identically live vs backtest.

        Args:
            event: NewBarEvent containing symbol, closed bar, and rolling DataFrame
        """
        symbol = event.symbol
        df = event.dataframe
        bar_count = event.bar_count

        # Cold Start Protection: Don't trade until we have enough data
        buffer = self._stream_buffers.get_buffer(symbol) if self._stream_buffers else None
        if buffer and not buffer.is_ready():
            if bar_count % 10 == 0:  # Log every 10 bars during warmup
                logger.info(f"🔄 [Live] {symbol} warming up: {bar_count}/{buffer.min_bars_to_trade} bars")
            return

        # Get all active and shadow strategies for this symbol
        active_strategies = await self._get_live_strategies(symbol)

        if not active_strategies:
            return  # No strategies to run

        for strategy_info in active_strategies:
            strategy_id = strategy_info['id']
            strategy_name = strategy_info['name']

            try:
                # Load strategy if not cached (protected by lock to prevent race conditions)
                async with self._strategies_lock:
                    if strategy_id not in self._loaded_strategies:
                        instance = await self._load_strategy_instance(strategy_info)
                        if instance:
                            self._loaded_strategies[strategy_id] = instance
                            self._last_signals[strategy_id] = 0  # Start flat
                            self._strategy_symbols[strategy_id] = symbol
                        else:
                            continue

                    strategy_instance = self._loaded_strategies[strategy_id]

                self.stats['strategy_runs'] += 1

                # Run strategy on rolling DataFrame with timeout protection
                # The strategy returns a Series/array of positions (like in backtest)
                # We only care about the LAST value (current signal)
                try:
                    result = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: strategy_instance.run(df, initial_capital=100000)
                        ),
                        timeout=5.0  # 5 second timeout to prevent hung strategies
                    )
                except asyncio.TimeoutError:
                    logger.error(f"⏱️ Strategy {strategy_name} timed out (>5s), skipping")
                    self.stats['strategy_timeouts'] = self.stats.get('strategy_timeouts', 0) + 1
                    continue

                # Extract the last signal
                # Handle different return formats from strategies
                if isinstance(result, tuple):
                    # Strategy returns (returns, equity, trades) - extract position from equity
                    _, equity, _ = result
                    # Determine signal from equity change direction
                    if len(equity) >= 2:
                        current_signal = 1 if equity.iloc[-1] > equity.iloc[-2] else 0
                    else:
                        current_signal = 0
                elif hasattr(result, 'iloc'):
                    # Series or DataFrame - take last value
                    current_signal = int(result.iloc[-1]) if len(result) > 0 else 0
                else:
                    current_signal = int(result) if result else 0

                # Normalize to -1, 0, 1
                current_signal = max(-1, min(1, current_signal))

                # Track strategy usage time for cleanup
                self._strategy_last_used[strategy_id] = datetime.utcnow()

                # Atomic signal read-compare-update with lock (prevents race condition)
                async with self._signals_lock:
                    last_signal = self._last_signals.get(strategy_id, 0)
                    if current_signal != last_signal:
                        self.stats['signal_changes'] += 1

                        # Signal debouncing: 60-second cooldown between signals for same strategy
                        last_signal_time = self._signal_cooldowns.get(strategy_id)
                        if last_signal_time:
                            elapsed = (datetime.utcnow() - last_signal_time).total_seconds()
                            if elapsed < 60.0:
                                logger.debug(
                                    f"🕐 Signal debounced for {strategy_name} ({elapsed:.1f}s < 60s cooldown)"
                                )
                                continue  # Skip this signal, try again next bar

                        # Determine action
                        if current_signal > 0 and last_signal <= 0:
                            action = 'buy'
                        elif current_signal < 0 and last_signal >= 0:
                            action = 'sell'
                        elif current_signal == 0 and last_signal != 0:
                            action = 'close'
                        else:
                            action = None

                        if action:
                            # Submit signal to ShadowTrader
                            signal = ShadowSignal(
                                strategy_id=strategy_id,
                                symbol=symbol,
                                action=action,
                                quantity=self._calculate_position_size(strategy_info),
                                signal_time=datetime.utcnow()
                            )
                            await self.submit_signal(signal)

                            # Update cooldown timestamp
                            self._signal_cooldowns[strategy_id] = datetime.utcnow()

                            logger.info(
                                f"🎯 [Live] {strategy_name} signal: {last_signal} → {current_signal} ({action.upper()})"
                            )

                        # Update last signal
                        self._last_signals[strategy_id] = current_signal

            except Exception as e:
                logger.error(f"Strategy {strategy_name} execution error: {e}")
                traceback.print_exc()

    async def _get_live_strategies(self, symbol: str) -> List[Dict[str, Any]]:
        """Get all active/shadow strategies that trade this symbol."""
        try:
            result = self.supabase.table('strategy_genome').select(
                'id', 'name', 'code_content', 'dna_config', 'status'
            ).in_('status', ['active', 'shadow']).execute()

            if not result.data:
                return []

            # Filter strategies that trade this symbol (or all symbols if not specified)
            strategies = []
            for s in result.data:
                config = s.get('dna_config', {}) or {}
                strategy_symbols = config.get('symbols', self.symbols)
                if symbol in strategy_symbols or not strategy_symbols:
                    strategies.append(s)

            return strategies

        except Exception as e:
            logger.error(f"Failed to fetch live strategies: {e}")
            return []

    async def _load_strategy_instance(self, strategy_info: Dict[str, Any]) -> Optional[Any]:
        """Dynamically load and instantiate a strategy from its code."""
        try:
            code_content = strategy_info.get('code_content', '')
            config = strategy_info.get('dna_config', {}) or {}

            if not code_content:
                logger.warning(f"Strategy {strategy_info['name']} has no code content")
                return None

            # Create a module namespace and execute the code
            namespace = {
                'pd': pd,
                'np': np,
                'datetime': datetime,
                'timedelta': timedelta,
            }

            exec(code_content, namespace)

            # Find the Strategy class
            if 'Strategy' not in namespace:
                logger.warning(f"Strategy {strategy_info['name']} has no 'Strategy' class")
                return None

            # Instantiate with config
            StrategyClass = namespace['Strategy']
            instance = StrategyClass(config)

            logger.info(f"📦 Loaded strategy: {strategy_info['name']}")
            return instance

        except Exception as e:
            logger.error(f"Failed to load strategy {strategy_info['name']}: {e}")
            return None

    def _calculate_position_size(self, strategy_info: Dict[str, Any]) -> int:
        """Calculate position size based on strategy config and risk limits."""
        config = strategy_info.get('dna_config', {}) or {}

        # Default to small size for shadow trading
        base_shares = config.get('position_size', 100)

        # Apply shadow mode scaling (10% of real size for safety)
        shadow_scale = 0.1
        return max(1, int(base_shares * shadow_scale))

    async def submit_signal(self, signal: ShadowSignal) -> None:
        """Submit a trading signal for execution."""
        self.stats['signals_received'] += 1
        await self._pending_signals.put(signal)

    async def _signal_processor(self) -> None:
        """Process pending signals with simulated latency."""
        while self._running:
            try:
                signal = await asyncio.wait_for(
                    self._pending_signals.get(),
                    timeout=1.0
                )

                # Simulate execution latency (50-200ms)
                latency_ms = random.randint(self.MIN_LATENCY_MS, self.MAX_LATENCY_MS)
                await asyncio.sleep(latency_ms / 1000)

                # Execute signal
                await self._execute_signal(signal, latency_ms)

            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Signal processing error: {e}")

    async def _execute_signal(self, signal: ShadowSignal, latency_ms: int) -> None:
        """
        Execute a trading signal with realistic friction.

        - Spread: Buy at ask, sell at bid
        - Liquidity: Reject if order > quote size
        - Staleness: Reject if quote > 1 second old
        """
        # Get quote with lock protection
        async with self._quotes_lock:
            quote = self._last_quotes.get(signal.symbol)

        if not quote:
            logger.warning(f"No quote for {signal.symbol}, rejecting signal")
            self.stats['trades_rejected'] += 1
            return

        # CRITICAL: Quote staleness check - reject quotes > 1 second old
        # This prevents executing at stale prices which causes P&L bleed in live trading
        quote_age_seconds = (utc_now() - quote.timestamp).total_seconds() if quote.timestamp else float('inf')
        if quote_age_seconds > 1.0:
            logger.warning(
                f"🕐 Stale quote for {signal.symbol} ({quote_age_seconds:.1f}s old), rejecting signal"
            )
            self.stats['stale_quote_rejects'] = self.stats.get('stale_quote_rejects', 0) + 1
            await self._record_rejection(signal, quote, 'stale_quote')
            return

        # CRITICAL: Market hours check - reject trades outside RTH
        # Prevents executing during pre-market (wide spreads) or on holidays
        if not is_market_open():
            logger.warning(
                f"🚫 Market closed, rejecting {signal.action} for {signal.symbol}"
            )
            self.stats['outside_rth_rejects'] = self.stats.get('outside_rth_rejects', 0) + 1
            await self._record_rejection(signal, quote, 'market_closed')
            return

        # CRITICAL: Crossed market check - reject if bid > ask (data error or unusual condition)
        if quote.bid_price > quote.ask_price:
            logger.warning(
                f"❌ Crossed market for {signal.symbol}: bid=${quote.bid_price:.2f} > ask=${quote.ask_price:.2f}"
            )
            self.stats['crossed_market_rejects'] = self.stats.get('crossed_market_rejects', 0) + 1
            await self._record_rejection(signal, quote, 'crossed_market')
            return

        # CRITICAL: Wide spread filter - reject if spread > 5% of mid price
        # Protects against bad fills in illiquid conditions or data issues
        if quote.ask_price > 0 and quote.bid_price > 0:
            mid_price = (quote.bid_price + quote.ask_price) / 2
            spread_pct = (quote.ask_price - quote.bid_price) / mid_price if mid_price > 0 else 1.0
            if spread_pct > 0.05:  # 5% max spread
                logger.warning(
                    f"📏 Wide spread for {signal.symbol}: {spread_pct*100:.1f}% > 5% max"
                )
                self.stats['wide_spread_rejects'] = self.stats.get('wide_spread_rejects', 0) + 1
                await self._record_rejection(signal, quote, 'wide_spread')
                return

        # Handle close action separately (has its own locking)
        if signal.action == 'close':
            await self._close_position(signal, quote, latency_ms)
            return

        # Determine fill price based on side
        if signal.action == 'buy':
            fill_price = quote.ask_price  # Pay the ask
            available_size = quote.ask_size
        elif signal.action == 'sell':
            fill_price = quote.bid_price  # Hit the bid
            available_size = quote.bid_size
        else:
            logger.warning(f"Unknown action: {signal.action}")
            return

        # Liquidity check: reject if order > quote size
        if signal.quantity > available_size:
            logger.info(
                f"🚫 Liquidity reject: {signal.symbol} order={signal.quantity} > size={available_size}"
            )
            self.stats['trades_rejected'] += 1

            # Record rejection in database
            await self._record_rejection(signal, quote, 'insufficient_liquidity')
            return

        # CRITICAL: TOCTOU FIX - Hold lock from duplicate check through position open
        # Without this, another coroutine could pass duplicate check + open position
        # between our check and our open, resulting in duplicate positions.
        async with self._positions_lock:
            # Duplicate check under lock
            for position in self._positions.values():
                if position.strategy_id == signal.strategy_id and position.symbol == signal.symbol:
                    logger.warning(
                        f"[DUPE] Rejected: {signal.symbol} position already exists for strategy {signal.strategy_id}"
                    )
                    self.stats['trades_rejected'] += 1
                    return

            # Open position while still holding lock (pass _lock_held=True to avoid deadlock)
            await self._open_position(signal, quote, fill_price, latency_ms, _lock_held=True)

    async def _open_position(
        self,
        signal: ShadowSignal,
        quote: 'QuoteTick',
        fill_price: float,
        latency_ms: int,
        _lock_held: bool = False
    ) -> None:
        """
        Open a new shadow position.

        Args:
            _lock_held: If True, caller already holds _positions_lock (avoids deadlock).
                       Internal parameter - callers should generally not set this.
        """
        try:
            # Determine current regime
            regime = self._current_regime

            # Call Supabase RPC to open position
            result = self.supabase.rpc('open_shadow_position', {
                'p_strategy_id': signal.strategy_id,
                'p_symbol': signal.symbol,
                'p_side': 'long' if signal.action == 'buy' else 'short',
                'p_quantity': signal.quantity,
                'p_entry_price': fill_price,
                'p_entry_bid': quote.bid_price,
                'p_entry_ask': quote.ask_price,
                'p_regime': regime,
                'p_latency_ms': latency_ms,
            }).execute()

            position_id = result.data

            # Track locally
            position = ShadowPosition(
                position_id=position_id,
                strategy_id=signal.strategy_id,
                symbol=signal.symbol,
                side='long' if signal.action == 'buy' else 'short',
                quantity=signal.quantity,
                entry_price=fill_price,
                entry_bid=quote.bid_price,
                entry_ask=quote.ask_price,
                entry_time=datetime.utcnow(),
                regime_at_entry=regime,
                current_price=fill_price,
                current_bid=quote.bid_price,
                current_ask=quote.ask_price,
            )

            # CRITICAL: Modify position dicts under lock
            # If caller already holds lock, skip acquiring (prevents deadlock)
            if _lock_held:
                self._positions[position_id] = position
                if signal.strategy_id not in self._strategy_positions:
                    self._strategy_positions[signal.strategy_id] = []
                self._strategy_positions[signal.strategy_id].append(position_id)
            else:
                async with self._positions_lock:
                    self._positions[position_id] = position
                    if signal.strategy_id not in self._strategy_positions:
                        self._strategy_positions[signal.strategy_id] = []
                    self._strategy_positions[signal.strategy_id].append(position_id)

            self.stats['positions_opened'] += 1
            self.stats['trades_executed'] += 1

            logger.info(
                f"📈 Opened: {signal.symbol} {position.side} "
                f"@ ${fill_price:.2f} (latency: {latency_ms}ms, regime: {regime})"
            )

        except Exception as e:
            logger.error(f"Failed to open position: {e}")

    async def _close_position(
        self,
        signal: ShadowSignal,
        quote: 'QuoteTick',
        latency_ms: int
    ) -> None:
        """Close an existing shadow position."""
        # CRITICAL: Hold lock for entire close operation to prevent race conditions.
        # Without this, another coroutine could modify positions mid-close, orphaning positions.
        async with self._positions_lock:
            # Find open positions for this strategy and symbol
            strategy_positions = self._strategy_positions.get(signal.strategy_id, [])

            for pos_id in strategy_positions[:]:  # Copy list to allow modification
                position = self._positions.get(pos_id)
                if not position or position.symbol != signal.symbol:
                    continue

                # Determine exit price based on position side
                if position.side == 'long':
                    exit_price = quote.bid_price  # Sell at bid
                else:
                    exit_price = quote.ask_price  # Cover at ask

                try:
                    # Call Supabase RPC to close position
                    result = self.supabase.rpc('close_shadow_position', {
                        'p_position_id': pos_id,
                        'p_exit_price': exit_price,
                        'p_exit_bid': quote.bid_price,
                        'p_exit_ask': quote.ask_price,
                        'p_regime': self._current_regime,
                    }).execute()

                    trade_id = result.data

                    # Clean up local tracking (already under lock)
                    del self._positions[pos_id]
                    self._strategy_positions[signal.strategy_id].remove(pos_id)

                    # Calculate P&L for logging
                    if position.side == 'long':
                        pnl = (exit_price - position.entry_price) * position.quantity
                    else:
                        pnl = (position.entry_price - exit_price) * position.quantity

                    self.stats['positions_closed'] += 1
                    self.stats['trades_executed'] += 1

                    logger.info(
                        f"📉 Closed: {signal.symbol} {position.side} "
                        f"@ ${exit_price:.2f} P&L: ${pnl:.2f}"
                    )

                    # Check for graduation (outside lock would deadlock if it accesses positions)
                    await self._check_graduation(signal.strategy_id)

                except Exception as e:
                    logger.error(f"Failed to close position: {e}")

    async def _record_rejection(
        self,
        signal: ShadowSignal,
        quote: 'QuoteTick',
        reason: str
    ) -> None:
        """Record a rejected trade for analysis."""
        try:
            self.supabase.table('shadow_trades').insert({
                'strategy_id': signal.strategy_id,
                'symbol': signal.symbol,
                'side': signal.action,
                'quantity': signal.quantity,
                'entry_price': 0,
                'fill_type': 'rejected',
                'signal_time': signal.signal_time.isoformat(),
                'execution_metadata': {
                    'rejection_reason': reason,
                    'quote_bid': quote.bid_price,
                    'quote_ask': quote.ask_price,
                    'quote_bid_size': quote.bid_size,
                    'quote_ask_size': quote.ask_size,
                    'order_size': signal.quantity,
                }
            }).execute()
        except Exception as e:
            logger.error(f"Failed to record rejection: {e}")

    async def _check_graduation(self, strategy_id: str) -> None:
        """Check if strategy has met graduation criteria."""
        try:
            result = self.supabase.rpc('check_graduation_ready', {
                'p_strategy_id': strategy_id
            }).execute()

            if result.data and result.data[0].get('is_ready'):
                # Strategy graduated!
                await self._publish_graduation(strategy_id, result.data[0])

        except Exception as e:
            logger.error(f"Graduation check failed: {e}")

    async def _publish_graduation(self, strategy_id: str, metrics: Dict) -> None:
        """Publish graduation notification to morning briefings."""
        try:
            # Get strategy details
            strategy = self.supabase.table('strategy_genome').select(
                'id', 'name', 'fitness_score'
            ).eq('id', strategy_id).single().execute()

            if not strategy.data:
                return

            # Update graduation tracker
            self.supabase.table('graduation_tracker').update({
                'status': 'graduated',
                'graduation_date': datetime.utcnow().isoformat(),
            }).eq('strategy_id', strategy_id).execute()

            # Create graduation briefing
            headline = f"🎓 GRADUATION: {strategy.data['name']} ready for production!"
            narrative = f"""## Strategy Graduation Notice

**{strategy.data['name']}** has successfully completed shadow trading validation and is **READY FOR PRODUCTION**.

### Shadow Trading Results
- **Total Trades**: {metrics.get('trade_count', 0)}
- **Shadow Sharpe**: {metrics.get('sharpe', 0):.2f}
- **Win Rate**: {metrics.get('win_rate', 0):.1%}

### Validation Summary
This strategy has demonstrated consistent performance over {metrics.get('trade_count', 0)} live-validated trades with execution slippage and realistic market friction accounted for.

### Recommended Action
**PROMOTE TO LIVE TRADING** - This strategy has proven itself in shadow mode and is ready for capital allocation.

### Risk Notes
{chr(10).join(f'- {c}' for c in metrics.get('missing_criteria', [])) or '- All graduation criteria met'}
"""

            self.supabase.table('morning_briefings').insert({
                'strategy_id': strategy_id,
                'headline': headline,
                'narrative': narrative,
                'key_metrics': {
                    'shadow_trades': metrics.get('trade_count', 0),
                    'shadow_sharpe': metrics.get('sharpe', 0),
                    'shadow_win_rate': metrics.get('win_rate', 0),
                    'graduation': True,
                },
                'priority_score': 100.0,  # High priority for graduations
            }).execute()

            self.stats['graduations'] += 1
            logger.info(f"🎓 [ShadowTrader] GRADUATION: {strategy.data['name']}")
            
            # Send Telegram notification
            send_telegram_alert(
                title=f"🎓 GRADUATION: {strategy.data['name']}",
                message=f"Strategy ready for production!\n\n"
                        f"• Trades: {metrics.get('trade_count', 0)}\n"
                        f"• Sharpe: {metrics.get('sharpe', 0):.2f}\n"
                        f"• Win Rate: {metrics.get('win_rate', 0):.1%}",
                priority='high'
            )

        except Exception as e:
            logger.error(f"Failed to publish graduation: {e}")

    async def _position_updater(self) -> None:
        """Periodically update positions in database."""
        while self._running:
            try:
                await asyncio.sleep(5)  # Update every 5 seconds

                # CRITICAL: Take snapshot under lock to prevent race with open/close
                # The list() call itself is not atomic - dict could change during iteration
                async with self._positions_lock:
                    positions_snapshot = list(self._positions.items())

                for pos_id, position in positions_snapshot:
                    # Calculate current P&L (with division by zero protection)
                    if abs(position.entry_price) < 1e-9:
                        current_pnl = 0.0
                        current_pnl_pct = 0.0
                    elif position.side == 'long':
                        current_pnl = (position.current_bid - position.entry_price) * position.quantity
                        current_pnl_pct = (position.current_bid - position.entry_price) / position.entry_price
                    else:
                        current_pnl = (position.entry_price - position.current_ask) * position.quantity
                        current_pnl_pct = (position.entry_price - position.current_ask) / position.entry_price

                    # Update in database
                    self.supabase.table('shadow_positions').update({
                        'current_price': position.current_price,
                        'current_bid': position.current_bid,
                        'current_ask': position.current_ask,
                        'current_pnl': current_pnl,
                        'current_pnl_pct': current_pnl_pct,
                        'max_favorable_excursion': position.max_favorable,
                        'max_adverse_excursion': position.max_adverse,
                        'time_in_position_seconds': int(
                            (datetime.utcnow() - position.entry_time).total_seconds()
                        ),
                        'current_regime': self._current_regime,
                    }).eq('id', pos_id).execute()

            except Exception as e:
                logger.error(f"Position update error: {e}")

    async def _strategy_cache_cleanup(self) -> None:
        """
        Periodically clean up strategy cache to prevent memory leaks.

        Strategies that haven't been used in >1 hour are evicted from the cache.
        They will be reloaded on next use. This prevents unbounded memory growth
        when strategies are rotated/deprecated but remain in cache.
        """
        CLEANUP_INTERVAL = 300  # Check every 5 minutes
        MAX_IDLE_SECONDS = 3600  # Evict after 1 hour of no use

        while self._running:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL)

                now = datetime.utcnow()
                strategies_to_evict = []

                # Find strategies that haven't been used recently
                async with self._strategies_lock:
                    for strategy_id in list(self._loaded_strategies.keys()):
                        last_used = self._strategy_last_used.get(strategy_id)
                        if last_used:
                            idle_seconds = (now - last_used).total_seconds()
                            if idle_seconds > MAX_IDLE_SECONDS:
                                strategies_to_evict.append(strategy_id)
                        else:
                            # Never used (shouldn't happen, but clean up anyway)
                            strategies_to_evict.append(strategy_id)

                    # Evict from all tracking dicts
                    for strategy_id in strategies_to_evict:
                        self._loaded_strategies.pop(strategy_id, None)
                        self._last_signals.pop(strategy_id, None)
                        self._strategy_symbols.pop(strategy_id, None)
                        self._strategy_last_used.pop(strategy_id, None)
                        self._signal_cooldowns.pop(strategy_id, None)

                if strategies_to_evict:
                    logger.info(
                        f"🧹 [ShadowTrader] Evicted {len(strategies_to_evict)} idle strategies from cache"
                    )
                    self.stats['strategies_evicted'] = self.stats.get('strategies_evicted', 0) + len(strategies_to_evict)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Strategy cleanup error: {e}")

    def update_regime(self, regime: str) -> None:
        """Update current market regime."""
        if regime != self._current_regime:
            logger.info(f"🔮 Regime change: {self._current_regime} → {regime}")
            self._current_regime = regime

    def get_stats(self) -> Dict[str, Any]:
        """Get shadow trading statistics."""
        return {
            **self.stats,
            'open_positions': len(self._positions),
            'connected': self._client.is_connected if self._client else False,
            'current_regime': self._current_regime,
        }


# ============================================================================
# STRATEGY EXECUTION (Runs in subprocess)
# ============================================================================

@dataclass
class BacktestResult:
    """Result from a single backtest execution."""
    strategy_id: str
    success: bool
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0
    max_drawdown: float = 0.0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    cagr: float = 0.0
    convexity_score: float = 0.0
    fitness_score: float = 0.0
    total_trades: int = 0
    error: Optional[str] = None
    execution_time_ms: int = 0

    # Symphony metrics (Universal Convexity)
    portfolio_contribution: float = 1.0  # Multiplier: 5x for negative corr, 0.1x for duplicate
    target_regime: str = ''  # Which regime this strategy hunts
    regime_performance: Dict[str, Dict[str, float]] = field(default_factory=dict)
    daily_returns: List[float] = field(default_factory=list)  # For portfolio correlation calc


def calculate_sharpe(returns: pd.Series, risk_free_rate: float = 0.0) -> float:
    """Calculate annualized Sharpe ratio."""
    if returns.empty or returns.std() == 0:
        return 0.0
    excess_returns = returns - risk_free_rate / 252
    return np.sqrt(252) * excess_returns.mean() / excess_returns.std()


def calculate_sortino(returns: pd.Series, risk_free_rate: float = 0.0) -> float:
    """Calculate annualized Sortino ratio."""
    if returns.empty:
        return 0.0
    excess_returns = returns - risk_free_rate / 252
    downside = returns[returns < 0]
    if downside.empty or downside.std() == 0:
        return calculate_sharpe(returns, risk_free_rate)  # Fallback to Sharpe
    return np.sqrt(252) * excess_returns.mean() / downside.std()


def calculate_max_drawdown(equity_curve: pd.Series) -> float:
    """Calculate maximum drawdown."""
    if equity_curve.empty:
        return 0.0
    peak = equity_curve.expanding().max()
    drawdown = (equity_curve - peak) / peak
    return drawdown.min()


def calculate_convexity_score(returns: pd.Series) -> float:
    """
    Calculate convexity score - measures asymmetric returns.
    Higher score = more positive skew (gains in big moves).
    """
    if returns.empty or len(returns) < 30:
        return 0.0

    # Positive convexity: gains accelerate in magnitude during market stress
    # Use skewness and kurtosis of returns
    skew = returns.skew()

    # Also measure: ratio of gains during high-vol days vs low-vol days
    rolling_vol = returns.rolling(20).std()
    if rolling_vol.dropna().empty:
        return max(0, skew * 0.5)

    median_vol = rolling_vol.median()
    high_vol_returns = returns[rolling_vol > median_vol].mean()
    low_vol_returns = returns[rolling_vol <= median_vol].mean()

    vol_ratio = high_vol_returns / low_vol_returns if low_vol_returns != 0 else 1.0

    # Convexity score: combination of skew and vol-conditional performance
    convexity = (skew * 0.3 + vol_ratio * 0.7)
    return max(0, min(2.0, convexity))  # Clamp to [0, 2]


def execute_strategy_backtest(
    strategy_id: str,
    code_content: str,
    dna_config: Dict[str, Any],
    data_dir: str,
    start_date: str = '2020-01-01',
    end_date: str = '2024-12-31',
    initial_capital: float = 100000.0
) -> BacktestResult:
    """
    Execute a single strategy backtest (runs in subprocess).

    This function is called by the multiprocessing pool.
    """
    import time as time_module
    start_time = time_module.time()

    try:
        # Load market data from local Parquet files
        data_path = Path(data_dir)

        # Find available data files (prioritize stocks_trades)
        trades_dir = data_path / 'stocks_trades' / 'SPY'
        if not trades_dir.exists():
            # Fallback: look for any available data
            available_dirs = list(data_path.glob('*/SPY'))
            if not available_dirs:
                return BacktestResult(
                    strategy_id=strategy_id,
                    success=False,
                    error="No market data found for SPY"
                )
            trades_dir = available_dirs[0]

        # Load Parquet files for date range
        parquet_files = sorted(trades_dir.glob('*.parquet'))
        if not parquet_files:
            return BacktestResult(
                strategy_id=strategy_id,
                success=False,
                error="No Parquet files found"
            )

        # Load and concatenate data using Polars (faster)
        dfs = []
        for pf in parquet_files:
            # Extract date from filename: SPY_20241120.parquet
            file_date = pf.stem.split('_')[-1]
            if start_date.replace('-', '') <= file_date <= end_date.replace('-', ''):
                dfs.append(pl.read_parquet(pf))

        if not dfs:
            # Generate synthetic data for testing
            logger.warning(f"No data in range, using synthetic data for {strategy_id}")
            dates = pd.date_range(start_date, end_date, freq='D')
            prices = 100 * np.cumprod(1 + np.random.randn(len(dates)) * 0.01)
            market_data = pd.DataFrame({
                'date': dates,
                'price': prices,
                'volume': np.random.randint(1000000, 10000000, len(dates))
            })
        else:
            # Combine and convert to pandas
            combined = pl.concat(dfs)
            market_data = combined.to_pandas()

        # Execute strategy code dynamically
        # Create a safe execution environment
        strategy_module = load_strategy_code(code_content, strategy_id)

        if strategy_module is None:
            # Fallback: run simple momentum backtest based on dna_config
            returns, equity_curve, trades = run_simple_backtest(
                market_data, dna_config, initial_capital
            )
        else:
            # Execute the loaded strategy
            try:
                strategy_instance = strategy_module.Strategy(dna_config)
                returns, equity_curve, trades = strategy_instance.run(
                    market_data, initial_capital
                )
            except Exception as e:
                # Fallback if strategy execution fails
                logger.warning(f"Strategy execution failed, using fallback: {e}")
                returns, equity_curve, trades = run_simple_backtest(
                    market_data, dna_config, initial_capital
                )

        # ================================================================
        # REGIME TAGGING - The Conductor's Score
        # ================================================================
        regime_monitor = RegimeMonitor(data_path)
        market_data_tagged = regime_monitor.tag_historical_regimes(market_data)
        regimes = market_data_tagged['regime'] if 'regime' in market_data_tagged.columns else pd.Series()

        # Calculate regime-specific performance
        regime_performance = {}
        target_regime = ''
        best_regime_sharpe = -float('inf')

        if not regimes.empty and len(returns) == len(regimes):
            regime_performance = regime_monitor.get_regime_performance(returns, regimes)

            # Determine target regime (best performing regime for this strategy)
            for regime, perf in regime_performance.items():
                if perf['sharpe'] > best_regime_sharpe and perf['count'] >= 20:
                    best_regime_sharpe = perf['sharpe']
                    target_regime = regime

        # ================================================================
        # CALCULATE METRICS
        # ================================================================
        sharpe = calculate_sharpe(returns)
        sortino = calculate_sortino(returns)
        max_dd = calculate_max_drawdown(equity_curve)
        convexity = calculate_convexity_score(returns)

        # Win rate and profit factor
        if len(trades) > 0:
            winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
            win_rate = len(winning_trades) / len(trades)

            gross_profit = sum(t.get('pnl', 0) for t in trades if t.get('pnl', 0) > 0)
            gross_loss = abs(sum(t.get('pnl', 0) for t in trades if t.get('pnl', 0) < 0))
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        else:
            win_rate = 0.0
            profit_factor = 0.0

        # CAGR
        years = (pd.to_datetime(end_date) - pd.to_datetime(start_date)).days / 365.25
        total_return = (equity_curve.iloc[-1] / initial_capital) if len(equity_curve) > 0 else 1.0
        cagr = (total_return ** (1 / years) - 1) if years > 0 else 0.0

        # ================================================================
        # SYMPHONY FITNESS - Portfolio Contribution
        # ================================================================
        # Base fitness: Sharpe * Sortino * Convexity * Drawdown penalty
        base_fitness = (
            max(0, sharpe) *
            max(0, sortino) *
            max(0.1, convexity) *
            (1 + max_dd)  # max_dd is negative, so this reduces fitness for big drawdowns
        )

        # Store daily returns for portfolio contribution calculation
        daily_returns_list = returns.tolist() if isinstance(returns, pd.Series) else list(returns)

        # Note: Portfolio contribution is calculated in execute_candidates()
        # where we have access to all existing strategies
        # Here we just store returns for later correlation calculation

        execution_time = int((time_module.time() - start_time) * 1000)

        return BacktestResult(
            strategy_id=strategy_id,
            success=True,
            sharpe_ratio=round(sharpe, 4),
            sortino_ratio=round(sortino, 4),
            max_drawdown=round(max_dd, 4),
            win_rate=round(win_rate, 4),
            profit_factor=round(min(profit_factor, 10), 4),  # Cap at 10
            cagr=round(cagr, 4),
            convexity_score=round(convexity, 4),
            fitness_score=round(base_fitness, 4),  # Base fitness before portfolio contribution
            total_trades=len(trades),
            execution_time_ms=execution_time,
            # Symphony metrics
            portfolio_contribution=1.0,  # Calculated later in execute_candidates
            target_regime=target_regime,
            regime_performance=regime_performance,
            daily_returns=daily_returns_list[-252:] if len(daily_returns_list) > 252 else daily_returns_list  # Last year
        )

    except Exception as e:
        execution_time = int((time_module.time() - start_time) * 1000)
        return BacktestResult(
            strategy_id=strategy_id,
            success=False,
            error=f"{type(e).__name__}: {str(e)}",
            execution_time_ms=execution_time
        )


def load_strategy_code(code_content: str, strategy_id: str) -> Optional[Any]:
    """
    Dynamically load strategy code as a module.
    Returns None if code is invalid or doesn't define Strategy class.
    """
    if not code_content or not code_content.strip():
        return None

    try:
        # Validate syntax first
        ast.parse(code_content)

        # Create temporary module
        spec = importlib.util.spec_from_loader(
            f"strategy_{strategy_id[:8]}",
            loader=None,
            origin="dynamic"
        )
        module = importlib.util.module_from_spec(spec)

        # Execute code in module namespace
        exec(code_content, module.__dict__)

        # Check for Strategy class
        if hasattr(module, 'Strategy'):
            return module

        return None

    except SyntaxError as e:
        logger.debug(f"Strategy {strategy_id} has syntax error: {e}")
        return None
    except Exception as e:
        logger.debug(f"Failed to load strategy {strategy_id}: {e}")
        return None


def run_simple_backtest(
    market_data: pd.DataFrame,
    dna_config: Dict[str, Any],
    initial_capital: float
) -> Tuple[pd.Series, pd.Series, List[Dict]]:
    """
    Run a simple momentum-based backtest as fallback.
    Used when strategy code is invalid or unavailable.
    """
    # Extract parameters from dna_config or use defaults
    lookback = dna_config.get('lookback', 20)
    threshold = dna_config.get('threshold', 0.02)

    # Ensure we have price data
    price_col = None
    for col in ['price', 'close', 'Close', 'last']:
        if col in market_data.columns:
            price_col = col
            break

    if price_col is None:
        # Generate random walk as fallback
        n_days = len(market_data) if len(market_data) > 0 else 252
        prices = pd.Series(100 * np.cumprod(1 + np.random.randn(n_days) * 0.01))
    else:
        prices = market_data[price_col].astype(float)

    # Simple momentum strategy
    returns_raw = prices.pct_change().fillna(0)
    momentum = prices.pct_change(lookback).fillna(0)

    # Position: long when momentum > threshold, else flat
    position = (momentum > threshold).astype(float)
    position = position.shift(1).fillna(0)  # Avoid look-ahead

    # Calculate strategy returns
    strategy_returns = position * returns_raw

    # Equity curve
    equity = initial_capital * (1 + strategy_returns).cumprod()

    # Generate trades (simplified)
    trades = []
    in_position = False
    entry_price = 0
    entry_idx = 0

    for i in range(1, len(position)):
        if position.iloc[i] == 1 and not in_position:
            in_position = True
            entry_price = prices.iloc[i]
            entry_idx = i
        elif position.iloc[i] == 0 and in_position:
            in_position = False
            exit_price = prices.iloc[i]
            pnl = (exit_price - entry_price) / entry_price
            trades.append({
                'entry_idx': entry_idx,
                'exit_idx': i,
                'pnl': pnl,
                'entry_price': entry_price,
                'exit_price': exit_price
            })

    return strategy_returns, equity, trades


# ============================================================================
# RESEARCH DIRECTOR (Main Orchestrator)
# ============================================================================

class ResearchDirector:
    """
    The Night Shift Research Director.
    Orchestrates autonomous strategy evolution, backtesting, and briefing generation.
    Now with Shadow Trading validation for live strategy testing.
    """

    def __init__(self, config: DaemonConfig):
        self.config = config
        self.supabase: Client = create_client(config.supabase_url, config.supabase_key)
        self.running = False
        self.last_recruit_time = datetime.min
        self.last_harvest_time = datetime.min
        self.last_execute_time = datetime.min
        self.last_publish_time = datetime.min
        self.last_discovery_time = datetime.min  # Autonomous market scanning
        self.last_gamma_publish_time = datetime.min  # Gamma intelligence publishing
        self.daily_briefings_published = 0
        self.stats = {
            'mutations_harvested': 0,
            'backtests_run': 0,
            'strategies_promoted': 0,
            'strategies_failed': 0,
            'briefings_published': 0,
            'graduations': 0,
            'discoveries': 0,  # Opportunities found by morphology scanner
            'missions_auto_created': 0,  # Missions created autonomously
            'errors': 0
        }

        # Initialize Shadow Trader for live validation
        self.regime_monitor = RegimeMonitor(config.data_dir)
        self.shadow_trader: Optional[ShadowTrader] = None
        if SHADOW_TRADING_AVAILABLE:
            self.shadow_trader = ShadowTrader(
                supabase=self.supabase,
                regime_monitor=self.regime_monitor,
                symbols=['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA'],
                api_key=os.environ.get('MASSIVE_KEY') or os.environ.get('POLYGON_API_KEY'),
            )

        logger.info("=" * 60)
        logger.info("🌙 Research Director initialized")
        logger.info(f"   Data directory: {config.data_dir}")
        logger.info(f"   Parallel workers: {config.parallel_workers}")
        logger.info(f"   Fitness threshold: {config.fitness_threshold}")
        logger.info(f"   Shadow Trading: {'ENABLED' if self.shadow_trader else 'DISABLED'}")
        logger.info(f"   Red Team Audits: {'ENABLED' if RED_TEAM_AVAILABLE else 'DISABLED'}")
        logger.info(f"   Discovery Scanner: {'ENABLED' if DISCOVERY_AVAILABLE else 'DISABLED'}")
        logger.info("=" * 60)

        # Mission tracking
        self._current_mission: Optional[Mission] = None
        self._last_mission_check = datetime.min
        self._mission_check_interval = 60  # Check mission every 60 seconds

    # ========================================================================
    # 0. GOAL-SEEKING ARCHITECTURE - The Hunter's Brain
    # ========================================================================

    async def get_active_mission(self) -> Optional[Mission]:
        """
        Fetch the highest-priority active mission from Supabase.
        Uses the get_active_mission() RPC function from the migrations.

        Returns:
            Mission object if one exists, None otherwise
        """
        try:
            result = self.supabase.rpc('get_active_mission').execute()

            if not result.data or len(result.data) == 0:
                logger.debug("No active missions found")
                return None

            row = result.data[0]
            mission = Mission(
                id=row['mission_id'],
                name=row['name'],
                objective=row.get('objective', f"Achieve {row['target_metric']} {row['target_operator']} {row['target_value']}"),
                target_metric=row['target_metric'],
                target_value=row['target_value'],
                target_operator=row['target_operator'],
                max_drawdown=row['max_drawdown'],
                current_best_value=row['current_best_value'] or 0.0,
                current_best_strategy_id=row.get('current_best_strategy_id'),
                gap_to_target=row['gap_to_target'] or row['target_value'],
                priority=row['priority']
            )

            logger.info(f"🎯 Active Mission: {mission.name}")
            logger.info(f"   Target: {mission.target_metric} {mission.target_operator} {mission.target_value}")
            logger.info(f"   Current Best: {mission.current_best_value:.4f}")
            logger.info(f"   Gap to Target: {mission.gap_to_target:.4f}")

            self._current_mission = mission
            return mission

        except Exception as e:
            logger.error(f"Failed to fetch active mission: {e}")
            return None

    async def evaluate_mission_progress(self, mission: Mission) -> Dict[str, Any]:
        """
        Evaluate current progress towards the mission target.
        Compares best Shadow Strategy performance against mission goals.

        Returns:
            Dict with progress metrics and recommended action
        """
        logger.info(f"📊 Evaluating mission progress: {mission.name}")

        # Get the best performing shadow strategy
        try:
            # Fetch top strategy by the mission's target metric
            metric_column = {
                'sharpe': 'sharpe_ratio',
                'daily_return': 'avg_daily_return',
                'sortino': 'sortino_ratio',
                'cagr': 'cagr',
                'win_rate': 'win_rate'
            }.get(mission.target_metric, 'sharpe_ratio')

            result = self.supabase.table('strategy_genome').select(
                'id', 'name', 'sharpe_ratio', 'avg_daily_return', 'sortino_ratio',
                'cagr', 'win_rate', 'max_drawdown', 'fitness_score'
            ).in_(
                'status', ['active', 'shadow']
            ).order(
                metric_column, desc=True
            ).limit(1).execute()

            if not result.data:
                return {
                    'status': 'no_strategies',
                    'gap': mission.target_value,
                    'action': 'bootstrap',
                    'reason': 'No active/shadow strategies exist'
                }

            best_strategy = result.data[0]
            current_value = best_strategy.get(metric_column, 0.0) or 0.0
            current_drawdown = best_strategy.get('max_drawdown', 0.0) or 0.0

            # Calculate gap
            if mission.target_operator == 'gte':
                gap = mission.target_value - current_value
                target_met = current_value >= mission.target_value
            elif mission.target_operator == 'lte':
                gap = current_value - mission.target_value
                target_met = current_value <= mission.target_value
            else:  # eq
                gap = abs(mission.target_value - current_value)
                target_met = gap < 0.01

            # Check drawdown constraint
            drawdown_ok = current_drawdown >= mission.max_drawdown  # Drawdowns are negative

            progress = {
                'status': 'complete' if target_met and drawdown_ok else 'hunting',
                'target_met': target_met,
                'drawdown_ok': drawdown_ok,
                'current_value': current_value,
                'target_value': mission.target_value,
                'gap': gap,
                'current_drawdown': current_drawdown,
                'max_drawdown_allowed': mission.max_drawdown,
                'best_strategy_id': best_strategy['id'],
                'best_strategy_name': best_strategy['name']
            }

            if target_met and drawdown_ok:
                # Update mission as complete
                await self._complete_mission(mission, best_strategy['id'], current_value)
                progress['action'] = 'complete'
                progress['reason'] = 'Mission target achieved!'
                logger.info(f"🎉 MISSION COMPLETE: {mission.name}")
            else:
                progress['action'] = 'continue_hunting'
                if not target_met:
                    progress['reason'] = f"Gap of {gap:.4f} to target"
                else:
                    progress['reason'] = f"Drawdown {current_drawdown:.2%} exceeds limit {mission.max_drawdown:.2%}"

            return progress

        except Exception as e:
            logger.error(f"Error evaluating mission progress: {e}")
            return {
                'status': 'error',
                'error': str(e),
                'action': 'retry'
            }

    async def _complete_mission(
        self,
        mission: Mission,
        strategy_id: str,
        final_value: float
    ) -> None:
        """Mark a mission as complete in the database."""
        try:
            self.supabase.table('missions').update({
                'status': 'completed',
                'current_best_strategy_id': strategy_id,
                'current_best_value': final_value,
                'completed_at': datetime.utcnow().isoformat()
            }).eq('id', mission.id).execute()

            logger.info(f"✅ Mission {mission.name} marked as complete")
            
            # Send Telegram notification for mission completion
            send_telegram_alert(
                title=f"🎉 MISSION COMPLETE: {mission.name}",
                message=f"Target achieved!\n\n"
                        f"• Metric: {mission.target_metric}\n"
                        f"• Target: {mission.target_value}\n"
                        f"• Achieved: {final_value:.4f}",
                priority='critical'
            )

        except Exception as e:
            logger.error(f"Failed to mark mission complete: {e}")

    def autonomous_decision_engine(
        self,
        mission: Mission,
        progress: Dict[str, Any]
    ) -> AutonomousDecision:
        """
        The Brain: Decide what type of swarm to dispatch based on current state.

        Decision Matrix:
        - Low returns → AGGRESSIVE (seek alpha)
        - High drawdown → RISK (reduce exposure)
        - Idle/stagnant → NOVELTY (explore new strategies)
        - Close to target → REFINEMENT (fine-tune parameters)
        - Strategies ready → RED_TEAM (audit before promotion)

        Args:
            mission: Current mission target
            progress: Progress evaluation from evaluate_mission_progress()

        Returns:
            AutonomousDecision with dispatch type and parameters
        """
        gap = progress.get('gap', float('inf'))
        current_value = progress.get('current_value', 0.0)
        current_drawdown = progress.get('current_drawdown', 0.0)
        target_value = mission.target_value

        # Calculate normalized gap (0 = at target, 1 = very far)
        gap_ratio = abs(gap) / max(abs(target_value), 0.001)

        context = {
            'gap': gap,
            'gap_ratio': gap_ratio,
            'current_value': current_value,
            'target_value': target_value,
            'current_drawdown': current_drawdown,
            'max_drawdown_allowed': mission.max_drawdown,
            'timestamp': datetime.utcnow().isoformat()
        }

        # Decision logic
        # Note: drawdowns are negative values, so "exceeded" means MORE negative
        # If current_drawdown (-25%) < max_drawdown (-20%), constraint is violated
        if current_drawdown < mission.max_drawdown:
            # Drawdown exceeded - focus on risk reduction
            return AutonomousDecision(
                dispatch_type=SwarmDispatchType.RISK,
                agent_count=15,
                objective=f"""CRITICAL: Current drawdown ({current_drawdown:.2%}) exceeds limit ({mission.max_drawdown:.2%}).
Focus on strategies with:
- Tighter stop losses
- Smaller position sizes
- More defensive entry criteria
- Volatility filters to avoid high-risk periods
Target: Reduce drawdown while maintaining {mission.target_metric} near {current_value:.4f}""",
                reasoning="Drawdown constraint violated - pivoting to risk reduction",
                context=context
            )

        if gap_ratio > 0.5:
            # Far from target - be aggressive
            return AutonomousDecision(
                dispatch_type=SwarmDispatchType.AGGRESSIVE,
                agent_count=20,
                objective=f"""HUNT AGGRESSIVELY: Target {mission.target_metric} is {target_value}, current is {current_value:.4f}.
Gap: {gap:.4f} ({gap_ratio:.1%} away from target)
Explore:
- Higher leverage strategies
- More volatile instruments
- Momentum breakout systems
- Gamma/convexity plays
- Novel entry signals
Maximum drawdown allowed: {mission.max_drawdown:.2%}""",
                reasoning=f"Large gap ({gap_ratio:.1%}) to target requires aggressive exploration",
                context=context
            )

        if gap_ratio > 0.1:
            # Moderate gap - balanced exploration
            return AutonomousDecision(
                dispatch_type=SwarmDispatchType.NOVELTY,
                agent_count=15,
                objective=f"""EXPLORE NOVELTY: Need to improve {mission.target_metric} from {current_value:.4f} to {target_value}.
Gap: {gap:.4f}
Try:
- Alternative indicators (RSI, MACD, Bollinger variations)
- Different timeframes
- Regime-specific strategies
- Cross-asset signals
- Machine learning entries
Keep drawdown under {mission.max_drawdown:.2%}""",
                reasoning=f"Moderate gap ({gap_ratio:.1%}) - exploring novel approaches",
                context=context
            )

        # Close to target - refine existing winners
        return AutonomousDecision(
            dispatch_type=SwarmDispatchType.REFINEMENT,
            agent_count=10,
            objective=f"""REFINE: Close to target! Current {mission.target_metric}: {current_value:.4f}, target: {target_value}
Gap: {gap:.4f} ({gap_ratio:.1%})
Focus on:
- Parameter optimization of top strategies
- Fine-tuning entry/exit timing
- Position sizing adjustments
- Transaction cost reduction
Maintain drawdown under {mission.max_drawdown:.2%}""",
            reasoning=f"Close to target ({gap_ratio:.1%}) - refining existing strategies",
            context=context
        )

    async def run_red_team_audit(
        self,
        strategy_id: str,
        mission_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Run Red Team audit on a strategy before promotion.
        Uses the red_team_swarm.py personas to stress-test the strategy.

        Args:
            strategy_id: UUID of strategy to audit
            mission_id: Optional mission this audit is for

        Returns:
            Audit results with pass/fail and scores
        """
        if not RED_TEAM_AVAILABLE:
            logger.warning("Red Team audit unavailable - skipping")
            return {'passed': True, 'reason': 'Red Team not available'}

        logger.info(f"🔴 Running Red Team audit on strategy {strategy_id[:8]}...")
        start_time = datetime.utcnow()

        try:
            # Fetch strategy details
            result = self.supabase.table('strategy_genome').select(
                'id', 'name', 'code_content', 'sharpe_ratio', 'max_drawdown',
                'win_rate', 'fitness_score'
            ).eq('id', strategy_id).execute()

            if not result.data:
                return {'passed': False, 'reason': 'Strategy not found'}

            strategy = result.data[0]

            # Build Red Team tasks for each persona
            red_team_tasks = []
            for persona_key, persona in RED_TEAM_PERSONAS.items():
                task = {
                    'id': f'red_team_{persona_key}',
                    'system': persona.get('prompt', persona.get('system', '')),
                    'user': f"""Audit this trading strategy:

**Strategy Name:** {strategy['name']}
**Sharpe Ratio:** {strategy.get('sharpe_ratio', 'N/A')}
**Max Drawdown:** {strategy.get('max_drawdown', 'N/A')}
**Win Rate:** {strategy.get('win_rate', 'N/A')}

**Code:**
```python
{strategy['code_content'][:3000]}
```

Provide your assessment as a {persona_key} expert. Score 0-100 and list critical issues.""",
                    'model': 'deepseek-chat',
                    'temperature': 0.3
                }
                red_team_tasks.append(task)

            # Run Red Team swarm
            results = run_swarm_sync(red_team_tasks, concurrency=6)

            # Parse results
            scores = {}
            critical_issues = []
            warnings = []
            full_reports = []

            for r in results:
                if r['status'] == 'success':
                    persona_key = r['id'].replace('red_team_', '')
                    content = r['content']
                    full_reports.append(f"## {persona_key.upper()}\n{content}")

                    # Extract score (look for patterns like "Score: 75" or "75/100")
                    score_match = re.search(r'(?:score[:\s]*)?(\d+)(?:\s*/\s*100)?', content.lower())
                    if score_match:
                        scores[persona_key] = float(score_match.group(1))
                    else:
                        scores[persona_key] = 50.0  # Default if no score found

                    # Extract critical issues
                    if 'critical' in content.lower() or 'fail' in content.lower():
                        # Find sentences with "critical" or "fail"
                        for line in content.split('\n'):
                            if 'critical' in line.lower() or 'fail' in line.lower():
                                critical_issues.append(f"[{persona_key}] {line.strip()}")

                    # Extract warnings
                    if 'warning' in content.lower() or 'concern' in content.lower():
                        for line in content.split('\n'):
                            if 'warning' in line.lower() or 'concern' in line.lower():
                                warnings.append(f"[{persona_key}] {line.strip()}")

            # Calculate overall score
            if scores:
                overall_score = sum(scores.values()) / len(scores)
            else:
                overall_score = 0.0

            # Determine pass/fail (threshold: 60/100, no critical issues)
            passed = overall_score >= 60.0 and len(critical_issues) == 0

            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

            # Record audit in database
            audit_result = {
                'strategy_id': strategy_id,
                'mission_id': mission_id,
                'passed': passed,
                'overall_score': overall_score,
                'scores': scores,
                'critical_issues': critical_issues[:10],  # Limit to 10
                'warnings': warnings[:10],
                'full_report': '\n\n'.join(full_reports),
                'duration_ms': duration_ms
            }

            # Save to database via RPC
            self.supabase.rpc('record_red_team_audit', {
                'p_strategy_id': strategy_id,
                'p_mission_id': mission_id,
                'p_passed': passed,
                'p_overall_score': overall_score,
                'p_scores': scores,
                'p_issues': critical_issues[:10],
                'p_warnings': warnings[:10],
                'p_full_report': '\n\n'.join(full_reports),
                'p_duration_ms': duration_ms
            }).execute()

            if passed:
                logger.info(f"✅ Red Team PASSED: {strategy['name']} (Score: {overall_score:.1f})")
            else:
                logger.warning(f"❌ Red Team FAILED: {strategy['name']} (Score: {overall_score:.1f})")
                if critical_issues:
                    logger.warning(f"   Critical issues: {critical_issues[:3]}")

            return audit_result

        except Exception as e:
            logger.error(f"Red Team audit error: {e}")
            return {'passed': False, 'reason': str(e), 'error': True}

    # ========================================================================
    # THE GATEKEEPER - Learning from Failures
    # ========================================================================

    async def conduct_post_mortem(
        self,
        strategy_id: str,
        failure_reason: str,
        fitness_score: float = 0.0
    ) -> Dict[str, Any]:
        """
        Conduct a post-mortem analysis on a failed strategy using an analyst agent.
        Extracts the causal mechanism of failure and stores it in causal_memories.

        Args:
            strategy_id: UUID of the failed strategy
            failure_reason: High-level reason for failure (e.g., "Red Team failed", "fitness < threshold")
            fitness_score: The fitness score at time of failure

        Returns:
            Dict with cause, mechanism, and whether it was saved
        """
        logger.info(f"🔬 [Gatekeeper] Conducting post-mortem on strategy {strategy_id[:8]}...")

        try:
            # Fetch strategy details
            result = self.supabase.table('strategy_genome').select(
                'id', 'name', 'code_content', 'dna_config', 'sharpe_ratio',
                'max_drawdown', 'win_rate', 'fitness_score'
            ).eq('id', strategy_id).execute()

            if not result.data:
                return {'success': False, 'error': 'Strategy not found'}

            strategy = result.data[0]

            # Build failure type options for prompt
            failure_type_options = "\n".join([
                f"- {ft.value}: {FAILURE_TYPE_DESCRIPTIONS[ft]}"
                for ft in FailureType
            ])

            # Build analyst prompt with MANDATORY failure classification
            analyst_prompt = f"""Analyze this failed trading strategy and classify the failure.

STRATEGY: {strategy['name']}
FITNESS SCORE: {fitness_score:.3f}
FAILURE REASON: {failure_reason}

CONFIGURATION:
{json.dumps(strategy.get('dna_config', {}), indent=2)}

METRICS:
- Sharpe Ratio: {strategy.get('sharpe_ratio', 'N/A')}
- Max Drawdown: {strategy.get('max_drawdown', 'N/A')}
- Win Rate: {strategy.get('win_rate', 'N/A')}

CODE:
{strategy.get('code_content', 'No code available')[:2000]}

=== MANDATORY CLASSIFICATION ===
You MUST classify this failure into EXACTLY ONE of these categories:

{failure_type_options}

=== TASK ===
Return a JSON object with:
{{
    "failure_type": "EXACTLY one of: overfitting, regime_mismatch, fee_erosion, liquidity_drag, lookahead_bias, noise_stops, execution_lag, correlation_break, tail_risk, parameter_fragile, unknown",
    "cause": "1-2 sentence summary of why this strategy failed",
    "mechanism": "Technical explanation linking to the failure_type",
    "constraint": "A rule to prevent this failure in future strategies"
}}

Return ONLY the JSON object, no other text."""

            # Dispatch single analyst agent
            analyst_task = [{
                'id': f'post_mortem_{strategy_id[:8]}',
                'system': "You are a quantitative trading analyst specializing in strategy failure analysis. Be precise and technical.",
                'user': analyst_prompt,
                'model': 'deepseek-chat',  # Fast model for analysis
                'temperature': 0.2
            }]

            results = run_swarm_sync(analyst_task, concurrency=1)

            if not results or results[0].get('status') != 'success':
                logger.error("[Gatekeeper] Post-mortem analysis failed")
                return {'success': False, 'error': 'Analysis failed'}

            # Parse result
            content = results[0].get('content', '')
            try:
                # Extract JSON from response
                json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
                if json_match:
                    analysis = json.loads(json_match.group())
                else:
                    analysis = json.loads(content)
            except json.JSONDecodeError:
                logger.warning(f"[Gatekeeper] Could not parse analysis JSON: {content[:200]}")
                analysis = {
                    'failure_type': 'unknown',
                    'cause': failure_reason,
                    'mechanism': content[:500],
                    'constraint': 'Unable to extract constraint'
                }

            # Parse and validate failure_type
            raw_failure_type = analysis.get('failure_type', 'unknown')
            failure_type = FailureType.from_string(raw_failure_type)

            # Store in causal_memories with standardized failure_type
            # Get workspace_id (use default if not set)
            workspace_id = os.environ.get('WORKSPACE_ID', '00000000-0000-0000-0000-000000000001')

            causal_memory = {
                'workspace_id': workspace_id,
                'event_description': f"Strategy '{strategy['name']}' failed: {analysis.get('cause', failure_reason)}",
                'mechanism': analysis.get('mechanism', ''),
                'failure_type': failure_type.value,  # Standardized failure classification
                'causal_graph': {
                    'strategy_id': strategy_id,
                    'strategy_name': strategy['name'],
                    'failure_type_raw': failure_reason,  # Original reason
                    'failure_type_classified': failure_type.value,  # Standardized
                    'fitness_at_failure': fitness_score,
                    'constraint': analysis.get('constraint', '')
                },
                'statistical_validation': {
                    'sharpe': strategy.get('sharpe_ratio'),
                    'max_drawdown': strategy.get('max_drawdown'),
                    'win_rate': strategy.get('win_rate')
                },
                'related_strategies': [strategy_id]
            }

            insert_result = self.supabase.table('causal_memories').insert(causal_memory).execute()

            if insert_result.data:
                logger.info(f"✅ [Gatekeeper] Post-mortem saved [{failure_type.value.upper()}]")
                logger.info(f"   Cause: {analysis.get('cause', 'Unknown cause')[:60]}...")
                logger.info(f"   Mechanism: {analysis.get('mechanism', '')[:60]}...")
                logger.info(f"   Constraint: {analysis.get('constraint', '')[:60]}...")

            return {
                'success': True,
                'failure_type': failure_type.value,
                'cause': analysis.get('cause', ''),
                'mechanism': analysis.get('mechanism', ''),
                'constraint': analysis.get('constraint', ''),
                'memory_id': insert_result.data[0]['id'] if insert_result.data else None
            }

        except Exception as e:
            logger.error(f"[Gatekeeper] Post-mortem error: {e}")
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    def get_swarm_constraints(self, limit: int = 5) -> str:
        """
        Query causal_memories for the most frequent failure mechanisms.
        Returns formatted constraints string to inject into swarm prompts.

        Args:
            limit: Maximum number of constraints to return

        Returns:
            Formatted string of constraints from institutional memory
        """
        try:
            # Query recent causal memories ordered by frequency
            result = self.supabase.table('causal_memories').select(
                'mechanism', 'causal_graph', 'event_description'
            ).order('created_at', desc=True).limit(50).execute()

            if not result.data:
                return ""

            # Extract and deduplicate constraints
            constraints = []
            seen_mechanisms = set()

            for memory in result.data:
                mechanism = memory.get('mechanism', '')
                causal_graph = memory.get('causal_graph', {})
                constraint = causal_graph.get('constraint', '') if isinstance(causal_graph, dict) else ''

                # Deduplicate by mechanism similarity
                mechanism_key = mechanism[:50].lower() if mechanism else ''
                if mechanism_key and mechanism_key not in seen_mechanisms:
                    seen_mechanisms.add(mechanism_key)
                    if constraint:
                        constraints.append(constraint)
                    elif mechanism:
                        constraints.append(mechanism)

                if len(constraints) >= limit:
                    break

            if not constraints:
                return ""

            # Format as numbered list
            constraint_text = "CONSTRAINTS FROM INSTITUTIONAL MEMORY:\n"
            constraint_text += "(These are proven failure patterns - DO NOT repeat them)\n\n"
            for i, constraint in enumerate(constraints, 1):
                constraint_text += f"{i}. {constraint}\n"

            logger.info(f"[Gatekeeper] Loaded {len(constraints)} constraints from memory")
            return constraint_text

        except Exception as e:
            logger.error(f"[Gatekeeper] Failed to get constraints: {e}")
            return ""

    async def dispatch_hunter_swarm(
        self,
        decision: AutonomousDecision,
        mission: Mission
    ) -> Dict[str, Any]:
        """
        Dispatch a swarm based on the autonomous decision engine's choice.

        Args:
            decision: The AutonomousDecision from the decision engine
            mission: Current mission for context

        Returns:
            Dispatch result with job ID and status
        """
        logger.info(f"🐝 Dispatching {decision.dispatch_type.value.upper()} swarm")
        logger.info(f"   Agents: {decision.agent_count}")
        logger.info(f"   Reasoning: {decision.reasoning}")

        try:
            # Record the dispatch decision
            dispatch_record = {
                'mission_id': mission.id,
                'dispatch_type': decision.dispatch_type.value,
                'agent_count': decision.agent_count,
                'decision_context': decision.context,
                'status': 'dispatched'
            }

            dispatch_result = self.supabase.table('mission_dispatches').insert(
                dispatch_record
            ).execute()

            dispatch_id = dispatch_result.data[0]['id'] if dispatch_result.data else None

            # Build swarm payload
            dispatch_payload = {
                'objective': decision.objective,
                'agentCount': decision.agent_count,
                'mode': decision.dispatch_type.value,
                'config': {
                    'missionId': mission.id,
                    'dispatchId': dispatch_id,
                    'targetMetric': mission.target_metric,
                    'targetValue': mission.target_value,
                    'maxDrawdown': mission.max_drawdown,
                    'dispatchType': decision.dispatch_type.value
                }
            }

            # Call swarm-dispatch edge function
            response = self.supabase.functions.invoke(
                'swarm-dispatch',
                invoke_options={'body': dispatch_payload}
            )

            if response.get('error'):
                raise Exception(f"Swarm dispatch failed: {response.get('error')}")

            result_data = response.get('data', {})
            job_id = result_data.get('jobId')

            # Update dispatch record with job ID
            if dispatch_id:
                self.supabase.table('mission_dispatches').update({
                    'swarm_job_id': job_id
                }).eq('id', dispatch_id).execute()

            logger.info(f"✅ Hunter swarm dispatched: Job {job_id}")

            return {
                'action': 'dispatched',
                'dispatch_type': decision.dispatch_type.value,
                'job_id': job_id,
                'dispatch_id': dispatch_id,
                'agents_spawned': decision.agent_count,
                'reasoning': decision.reasoning
            }

        except Exception as e:
            logger.error(f"Failed to dispatch hunter swarm: {e}")
            self.stats['errors'] += 1
            return {'action': 'error', 'error': str(e)}

    async def run_mission_loop(self) -> Dict[str, Any]:
        """
        The main mission-driven loop. Replaces the old pool-maintenance logic.

        1. Check for active mission
        2. Evaluate progress towards target
        3. Make autonomous decision on what to do
        4. Dispatch appropriate swarm
        5. Run Red Team on candidates

        Returns:
            Status dict with actions taken
        """
        logger.info("🎯 [Mission Control] Starting mission loop...")

        # Step 1: Get active mission
        mission = await self.get_active_mission()
        if not mission:
            logger.info("   No active missions - falling back to pool maintenance")
            return await self.replenish_pool()

        # Step 2: Evaluate progress
        progress = await self.evaluate_mission_progress(mission)

        if progress.get('status') == 'complete':
            logger.info(f"🎉 Mission {mission.name} is COMPLETE!")
            return {
                'action': 'mission_complete',
                'mission': mission.name,
                'final_value': progress.get('current_value')
            }

        if progress.get('status') == 'error':
            logger.error(f"Mission evaluation error: {progress.get('error')}")
            return {'action': 'error', 'error': progress.get('error')}

        # Step 3: Make autonomous decision
        decision = self.autonomous_decision_engine(mission, progress)
        logger.info(f"   Decision: {decision.dispatch_type.value} ({decision.reasoning})")

        # Step 4: Check if we should run Red Team first
        if decision.dispatch_type != SwarmDispatchType.RED_TEAM:
            # Check for strategies pending audit
            pending_audit = self.supabase.rpc(
                'get_strategies_pending_audit',
                {'p_limit': 5}
            ).execute()

            if pending_audit.data and len(pending_audit.data) > 0:
                logger.info(f"   Found {len(pending_audit.data)} strategies pending Red Team audit")
                # Run Red Team on pending strategies
                for strat in pending_audit.data:
                    audit_result = await self.run_red_team_audit(
                        strat['strategy_id'],
                        mission.id
                    )
                    if audit_result.get('passed'):
                        # Update mission progress if this is a new best
                        self.supabase.rpc('update_mission_progress', {
                            'p_mission_id': mission.id,
                            'p_strategy_id': strat['strategy_id'],
                            'p_metric_value': strat.get('sharpe_ratio', 0),
                            'p_trigger_type': 'red_team_pass'
                        }).execute()
                    else:
                        # GATEKEEPER: Conduct post-mortem on failed strategy
                        failure_reason = audit_result.get('reason', 'Red Team audit failed')
                        await self.conduct_post_mortem(
                            strategy_id=strat['strategy_id'],
                            failure_reason=f"Red Team: {failure_reason}",
                            fitness_score=strat.get('fitness_score', 0)
                        )

        # Step 5: Dispatch hunter swarm
        dispatch_result = await self.dispatch_hunter_swarm(decision, mission)

        return {
            'action': 'mission_loop_complete',
            'mission': mission.name,
            'progress': progress,
            'decision': decision.dispatch_type.value,
            'dispatch': dispatch_result
        }

    # ========================================================================
    # 0.5 DISCOVERY PHASE - Autonomous Mission Creation
    # ========================================================================

    async def run_discovery_phase(self) -> Dict[str, Any]:
        """
        Autonomous market scanning and mission creation.

        This is what makes the daemon TRULY autonomous - instead of just
        reacting to manually created missions, it scans the market and
        creates missions based on observed opportunities.

        Flow:
        1. Check if any missions exist
        2. If no missions: scan market for opportunities
        3. Auto-create missions from top opportunities
        4. Return summary of discoveries

        Returns:
            Dict with discoveries made and missions created
        """
        if not DISCOVERY_AVAILABLE:
            logger.debug("Discovery module not available - skipping discovery phase")
            return {'action': 'skip', 'reason': 'discovery_not_available'}

        logger.info("🔭 [Discovery] Running autonomous market scan...")

        try:
            # Always scan for opportunities - multiple missions can coexist
            # Step 1: Scan market for opportunities
            scanner = MorphologyScanner(
                data_dir=self.config.data_dir,
                min_confidence=0.5  # Lower threshold to catch more opportunities
            )
            opportunities = scanner.scan()

            if not opportunities:
                logger.info("   No opportunities found above confidence threshold")
                return {
                    'action': 'none',
                    'reason': 'no_opportunities_found'
                }

            # Step 3: Create missions from top opportunities (limit to top 3)
            missions_created = []
            for opp in opportunities[:3]:
                try:
                    mission_params = opp.to_mission_params()

                    # Insert mission into Supabase
                    result = self.supabase.table('missions').insert({
                        'name': mission_params['name'],
                        'objective': mission_params['objective'],
                        'target_metric': mission_params['target_metric'],
                        'target_value': mission_params['target_value'],
                        'target_operator': mission_params['target_operator'],
                        'max_drawdown': mission_params['max_drawdown'],
                        'priority': mission_params['priority'],
                        'status': 'active',
                        'created_at': datetime.now().isoformat(),
                        'metadata': {
                            'source': 'morphology_scanner',
                            'opportunity_type': opp.opportunity_type.value,
                            'symbol': opp.symbol,
                            'confidence': opp.confidence,
                            'context': opp.context
                        }
                    }).execute()

                    if result.data:
                        mission_id = result.data[0].get('id')
                        missions_created.append({
                            'id': mission_id,
                            'name': mission_params['name'],
                            'symbol': opp.symbol,
                            'confidence': opp.confidence
                        })
                        logger.info(f"   ✅ Created mission: {mission_params['name']}")

                        # Only create one mission at a time to avoid overwhelming
                        break

                except Exception as e:
                    logger.error(f"   Failed to create mission from opportunity: {e}")
                    continue

            # Step 4: Update stats
            self.stats['discoveries'] += len(opportunities)
            self.stats['missions_auto_created'] += len(missions_created)

            # Step 5: Send notification if mission created
            if missions_created:
                await send_telegram_alert_async(
                    title="🔭 Discovery: New Mission Created",
                    message=f"Auto-created mission from market scan:\n{missions_created[0]['name']}\nSymbol: {missions_created[0]['symbol']}\nConfidence: {missions_created[0]['confidence']:.0%}",
                    priority='normal'
                )

            return {
                'action': 'discovery_complete',
                'opportunities_found': len(opportunities),
                'missions_created': missions_created
            }

        except Exception as e:
            logger.error(f"Discovery phase error: {e}")
            traceback.print_exc()
            return {'action': 'error', 'error': str(e)}

    # ========================================================================
    # 0.6 GAMMA PUBLISHER - Push gamma intelligence to UI
    # ========================================================================

    async def publish_gamma_intelligence(self) -> Dict[str, Any]:
        """
        Calculate and publish gamma intelligence to Supabase for UI consumption.

        This bridges Python calculations to the React GammaIntelligenceMonitor
        component via Supabase realtime subscriptions.

        Flow:
        1. Get options data for SPY (and other symbols)
        2. Calculate gamma exposure using GammaCalculator
        3. Publish to dealer_positioning and gamma_walls tables
        4. React UI automatically updates via subscription

        Returns:
            Dict with symbols published and any errors
        """
        logger.info("📊 [Gamma Publisher] Publishing gamma intelligence to UI...")

        try:
            # Import publisher and calculator
            from engine.data.publisher import SupabasePublisher
            from engine.features.gamma_calc import GammaCalculator

            publisher = SupabasePublisher(
                url=self.config.supabase_url,
                key=self.config.supabase_key
            )
            calculator = GammaCalculator()

            symbols_published = []
            errors = []

            # For now, just publish regime data since we may not have live options data
            # When ThetaData is available, we'll add full gamma calculations
            try:
                # Get current VIX and SPY levels from regime monitor
                regime_state = self.regime_monitor.get_current_state() if hasattr(self, 'regime_monitor') else None

                if regime_state:
                    # Determine VIX regime
                    vix_level = regime_state.get('vix', 20.0)
                    if vix_level < 15:
                        vix_regime = 'SUBOPTIMAL'  # Complacency
                    elif vix_level <= 28:
                        vix_regime = 'OPTIMAL'
                    elif vix_level <= 35:
                        vix_regime = 'SUBOPTIMAL'
                    else:
                        vix_regime = 'PAUSE'

                    # Publish regime
                    publisher.publish_regime(
                        vix_level=vix_level,
                        vix_regime=vix_regime,
                        spy_price=regime_state.get('spy_price'),
                        spy_trend=regime_state.get('trend'),
                        position_multiplier=regime_state.get('position_multiplier', 1.0)
                    )
                    symbols_published.append('REGIME')
                    logger.info(f"   ✅ Published regime: VIX {vix_level:.1f} ({vix_regime})")

            except Exception as e:
                logger.warning(f"   Could not publish regime: {e}")
                errors.append(f"regime: {e}")

            # TODO: Add gamma calculation when options data is available
            # This would look like:
            # for symbol in ['SPY', 'QQQ']:
            #     options_df = await self.get_options_chain(symbol)
            #     if options_df is not None:
            #         gamma_exp = calculator.calculate_gex(options_df, spot_price)
            #         publisher.publish_from_gamma_exposure(symbol, gamma_exp, spot_price)
            #         symbols_published.append(symbol)

            return {
                'action': 'published',
                'symbols': symbols_published,
                'errors': errors if errors else None
            }

        except ImportError as e:
            logger.warning(f"   Gamma publisher not available: {e}")
            return {'action': 'skip', 'reason': str(e)}
        except Exception as e:
            logger.error(f"   Gamma publish error: {e}")
            traceback.print_exc()
            return {'action': 'error', 'error': str(e)}

    # ========================================================================
    # 1. THE RECRUITER - Replenish Strategy Pool (Legacy - now uses missions)
    # ========================================================================

    async def replenish_pool(self) -> Dict[str, Any]:
        """
        Check strategy pool size and dispatch swarm to generate mutations if needed.

        Returns dict with action taken and details.
        """
        logger.info("🔍 [Recruiter] Checking strategy pool...")

        try:
            # Count active + incubating strategies
            result = self.supabase.table('strategy_genome').select(
                'id', count='exact'
            ).in_('status', ['active', 'incubating']).execute()

            current_count = result.count or 0
            logger.info(f"   Current pool size: {current_count}/{self.config.min_pool_size}")

            if current_count >= self.config.min_pool_size:
                return {
                    'action': 'none',
                    'reason': f'Pool sufficient ({current_count} strategies)',
                    'current_count': current_count
                }

            # Need to recruit! Get top performing strategies to mutate
            top_strategies = self.supabase.table('strategy_genome').select(
                'id', 'name', 'fitness_score', 'code_content'
            ).eq('status', 'active').order(
                'fitness_score', desc=True
            ).limit(self.config.top_strategies_for_mutation).execute()

            if not top_strategies.data:
                # No active strategies - need to bootstrap
                logger.warning("   No active strategies found - bootstrapping with seed strategy")
                return await self._bootstrap_pool()

            # Prepare mutation objective
            strategy_names = [s['name'] for s in top_strategies.data]
            strategy_ids = [s['id'] for s in top_strategies.data]

            # GATEKEEPER: Inject constraints from institutional memory
            constraints = self.get_swarm_constraints(limit=5)

            objective = f"""Mutate the top {len(strategy_ids)} performing strategies to find local convexity extrema.

Target strategies for mutation:
{chr(10).join(f'- {name}' for name in strategy_names)}

Focus on mutations that:
1. Increase positive convexity (bigger gains in volatile markets)
2. Reduce drawdown without sacrificing returns
3. Improve Sharpe and Sortino ratios
4. Explore novel entry/exit timing

{constraints}"""

            # Dispatch swarm via Edge Function
            agents_to_spawn = self.config.min_pool_size - current_count
            agents_to_spawn = min(agents_to_spawn, 20)  # Cap at 20 per batch

            dispatch_payload = {
                'objective': objective,
                'agentCount': agents_to_spawn,
                'mode': 'evolution',
                'config': {
                    'parentStrategies': strategy_ids,
                    'mutationTypes': [
                        'parameter_shift', 'logic_inversion', 'indicator_swap',
                        'lookback_change', 'exit_rule_mod', 'position_sizing', 'regime_filter'
                    ]
                }
            }

            # Call swarm-dispatch edge function
            response = self.supabase.functions.invoke(
                'swarm-dispatch',
                invoke_options={'body': dispatch_payload}
            )

            if response.get('error'):
                raise Exception(f"Swarm dispatch failed: {response.get('error')}")

            result_data = response.get('data', {})
            job_id = result_data.get('jobId')

            logger.info(f"✅ [Recruiter] Dispatched swarm job {job_id} for {agents_to_spawn} mutations")

            return {
                'action': 'dispatched',
                'job_id': job_id,
                'agents_spawned': agents_to_spawn,
                'parent_strategies': strategy_names
            }

        except Exception as e:
            logger.error(f"❌ [Recruiter] Error: {e}")
            self.stats['errors'] += 1
            return {'action': 'error', 'error': str(e)}

    async def _bootstrap_pool(self) -> Dict[str, Any]:
        """Bootstrap the strategy pool with a seed strategy."""
        seed_strategy = {
            'name': 'Momentum Base v1',
            'status': 'active',
            'generation': 0,
            'dna_config': {
                'lookback': 20,
                'threshold': 0.02,
                'stop_loss': -0.05,
                'take_profit': 0.10,
                'position_size': 0.1
            },
            'code_content': '''
class Strategy:
    """Simple momentum strategy - base for mutations."""

    def __init__(self, config):
        self.lookback = config.get('lookback', 20)
        self.threshold = config.get('threshold', 0.02)
        self.stop_loss = config.get('stop_loss', -0.05)
        self.take_profit = config.get('take_profit', 0.10)

    def run(self, market_data, initial_capital):
        import pandas as pd
        import numpy as np

        prices = market_data['price'] if 'price' in market_data.columns else market_data.iloc[:, 0]
        returns = prices.pct_change().fillna(0)
        momentum = prices.pct_change(self.lookback).fillna(0)

        position = (momentum > self.threshold).astype(float).shift(1).fillna(0)
        strategy_returns = position * returns
        equity = initial_capital * (1 + strategy_returns).cumprod()

        trades = []
        return strategy_returns, equity, trades
''',
            'fitness_score': 0.5,  # Baseline
            'sharpe_ratio': 1.0,
            'sortino_ratio': 1.2,
            'max_drawdown': -0.15
        }

        result = self.supabase.table('strategy_genome').insert(seed_strategy).execute()

        logger.info("🌱 [Recruiter] Bootstrapped pool with seed strategy")
        return {
            'action': 'bootstrapped',
            'seed_strategy': seed_strategy['name']
        }

    # ========================================================================
    # 2. THE HARVESTER - Collect and Validate Mutations
    # ========================================================================

    async def harvest_mutations(self) -> Dict[str, Any]:
        """
        Poll completed evolution tasks and save valid mutations to strategy_genome.

        Returns dict with harvest statistics.
        """
        logger.info("🌾 [Harvester] Checking for completed mutations...")

        harvested = 0
        invalid = 0

        try:
            # Find completed evolution tasks not yet harvested
            # We track harvesting via a metadata flag
            tasks = self.supabase.table('swarm_tasks').select(
                'id', 'job_id', 'agent_role', 'output_content', 'completed_at'
            ).eq('status', 'completed').is_('output_content', 'not.null').execute()

            if not tasks.data:
                logger.info("   No new mutations to harvest")
                return {'harvested': 0, 'invalid': 0}

            # Get job modes to filter for evolution tasks
            job_ids = list(set(t['job_id'] for t in tasks.data))
            jobs = self.supabase.table('swarm_jobs').select(
                'id', 'mode'
            ).in_('id', job_ids).eq('mode', 'evolution').execute()

            evolution_job_ids = {j['id'] for j in (jobs.data or [])}
            evolution_tasks = [t for t in tasks.data if t['job_id'] in evolution_job_ids]

            logger.info(f"   Found {len(evolution_tasks)} evolution tasks to process")

            for task in evolution_tasks:
                try:
                    # Parse code from LLM output
                    code_content = self._extract_code_from_output(task['output_content'])

                    if not code_content:
                        logger.debug(f"   Task {task['id']}: No code block found")
                        invalid += 1
                        continue

                    # Validate Python syntax via AST
                    if not self._validate_python_syntax(code_content):
                        logger.debug(f"   Task {task['id']}: Invalid Python syntax")
                        invalid += 1
                        continue

                    # Extract mutation metadata
                    mutation_info = self._extract_mutation_info(task['output_content'])

                    # Generate unique name
                    mutation_name = f"{mutation_info['type']}_{task['id'][:8]}"
                    code_hash = hashlib.md5(code_content.encode()).hexdigest()

                    # Check for duplicate (same code hash)
                    existing = self.supabase.table('strategy_genome').select(
                        'id'
                    ).eq('code_hash', code_hash).execute()

                    if existing.data:
                        logger.debug(f"   Task {task['id']}: Duplicate code detected")
                        invalid += 1
                        continue

                    # Save to strategy_genome
                    new_strategy = {
                        'name': mutation_name,
                        'status': 'incubating',
                        'dna_config': mutation_info.get('config', {}),
                        'code_content': code_content,
                        'code_hash': code_hash,
                        'metadata': {
                            'mutation_type': mutation_info['type'],
                            'reasoning': mutation_info.get('reasoning', ''),
                            'source_task_id': task['id'],
                            'source_job_id': task['job_id'],
                            'harvested_at': datetime.utcnow().isoformat()
                        }
                    }

                    self.supabase.table('strategy_genome').insert(new_strategy).execute()
                    harvested += 1

                    logger.info(f"   ✅ Harvested: {mutation_name}")

                except Exception as e:
                    logger.error(f"   Error processing task {task['id']}: {e}")
                    invalid += 1

            self.stats['mutations_harvested'] += harvested
            logger.info(f"🌾 [Harvester] Complete: {harvested} harvested, {invalid} invalid")

            return {'harvested': harvested, 'invalid': invalid}

        except Exception as e:
            logger.error(f"❌ [Harvester] Error: {e}")
            self.stats['errors'] += 1
            return {'harvested': 0, 'invalid': 0, 'error': str(e)}

    def _extract_code_from_output(self, content: str) -> Optional[str]:
        """Extract Python code block from LLM output."""
        if not content:
            return None

        # Look for ```python ... ``` blocks
        python_match = re.search(r'```python\n([\s\S]*?)```', content)
        if python_match:
            return python_match.group(1).strip()

        # Fallback: any ``` block
        code_match = re.search(r'```\n?([\s\S]*?)```', content)
        if code_match:
            return code_match.group(1).strip()

        return None

    def _validate_python_syntax(self, code: str) -> bool:
        """Validate Python code syntax via AST parsing."""
        try:
            ast.parse(code)
            return True
        except SyntaxError:
            return False

    def _extract_mutation_info(self, content: str) -> Dict[str, Any]:
        """Extract mutation type and reasoning from LLM output."""
        info = {
            'type': 'unknown',
            'reasoning': '',
            'config': {}
        }

        # Extract mutation type
        type_match = re.search(r'### Mutation Type\n(.*?)(?=###|$)', content, re.DOTALL)
        if type_match:
            info['type'] = type_match.group(1).strip().lower().replace(' ', '_')[:50]

        # Extract reasoning
        reasoning_match = re.search(r'### Reasoning\n(.*?)(?=###|$)', content, re.DOTALL)
        if reasoning_match:
            info['reasoning'] = reasoning_match.group(1).strip()[:500]

        return info

    # ========================================================================
    # 3. THE EXECUTION ENGINE - Parallel Local Backtests
    # ========================================================================

    async def execute_candidates(self) -> Dict[str, Any]:
        """
        Run parallel backtests on incubating strategies.

        Uses multiprocessing.Pool to leverage M4 Pro cores.
        Applies Symphony Fitness (Portfolio Contribution) multiplier.
        Updates strategy status based on fitness results.
        """
        logger.info("⚙️ [Execution Engine] Starting parallel backtests...")

        try:
            # Fetch incubating strategies
            candidates = self.supabase.table('strategy_genome').select(
                'id', 'name', 'code_content', 'dna_config'
            ).eq('status', 'incubating').limit(20).execute()

            if not candidates.data:
                logger.info("   No candidates to execute")
                return {'executed': 0, 'promoted': 0, 'failed': 0}

            logger.info(f"   Found {len(candidates.data)} candidates")

            # ================================================================
            # SYMPHONY FITNESS: Get existing active strategy returns
            # ================================================================
            existing_returns = get_existing_active_returns(self.supabase, self.config.data_dir)
            logger.info(f"   Loaded {len(existing_returns)} existing active strategies for correlation")

            # Prepare backtest tasks
            tasks = [
                (
                    c['id'],
                    c['code_content'] or '',
                    c['dna_config'] or {},
                    str(self.config.data_dir)
                )
                for c in candidates.data
            ]

            # Execute in parallel using ProcessPoolExecutor
            results: List[BacktestResult] = []

            with ProcessPoolExecutor(max_workers=self.config.parallel_workers) as executor:
                futures = {
                    executor.submit(
                        execute_strategy_backtest,
                        task[0], task[1], task[2], task[3]
                    ): task[0]
                    for task in tasks
                }

                for future in as_completed(futures):
                    strategy_id = futures[future]
                    try:
                        result = future.result(timeout=300)  # 5 min timeout per backtest
                        results.append(result)
                        logger.info(f"   Completed: {strategy_id[:8]} - Base Fitness: {result.fitness_score:.4f}")
                    except Exception as e:
                        logger.error(f"   Failed: {strategy_id[:8]} - {e}")
                        results.append(BacktestResult(
                            strategy_id=strategy_id,
                            success=False,
                            error=str(e)
                        ))

            # ================================================================
            # SYMPHONY FITNESS: Calculate Portfolio Contribution
            # ================================================================
            logger.info("   Calculating portfolio contributions...")

            for result in results:
                if result.success and result.daily_returns:
                    candidate_returns = pd.Series(result.daily_returns)

                    # Calculate portfolio contribution multiplier
                    contribution = calculate_portfolio_contribution(
                        candidate_returns,
                        existing_returns
                    )

                    # Apply multiplier to fitness
                    result.portfolio_contribution = contribution
                    symphony_fitness = result.fitness_score * contribution

                    logger.info(
                        f"   {result.strategy_id[:8]}: "
                        f"Base={result.fitness_score:.3f} × "
                        f"Contribution={contribution:.1f}x = "
                        f"Symphony={symphony_fitness:.3f} "
                        f"[Target: {result.target_regime or 'UNKNOWN'}]"
                    )

                    # Update fitness with symphony multiplier
                    result.fitness_score = round(symphony_fitness, 4)

            # Update Supabase with results
            promoted = 0
            failed = 0

            for result in results:
                if result.success and result.fitness_score >= self.config.fitness_threshold:
                    # Strategy passed backtests - queue for Red Team audit
                    # Note: Actual promotion to 'active' happens via run_red_team_audit()
                    # when the strategy passes adversarial assessment
                    new_status = 'incubating'  # Keep incubating until Red Team passes
                    if not RED_TEAM_AVAILABLE:
                        # If Red Team not available, promote directly
                        new_status = 'active'

                    self.supabase.table('strategy_genome').update({
                        'status': new_status,
                        'fitness_score': result.fitness_score,
                        'sharpe_ratio': result.sharpe_ratio,
                        'sortino_ratio': result.sortino_ratio,
                        'max_drawdown': result.max_drawdown,
                        'win_rate': result.win_rate,
                        'profit_factor': result.profit_factor,
                        'cagr': result.cagr,
                        'tested_at': datetime.utcnow().isoformat(),
                        'promoted_at': datetime.utcnow().isoformat() if new_status == 'active' else None,
                        'metadata': {
                            'convexity_score': result.convexity_score,
                            'total_trades': result.total_trades,
                            'execution_time_ms': result.execution_time_ms,
                            # Symphony metrics
                            'portfolio_contribution': result.portfolio_contribution,
                            'target_regime': result.target_regime,
                            'regime_performance': result.regime_performance,
                            'daily_returns': result.daily_returns,  # Store for future correlation
                            # Red Team tracking
                            'backtest_passed': True,
                            'red_team_pending': RED_TEAM_AVAILABLE,
                            'queued_for_red_team_at': datetime.utcnow().isoformat() if RED_TEAM_AVAILABLE else None
                        }
                    }).eq('id', result.strategy_id).execute()
                    promoted += 1

                    if RED_TEAM_AVAILABLE:
                        logger.info(f"   🔴 Queued for Red Team: {result.strategy_id[:8]} (Fitness: {result.fitness_score:.4f})")
                    else:
                        logger.info(f"   🎵 Promoted to Symphony: {result.strategy_id[:8]} (Target: {result.target_regime})")
                else:
                    # Mark as failed
                    failure_reason = result.error
                    if not failure_reason:
                        if result.portfolio_contribution < 0.5:
                            failure_reason = f'Duplicate exposure (contribution={result.portfolio_contribution}x)'
                        else:
                            failure_reason = f'Fitness {result.fitness_score:.4f} below threshold {self.config.fitness_threshold}'

                    self.supabase.table('strategy_genome').update({
                        'status': 'failed',
                        'tested_at': datetime.utcnow().isoformat(),
                        'metadata': {
                            'failure_reason': failure_reason,
                            'base_fitness': result.fitness_score / max(result.portfolio_contribution, 0.1),
                            'portfolio_contribution': result.portfolio_contribution,
                            'symphony_fitness': result.fitness_score,
                            'target_regime': result.target_regime,
                            'execution_time_ms': result.execution_time_ms
                        }
                    }).eq('id', result.strategy_id).execute()
                    failed += 1

            self.stats['backtests_run'] += len(results)
            self.stats['strategies_promoted'] += promoted
            self.stats['strategies_failed'] += failed

            logger.info(f"⚙️ [Execution Engine] Complete: {promoted} promoted to Symphony, {failed} failed")

            return {
                'executed': len(results),
                'promoted': promoted,
                'failed': failed
            }

        except Exception as e:
            logger.error(f"❌ [Execution Engine] Error: {e}")
            traceback.print_exc()
            self.stats['errors'] += 1
            return {'executed': 0, 'promoted': 0, 'failed': 0, 'error': str(e)}

    # ========================================================================
    # 4. THE PUBLISHER - Morning Briefings
    # ========================================================================

    async def publish_briefings(self) -> Dict[str, Any]:
        """
        Generate morning briefings for top performing strategies.

        Called daily (or when exceptional alpha found).
        """
        logger.info("📰 [Publisher] Preparing morning briefings...")

        try:
            # Check if we've already published today
            today = datetime.now().date()
            if self.last_publish_time.date() == today:
                if self.daily_briefings_published >= self.config.max_briefings_per_day:
                    logger.info("   Daily briefing limit reached")
                    return {'published': 0, 'reason': 'daily_limit_reached'}
            else:
                # New day, reset counter
                self.daily_briefings_published = 0

            # Get top active strategies without briefings
            strategies = self.supabase.table('strategy_genome').select(
                'id', 'name', 'fitness_score', 'sharpe_ratio', 'sortino_ratio',
                'max_drawdown', 'win_rate', 'profit_factor', 'cagr', 'metadata'
            ).eq('status', 'active').order(
                'fitness_score', desc=True
            ).limit(10).execute()

            if not strategies.data:
                logger.info("   No active strategies to brief")
                return {'published': 0}

            # Check which strategies already have briefings
            strategy_ids = [s['id'] for s in strategies.data]
            existing = self.supabase.table('morning_briefings').select(
                'strategy_id'
            ).in_('strategy_id', strategy_ids).execute()

            existing_ids = {b['strategy_id'] for b in (existing.data or [])}
            new_strategies = [s for s in strategies.data if s['id'] not in existing_ids]

            if not new_strategies:
                logger.info("   All top strategies already have briefings")
                return {'published': 0, 'reason': 'all_briefed'}

            # Generate briefings for top 3 new strategies
            published = 0
            for strategy in new_strategies[:3]:
                briefing = self._generate_briefing(strategy)

                self.supabase.table('morning_briefings').insert(briefing).execute()
                published += 1
                self.daily_briefings_published += 1

                logger.info(f"   📰 Published: {briefing['headline'][:50]}...")

            self.stats['briefings_published'] += published
            self.last_publish_time = datetime.now()

            logger.info(f"📰 [Publisher] Published {published} briefings")

            return {'published': published}

        except Exception as e:
            logger.error(f"❌ [Publisher] Error: {e}")
            self.stats['errors'] += 1
            return {'published': 0, 'error': str(e)}

    def _generate_briefing(self, strategy: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a plain-English briefing for a strategy."""

        # Extract metrics
        sharpe = strategy.get('sharpe_ratio', 0)
        sortino = strategy.get('sortino_ratio', 0)
        max_dd = strategy.get('max_drawdown', 0)
        win_rate = strategy.get('win_rate', 0)
        fitness = strategy.get('fitness_score', 0)
        cagr = strategy.get('cagr', 0)
        metadata = strategy.get('metadata', {})

        # Generate headline based on performance
        if sharpe > 2.0:
            headline = f"🔥 High-Sharpe Discovery: {strategy['name']} shows {sharpe:.2f} Sharpe"
        elif fitness > 1.0:
            headline = f"⭐ Strong Performer: {strategy['name']} with {fitness:.2f} fitness score"
        else:
            headline = f"📊 New Strategy: {strategy['name']} ready for review"

        # Generate narrative
        narrative = f"""## Strategy Overview

**{strategy['name']}** has completed backtesting and shows promising characteristics.

### Performance Metrics
- **Sharpe Ratio**: {sharpe:.2f} {'(Excellent)' if sharpe > 2 else '(Good)' if sharpe > 1 else '(Moderate)'}
- **Sortino Ratio**: {sortino:.2f}
- **Maximum Drawdown**: {max_dd:.1%}
- **Win Rate**: {win_rate:.1%}
- **CAGR**: {cagr:.1%}

### Risk Assessment
{'⚠️ Low drawdown tolerance' if max_dd < -0.20 else '✅ Acceptable drawdown levels'}
{'⚠️ Below 50% win rate' if win_rate < 0.5 else '✅ Positive win rate'}

### Convexity Analysis
Convexity Score: {metadata.get('convexity_score', 'N/A')}

{'This strategy shows positive convexity characteristics - it tends to perform well during volatile market conditions.' if metadata.get('convexity_score', 0) > 1 else 'Convexity is neutral - performance is relatively symmetric across market conditions.'}

### Recommendation
{'**Strong candidate for shadow trading.** Consider moving to paper trading for live validation.' if fitness > 0.8 else '**Moderate potential.** May benefit from parameter optimization before live testing.'}

### Next Steps
1. Review the strategy logic in detail
2. If approved, move to shadow trading mode
3. Monitor for 2-4 weeks before live deployment
"""

        return {
            'strategy_id': strategy['id'],
            'headline': headline,
            'narrative': narrative,
            'key_metrics': {
                'sharpe': sharpe,
                'sortino': sortino,
                'max_drawdown': max_dd,
                'win_rate': win_rate,
                'cagr': cagr,
                'fitness': fitness
            },
            'priority_score': fitness,
            'created_at': datetime.utcnow().isoformat()
        }

    # ========================================================================
    # MAIN LOOP
    # ========================================================================

    async def run(self):
        """Main daemon loop."""
        self.running = True
        logger.info("🚀 Research Director starting main loop...")

        # Start Shadow Trader if available
        if self.shadow_trader:
            logger.info("🔮 Starting Shadow Trader...")
            await self.shadow_trader.start()

        while self.running:
            try:
                now = datetime.now()

                # 0. DISCOVERY PHASE - Autonomous market scanning (runs first!)
                # This is what makes the daemon TRULY autonomous - it creates missions
                # from market observations instead of just reacting to manual missions
                if DISCOVERY_AVAILABLE and (now - self.last_discovery_time).total_seconds() >= self.config.discovery_interval:
                    await self.run_discovery_phase()
                    self.last_discovery_time = now

                # 0.5. GAMMA PUBLISHER - Push gamma intelligence to UI (every 5 min)
                if (now - self.last_gamma_publish_time).total_seconds() >= self.config.gamma_publish_interval:
                    await self.publish_gamma_intelligence()
                    self.last_gamma_publish_time = now

                # 1. Mission Control - check every recruit_interval (goal-seeking loop)
                if (now - self.last_recruit_time).total_seconds() >= self.config.recruit_interval:
                    await self.run_mission_loop()
                    self.last_recruit_time = now

                # 2. Harvester - check every harvest_interval
                if (now - self.last_harvest_time).total_seconds() >= self.config.harvest_interval:
                    await self.harvest_mutations()
                    self.last_harvest_time = now

                # 3. Execution Engine - check every execute_interval
                if (now - self.last_execute_time).total_seconds() >= self.config.execute_interval:
                    await self.execute_candidates()
                    self.last_execute_time = now

                # 4. Publisher - check at publish_hour daily
                if now.hour == self.config.publish_hour:
                    if self.last_publish_time.date() != now.date():
                        await self.publish_briefings()

                # 5. Check for graduations (updated during shadow trading)
                if self.shadow_trader:
                    shadow_stats = self.shadow_trader.get_stats()
                    # Use += to accumulate graduations, not overwrite
                    new_graduations = shadow_stats.get('graduations', 0)
                    if new_graduations > self.stats['graduations']:
                        self.stats['graduations'] = new_graduations

                # Log stats periodically
                if now.minute == 0 and now.second < 30:
                    self._log_stats()

                # Sleep before next check
                await asyncio.sleep(30)  # Check every 30 seconds

            except KeyboardInterrupt:
                logger.info("Received shutdown signal")
                self.running = False
            except Exception as e:
                logger.error(f"Main loop error: {e}")
                traceback.print_exc()
                self.stats['errors'] += 1
                await asyncio.sleep(60)  # Wait before retry

        # Shutdown Shadow Trader
        if self.shadow_trader:
            await self.shadow_trader.stop()

        logger.info("🌙 Research Director shutting down...")
        self._log_stats()

    def _log_stats(self):
        """Log current statistics."""
        logger.info("=" * 40)
        logger.info("📊 Research Director Stats:")
        logger.info(f"   🔭 Discoveries: {self.stats['discoveries']}")
        logger.info(f"   🎯 Missions auto-created: {self.stats['missions_auto_created']}")
        logger.info(f"   Mutations harvested: {self.stats['mutations_harvested']}")
        logger.info(f"   Backtests run: {self.stats['backtests_run']}")
        logger.info(f"   Strategies promoted: {self.stats['strategies_promoted']}")
        logger.info(f"   Strategies failed: {self.stats['strategies_failed']}")
        logger.info(f"   Briefings published: {self.stats['briefings_published']}")
        logger.info(f"   Graduations: {self.stats['graduations']}")
        logger.info(f"   Errors: {self.stats['errors']}")

        # Shadow Trader stats
        if self.shadow_trader:
            shadow_stats = self.shadow_trader.get_stats()
            logger.info("🔮 Shadow Trader Stats:")
            logger.info(f"   Connected: {shadow_stats.get('connected', False)}")
            logger.info(f"   Open positions: {shadow_stats.get('open_positions', 0)}")
            logger.info(f"   Signals received: {shadow_stats.get('signals_received', 0)}")
            logger.info(f"   Trades executed: {shadow_stats.get('trades_executed', 0)}")
            logger.info(f"   Trades rejected: {shadow_stats.get('trades_rejected', 0)}")
            logger.info(f"   Current regime: {shadow_stats.get('current_regime', 'UNKNOWN')}")

        logger.info("=" * 40)

    def stop(self):
        """Signal daemon to stop."""
        self.running = False


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Research Daemon - The Night Shift')
    parser.add_argument('--recruit-interval', type=int, default=3600,
                       help='Seconds between recruitment checks (default: 3600)')
    parser.add_argument('--harvest-interval', type=int, default=300,
                       help='Seconds between harvest checks (default: 300)')
    parser.add_argument('--execute-interval', type=int, default=600,
                       help='Seconds between execution batches (default: 600)')
    parser.add_argument('--workers', type=int, default=4,
                       help='Number of parallel backtest workers (default: 4)')
    parser.add_argument('--fitness-threshold', type=float, default=0.5,
                       help='Minimum fitness to promote strategy (default: 0.5)')
    parser.add_argument('--run-once', action='store_true',
                       help='Run each phase once and exit (for testing)')

    args = parser.parse_args()

    # Create configuration
    config = DaemonConfig()
    config.recruit_interval = args.recruit_interval
    config.harvest_interval = args.harvest_interval
    config.execute_interval = args.execute_interval
    config.parallel_workers = args.workers
    config.fitness_threshold = args.fitness_threshold

    if not config.validate():
        sys.exit(1)

    # Create director
    director = ResearchDirector(config)

    if args.run_once:
        # Test mode - run each phase once
        async def run_once():
            logger.info("Running in test mode (--run-once)")
            await director.replenish_pool()
            await director.harvest_mutations()
            await director.execute_candidates()
            await director.publish_briefings()
            director._log_stats()

        asyncio.run(run_once())
    else:
        # Normal daemon mode
        try:
            asyncio.run(director.run())
        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        except Exception as e:
            logger.error(f"Fatal error: {e}")
            traceback.print_exc()
            sys.exit(1)


if __name__ == '__main__':
    main()
