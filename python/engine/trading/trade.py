"""
Generic trade object for multi-leg option structures.

Defines:
- TradeLeg: Single option leg (strike, expiry, type, quantity)
- Trade: Multi-leg structure with entry/exit rules
"""

from dataclasses import dataclass
from datetime import datetime, date as date_cls
from typing import List, Optional, Dict
import pandas as pd
import numpy as np
from ..pricing.greeks import calculate_all_greeks
from .utils import normalize_date


CONTRACT_MULTIPLIER = 100  # SPY options represent 100 shares per contract


@dataclass
class TradeLeg:
    """Single option leg within a trade structure."""

    strike: float          # Strike price
    expiry: datetime       # Expiration date
    option_type: str       # 'call' or 'put'
    quantity: int          # Positive = long, negative = short
    dte: int              # Days to expiration at entry (for reference)

    def __repr__(self):
        direction = "Long" if self.quantity > 0 else "Short"
        return f"{direction} {abs(self.quantity)}x {self.strike:.0f} {self.option_type.upper()} ({self.dte}DTE)"


@dataclass
class Trade:
    """Multi-leg option structure with entry/exit rules."""

    # Identity
    trade_id: str
    profile_name: str

    # Entry
    entry_date: datetime
    legs: List[TradeLeg]
    entry_prices: Dict[int, float]  # leg_index -> entry_price

    # Position tracking
    is_open: bool = True
    underlying_price_entry: float = 0.0

    # Hedging
    delta_hedge_qty: float = 0.0  # ES futures quantity for delta hedge
    cumulative_hedge_cost: float = 0.0  # Track total hedging costs

    # Commissions and fees
    entry_commission: float = 0.0  # Commission paid on entry
    exit_commission: float = 0.0  # Commission paid on exit

    # Exit
    exit_date: Optional[datetime] = None
    exit_prices: Optional[Dict[int, float]] = None
    exit_reason: Optional[str] = None

    # P&L tracking
    entry_cost: float = 0.0  # Total entry cost (negative = debit paid)
    exit_proceeds: float = 0.0  # Total exit proceeds
    realized_pnl: float = 0.0

    # Greeks tracking (current values - updated during mark-to-market)
    net_delta: float = 0.0
    net_gamma: float = 0.0
    net_vega: float = 0.0
    net_theta: float = 0.0

    # Greeks history (list of dicts tracking Greeks over time)
    greeks_history: List[Dict] = None  # [{date, dte, spot, delta, gamma, vega, theta, iv}, ...]

    # P&L attribution by Greek component
    pnl_attribution: Optional[Dict[str, float]] = None  # {delta_pnl, gamma_pnl, theta_pnl, vega_pnl}

    # Metadata for AI/ML state tracking
    metadata: Dict = None

    def __post_init__(self):
        """Calculate entry cost from entry prices.

        Sign Convention:
        - entry_cost = cash outflow (positive for debit paid, negative for credit received)
        - For LONG positions (qty > 0): We pay → entry_cost = +qty * price (positive)
        - For SHORT positions (qty < 0): We receive → entry_cost = qty * price (negative)
        """
        # Normalize entry_date to datetime.date for consistency
        date_obj = normalize_date(self.entry_date)
        self.entry_date = datetime.combine(date_obj, datetime.min.time())

        # Initialize Greeks history if None
        if self.greeks_history is None:
            self.greeks_history = []
            
        if self.metadata is None:
            self.metadata = {}

        if self.entry_prices:
            self.entry_cost = sum(
                self.legs[i].quantity * price * CONTRACT_MULTIPLIER  # Convert to notional dollars
                for i, price in self.entry_prices.items()
            )

    def close(self, exit_date: datetime, exit_prices: Dict[int, float], reason: str):
        """Close the trade and calculate realized P&L.

        P&L Calculation:
        - P&L = quantity × (exit_price - entry_price) for each leg, summed
        - LONG (qty > 0): profit when exit_price > entry_price → positive P&L
        - SHORT (qty < 0): profit when entry_price > exit_price → positive P&L
        - This convention naturally handles both directions correctly
        - Subtract all costs: entry commission, exit commission, hedge costs
        """
        self.is_open = False
        # Normalize exit_date to datetime.date for consistency
        date_obj = normalize_date(exit_date)
        self.exit_date = datetime.combine(date_obj, datetime.min.time())
        self.exit_prices = exit_prices
        self.exit_reason = reason

        # Calculate P&L per leg: qty × (exit - entry)
        pnl_legs = 0.0
        for i, exit_price in exit_prices.items():
            entry_price = self.entry_prices[i]
            leg_qty = self.legs[i].quantity
            pnl_legs += leg_qty * (exit_price - entry_price) * CONTRACT_MULTIPLIER

        # For backward compatibility, also calculate exit_proceeds
        # exit_proceeds = cash inflow (negative for long closing, positive for short closing)
        self.exit_proceeds = sum(
            -self.legs[i].quantity * price * CONTRACT_MULTIPLIER
            for i, price in exit_prices.items()
        )

        # Realized P&L = leg P&L - all costs (commissions + hedging)
        self.realized_pnl = pnl_legs - self.entry_commission - self.exit_commission - self.cumulative_hedge_cost

    def mark_to_market(
        self,
        current_prices: Dict[int, float],
        current_date: Optional[datetime] = None,
        underlying_price: Optional[float] = None,
        implied_vol: Optional[float] = None,
        risk_free_rate: float = 0.05,
        estimated_exit_commission: float = 0.0
    ) -> float:
        """Calculate current P&L and update Greeks (unrealized for open trades).

        Uses same P&L convention: qty × (current_price - entry_price)
        Subtracts all costs: entry commission (already paid) + hedge costs + estimated exit commission

        Parameters:
        -----------
        current_prices : dict
            Current prices for each leg (mid prices)
        current_date : datetime, optional
            Current date (for Greeks calculation and history)
        underlying_price : float, optional
            Current spot price (for Greeks calculation)
        implied_vol : float, optional
            Current implied volatility (for Greeks calculation)
        risk_free_rate : float
            Risk-free rate (default: 5%)
        estimated_exit_commission : float
            Estimated commission for closing the position (default: 0.0)

        Returns:
        --------
        unrealized_pnl : float
            Current unrealized P&L (subtracts estimated exit commission)
        """
        if not self.is_open:
            return self.realized_pnl

        # Calculate unrealized P&L per leg: qty × (current - entry)
        unrealized_pnl = 0.0
        for i, current_price in current_prices.items():
            entry_price = self.entry_prices[i]
            leg_qty = self.legs[i].quantity
            unrealized_pnl += leg_qty * (current_price - entry_price) * CONTRACT_MULTIPLIER

        # Update Greeks if we have the required parameters
        if current_date is not None and underlying_price is not None:
            # Calculate current Greeks
            self.calculate_greeks(
                underlying_price=underlying_price,
                current_date=current_date,
                implied_vol=implied_vol if implied_vol is not None else 0.30,
                risk_free_rate=risk_free_rate
            )

            # Store Greeks history
            date_normalized = normalize_date(current_date)
            entry_date_normalized = normalize_date(self.entry_date)
            days_in_trade = (date_normalized - entry_date_normalized).days

            # Calculate average DTE across legs
            avg_dte = 0
            for leg in self.legs:
                expiry = normalize_date(leg.expiry)
                dte = (expiry - date_normalized).days
                avg_dte += max(dte, 0)
            avg_dte = avg_dte / len(self.legs) if self.legs else 0

            self.greeks_history.append({
                'date': date_normalized,
                'days_in_trade': days_in_trade,
                'avg_dte': avg_dte,
                'spot': underlying_price,
                'delta': self.net_delta,
                'gamma': self.net_gamma,
                'vega': self.net_vega,
                'theta': self.net_theta,
                'iv': implied_vol if implied_vol is not None else 0.30
            })

            # Calculate P&L attribution if we have at least 2 history points
            if len(self.greeks_history) >= 2:
                self._calculate_pnl_attribution()

        # FIX BUG-003: Unrealized P&L - hedge costs + estimated exit costs
        # Entry commission already paid (sunk cost), don't subtract from unrealized
        # Will be subtracted from realized P&L at close
        return unrealized_pnl - self.cumulative_hedge_cost - estimated_exit_commission

    def add_hedge_cost(self, cost: float):
        """Add to cumulative hedging cost."""
        self.cumulative_hedge_cost += cost

    def _calculate_pnl_attribution(self):
        """
        Attribute P&L to delta, gamma, theta, vega changes.

        Formula (simplified Taylor expansion):
        - Delta P&L: delta × ΔS (spot change)
        - Gamma P&L: 0.5 × gamma × (ΔS)² (convexity)
        - Theta P&L: theta × Δt (time decay, in days)
        - Vega P&L: vega × ΔIV (volatility change)

        Note: This is an approximation. Real P&L includes:
        - Higher order Greeks (vanna, volga, etc.)
        - Realized vs implied vol differences
        - Discrete rehedging
        """
        if len(self.greeks_history) < 2:
            return

        prev = self.greeks_history[-2]
        curr = self.greeks_history[-1]

        # Calculate changes
        delta_spot = curr['spot'] - prev['spot']
        delta_time = (curr['date'] - prev['date']).days if isinstance(curr['date'], datetime) else 1
        delta_iv = curr['iv'] - prev['iv']

        # Average Greeks (use average of prev and current for better accuracy)
        avg_delta = (prev['delta'] + curr['delta']) / 2
        avg_gamma = (prev['gamma'] + curr['gamma']) / 2
        avg_theta = (prev['theta'] + curr['theta']) / 2
        avg_vega = (prev['vega'] + curr['vega']) / 2

        # Attribution calculations
        delta_pnl = avg_delta * delta_spot
        gamma_pnl = 0.5 * avg_gamma * (delta_spot ** 2)
        # FIX BUG-TRADE-001: Theta is annualized (per year), delta_time is in days
        # Must convert theta to daily rate: divide by 365
        theta_pnl = avg_theta * (delta_time / 365.0)
        vega_pnl = avg_vega * delta_iv

        # Store attribution
        self.pnl_attribution = {
            'delta_pnl': delta_pnl,
            'gamma_pnl': gamma_pnl,
            'theta_pnl': theta_pnl,
            'vega_pnl': vega_pnl,
            'total_attributed': delta_pnl + gamma_pnl + theta_pnl + vega_pnl,
            'delta_spot': delta_spot,
            'delta_time': delta_time,
            'delta_iv': delta_iv
        }

    def calculate_greeks(
        self,
        underlying_price: float,
        current_date: datetime,
        implied_vol: float = 0.30,
        risk_free_rate: float = 0.05
    ):
        """
        Calculate and update net Greeks for all legs.

        Parameters:
        -----------
        underlying_price : float
            Current underlying price
        current_date : datetime
            Current date for calculating time to expiration
        implied_vol : float
            Implied volatility (default: 30%)
        risk_free_rate : float
            Risk-free rate (default: 5%)

        Updates:
        --------
        self.net_delta, self.net_gamma, self.net_vega, self.net_theta
        """
        # Reset Greeks
        self.net_delta = 0.0
        self.net_gamma = 0.0
        self.net_vega = 0.0
        self.net_theta = 0.0

        # Normalize current_date to date object
        current_dt = normalize_date(current_date)

        for i, leg in enumerate(self.legs):
            # Calculate time to expiration in years
            # Normalize leg.expiry to date object
            expiry = normalize_date(leg.expiry)

            time_to_expiry = (expiry - current_dt).days / 365.0

            # Skip if expired
            if time_to_expiry <= 0:
                continue

            # Calculate Greeks for this leg
            leg_greeks = calculate_all_greeks(
                S=underlying_price,
                K=leg.strike,
                T=time_to_expiry,
                r=risk_free_rate,
                sigma=implied_vol,
                option_type=leg.option_type
            )

            # Aggregate net Greeks (multiply by quantity and contract multiplier)
            # Each option contract represents 100 shares
            contract_multiplier = 100
            self.net_delta += leg.quantity * leg_greeks['delta'] * contract_multiplier
            self.net_gamma += leg.quantity * leg_greeks['gamma'] * contract_multiplier
            self.net_vega += leg.quantity * leg_greeks['vega'] * contract_multiplier
            self.net_theta += leg.quantity * leg_greeks['theta'] * contract_multiplier

    def __repr__(self):
        status = "OPEN" if self.is_open else "CLOSED"
        legs_str = ", ".join(str(leg) for leg in self.legs)
        return f"{self.profile_name} [{self.trade_id}] {status}: {legs_str}"


