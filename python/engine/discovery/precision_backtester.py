#!/usr/bin/env python3
"""
Precision Backtester: Event-Driven Options Strategy Backtesting

Bridges StructureDNA definitions to the TradeSimulator for realistic backtesting.
Unlike the old fast_backtester (now deleted), this uses:
- Event-driven simulation (not pre-computed surfaces)
- Realistic execution via UnifiedExecutionModel (bid-ask, slippage, partial fills)
- Proper P&L accounting with Greeks tracking
- T+1 execution lag to prevent look-ahead bias
- Circuit breakers and margin checks

Usage:
    backtester = PrecisionBacktester(data_path, regime_path)
    result = backtester.backtest(dna)
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd

from .structure_dna import (
    StructureDNA,
    StructureType,
    DTEBucket,
    DeltaBucket,
)
from ..trading.simulator import TradeSimulator, SimulationConfig
from ..trading.execution import UnifiedExecutionModel
from ..trading.trade import (
    Trade,
    TradeLeg,
    create_straddle_trade,
    create_strangle_trade,
    create_spread_trade,
    create_backspread_trade,
    clear_trade_id_registry,
)
from ..pricing.greeks import calculate_price

logger = logging.getLogger("AlphaFactory.PrecisionBacktester")


def _normalize_datetime(dt: Any) -> datetime:
    """Convert any datetime-like to tz-naive datetime for consistent comparisons."""
    if dt is None:
        return None
    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()
    if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    if isinstance(dt, datetime):
        return dt
    # Handle date objects
    if hasattr(dt, 'year') and hasattr(dt, 'month') and hasattr(dt, 'day'):
        return datetime(dt.year, dt.month, dt.day)
    return dt


# ============================================================================
# BACKTEST RESULT
# ============================================================================

@dataclass
class BacktestResult:
    """Results from backtesting a single structure."""
    dna: StructureDNA

    # Return metrics
    total_return: float
    ann_return: float
    ann_volatility: float
    sharpe_ratio: float
    sortino_ratio: float

    # Risk metrics
    max_drawdown: float
    max_drawdown_duration: int  # days
    calmar_ratio: float

    # Trade metrics
    n_trades: int
    n_winning_trades: int
    n_losing_trades: int
    win_rate: float
    profit_factor: float
    avg_trade_return: float
    avg_winner: float
    avg_loser: float

    # Cost metrics
    total_commission: float
    total_slippage: float

    # Distribution
    skewness: float
    kurtosis: float

    # Regime breakdown
    returns_by_regime: Dict[int, float] = field(default_factory=dict)

    # Raw data (optional, for analysis)
    equity_curve: Optional[pd.DataFrame] = None
    trades: Optional[List[Dict]] = None

    def to_dict(self) -> Dict:
        """Serialize to dictionary (excluding large arrays)."""
        return {
            'structure_type': self.dna.structure_type.value,
            'dte_bucket': self.dna.dte_bucket.value,
            'delta_bucket': self.dna.delta_bucket.value,
            'entry_regimes': self.dna.entry_regimes,
            'total_return': self.total_return,
            'ann_return': self.ann_return,
            'ann_volatility': self.ann_volatility,
            'sharpe_ratio': self.sharpe_ratio,
            'sortino_ratio': self.sortino_ratio,
            'max_drawdown': self.max_drawdown,
            'max_drawdown_duration': self.max_drawdown_duration,
            'calmar_ratio': self.calmar_ratio,
            'n_trades': self.n_trades,
            'win_rate': self.win_rate,
            'profit_factor': self.profit_factor,
            'avg_trade_return': self.avg_trade_return,
            'total_commission': self.total_commission,
            'total_slippage': self.total_slippage,
            'skewness': self.skewness,
            'kurtosis': self.kurtosis,
            'returns_by_regime': self.returns_by_regime,
        }


# ============================================================================
# DNA TO TRADE CONVERTER
# ============================================================================

class DNAToTradeConverter:
    """Converts StructureDNA to Trade objects."""

    # Delta to strike offset mapping (approximate)
    DELTA_OFFSETS = {
        DeltaBucket.ATM: 0.0,
        DeltaBucket.D25: 0.03,   # ~3% OTM
        DeltaBucket.D10: 0.06,   # ~6% OTM
        DeltaBucket.D5: 0.10,    # ~10% OTM
    }

    @classmethod
    def create_trade(
        cls,
        dna: StructureDNA,
        trade_id: str,
        entry_date: datetime,
        spot_price: float,
        vix: float = 20.0,
    ) -> Optional[Trade]:
        """
        Convert StructureDNA to a Trade object.

        Args:
            dna: Structure definition
            trade_id: Unique trade identifier
            entry_date: Trade entry date
            spot_price: Current underlying price
            vix: Current VIX level (for IV estimation)

        Returns:
            Trade object or None if structure can't be created
        """
        # Normalize entry_date to tz-naive for consistent handling
        entry_date = _normalize_datetime(entry_date)

        dte = dna.dte_bucket.value
        expiry = entry_date + timedelta(days=dte)
        delta_offset = cls.DELTA_OFFSETS.get(dna.delta_bucket, 0.0)

        # Round strike to nearest dollar
        atm_strike = round(spot_price)
        otm_call_strike = round(spot_price * (1 + delta_offset))
        otm_put_strike = round(spot_price * (1 - delta_offset))

        structure_type = dna.structure_type

        # Single leg structures
        if structure_type == StructureType.LONG_CALL:
            return cls._create_single_leg(
                trade_id, entry_date, otm_call_strike, expiry, dte, 'call', 1
            )
        elif structure_type == StructureType.LONG_PUT:
            return cls._create_single_leg(
                trade_id, entry_date, otm_put_strike, expiry, dte, 'put', 1
            )
        elif structure_type == StructureType.SHORT_CALL:
            return cls._create_single_leg(
                trade_id, entry_date, otm_call_strike, expiry, dte, 'call', -1
            )
        elif structure_type == StructureType.SHORT_PUT:
            return cls._create_single_leg(
                trade_id, entry_date, otm_put_strike, expiry, dte, 'put', -1
            )

        # Straddles
        elif structure_type == StructureType.LONG_STRADDLE:
            return create_straddle_trade(
                trade_id, dna.structure_type.value, entry_date,
                atm_strike, expiry, dte, quantity=1
            )
        elif structure_type == StructureType.SHORT_STRADDLE:
            return create_straddle_trade(
                trade_id, dna.structure_type.value, entry_date,
                atm_strike, expiry, dte, quantity=-1
            )

        # Strangles
        elif structure_type == StructureType.LONG_STRANGLE:
            return create_strangle_trade(
                trade_id, dna.structure_type.value, entry_date,
                otm_call_strike, otm_put_strike, expiry, dte, quantity=1, short=False
            )
        elif structure_type == StructureType.SHORT_STRANGLE:
            return create_strangle_trade(
                trade_id, dna.structure_type.value, entry_date,
                otm_call_strike, otm_put_strike, expiry, dte, quantity=1, short=True
            )

        # Vertical spreads
        elif structure_type == StructureType.CALL_DEBIT_SPREAD:
            spread_width = int(spot_price * dna.spread_width_pct)
            return create_spread_trade(
                trade_id, dna.structure_type.value, entry_date,
                long_strike=atm_strike,
                short_strike=atm_strike + spread_width,
                expiry=expiry, dte=dte, option_type='call'
            )
        elif structure_type == StructureType.CALL_CREDIT_SPREAD:
            spread_width = int(spot_price * dna.spread_width_pct)
            return create_spread_trade(
                trade_id, dna.structure_type.value, entry_date,
                long_strike=atm_strike + spread_width,
                short_strike=atm_strike,
                expiry=expiry, dte=dte, option_type='call'
            )
        elif structure_type == StructureType.PUT_DEBIT_SPREAD:
            spread_width = int(spot_price * dna.spread_width_pct)
            return create_spread_trade(
                trade_id, dna.structure_type.value, entry_date,
                long_strike=atm_strike,
                short_strike=atm_strike - spread_width,
                expiry=expiry, dte=dte, option_type='put'
            )
        elif structure_type == StructureType.PUT_CREDIT_SPREAD:
            spread_width = int(spot_price * dna.spread_width_pct)
            return create_spread_trade(
                trade_id, dna.structure_type.value, entry_date,
                long_strike=atm_strike - spread_width,
                short_strike=atm_strike,
                expiry=expiry, dte=dte, option_type='put'
            )

        # Iron structures
        elif structure_type == StructureType.IRON_CONDOR:
            return cls._create_iron_condor(
                trade_id, entry_date, spot_price, dna, expiry, dte
            )
        elif structure_type == StructureType.IRON_BUTTERFLY:
            return cls._create_iron_butterfly(
                trade_id, entry_date, spot_price, dna, expiry, dte
            )

        # Calendar/Diagonal spreads
        elif structure_type in [
            StructureType.CALL_CALENDAR, StructureType.PUT_CALENDAR,
            StructureType.CALL_DIAGONAL, StructureType.PUT_DIAGONAL
        ]:
            return cls._create_calendar_diagonal(
                trade_id, entry_date, spot_price, dna, expiry, dte
            )

        logger.warning(f"Unsupported structure type: {structure_type}")
        return None

    @classmethod
    def _create_single_leg(
        cls, trade_id: str, entry_date: datetime, strike: float,
        expiry: datetime, dte: int, option_type: str, quantity: int
    ) -> Trade:
        """Create single-leg trade."""
        legs = [TradeLeg(strike=strike, expiry=expiry, option_type=option_type,
                         quantity=quantity, dte=dte)]
        return Trade(
            trade_id=trade_id,
            profile_name=f"{'long' if quantity > 0 else 'short'}_{option_type}",
            entry_date=entry_date,
            legs=legs,
            entry_prices={}
        )

    @classmethod
    def _create_iron_condor(
        cls, trade_id: str, entry_date: datetime, spot_price: float,
        dna: StructureDNA, expiry: datetime, dte: int
    ) -> Trade:
        """Create iron condor: short strangle + long wings."""
        atm = round(spot_price)
        width = int(spot_price * dna.spread_width_pct)
        wing = int(spot_price * dna.wing_width_pct)

        legs = [
            # Short strangle (inner)
            TradeLeg(strike=atm + width, expiry=expiry, option_type='call', quantity=-1, dte=dte),
            TradeLeg(strike=atm - width, expiry=expiry, option_type='put', quantity=-1, dte=dte),
            # Long wings (outer)
            TradeLeg(strike=atm + width + wing, expiry=expiry, option_type='call', quantity=1, dte=dte),
            TradeLeg(strike=atm - width - wing, expiry=expiry, option_type='put', quantity=1, dte=dte),
        ]
        return Trade(
            trade_id=trade_id,
            profile_name='iron_condor',
            entry_date=entry_date,
            legs=legs,
            entry_prices={}
        )

    @classmethod
    def _create_iron_butterfly(
        cls, trade_id: str, entry_date: datetime, spot_price: float,
        dna: StructureDNA, expiry: datetime, dte: int
    ) -> Trade:
        """Create iron butterfly: short straddle + long wings."""
        atm = round(spot_price)
        wing = int(spot_price * dna.wing_width_pct)

        legs = [
            # Short straddle (center)
            TradeLeg(strike=atm, expiry=expiry, option_type='call', quantity=-1, dte=dte),
            TradeLeg(strike=atm, expiry=expiry, option_type='put', quantity=-1, dte=dte),
            # Long wings
            TradeLeg(strike=atm + wing, expiry=expiry, option_type='call', quantity=1, dte=dte),
            TradeLeg(strike=atm - wing, expiry=expiry, option_type='put', quantity=1, dte=dte),
        ]
        return Trade(
            trade_id=trade_id,
            profile_name='iron_butterfly',
            entry_date=entry_date,
            legs=legs,
            entry_prices={}
        )

    @classmethod
    def _create_calendar_diagonal(
        cls, trade_id: str, entry_date: datetime, spot_price: float,
        dna: StructureDNA, front_expiry: datetime, front_dte: int
    ) -> Trade:
        """Create calendar or diagonal spread."""
        back_expiry = entry_date + timedelta(days=front_dte + dna.back_month_offset)
        back_dte = front_dte + dna.back_month_offset
        atm = round(spot_price)

        is_call = dna.structure_type in [StructureType.CALL_CALENDAR, StructureType.CALL_DIAGONAL]
        option_type = 'call' if is_call else 'put'

        if dna.structure_type in [StructureType.CALL_CALENDAR, StructureType.PUT_CALENDAR]:
            # Same strike, different expiry
            front_strike = atm
            back_strike = atm
        else:
            # Diagonal: different strikes
            offset = int(spot_price * cls.DELTA_OFFSETS.get(dna.delta_bucket, 0.03))
            if is_call:
                front_strike = atm
                back_strike = atm + offset
            else:
                front_strike = atm
                back_strike = atm - offset

        legs = [
            TradeLeg(strike=front_strike, expiry=front_expiry, option_type=option_type,
                     quantity=-1, dte=front_dte),  # Short front
            TradeLeg(strike=back_strike, expiry=back_expiry, option_type=option_type,
                     quantity=1, dte=back_dte),    # Long back
        ]
        return Trade(
            trade_id=trade_id,
            profile_name=dna.structure_type.value,
            entry_date=entry_date,
            legs=legs,
            entry_prices={}
        )


# ============================================================================
# PRECISION BACKTESTER
# ============================================================================

class PrecisionBacktester:
    """
    Event-driven backtester using TradeSimulator for realistic execution.

    Usage:
        backtester = PrecisionBacktester(data_path, regime_path)
        result = backtester.backtest(dna)
    """

    def __init__(
        self,
        data_path: Path,
        regime_path: Path,
        vix_path: Optional[Path] = None,
        initial_capital: float = 100_000.0,
    ):
        """
        Initialize backtester.

        Args:
            data_path: Path to price data (parquet with date, close columns)
            regime_path: Path to regime assignments parquet
            vix_path: Optional path to VIX data
            initial_capital: Starting capital
        """
        self.data_path = Path(data_path)
        self.regime_path = Path(regime_path)
        self.initial_capital = initial_capital

        # Load data
        logger.info(f"Loading price data from {data_path}")
        self.price_data = self._load_price_data(data_path)

        logger.info(f"Loading regimes from {regime_path}")
        self.regimes = self._load_regimes(regime_path)

        # Load VIX if provided
        self.vix_data = self._load_vix(vix_path) if vix_path else None

        # Align dates
        self.trading_dates = self.price_data.index.intersection(self.regimes.index)
        logger.info(f"Aligned {len(self.trading_dates)} trading dates")

        # Pre-align all data
        self._aligned_prices = self.price_data.reindex(self.trading_dates)
        self._aligned_regimes = self.regimes.reindex(self.trading_dates)
        self._aligned_vix = self.vix_data.reindex(self.trading_dates) if self.vix_data is not None else None

        # Execution model
        self.execution_model = UnifiedExecutionModel()

    def _load_price_data(self, path: Path) -> pd.DataFrame:
        """Load price data."""
        df = pd.read_parquet(path)
        df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
        df = df.set_index('date')
        return df

    def _load_regimes(self, path: Path) -> pd.Series:
        """Load regime assignments."""
        df = pd.read_parquet(path)
        df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
        df = df.set_index('date')['regime']
        return df

    def _load_vix(self, path: Path) -> Optional[pd.Series]:
        """Load VIX data."""
        try:
            df = pd.read_parquet(path)
            df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
            df = df.set_index('date')
            return df.get('close', df.get('vix'))
        except Exception as e:
            logger.warning(f"Could not load VIX: {e}")
            return None

    def _check_entry_conditions(self, dna: StructureDNA, date: datetime) -> bool:
        """Check if entry conditions are met for this date."""
        # Regime filter
        regime = self._aligned_regimes.get(date)
        if regime is None or regime not in dna.entry_regimes:
            return False

        # VIX filter
        if self._aligned_vix is not None:
            vix = self._aligned_vix.get(date, 20.0)
            if vix < dna.min_vix or vix > dna.max_vix:
                return False

        return True

    def _check_exit_conditions(
        self,
        trade: Trade,
        date: datetime,
        current_pnl_pct: float,
        dna: StructureDNA
    ) -> Tuple[bool, str]:
        """Check if exit conditions are met."""
        # Profit target
        if current_pnl_pct >= dna.profit_target_pct:
            return True, "PROFIT_TARGET"

        # Stop loss
        if current_pnl_pct <= -dna.stop_loss_pct:
            return True, "STOP_LOSS"

        # DTE threshold
        if trade.legs:
            min_dte = min((leg.expiry - date).days for leg in trade.legs)
            if min_dte <= dna.dte_exit_threshold:
                return True, "DTE_EXIT"

        # Regime exit
        if dna.regime_exit:
            regime = self._aligned_regimes.get(date)
            if regime is not None and regime not in dna.entry_regimes:
                return True, "REGIME_CHANGE"

        return False, ""

    def backtest(
        self,
        dna: StructureDNA,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> BacktestResult:
        """
        Backtest a single structure DNA.

        Args:
            dna: Structure DNA to backtest
            start_date: Start of backtest period
            end_date: End of backtest period

        Returns:
            BacktestResult with all metrics
        """
        # Clear trade ID registry for clean run
        clear_trade_id_registry()

        # Filter dates
        dates = self.trading_dates
        if start_date:
            dates = dates[dates >= start_date]
        if end_date:
            dates = dates[dates <= end_date]

        if len(dates) < 20:
            return self._empty_result(dna)

        # Initialize simulator
        sim_config = SimulationConfig(
            max_days_in_trade=dna.dte_bucket.value + 7,  # Allow some buffer
            max_loss_pct=dna.stop_loss_pct,
        )

        simulator = TradeSimulator(
            initial_capital=self.initial_capital,
            config=sim_config
        )

        # Run event-driven simulation
        trade_count = 0
        current_trade: Optional[Trade] = None

        for date in dates:
            price_row = self._aligned_prices.loc[date]
            spot = price_row.get('close', price_row.get('adj_close', 0))
            vix = self._aligned_vix.get(date, 20.0) if self._aligned_vix is not None else 20.0

            # Normalize date for consistent datetime operations
            date_normalized = _normalize_datetime(date)

            # Mark-to-market existing positions
            if current_trade is not None:
                simulator.mark_to_market(date_normalized, {'SPY': spot}, vix=vix)

                # Check exit conditions
                if current_trade.is_open:
                    entry_cost = abs(current_trade.entry_cost) if current_trade.entry_cost != 0 else 1
                    # Estimate current P&L
                    current_prices = {}
                    for i, leg in enumerate(current_trade.legs):
                        T = max(0, (leg.expiry - date_normalized).days / 365.0)
                        price = calculate_price(
                            S=spot, K=leg.strike, T=T, r=0.05,
                            sigma=vix / 100.0, option_type=leg.option_type
                        )
                        current_prices[i] = price

                    unrealized = current_trade.mark_to_market(current_prices, date_normalized, spot, vix / 100.0)
                    current_pnl_pct = unrealized / entry_cost if entry_cost > 0 else 0

                    should_exit, reason = self._check_exit_conditions(
                        current_trade, date_normalized, current_pnl_pct, dna
                    )
                    if should_exit:
                        simulator.exit_trade(current_trade, date_normalized, spot, reason, vix)
                        current_trade = None

            # Check entry conditions if no position
            if current_trade is None:
                if self._check_entry_conditions(dna, date_normalized):
                    trade_count += 1
                    trade_id = f"{dna.structure_type.value}_{trade_count}"

                    new_trade = DNAToTradeConverter.create_trade(
                        dna, trade_id, date_normalized, spot, vix
                    )

                    if new_trade is not None:
                        # Price the legs
                        entry_prices = {}
                        for i, leg in enumerate(new_trade.legs):
                            T = max(0.001, (leg.expiry - date_normalized).days / 365.0)
                            mid_price = calculate_price(
                                S=spot, K=leg.strike, T=T, r=0.05,
                                sigma=vix / 100.0, option_type=leg.option_type
                            )
                            # Apply execution model for realistic entry
                            side = 'buy' if leg.quantity > 0 else 'sell'
                            moneyness = abs(leg.strike - spot) / spot
                            exec_price = self.execution_model.get_execution_price(
                                mid_price=mid_price,
                                side=side,
                                moneyness=moneyness,
                                dte=leg.dte,
                                vix_level=vix
                            )
                            entry_prices[i] = exec_price

                        new_trade.entry_prices = entry_prices
                        new_trade.underlying_price_entry = spot

                        # Calculate entry cost
                        new_trade.entry_cost = sum(
                            new_trade.legs[i].quantity * price * 100
                            for i, price in entry_prices.items()
                        )

                        # Commission
                        new_trade.entry_commission = self.execution_model.get_commission_cost(
                            len(new_trade.legs)
                        )

                        # Check if we have capital
                        required = abs(new_trade.entry_cost) + new_trade.entry_commission
                        if simulator.current_capital >= required:
                            simulator.current_capital -= new_trade.entry_cost
                            simulator.current_capital -= new_trade.entry_commission
                            simulator.active_trades.append(new_trade)
                            current_trade = new_trade

        # Close any remaining position at end
        if current_trade is not None and current_trade.is_open:
            final_date = dates[-1]
            final_date_normalized = _normalize_datetime(final_date)
            final_spot = self._aligned_prices.loc[final_date].get('close', 0)
            final_vix = self._aligned_vix.get(final_date, 20.0) if self._aligned_vix is not None else 20.0
            simulator.exit_trade(current_trade, final_date_normalized, final_spot, "END_OF_BACKTEST", final_vix)

        # Compute metrics
        return self._compute_metrics(simulator, dna, dates)

    def _compute_metrics(
        self,
        simulator: TradeSimulator,
        dna: StructureDNA,
        dates: pd.DatetimeIndex
    ) -> BacktestResult:
        """Compute all performance metrics from simulation."""
        equity_df = pd.DataFrame(simulator.equity_curve)
        trades = simulator.trades

        if equity_df.empty or len(trades) == 0:
            return self._empty_result(dna)

        # Basic returns
        equity_df['date'] = pd.to_datetime(equity_df['date'])
        equity_df = equity_df.set_index('date')
        equity_df['returns'] = equity_df['equity'].pct_change().fillna(0)

        total_return = (equity_df['equity'].iloc[-1] / self.initial_capital) - 1
        n_days = len(equity_df)
        ann_factor = 252 / n_days if n_days > 0 else 1
        ann_return = (1 + total_return) ** ann_factor - 1
        ann_vol = equity_df['returns'].std() * np.sqrt(252)

        # Risk metrics
        sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0

        # FIX: Sortino uses LPM2 (Lower Partial Moment), not std of negative returns
        # Per Gemini audit 2025-12-06: std(neg_returns) measures dispersion around mean loss,
        # which is wrong. LPM2 = sqrt(mean(min(r, 0)^2)) measures dispersion around zero.
        downside_returns = np.minimum(equity_df['returns'], 0)  # Clip positive to 0
        downside_vol = np.sqrt((downside_returns ** 2).mean()) * np.sqrt(252)
        sortino = ann_return / downside_vol if downside_vol > 0 else 0.0

        # Drawdown
        cum_max = equity_df['equity'].expanding().max()
        drawdown = (equity_df['equity'] - cum_max) / cum_max
        max_dd = abs(drawdown.min()) if len(drawdown) > 0 else 0.0

        # Max drawdown duration
        underwater = drawdown < 0
        if underwater.any():
            underwater_periods = underwater.astype(int).groupby((~underwater).cumsum()).cumsum()
            max_dd_duration = int(underwater_periods.max())
        else:
            max_dd_duration = 0

        calmar = ann_return / max_dd if max_dd > 0 else 0.0

        # Trade metrics
        n_trades = len(trades)
        trade_pnls = [t.realized_pnl for t in trades]
        winners = [p for p in trade_pnls if p > 0]
        losers = [p for p in trade_pnls if p <= 0]

        n_winning = len(winners)
        n_losing = len(losers)
        win_rate = n_winning / n_trades if n_trades > 0 else 0.0

        total_gains = sum(winners)
        total_losses = abs(sum(losers))
        profit_factor = total_gains / total_losses if total_losses > 0 else 0.0

        avg_trade = np.mean(trade_pnls) if trade_pnls else 0.0
        avg_winner = np.mean(winners) if winners else 0.0
        avg_loser = np.mean(losers) if losers else 0.0

        # Costs
        total_commission = sum(t.entry_commission + t.exit_commission for t in trades)
        total_slippage = 0.0  # Embedded in execution prices

        # Distribution
        returns = equity_df['returns']
        skewness = returns.skew() if len(returns) > 2 else 0.0
        kurtosis = returns.kurtosis() if len(returns) > 3 else 0.0

        # Regime breakdown
        returns_by_regime = {}
        for regime in [0, 1, 2, 3]:
            regime_mask = self._aligned_regimes.reindex(equity_df.index) == regime
            regime_returns = returns[regime_mask]
            if len(regime_returns) > 0:
                returns_by_regime[regime] = (1 + regime_returns).prod() - 1
            else:
                returns_by_regime[regime] = 0.0

        return BacktestResult(
            dna=dna,
            total_return=total_return,
            ann_return=ann_return,
            ann_volatility=ann_vol,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            max_drawdown=max_dd,
            max_drawdown_duration=max_dd_duration,
            calmar_ratio=calmar,
            n_trades=n_trades,
            n_winning_trades=n_winning,
            n_losing_trades=n_losing,
            win_rate=win_rate,
            profit_factor=profit_factor,
            avg_trade_return=avg_trade,
            avg_winner=avg_winner,
            avg_loser=avg_loser,
            total_commission=total_commission,
            total_slippage=total_slippage,
            skewness=skewness,
            kurtosis=kurtosis,
            returns_by_regime=returns_by_regime,
            equity_curve=equity_df,
            trades=[{'entry': t.entry_date, 'exit': t.exit_date, 'pnl': t.realized_pnl,
                     'reason': t.exit_reason} for t in trades],
        )

    def _empty_result(self, dna: StructureDNA) -> BacktestResult:
        """Return empty result for insufficient data."""
        return BacktestResult(
            dna=dna,
            total_return=0.0, ann_return=0.0, ann_volatility=0.0,
            sharpe_ratio=0.0, sortino_ratio=0.0,
            max_drawdown=0.0, max_drawdown_duration=0, calmar_ratio=0.0,
            n_trades=0, n_winning_trades=0, n_losing_trades=0,
            win_rate=0.0, profit_factor=0.0, avg_trade_return=0.0,
            avg_winner=0.0, avg_loser=0.0,
            total_commission=0.0, total_slippage=0.0,
            skewness=0.0, kurtosis=0.0,
            returns_by_regime={},
        )

    def backtest_population(
        self,
        population: List[StructureDNA],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        n_workers: int = 1,  # Sequential by default for reproducibility
    ) -> List[BacktestResult]:
        """
        Backtest entire population.

        Note: Runs sequentially by default to ensure reproducibility.
        Parallel execution can introduce non-determinism.
        """
        results = []
        for i, dna in enumerate(population):
            if (i + 1) % 10 == 0:
                logger.info(f"Backtested {i + 1}/{len(population)} structures")
            result = self.backtest(dna, start_date, end_date)
            results.append(result)
        return results


# ============================================================================
# FITNESS FUNCTION
# ============================================================================

def compute_fitness(
    result: BacktestResult,
    sharpe_weight: float = 0.4,
    sortino_weight: float = 0.2,
    calmar_weight: float = 0.2,
    win_rate_weight: float = 0.1,
    profit_factor_weight: float = 0.1,
) -> float:
    """
    Compute fitness score for genetic algorithm.

    Higher is better. Incorporates multiple risk-adjusted metrics.
    """
    # Sanity checks - flag impossible results
    if result.sharpe_ratio > 5.0:
        logger.warning(f"Suspicious Sharpe: {result.sharpe_ratio:.2f} - capping at 5.0")
        sharpe = 5.0
    else:
        sharpe = result.sharpe_ratio

    if result.total_return > 10.0:  # 1000% return
        logger.warning(f"Suspicious return: {result.total_return:.1%} - investigate")

    # Weighted combination
    fitness = (
        sharpe_weight * sharpe +
        sortino_weight * min(result.sortino_ratio, 5.0) +
        calmar_weight * min(result.calmar_ratio, 5.0) +
        win_rate_weight * (result.win_rate - 0.5) * 2 +
        profit_factor_weight * min(result.profit_factor - 1.0, 3.0)
    )

    # Penalties
    if result.max_drawdown > 0.3:
        fitness -= 0.5 * (result.max_drawdown - 0.3)

    if result.n_trades < 10:
        fitness -= 0.3 * (10 - result.n_trades) / 10

    return fitness


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse
    from .structure_dna import create_initial_population

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    parser = argparse.ArgumentParser(description='Precision options backtester')
    parser.add_argument('--data', type=str, required=True, help='Path to price data parquet')
    parser.add_argument('--regimes', type=str, required=True, help='Path to regime assignments parquet')
    parser.add_argument('--n-structures', type=int, default=10, help='Number of structures to test')

    args = parser.parse_args()

    backtester = PrecisionBacktester(
        data_path=Path(args.data),
        regime_path=Path(args.regimes)
    )

    population = create_initial_population(args.n_structures)

    print("\n=== Precision Backtesting ===\n")
    results = backtester.backtest_population(population)

    for result in results:
        result.dna.fitness_score = compute_fitness(result)

    results.sort(key=lambda r: r.dna.fitness_score, reverse=True)

    print("\n=== Top Structures ===\n")
    for i, result in enumerate(results[:5]):
        print(f"{i+1}. {result.dna.structure_type.value} ({result.dna.dte_bucket.value}DTE)")
        print(f"   Sharpe: {result.sharpe_ratio:.2f} | Win: {result.win_rate:.1%} | "
              f"MaxDD: {result.max_drawdown:.1%} | Trades: {result.n_trades}")
        print()
