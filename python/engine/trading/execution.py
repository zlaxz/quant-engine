"""
Execution model for realistic bid-ask spreads, slippage, and transaction costs.
UNIFIED MODEL: Combines sophisticated spread modeling with simulator execution logic.

Models:
- Bid-ask spreads as function of moneyness, DTE, volatility, time-of-day
- Execution slippage (size-based)
- Partial fills based on liquidity
- Delta hedging costs (ES futures)
"""

import numpy as np
import pandas as pd
from typing import Tuple, Dict, Optional


class UnifiedExecutionModel:
    """
    Unified execution cost model for SPY options and ES futures.
    Handles spreads, slippage, partial fills, and commission calculations.
    """

    def __init__(
        self,
        # Spread Configuration
        base_spread_atm: float = 0.20,          # $0.20 ATM base spread (SPY typical)
        base_spread_otm: float = 0.30,          # $0.30 OTM base spread
        spread_multiplier_vol: float = 2.0,     # Max vol multiplier
        
        # Size-Based Slippage (percentage of half-spread)
        slippage_small: float = 0.10,           # 1-10 contracts
        slippage_medium: float = 0.25,          # 11-50 contracts
        slippage_large: float = 0.50,           # 50+ contracts
        
        # Time-of-Day Spread Multipliers (ET market hours)
        time_of_day_open: float = 1.5,          # 9:30-10:00 ET
        time_of_day_midday: float = 1.0,        # 10:00-15:00 ET
        time_of_day_close: float = 1.3,         # 15:00-16:00 ET
        
        # Partial Fill Configuration
        max_volume_participation: float = 0.10, # Max 10% of daily volume
        min_fill_probability: float = 0.3,      # Minimum fill probability
        fill_volatility_factor: float = 1.5,    # Fill uncertainty in high vol
        
        # Commission & Fees
        option_commission: float = 0.65,        # Per contract
        min_commission: float = 1.00,           # Minimum per trade
        es_commission: float = 2.50,            # ES futures round-trip
        es_spread: float = 12.50,               # ES bid-ask spread
        
        # Regulatory Fees
        sec_fee_rate: float = 0.00182,          # SEC fee per $1000 principal
        occ_fee: float = 0.055,                 # OCC fee per contract
        finra_fee: float = 0.00205,             # FINRA TAFC fee per contract (short sales)
    ):
        self.base_spread_atm = base_spread_atm
        self.base_spread_otm = base_spread_otm
        self.spread_multiplier_vol = spread_multiplier_vol
        
        self.slippage_small = slippage_small
        self.slippage_medium = slippage_medium
        self.slippage_large = slippage_large
        
        self.time_of_day_open = time_of_day_open
        self.time_of_day_midday = time_of_day_midday
        self.time_of_day_close = time_of_day_close
        
        self.max_volume_participation = max_volume_participation
        self.min_fill_probability = min_fill_probability
        self.fill_volatility_factor = fill_volatility_factor
        
        self.option_commission = option_commission
        self.min_commission = min_commission
        self.es_commission = es_commission
        self.es_spread = es_spread
        
        self.sec_fee_rate = sec_fee_rate
        self.occ_fee = occ_fee
        self.finra_fee = finra_fee

    def _get_time_of_day_factor(self, hour: int, minute: int = 0) -> float:
        """Return spread multiplier based on market microstructure patterns."""
        # Convert to ET market hours (9:30-16:00)
        market_minutes = (hour - 9) * 60 + (minute - 30) if hour >= 9 else -1
        
        if market_minutes < 0 or market_minutes > 390:  # Outside market hours
            return 2.0  # Much wider outside trading hours
        
        if market_minutes <= 30:  # 9:30-10:00 ET
            return self.time_of_day_open
        
        if market_minutes >= 330:  # 15:00-16:00 ET
            return self.time_of_day_close
        
        return self.time_of_day_midday  # 10:00-15:00 ET

    def get_spread(
        self,
        mid_price: float,
        moneyness: float,        # abs(strike - spot) / spot
        dte: int,                # days to expiration
        vix_level: float = 20.0,
        is_strangle: bool = False,
        hour_of_day: int = 12,   # 0-23, ET hour
    ) -> float:
        """
        Calculate bid-ask spread for an option.
        """
        # Base spread (strangle tighter than straddle)
        base = self.base_spread_otm if is_strangle else self.base_spread_atm
        
        # Moneyness factor: linear widening (OTM = wider)
        moneyness_factor = 1.0 + moneyness * 5.0
        
        # DTE factor: wider for short-dated options
        dte_factor = 1.0
        if dte < 7:
            dte_factor = 1.3     # 30% wider for weekly
        elif dte < 14:
            dte_factor = 1.15    # 15% wider for 2-week
        
        # Volatility factor: continuous scaling with VIX
        vol_factor = 1.0 + max(0, (vix_level - 15.0) / 20.0)
        vol_factor = min(3.0, vol_factor)
        
        # Time-of-day factor (ET market hours 9:30-16:00)
        time_factor = self._get_time_of_day_factor(hour_of_day)
        
        # Structure factor (strangle vs straddle already in base)
        structure_factor = 0.9 if is_strangle else 1.0
        
        spread = base * moneyness_factor * dte_factor * vol_factor * time_factor * structure_factor
        return max(spread, 0.01)  # Minimum 1 cent spread

    def get_fill_quantity(
        self,
        order_size: int,          # Absolute quantity desired
        daily_volume: int,        # Today's volume for this option
        open_interest: int,       # Current open interest
        vix_level: float = 20.0,
        hour_of_day: int = 12,
    ) -> Tuple[int, float]:
        """
        Calculate realistic fill quantity and fill probability.
        Returns (filled_quantity, fill_confidence).
        """
        if daily_volume == 0 or open_interest < 100:
            return 0, 0.0  # No liquidity
        
        # Maximum participation rate (avoid moving market)
        max_participation = self.max_volume_participation
        max_fill = int(daily_volume * max_participation)
        if max_fill == 0:
            max_fill = 1 # Allow at least 1 contract if volume exists
        
        # Base fill probability based on size relative to volume
        size_ratio = order_size / daily_volume
        base_prob = min(1.0, 1.0 / (1.0 + size_ratio * 10))
        
        # Adjust for volatility (harder to fill in high vol)
        vol_adjustment = 1.0 / (1.0 + max(0, vix_level - 20.0) / 30.0)
        
        # Adjust for time of day (better fills midday)
        time_factor = self._get_time_of_day_factor(hour_of_day)
        time_adjustment = 1.0 / time_factor  # Inverse: wider spreads = lower fill probability
        
        # Final fill probability
        fill_prob = base_prob * vol_adjustment * time_adjustment
        fill_prob = max(self.min_fill_probability, fill_prob)
        
        # Determine fill quantity (deterministic for backtest reproducibility)
        # In a live sim, we might use np.random.random() <= fill_prob
        # Here we'll just cap the size based on max_fill
        filled = min(order_size, max_fill)
        
        return int(filled), fill_prob

    def get_execution_price(
        self,
        mid_price: float,
        side: str,                # 'buy' or 'sell'
        moneyness: float,
        dte: int,
        vix_level: float = 20.0,
        is_strangle: bool = False,
        quantity: int = 1,        # Order size (for size-based slippage)
        filled_quantity: int = None,  # Actual fill quantity (if partial)
        hour_of_day: int = 12,
    ) -> float:
        """
        Get realistic execution price including all adjustments.
        """
        # Calculate base spread
        spread = self.get_spread(mid_price, moneyness, dte, vix_level, 
                                is_strangle, hour_of_day)
        half_spread = spread / 2.0
        
        # Size-based slippage (use filled quantity if partial fill)
        qty_for_slippage = filled_quantity if filled_quantity is not None else abs(quantity)
        abs_qty = abs(qty_for_slippage)
        
        if abs_qty <= 10:
            slippage_pct = self.slippage_small
        elif abs_qty <= 50:
            slippage_pct = self.slippage_medium
        else:
            slippage_pct = self.slippage_large
        
        slippage = half_spread * slippage_pct
        
        # Directional adjustment
        if side == 'buy':
            return mid_price + half_spread + slippage
        elif side == 'sell':
            return max(0.01, mid_price - half_spread - slippage)
        else:
            raise ValueError(f"Invalid side: {side}")

    def get_commission_cost(self, num_contracts: int, is_short: bool = False, premium: float = 0.0) -> float:
        """
        Calculate total commission and fees for options trade.
        """
        num_contracts = abs(num_contracts)
        
        # Base commission
        commission = num_contracts * self.option_commission
        
        # SEC fee (per $1000 of principal on sells)
        sec_fees = 0.0
        if is_short and premium > 0:
            principal = num_contracts * 100 * premium
            sec_fees = principal * (self.sec_fee_rate / 1000.0)
        
        # OCC fees
        occ_fees = num_contracts * self.occ_fee
        
        # FINRA fees
        finra_fees = num_contracts * self.finra_fee if is_short else 0.0
        
        total = commission + sec_fees + occ_fees + finra_fees
        
        # Apply minimum per trade if applicable (simplified, usually per order)
        return max(total, self.min_commission)

    def execute_order(
        self,
        mid_price: float,
        side: str,
        quantity: int,
        moneyness: float,
        dte: int,
        daily_volume: int,
        open_interest: int,
        vix_level: float = 20.0,
        is_strangle: bool = False,
        hour_of_day: int = 12,
    ) -> Dict:
        """
        Complete order execution simulation.
        Returns dict with execution details.
        """
        # 1. Determine fill quantity
        filled_qty, fill_prob = self.get_fill_quantity(
            abs(quantity), daily_volume, open_interest, 
            vix_level, hour_of_day
        )
        
        if filled_qty == 0:
            return {
                'filled': False,
                'filled_quantity': 0,
                'execution_price': None,
                'slippage': None,
                'commission': 0.0,
                'fill_confidence': fill_prob
            }
        
        # 2. Calculate execution price
        exec_price = self.get_execution_price(
            mid_price, side, moneyness, dte, vix_level,
            is_strangle, quantity, filled_qty, hour_of_day
        )
        
        # 3. Calculate commission and fees
        is_short = side == 'sell'
        commission = self.get_commission_cost(filled_qty, is_short, exec_price)
        
        # 4. Calculate total cost
        total_cost = exec_price * filled_qty * 100 + commission
        
        return {
            'filled': True,
            'filled_quantity': filled_qty,
            'execution_price': exec_price,
            'slippage': abs(exec_price - mid_price),
            'commission': commission,
            'total_cost': total_cost,
            'fill_confidence': fill_prob,
            'remaining_quantity': abs(quantity) - filled_qty
        }

# Backward compatibility alias
ExecutionModel = UnifiedExecutionModel

def calculate_moneyness(strike: float, spot: float) -> float:
    """Calculate moneyness as abs(strike - spot) / spot."""
    return abs(strike - spot) / spot