def create_straddle_trade(
    trade_id: str,
    profile_name: str,
    entry_date: datetime,
    strike: float,
    expiry: datetime,
    dte: int,
    quantity: int = 1,
    entry_prices: Optional[Dict[int, float]] = None
) -> Trade:
    """Helper to create ATM straddle trade (long call + long put)."""

    legs = [
        TradeLeg(strike=strike, expiry=expiry, option_type='call', quantity=quantity, dte=dte),
        TradeLeg(strike=strike, expiry=expiry, option_type='put', quantity=quantity, dte=dte)
    ]

    return Trade(
        trade_id=trade_id,
        profile_name=profile_name,
        entry_date=entry_date,
        legs=legs,
        entry_prices=entry_prices or {}
    )


def create_strangle_trade(
    trade_id: str,
    profile_name: str,
    entry_date: datetime,
    call_strike: float,
    put_strike: float,
    expiry: datetime,
    dte: int,
    quantity: int = 1,
    short: bool = False,
    entry_prices: Optional[Dict[int, float]] = None
) -> Trade:
    """Helper to create strangle trade (OTM call + OTM put)."""

    qty = -quantity if short else quantity

    legs = [
        TradeLeg(strike=call_strike, expiry=expiry, option_type='call', quantity=qty, dte=dte),
        TradeLeg(strike=put_strike, expiry=expiry, option_type='put', quantity=qty, dte=dte)
    ]

    return Trade(
        trade_id=trade_id,
        profile_name=profile_name,
        entry_date=entry_date,
        legs=legs,
        entry_prices=entry_prices or {}
    )


