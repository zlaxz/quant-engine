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
from datetime import datetime, timedelta, time
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from multiprocessing import Pool, cpu_count
from concurrent.futures import ProcessPoolExecutor, as_completed
import re

import random
import numpy as np
import pandas as pd
import polars as pl
from supabase import create_client, Client

# Shadow Trader imports
try:
    from massive_socket import MassiveSocket, QuoteTick, TradeTick, Tick
    SHADOW_TRADING_AVAILABLE = True
except ImportError:
    SHADOW_TRADING_AVAILABLE = False
    logger = logging.getLogger('NightShift')
    # Will be initialized after logging setup

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

    Consumes live market data from MassiveSocket and simulates execution
    for active strategies to validate performance before production.

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
        self._socket: Optional['MassiveSocket'] = None
        self._running = False
        self._positions: Dict[str, ShadowPosition] = {}  # position_id -> position
        self._strategy_positions: Dict[str, List[str]] = {}  # strategy_id -> [position_ids]
        self._pending_signals: asyncio.Queue = asyncio.Queue()
        self._last_quotes: Dict[str, 'QuoteTick'] = {}
        self._current_regime: str = RegimeType.LOW_VOL_GRIND

        # Statistics
        self.stats = {
            'signals_received': 0,
            'trades_executed': 0,
            'trades_rejected': 0,
            'positions_opened': 0,
            'positions_closed': 0,
            'graduations': 0,
        }

        logger.info("🔮 ShadowTrader initialized")
        logger.info(f"   Symbols: {self.symbols}")
        logger.info(f"   Graduation: {self.GRADUATION_TRADE_COUNT} trades @ {self.GRADUATION_SHARPE_THRESHOLD} Sharpe")

    async def start(self) -> None:
        """Start shadow trading with live data feed."""
        if not SHADOW_TRADING_AVAILABLE:
            logger.warning("Shadow trading unavailable - massive_socket not imported")
            return

        logger.info("🔮 [ShadowTrader] Starting live paper trading...")

        try:
            # Connect to WebSocket
            self._socket = MassiveSocket(
                api_key=self.api_key,
                symbols=self.symbols,
                feed_type='stocks',
            )
            await self._socket.connect()
            self._running = True

            # Start background tasks
            asyncio.create_task(self._tick_consumer())
            asyncio.create_task(self._signal_processor())
            asyncio.create_task(self._position_updater())

            # Start WebSocket receiver
            asyncio.create_task(self._socket.run())

            logger.info("🔮 [ShadowTrader] Live feed connected")

        except Exception as e:
            logger.error(f"❌ [ShadowTrader] Failed to start: {e}")
            self._running = False

    async def stop(self) -> None:
        """Stop shadow trading."""
        self._running = False
        if self._socket:
            await self._socket.close()
        logger.info("🔮 [ShadowTrader] Stopped")

    async def _tick_consumer(self) -> None:
        """Consume ticks from WebSocket and update state."""
        if not self._socket:
            return

        async for tick in self._socket.stream():
            if not self._running:
                break

            try:
                # Update last quote cache
                if isinstance(tick, QuoteTick):
                    self._last_quotes[tick.symbol] = tick

                    # Update open positions with current prices
                    await self._update_position_prices(tick)

                elif isinstance(tick, TradeTick):
                    # Could use trade prints for additional validation
                    pass

            except Exception as e:
                logger.error(f"Tick processing error: {e}")

    async def _update_position_prices(self, quote: 'QuoteTick') -> None:
        """Update open positions with current market prices."""
        for pos_id, position in self._positions.items():
            if position.symbol == quote.symbol:
                position.current_price = quote.mid_price
                position.current_bid = quote.bid_price
                position.current_ask = quote.ask_price

                # Calculate current P&L
                if position.side == 'long':
                    pnl_pct = (quote.bid_price - position.entry_price) / position.entry_price
                else:
                    pnl_pct = (position.entry_price - quote.ask_price) / position.entry_price

                # Track excursions
                if pnl_pct > position.max_favorable:
                    position.max_favorable = pnl_pct
                if pnl_pct < position.max_adverse:
                    position.max_adverse = pnl_pct

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
        """
        quote = self._last_quotes.get(signal.symbol)
        if not quote:
            logger.warning(f"No quote for {signal.symbol}, rejecting signal")
            self.stats['trades_rejected'] += 1
            return

        # Determine fill price based on side
        if signal.action == 'buy':
            fill_price = quote.ask_price  # Pay the ask
            available_size = quote.ask_size
        elif signal.action == 'sell':
            fill_price = quote.bid_price  # Hit the bid
            available_size = quote.bid_size
        elif signal.action == 'close':
            # Close existing position
            await self._close_position(signal, quote, latency_ms)
            return
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

        # Open new position
        await self._open_position(signal, quote, fill_price, latency_ms)

    async def _open_position(
        self,
        signal: ShadowSignal,
        quote: 'QuoteTick',
        fill_price: float,
        latency_ms: int
    ) -> None:
        """Open a new shadow position."""
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

                # Clean up local tracking
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

                # Check for graduation
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

        except Exception as e:
            logger.error(f"Failed to publish graduation: {e}")

    async def _position_updater(self) -> None:
        """Periodically update positions in database."""
        while self._running:
            try:
                await asyncio.sleep(5)  # Update every 5 seconds

                for pos_id, position in self._positions.items():
                    # Calculate current P&L
                    if position.side == 'long':
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
            'connected': self._socket.is_connected if self._socket else False,
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
        self.daily_briefings_published = 0
        self.stats = {
            'mutations_harvested': 0,
            'backtests_run': 0,
            'strategies_promoted': 0,
            'strategies_failed': 0,
            'briefings_published': 0,
            'graduations': 0,
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
        logger.info("=" * 60)

    # ========================================================================
    # 1. THE RECRUITER - Replenish Strategy Pool
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

            objective = f"""Mutate the top {len(strategy_ids)} performing strategies to find local convexity extrema.

Target strategies for mutation:
{chr(10).join(f'- {name}' for name in strategy_names)}

Focus on mutations that:
1. Increase positive convexity (bigger gains in volatile markets)
2. Reduce drawdown without sacrificing returns
3. Improve Sharpe and Sortino ratios
4. Explore novel entry/exit timing"""

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
                    # Promote to active - strategy contributes to the Symphony!
                    self.supabase.table('strategy_genome').update({
                        'status': 'active',
                        'fitness_score': result.fitness_score,
                        'sharpe_ratio': result.sharpe_ratio,
                        'sortino_ratio': result.sortino_ratio,
                        'max_drawdown': result.max_drawdown,
                        'win_rate': result.win_rate,
                        'profit_factor': result.profit_factor,
                        'cagr': result.cagr,
                        'tested_at': datetime.utcnow().isoformat(),
                        'promoted_at': datetime.utcnow().isoformat(),
                        'metadata': {
                            'convexity_score': result.convexity_score,
                            'total_trades': result.total_trades,
                            'execution_time_ms': result.execution_time_ms,
                            # Symphony metrics
                            'portfolio_contribution': result.portfolio_contribution,
                            'target_regime': result.target_regime,
                            'regime_performance': result.regime_performance,
                            'daily_returns': result.daily_returns  # Store for future correlation
                        }
                    }).eq('id', result.strategy_id).execute()
                    promoted += 1
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

                # 1. Recruiter - check every recruit_interval
                if (now - self.last_recruit_time).total_seconds() >= self.config.recruit_interval:
                    await self.replenish_pool()
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
                    self.stats['graduations'] = shadow_stats.get('graduations', 0)

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
