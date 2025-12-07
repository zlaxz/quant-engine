"""
Futures Risk Manager

Production-grade position sizing and risk management for futures.
Handles portfolio-level risk, correlation, and drawdown protection.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class RiskLevel(Enum):
    """Risk level classifications."""
    NORMAL = "normal"
    ELEVATED = "elevated"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class RiskLimits:
    """Risk limits configuration."""
    # Position limits
    max_position_size: int = 10  # Max contracts per position
    max_portfolio_exposure: float = 0.20  # 20% of capital
    max_single_position_pct: float = 0.05  # 5% of capital per position

    # Loss limits
    max_daily_loss: float = 0.02  # 2% daily stop
    max_weekly_loss: float = 0.05  # 5% weekly stop
    max_drawdown: float = 0.10  # 10% max drawdown

    # Correlation limits
    max_correlated_exposure: float = 0.15  # Max exposure to correlated positions

    # Volatility adjustments
    vol_scaling: bool = True
    target_vol: float = 0.15  # Target annualized vol
    max_vol_scale: float = 2.0  # Max scale-up in low vol
    min_vol_scale: float = 0.25  # Min scale-down in high vol


@dataclass
class PositionSizeResult:
    """Result of position sizing calculation."""
    symbol: str
    signal_strength: float
    base_size: int
    adjusted_size: int
    risk_adjusted_size: int
    final_size: int
    notional_value: float
    portfolio_pct: float
    adjustments: Dict[str, float] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    blocked: bool = False
    block_reason: Optional[str] = None


@dataclass
class RiskState:
    """Current risk state of portfolio."""
    timestamp: datetime
    capital: float
    equity: float
    open_pnl: float
    daily_pnl: float
    weekly_pnl: float
    peak_equity: float
    drawdown: float
    drawdown_pct: float
    risk_level: RiskLevel
    positions_count: int
    total_exposure: float
    exposure_pct: float
    correlation_risk: float
    vol_regime: str
    limits_breached: List[str] = field(default_factory=list)


class FuturesRiskManager:
    """
    Production risk manager for futures trading.

    Features:
    - Dynamic position sizing based on volatility
    - Portfolio-level exposure management
    - Correlation-adjusted risk limits
    - Drawdown protection with circuit breakers
    - Real-time P&L tracking
    """

    def __init__(
        self,
        initial_capital: float,
        limits: Optional[RiskLimits] = None,
        contract_specs: Optional[Dict[str, Dict]] = None
    ):
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.limits = limits or RiskLimits()

        # Default contract specs
        self.contract_specs = contract_specs or {
            'ES': {'tick_size': 0.25, 'tick_value': 12.50, 'multiplier': 50},
            'NQ': {'tick_size': 0.25, 'tick_value': 5.00, 'multiplier': 20},
            'MES': {'tick_size': 0.25, 'tick_value': 1.25, 'multiplier': 5},
            'MNQ': {'tick_size': 0.25, 'tick_value': 0.50, 'multiplier': 2},
            'RTY': {'tick_size': 0.10, 'tick_value': 5.00, 'multiplier': 50},
            'YM': {'tick_size': 1.00, 'tick_value': 5.00, 'multiplier': 5},
            'CL': {'tick_size': 0.01, 'tick_value': 10.00, 'multiplier': 1000},
            'GC': {'tick_size': 0.10, 'tick_value': 10.00, 'multiplier': 100},
            'ZN': {'tick_size': 0.015625, 'tick_value': 15.625, 'multiplier': 1000},
            'ZB': {'tick_size': 0.03125, 'tick_value': 31.25, 'multiplier': 1000},
            '6E': {'tick_size': 0.00005, 'tick_value': 6.25, 'multiplier': 125000},
        }

        # State tracking
        self._positions: Dict[str, Dict] = {}
        self._daily_pnl: float = 0.0
        self._weekly_pnl: float = 0.0
        self._peak_equity: float = initial_capital
        self._pnl_history: List[Dict] = []
        self._risk_events: List[Dict] = []
        self._last_reset: datetime = datetime.now()
        self._trading_halted: bool = False
        self._halt_reason: Optional[str] = None

        # Correlation matrix (simplified - equity indices correlated)
        self._correlation_groups = {
            'equity_index': ['ES', 'NQ', 'RTY', 'YM', 'MES', 'MNQ'],
            'energy': ['CL', 'NG'],
            'metals': ['GC', 'SI'],
            'bonds': ['ZN', 'ZB', 'ZF'],
            'currencies': ['6E', '6J']
        }

    def calculate_position_size(
        self,
        symbol: str,
        signal_strength: float,
        current_price: float,
        atr: float,
        vol_regime: str = 'normal',
        existing_positions: Optional[Dict[str, Dict]] = None
    ) -> PositionSizeResult:
        """
        Calculate optimal position size with all risk adjustments.

        Args:
            symbol: Futures symbol
            signal_strength: -1 to 1 signal strength
            current_price: Current price
            atr: Average True Range
            vol_regime: 'low', 'normal', 'high', 'extreme'
            existing_positions: Current open positions

        Returns:
            PositionSizeResult with sizing details
        """
        result = PositionSizeResult(
            symbol=symbol,
            signal_strength=signal_strength,
            base_size=0,
            adjusted_size=0,
            risk_adjusted_size=0,
            final_size=0,
            notional_value=0.0,
            portfolio_pct=0.0
        )

        # Check if trading is halted
        if self._trading_halted:
            result.blocked = True
            result.block_reason = self._halt_reason
            return result

        # Check signal strength minimum
        if abs(signal_strength) < 0.2:
            result.blocked = True
            result.block_reason = "Signal strength below threshold"
            return result

        # Get contract specs
        spec = self.contract_specs.get(symbol, {
            'tick_size': 0.01, 'tick_value': 1.0, 'multiplier': 1
        })
        multiplier = spec['multiplier']

        # Calculate notional per contract
        notional_per_contract = current_price * multiplier

        # Step 1: Base size from max single position
        max_notional = self.capital * self.limits.max_single_position_pct
        base_size = int(max_notional / notional_per_contract)
        base_size = max(1, min(base_size, self.limits.max_position_size))
        result.base_size = base_size

        # Step 2: Signal strength adjustment
        signal_adj = abs(signal_strength)
        adjusted_size = int(base_size * signal_adj)
        result.adjusted_size = adjusted_size
        result.adjustments['signal_strength'] = signal_adj

        # Step 3: Volatility scaling
        vol_scale = 1.0
        if self.limits.vol_scaling and atr > 0:
            # Estimate annualized vol from ATR
            est_vol = (atr / current_price) * np.sqrt(252)
            vol_scale = self.limits.target_vol / est_vol if est_vol > 0 else 1.0
            vol_scale = max(self.limits.min_vol_scale,
                          min(self.limits.max_vol_scale, vol_scale))
            result.adjustments['vol_scale'] = vol_scale

        # Vol regime override
        vol_regime_scales = {
            'low': 1.2,
            'normal': 1.0,
            'high': 0.6,
            'extreme': 0.3
        }
        regime_scale = vol_regime_scales.get(vol_regime, 1.0)
        vol_scale *= regime_scale
        result.adjustments['regime_scale'] = regime_scale

        risk_adjusted_size = int(adjusted_size * vol_scale)
        result.risk_adjusted_size = risk_adjusted_size

        # Step 4: Portfolio exposure check
        existing = existing_positions or self._positions
        current_exposure = sum(
            abs(p.get('notional', 0)) for p in existing.values()
        )
        new_notional = risk_adjusted_size * notional_per_contract
        total_exposure = current_exposure + new_notional

        max_exposure = self.capital * self.limits.max_portfolio_exposure
        if total_exposure > max_exposure:
            available_exposure = max_exposure - current_exposure
            if available_exposure <= 0:
                result.blocked = True
                result.block_reason = "Portfolio exposure limit reached"
                return result
            risk_adjusted_size = int(available_exposure / notional_per_contract)
            result.warnings.append("Reduced due to portfolio exposure limit")
            result.adjustments['exposure_reduction'] = available_exposure / max_exposure

        # Step 5: Correlation check
        symbol_group = None
        for group, symbols in self._correlation_groups.items():
            if symbol in symbols:
                symbol_group = group
                break

        if symbol_group:
            correlated_exposure = sum(
                abs(p.get('notional', 0))
                for s, p in existing.items()
                if s in self._correlation_groups.get(symbol_group, [])
            )
            max_correlated = self.capital * self.limits.max_correlated_exposure
            if correlated_exposure + new_notional > max_correlated:
                available = max_correlated - correlated_exposure
                if available <= 0:
                    result.blocked = True
                    result.block_reason = f"Correlated exposure limit ({symbol_group})"
                    return result
                risk_adjusted_size = int(available / notional_per_contract)
                result.warnings.append(f"Reduced due to {symbol_group} correlation")

        # Step 6: Drawdown scaling
        current_drawdown = self._calculate_drawdown()
        if current_drawdown > 0.05:  # >5% drawdown
            dd_scale = max(0.5, 1 - (current_drawdown / self.limits.max_drawdown))
            risk_adjusted_size = int(risk_adjusted_size * dd_scale)
            result.adjustments['drawdown_scale'] = dd_scale
            result.warnings.append(f"Reduced due to {current_drawdown:.1%} drawdown")

        # Final size
        final_size = max(0, min(risk_adjusted_size, self.limits.max_position_size))
        result.final_size = final_size
        result.notional_value = final_size * notional_per_contract
        result.portfolio_pct = result.notional_value / self.capital if self.capital > 0 else 0

        # Direction from signal
        if signal_strength < 0:
            result.final_size = -result.final_size

        return result

    def calculate_stop_loss(
        self,
        symbol: str,
        entry_price: float,
        direction: int,  # 1=long, -1=short
        atr: float,
        atr_multiplier: float = 2.0
    ) -> Tuple[float, float]:
        """
        Calculate stop loss and risk amount.

        Returns:
            (stop_price, risk_per_contract)
        """
        spec = self.contract_specs.get(symbol, {'multiplier': 1})
        multiplier = spec['multiplier']

        # ATR-based stop
        stop_distance = atr * atr_multiplier

        if direction > 0:  # Long
            stop_price = entry_price - stop_distance
        else:  # Short
            stop_price = entry_price + stop_distance

        risk_per_contract = stop_distance * multiplier

        return stop_price, risk_per_contract

    def check_entry_allowed(
        self,
        symbol: str,
        direction: int
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if entry is allowed given current risk state.

        Returns:
            (allowed, reason if not allowed)
        """
        # Trading halted?
        if self._trading_halted:
            return False, self._halt_reason

        # Calculate open P&L for limit checks
        open_pnl = sum(p.get('unrealized_pnl', 0) for p in self._positions.values())

        # Daily loss limit (realized + unrealized)
        total_daily_pnl = self._daily_pnl + open_pnl
        if total_daily_pnl < -self.capital * self.limits.max_daily_loss:
            self._halt_trading("Daily loss limit breached (including open positions)")
            return False, "Daily loss limit reached"

        # Weekly loss limit (realized + unrealized)
        total_weekly_pnl = self._weekly_pnl + open_pnl
        if total_weekly_pnl < -self.capital * self.limits.max_weekly_loss:
            self._halt_trading("Weekly loss limit breached (including open positions)")
            return False, "Weekly loss limit reached"

        # Max drawdown
        current_dd = self._calculate_drawdown()
        if current_dd >= self.limits.max_drawdown:
            self._halt_trading(f"Max drawdown breached: {current_dd:.1%}")
            return False, f"Max drawdown reached: {current_dd:.1%}"

        # Already have position in same direction?
        if symbol in self._positions:
            existing_dir = 1 if self._positions[symbol].get('quantity', 0) > 0 else -1
            if existing_dir == direction:
                return False, "Already have position in same direction"

        return True, None

    def update_position(
        self,
        symbol: str,
        quantity: int,
        entry_price: float,
        current_price: float,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None
    ):
        """Update or create a position."""
        spec = self.contract_specs.get(symbol, {'multiplier': 1})
        multiplier = spec['multiplier']

        notional = abs(quantity) * current_price * multiplier
        unrealized_pnl = quantity * (current_price - entry_price) * multiplier

        self._positions[symbol] = {
            'quantity': quantity,
            'entry_price': entry_price,
            'current_price': current_price,
            'notional': notional,
            'unrealized_pnl': unrealized_pnl,
            'stop_loss': stop_loss,
            'take_profit': take_profit,
            'timestamp': datetime.now()
        }

    def close_position(self, symbol: str, exit_price: float) -> float:
        """
        Close a position and return realized P&L.
        """
        if symbol not in self._positions:
            return 0.0

        pos = self._positions[symbol]
        spec = self.contract_specs.get(symbol, {'multiplier': 1})
        multiplier = spec['multiplier']

        realized_pnl = pos['quantity'] * (exit_price - pos['entry_price']) * multiplier

        # Update P&L tracking
        self._daily_pnl += realized_pnl
        self._weekly_pnl += realized_pnl
        self.capital += realized_pnl

        # Update peak
        if self.capital > self._peak_equity:
            self._peak_equity = self.capital

        # Record
        self._pnl_history.append({
            'timestamp': datetime.now(),
            'symbol': symbol,
            'pnl': realized_pnl,
            'capital': self.capital
        })

        del self._positions[symbol]
        return realized_pnl

    def get_risk_state(self) -> RiskState:
        """Get current risk state snapshot."""
        equity = self.capital + sum(
            p.get('unrealized_pnl', 0) for p in self._positions.values()
        )
        open_pnl = sum(p.get('unrealized_pnl', 0) for p in self._positions.values())
        total_exposure = sum(abs(p.get('notional', 0)) for p in self._positions.values())
        drawdown = self._peak_equity - equity
        drawdown_pct = drawdown / self._peak_equity if self._peak_equity > 0 else 0

        # Determine risk level
        if drawdown_pct >= self.limits.max_drawdown * 0.9:
            risk_level = RiskLevel.CRITICAL
        elif drawdown_pct >= self.limits.max_drawdown * 0.7:
            risk_level = RiskLevel.HIGH
        elif drawdown_pct >= self.limits.max_drawdown * 0.5:
            risk_level = RiskLevel.ELEVATED
        else:
            risk_level = RiskLevel.NORMAL

        # Check limits
        limits_breached = []
        if -self._daily_pnl > self.capital * self.limits.max_daily_loss * 0.8:
            limits_breached.append("daily_loss_warning")
        if -self._weekly_pnl > self.capital * self.limits.max_weekly_loss * 0.8:
            limits_breached.append("weekly_loss_warning")
        if total_exposure > self.capital * self.limits.max_portfolio_exposure * 0.9:
            limits_breached.append("exposure_warning")

        return RiskState(
            timestamp=datetime.now(),
            capital=self.capital,
            equity=equity,
            open_pnl=open_pnl,
            daily_pnl=self._daily_pnl,
            weekly_pnl=self._weekly_pnl,
            peak_equity=self._peak_equity,
            drawdown=drawdown,
            drawdown_pct=drawdown_pct,
            risk_level=risk_level,
            positions_count=len(self._positions),
            total_exposure=total_exposure,
            exposure_pct=total_exposure / self.capital if self.capital > 0 else 0,
            correlation_risk=self._calculate_correlation_risk(),
            vol_regime=self._get_vol_regime(),
            limits_breached=limits_breached
        )

    def daily_reset(self):
        """Reset daily counters (call at start of each trading day)."""
        self._daily_pnl = 0.0
        self._last_reset = datetime.now()
        logger.info("Daily risk counters reset")

    def weekly_reset(self):
        """Reset weekly counters (call at start of each week)."""
        self._weekly_pnl = 0.0
        logger.info("Weekly risk counters reset")

    def resume_trading(self):
        """Resume trading after halt (requires manual intervention)."""
        if self._trading_halted:
            self._risk_events.append({
                'timestamp': datetime.now(),
                'event': 'trading_resumed',
                'previous_halt_reason': self._halt_reason
            })
            self._trading_halted = False
            self._halt_reason = None
            logger.warning("Trading resumed manually")

    def _halt_trading(self, reason: str):
        """Halt all trading."""
        self._trading_halted = True
        self._halt_reason = reason
        self._risk_events.append({
            'timestamp': datetime.now(),
            'event': 'trading_halted',
            'reason': reason
        })
        logger.critical(f"TRADING HALTED: {reason}")

    def _calculate_drawdown(self) -> float:
        """Calculate current drawdown percentage."""
        equity = self.capital + sum(
            p.get('unrealized_pnl', 0) for p in self._positions.values()
        )
        if self._peak_equity > 0:
            return (self._peak_equity - equity) / self._peak_equity
        return 0.0

    def _calculate_correlation_risk(self) -> float:
        """Calculate correlation risk score (0-1)."""
        if not self._positions:
            return 0.0

        # Count positions in same correlation group
        group_exposures = {}
        for symbol, pos in self._positions.items():
            for group, symbols in self._correlation_groups.items():
                if symbol in symbols:
                    if group not in group_exposures:
                        group_exposures[group] = 0
                    group_exposures[group] += abs(pos.get('notional', 0))

        # Highest single group concentration
        if group_exposures:
            max_group = max(group_exposures.values())
            total = sum(abs(p.get('notional', 0)) for p in self._positions.values())
            if total > 0:
                return max_group / total
        return 0.0

    def _get_vol_regime(self) -> str:
        """Determine current volatility regime."""
        # In production, this would use VIX or realized vol
        # Placeholder - would be set externally
        return 'normal'

    def get_position_summary(self) -> pd.DataFrame:
        """Get summary of all positions."""
        if not self._positions:
            return pd.DataFrame()

        records = []
        for symbol, pos in self._positions.items():
            records.append({
                'symbol': symbol,
                'quantity': pos['quantity'],
                'entry_price': pos['entry_price'],
                'current_price': pos['current_price'],
                'notional': pos['notional'],
                'unrealized_pnl': pos['unrealized_pnl'],
                'pnl_pct': pos['unrealized_pnl'] / pos['notional'] if pos['notional'] > 0 else 0,
                'stop_loss': pos.get('stop_loss'),
                'take_profit': pos.get('take_profit')
            })

        return pd.DataFrame(records)

    def get_risk_events(self) -> List[Dict]:
        """Get log of all risk events."""
        return self._risk_events.copy()

    def export_state(self) -> Dict:
        """Export full risk manager state for persistence."""
        return {
            'capital': self.capital,
            'initial_capital': self.initial_capital,
            'peak_equity': self._peak_equity,
            'daily_pnl': self._daily_pnl,
            'weekly_pnl': self._weekly_pnl,
            'positions': self._positions.copy(),
            'trading_halted': self._trading_halted,
            'halt_reason': self._halt_reason,
            'risk_events': self._risk_events.copy(),
            'pnl_history': self._pnl_history.copy(),
            'timestamp': datetime.now().isoformat()
        }

    def import_state(self, state: Dict):
        """Import risk manager state from persistence."""
        self.capital = state.get('capital', self.initial_capital)
        self._peak_equity = state.get('peak_equity', self.capital)
        self._daily_pnl = state.get('daily_pnl', 0.0)
        self._weekly_pnl = state.get('weekly_pnl', 0.0)
        self._positions = state.get('positions', {})
        self._trading_halted = state.get('trading_halted', False)
        self._halt_reason = state.get('halt_reason')
        self._risk_events = state.get('risk_events', [])
        self._pnl_history = state.get('pnl_history', [])
        logger.info("Risk manager state imported")


