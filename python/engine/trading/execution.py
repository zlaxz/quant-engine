"""
Execution model for realistic bid-ask spreads, slippage, and transaction costs.

Models:
- Bid-ask spreads as function of moneyness, DTE, volatility
- Execution slippage
- Delta hedging costs (ES futures)
"""

import numpy as np
import pandas as pd
from typing import Tuple


class ExecutionModel:
    """Realistic execution cost model for SPY options."""

    def __init__(
        self,
        base_spread_atm: float = 0.20,  # Base ATM spread ($) - BUG FIX Round 7: was 0.03, too low
        base_spread_otm: float = 0.30,  # Base OTM spread ($) - BUG FIX Round 7: was 0.05, too low
        spread_multiplier_vol: float = 2.0,  # Spread widening in high vol (2-3x)
        slippage_small: float = 0.10,  # 10% of spread for 1-10 contracts (BUG FIX 2025-11-18)
        slippage_medium: float = 0.25,  # 25% of spread for 11-50 contracts
        slippage_large: float = 0.50,  # 50% of spread for 50+ contracts
        es_commission: float = 2.50,  # ES futures commission per round-trip
        es_spread: float = 12.50,  # ES bid-ask spread (0.25 points = $12.50) - BUG FIX 2025-11-18
        option_commission: float = 0.65,  # Options commission per contract
        sec_fee_rate: float = 0.00182  # SEC fee per $1000 principal (for short sales)
    ):
        """
        Initialize execution model.

        Parameters:
        -----------
        base_spread_atm : float
            Base bid-ask spread for ATM straddles (dollars)
        base_spread_otm : float
            Base bid-ask spread for OTM options (dollars)
        spread_multiplier_vol : float
            Spread widening multiplier during high volatility
        slippage_pct : float
            Additional slippage as percentage of mid price
        es_commission : float
            ES futures commission per round-trip (dollars)
        es_slippage : float
            ES futures slippage per contract (dollars)
        option_commission : float
            Commission per option contract (dollars)
        sec_fee_rate : float
            SEC fee per contract for short sales (dollars)
        """
        self.base_spread_atm = base_spread_atm
        self.base_spread_otm = base_spread_otm
        self.spread_multiplier_vol = spread_multiplier_vol
        # BUG FIX (2025-11-18): Size-based slippage instead of fixed percentage
        self.slippage_small = slippage_small
        self.slippage_medium = slippage_medium
        self.slippage_large = slippage_large
        self.es_commission = es_commission
        self.es_spread = es_spread  # BUG FIX: ES bid-ask spread included
        self.option_commission = option_commission
        self.sec_fee_rate = sec_fee_rate

    def get_spread(
        self,
        mid_price: float,
        moneyness: float,
        dte: int,
        vix_level: float = 20.0,
        is_strangle: bool = False
    ) -> float:
        """
        Calculate bid-ask spread for an option.

        Parameters:
        -----------
        mid_price : float
            Mid price of the option
        moneyness : float
            Abs(strike - spot) / spot (0 = ATM, higher = OTM)
        dte : int
            Days to expiration
        vix_level : float
            Current VIX level (for spread widening)
        is_strangle : bool
            Whether this is a strangle (tighter spread than straddle)

        Returns:
        --------
        spread : float
            Bid-ask spread in dollars
        """
        # Base spread depends on structure
        base = self.base_spread_otm if is_strangle else self.base_spread_atm

        # BUG FIX (2025-11-18): Final audit - linear scaling more realistic
        # Strategy-logic-auditor found: Power function causes OTM narrower than ATM
        # Using linear scaling: moneyness 0.1 → 1.5x, moneyness 0.2 → 2.0x
        moneyness_factor = 1.0 + moneyness * 5.0  # Linear widening

        # Adjust for DTE (wider spreads for short DTE)
        dte_factor = 1.0
        if dte < 7:
            dte_factor = 1.3  # 30% wider for weekly options
        elif dte < 14:
            dte_factor = 1.15  # 15% wider for 2-week options

        # Adjust for volatility (continuous scaling, not threshold-based)
        # BUG FIX (2025-11-18): Final audit - VIX thresholds miss 45% of vol moves
        # Continuous: VIX 15→1.0x, VIX 25→1.5x, VIX 35+→2.0x
        vol_factor = 1.0 + max(0, (vix_level - 15.0) / 20.0)
        vol_factor = min(3.0, vol_factor)  # Cap at 3x

        # Final spread
        spread = base * moneyness_factor * dte_factor * vol_factor

        # BUG FIX Round 7: Removed min_spread override that was masking all scaling factors
        # With increased base spreads (0.20 ATM, 0.30 OTM), calculated spread always exceeds
        # reasonable minimums. The override was preventing vol/moneyness/DTE scaling from working.
        # Examples of spread calculation with new bases:
        #   ATM, VIX 15: $0.20 * 1.0 * 1.0 * 1.0 = $0.20
        #   ATM, VIX 45: $0.20 * 1.0 * 1.0 * 2.5 = $0.50 (vol scaling works!)
        #   OTM 15%, VIX 20: $0.30 * 1.75 * 1.0 * 1.25 = $0.66 (moneyness scaling works!)
        return spread

    def get_execution_price(
        self,
        mid_price: float,
        side: str,  # 'buy' or 'sell'
        moneyness: float,
        dte: int,
        vix_level: float = 20.0,
        is_strangle: bool = False,
        quantity: int = 1  # BUG FIX (2025-11-18): Agent #6b - size-based slippage
    ) -> float:
        """
        Get realistic execution price including bid-ask spread and slippage.

        BUG FIX (2025-11-18): Added size-based slippage - zero slippage is unrealistic

        Parameters:
        -----------
        mid_price : float
            Mid price of the option
        side : str
            'buy' or 'sell'
        moneyness : float
            Abs(strike - spot) / spot
        dte : int
            Days to expiration
        vix_level : float
            Current VIX level
        is_strangle : bool
            Whether this is a strangle
        quantity : int
            Order size (for size-based slippage)

        Returns:
        --------
        exec_price : float
            Execution price (mid ± half spread ± slippage)
        """
        spread = self.get_spread(mid_price, moneyness, dte, vix_level, is_strangle)
        half_spread = spread / 2.0

        # Size-based slippage as % of half-spread
        abs_qty = abs(quantity)
        if abs_qty <= 10:
            slippage_pct = self.slippage_small
        elif abs_qty <= 50:
            slippage_pct = self.slippage_medium
        else:
            slippage_pct = self.slippage_large

        slippage = half_spread * slippage_pct

        if side == 'buy':
            # Pay ask + slippage
            return mid_price + half_spread + slippage
        elif side == 'sell':
            # Receive bid - slippage
            return max(0.01, mid_price - half_spread - slippage)
        else:
            raise ValueError(f"Invalid side: {side}. Must be 'buy' or 'sell'")

    def get_delta_hedge_cost(self, contracts: float, es_mid_price: float = 4500.0) -> float:
        """
        Calculate cost of delta hedging with ES futures.

        BUG FIX (2025-11-18): Agent #6b found - missing ES bid-ask spread ($12.50 per round trip)

        Parameters:
        -----------
        contracts : float
            Number of ES futures contracts (can be fractional, will round)
        es_mid_price : float
            ES mid price (for market impact on large orders, currently unused)

        Returns:
        --------
        cost : float
            Total cost of hedging (commission + ES spread + market impact)
        """
        # Round to nearest contract, but zero out if < 0.5 contracts
        if abs(contracts) < 0.5:
            return 0.0

        actual_contracts = abs(round(contracts))

        # ES typical spread: 0.25 points = $12.50 per contract (one-way)
        # We pay half-spread on entry
        es_half_spread = self.es_spread / 2.0

        # Base costs: commission + half spread (one-way)
        cost_per_contract = self.es_commission + es_half_spread

        # Market impact for larger orders
        impact_multiplier = 1.0
        if actual_contracts > 10:
            impact_multiplier = 1.1  # 10% additional cost for >10 contracts
        elif actual_contracts > 50:
            impact_multiplier = 1.25  # 25% additional cost for >50 contracts

        return actual_contracts * cost_per_contract * impact_multiplier

    def apply_spread_to_price(
        self,
        mid_price: float,
        quantity: int,  # Positive = long, negative = short
        moneyness: float,
        dte: int,
        vix_level: float = 20.0,
        is_strangle: bool = False
    ) -> float:
        """
        Apply bid-ask spread to get execution price based on quantity sign.

        Parameters:
        -----------
        mid_price : float
            Mid price
        quantity : int
            Quantity (sign determines buy/sell)
        moneyness : float
            Moneyness
        dte : int
            Days to expiration
        vix_level : float
            VIX level
        is_strangle : bool
            Whether strangle

        Returns:
        --------
        exec_price : float
            Execution price
        """
        side = 'buy' if quantity > 0 else 'sell'
        return self.get_execution_price(
            mid_price, side, moneyness, dte, vix_level, is_strangle
        )

    def get_commission_cost(self, num_contracts: int, is_short: bool = False, premium: float = 0.0) -> float:
        """
        Calculate total commission and fees for options trade.

        BUG FIX (2025-11-18): Agent #6b found - missing OCC and FINRA fees ($0.06+/contract)

        Parameters:
        -----------
        num_contracts : int
            Number of contracts traded (absolute value)
        is_short : bool
            Whether this is a short sale (incurs SEC fees)
        premium : float
            Option premium (for SEC fee calculation which is per $1000 of principal)

        Returns:
        --------
        total_cost : float
            Total commission + fees (always positive)
        """
        num_contracts = abs(num_contracts)

        # Base commission
        commission = num_contracts * self.option_commission

        # SEC fee is actually $0.00182 per $1000 of principal (NOT per contract)
        sec_fees = 0.0
        if is_short and premium > 0:
            principal = num_contracts * 100 * premium
            sec_fees = principal * (0.00182 / 1000.0)

        # OCC fees ($0.055 per contract) - MISSING in original
        occ_fees = num_contracts * 0.055

        # FINRA TAFC fee ($0.00205 per contract for short sales) - MISSING in original
        finra_fees = num_contracts * 0.00205 if is_short else 0.0

        return commission + sec_fees + occ_fees + finra_fees


def calculate_moneyness(strike: float, spot: float) -> float:
    """Calculate moneyness as abs(strike - spot) / spot."""
    return abs(strike - spot) / spot


def get_vix_proxy(rv_20: float) -> float:
    """
    Simple VIX proxy from 20-day realized vol.

    Typical relationship: VIX ≈ RV * sqrt(252) * 100 * 1.2 (IV premium)

    Parameters:
    -----------
    rv_20 : float
        20-day realized volatility (annualized, as decimal)

    Returns:
    --------
    vix_proxy : float
        VIX proxy (e.g., 20.0 for 20% implied vol)
    """
    return rv_20 * 100 * 1.2  # RV to IV with 20% premium