def create_spread_trade(
    trade_id: str,
    profile_name: str,
    entry_date: datetime,
    long_strike: float,
    short_strike: float,
    expiry: datetime,
    dte: int,
    option_type: str = 'call',
    quantity: int = 1,
    entry_prices: Optional[Dict[int, float]] = None
) -> Trade:
    """Helper to create vertical spread (long one strike, short another)."""

    legs = [
        TradeLeg(strike=long_strike, expiry=expiry, option_type=option_type, quantity=quantity, dte=dte),
        TradeLeg(strike=short_strike, expiry=expiry, option_type=option_type, quantity=-quantity, dte=dte)
    ]

    return Trade(
        trade_id=trade_id,
        profile_name=profile_name,
        entry_date=entry_date,
        legs=legs,
        entry_prices=entry_prices or {}
    )


def create_backspread_trade(
    trade_id: str,
    profile_name: str,
    entry_date: datetime,
    short_strike: float,
    long_strike: float,
    expiry: datetime,
    dte: int,
    option_type: str = 'put',
    long_ratio: int = 2,
    entry_prices: Optional[Dict[int, float]] = None
) -> Trade:
    """Helper to create backspread (short 1, long 2 typically)."""

    legs = [
        TradeLeg(strike=short_strike, expiry=expiry, option_type=option_type, quantity=-1, dte=dte),
        TradeLeg(strike=long_strike, expiry=expiry, option_type=option_type, quantity=long_ratio, dte=dte)
    ]

    return Trade(
        trade_id=trade_id,
        profile_name=profile_name,
        entry_date=entry_date,
        legs=legs,
        entry_prices=entry_prices or {}
    )