class PortfolioRiskManager:
    """
    Multi-symbol portfolio risk manager.

    Handles cross-asset risk, rebalancing, and portfolio-level constraints.
    """

    def __init__(
        self,
        capital: float,
        risk_per_trade: float = 0.01,  # 1% risk per trade
        max_positions: int = 10,
        correlation_threshold: float = 0.7
    ):
        self.capital = capital
        self.risk_per_trade = risk_per_trade
        self.max_positions = max_positions
        self.correlation_threshold = correlation_threshold

        self._positions: Dict[str, Dict] = {}
        self._correlation_matrix: Optional[pd.DataFrame] = None

    def set_correlation_matrix(self, corr_matrix: pd.DataFrame):
        """Set the correlation matrix for risk calculations."""
        self._correlation_matrix = corr_matrix

    def calculate_kelly_position(
        self,
        symbol: str,
        win_rate: float,
        avg_win: float,
        avg_loss: float,
        max_kelly_fraction: float = 0.25
    ) -> float:
        """
        Calculate position size using Kelly Criterion.

        Returns fraction of capital to allocate.
        """
        if avg_loss == 0:
            return 0.0

        # Kelly formula: f* = (p*b - q) / b
        # where p = win rate, q = 1-p, b = avg_win/avg_loss
        b = avg_win / abs(avg_loss)
        p = win_rate
        q = 1 - p

        kelly = (p * b - q) / b

        # Fractional Kelly for safety
        kelly = max(0, kelly * max_kelly_fraction)

        return kelly

    def calculate_var(
        self,
        positions: Dict[str, float],
        returns: pd.DataFrame,
        confidence: float = 0.95,
        horizon_days: int = 1
    ) -> float:
        """
        Calculate portfolio Value at Risk.

        Args:
            positions: Dict of symbol -> position value
            returns: DataFrame of historical returns
            confidence: Confidence level (0.95 = 95%)
            horizon_days: VaR horizon

        Returns:
            VaR in dollar terms
        """
        symbols = list(positions.keys())
        weights = np.array([positions[s] / sum(positions.values()) for s in symbols])

        # Filter returns to only positions we have
        available = [s for s in symbols if s in returns.columns]
        if not available:
            return 0.0

        port_returns = (returns[available] * weights[:len(available)]).sum(axis=1)

        # Parametric VaR
        var_percentile = np.percentile(port_returns, (1 - confidence) * 100)
        portfolio_value = sum(positions.values())

        return abs(var_percentile * portfolio_value * np.sqrt(horizon_days))

    def get_rebalance_trades(
        self,
        target_weights: Dict[str, float],
        current_positions: Dict[str, Dict],
        prices: Dict[str, float],
        min_trade_value: float = 1000
    ) -> List[Dict]:
        """
        Calculate trades needed to rebalance to target weights.

        Returns list of trades to execute.
        """
        trades = []

        # Current weights
        total_value = sum(
            abs(p.get('quantity', 0) * prices.get(s, 0) *
                self._get_multiplier(s))
            for s, p in current_positions.items()
        ) or self.capital

        # Calculate differences
        for symbol, target_weight in target_weights.items():
            target_value = self.capital * target_weight
            current_value = 0

            if symbol in current_positions:
                pos = current_positions[symbol]
                current_value = pos.get('quantity', 0) * prices.get(symbol, 0) * \
                               self._get_multiplier(symbol)

            diff = target_value - current_value

            if abs(diff) >= min_trade_value:
                multiplier = self._get_multiplier(symbol)
                price = prices.get(symbol, 0)
                if price > 0 and multiplier > 0:
                    contracts = int(diff / (price * multiplier))
                    if contracts != 0:
                        trades.append({
                            'symbol': symbol,
                            'action': 'BUY' if contracts > 0 else 'SELL',
                            'quantity': abs(contracts),
                            'target_value': target_value,
                            'current_value': current_value
                        })

        return trades

    def _get_multiplier(self, symbol: str) -> float:
        """Get contract multiplier for symbol."""
        specs = {
            'ES': 50, 'NQ': 20, 'MES': 5, 'MNQ': 2,
            'RTY': 50, 'YM': 5, 'CL': 1000, 'GC': 100
        }
        return specs.get(symbol, 1)
