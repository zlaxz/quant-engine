"""
Risk Manager - Position Sizing with Contract Multipliers
=========================================================

THE x100 TRAP: Options have a 100x multiplier. If your bot sees an option
at $4.00 and calculates size for a $10,000 position, it might try to buy
2,500 contracts instead of 25. This blows up the account.

This module provides contract-aware position sizing to prevent disasters.

Usage:
    rm = RiskManager(account_size=100000, max_risk_per_trade=0.02)

    # For options (automatic 100x multiplier)
    size = rm.calculate_position_size(
        price=4.00,
        stop_loss=3.50,
        asset_type='option'
    )  # Returns contract count, properly adjusted

    # For futures
    size = rm.calculate_position_size(
        price=5000.00,
        stop_loss=4980.00,
        asset_type='future',
        symbol='ES'
    )  # Returns contract count, adjusted for 50x multiplier
"""

import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class AssetType(Enum):
    """Asset types with their contract multipliers."""
    STOCK = 'stock'
    OPTION = 'option'
    FUTURE = 'future'


# Contract multipliers by asset type and symbol
CONTRACT_MULTIPLIERS = {
    'option': 100,      # 1 contract = 100 shares
    'future': {
        'ES': 50,       # E-mini S&P 500: $50 per point
        'NQ': 20,       # E-mini Nasdaq: $20 per point
        'MES': 5,       # Micro E-mini S&P: $5 per point
        'MNQ': 2,       # Micro E-mini Nasdaq: $2 per point
        'YM': 5,        # E-mini Dow: $5 per point
        'RTY': 50,      # E-mini Russell: $50 per point
        'CL': 1000,     # Crude Oil: 1000 barrels
        'GC': 100,      # Gold: 100 troy ounces
        'DEFAULT': 1,   # Unknown futures default
    },
    'stock': 1,         # Stocks have no multiplier
}

# Safety limits to prevent catastrophic bugs
MAX_CONTRACTS = {
    'option': 50,       # Max 50 option contracts per trade
    'future': 10,       # Max 10 futures contracts per trade
    'stock': 10000,     # Max 10,000 shares per trade
}


@dataclass
class PositionSizeResult:
    """Result of position sizing calculation."""
    quantity: int
    notional_value: float
    risk_amount: float
    risk_percent: float
    multiplier: int
    asset_type: str
    was_limited: bool = False
    limit_reason: str = ""


class RiskManager:
    """
    Risk-aware position sizing with contract multipliers.

    The core principle: Never risk more than X% of account on a single trade.
    Account for contract multipliers to avoid the x100 trap.

    Attributes:
        account_size: Total account value
        max_risk_per_trade: Maximum fraction of account to risk (default 0.02 = 2%)
        max_position_pct: Maximum position size as % of account (default 0.20 = 20%)
    """

    def __init__(
        self,
        account_size: float,
        max_risk_per_trade: float = 0.02,
        max_position_pct: float = 0.20,
    ):
        """
        Initialize Risk Manager.

        Args:
            account_size: Total account value in dollars
            max_risk_per_trade: Max % of account to risk per trade (0.02 = 2%)
            max_position_pct: Max position size as % of account (0.20 = 20%)
        """
        self.account_size = account_size
        self.max_risk_per_trade = max_risk_per_trade
        self.max_position_pct = max_position_pct

        logger.info(f"RiskManager initialized:")
        logger.info(f"  Account: ${account_size:,.2f}")
        logger.info(f"  Max risk/trade: {max_risk_per_trade:.1%}")
        logger.info(f"  Max position: {max_position_pct:.1%}")

    def get_contract_multiplier(
        self,
        asset_type: str,
        symbol: Optional[str] = None
    ) -> int:
        """
        Get the contract multiplier for an asset.

        Args:
            asset_type: 'stock', 'option', or 'future'
            symbol: Symbol (required for futures to get correct multiplier)

        Returns:
            Contract multiplier (100 for options, varies for futures, 1 for stocks)
        """
        asset_type = asset_type.lower()

        if asset_type == 'option':
            return CONTRACT_MULTIPLIERS['option']  # Always 100

        elif asset_type == 'future':
            if symbol:
                symbol = symbol.upper()
                # Check for exact match
                if symbol in CONTRACT_MULTIPLIERS['future']:
                    return CONTRACT_MULTIPLIERS['future'][symbol]
                # Check for symbol prefix (e.g., 'ESH24' -> 'ES')
                for base_symbol in CONTRACT_MULTIPLIERS['future']:
                    if symbol.startswith(base_symbol):
                        return CONTRACT_MULTIPLIERS['future'][base_symbol]
            return CONTRACT_MULTIPLIERS['future']['DEFAULT']

        else:  # stock
            return CONTRACT_MULTIPLIERS['stock']  # Always 1

    def get_max_contracts(self, asset_type: str) -> int:
        """Get the maximum contracts allowed for an asset type."""
        asset_type = asset_type.lower()
        return MAX_CONTRACTS.get(asset_type, MAX_CONTRACTS['stock'])

    def calculate_position_size(
        self,
        price: float,
        stop_loss: float,
        asset_type: str = 'stock',
        symbol: Optional[str] = None,
        custom_risk_pct: Optional[float] = None,
    ) -> PositionSizeResult:
        """
        Calculate position size with contract multiplier awareness.

        THE FORMULA:
        1. Risk Amount = Account * Risk%
        2. Risk Per Unit = |Price - Stop|
        3. Raw Quantity = Risk Amount / Risk Per Unit
        4. Adjusted Quantity = Raw Quantity / Multiplier
        5. Final = min(Adjusted, Max Contracts, Max Position Limit)

        Args:
            price: Current price of the asset
            stop_loss: Stop loss price
            asset_type: 'stock', 'option', or 'future'
            symbol: Symbol (needed for futures multiplier lookup)
            custom_risk_pct: Override default risk percentage

        Returns:
            PositionSizeResult with calculated quantity and details

        Example:
            # Option at $4.00 with $3.50 stop, 2% risk on $100k account
            # Risk = $100k * 0.02 = $2,000
            # Risk per share = $0.50
            # Raw shares = 4,000
            # Contracts = 4,000 / 100 = 40
        """
        asset_type = asset_type.lower()
        risk_pct = custom_risk_pct or self.max_risk_per_trade

        # Get multiplier
        multiplier = self.get_contract_multiplier(asset_type, symbol)

        # Calculate risk amount (dollars we're willing to lose)
        risk_amount = self.account_size * risk_pct

        # Calculate risk per share/contract
        risk_per_unit = abs(price - stop_loss)

        if risk_per_unit <= 0:
            logger.warning(f"Invalid stop loss: price={price}, stop={stop_loss}")
            return PositionSizeResult(
                quantity=0,
                notional_value=0,
                risk_amount=0,
                risk_percent=0,
                multiplier=multiplier,
                asset_type=asset_type,
                was_limited=True,
                limit_reason="Invalid stop loss"
            )

        # Calculate raw quantity (in shares)
        raw_quantity = risk_amount / risk_per_unit

        # Adjust for contract multiplier
        # For options: 40 contracts = 4000 shares, so divide by 100
        adjusted_quantity = raw_quantity / multiplier

        # Round down to whole contracts
        quantity = int(adjusted_quantity)

        # Apply maximum contract limit (safety check)
        max_contracts = self.get_max_contracts(asset_type)
        was_limited = False
        limit_reason = ""

        if quantity > max_contracts:
            was_limited = True
            limit_reason = f"Exceeded max contracts ({max_contracts})"
            quantity = max_contracts
            logger.warning(f"Position limited: {limit_reason}")

        # Apply maximum position size limit
        max_position_value = self.account_size * self.max_position_pct
        position_value = quantity * price * multiplier

        if position_value > max_position_value:
            was_limited = True
            limit_reason = f"Exceeded max position value (${max_position_value:,.2f})"
            quantity = int(max_position_value / (price * multiplier))
            logger.warning(f"Position limited: {limit_reason}")

        # Recalculate actual risk with final quantity
        actual_risk = quantity * risk_per_unit * multiplier
        actual_risk_pct = actual_risk / self.account_size if self.account_size > 0 else 0

        # Calculate notional value
        notional_value = quantity * price * multiplier

        result = PositionSizeResult(
            quantity=quantity,
            notional_value=notional_value,
            risk_amount=actual_risk,
            risk_percent=actual_risk_pct,
            multiplier=multiplier,
            asset_type=asset_type,
            was_limited=was_limited,
            limit_reason=limit_reason
        )

        logger.info(f"Position sized: {quantity} {asset_type}s @ ${price:.2f}")
        logger.info(f"  Multiplier: {multiplier}x, Notional: ${notional_value:,.2f}")
        logger.info(f"  Risk: ${actual_risk:,.2f} ({actual_risk_pct:.2%})")

        return result

    def validate_order(
        self,
        quantity: int,
        price: float,
        asset_type: str,
        symbol: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validate an order before submission.

        Checks:
        - Quantity within limits
        - Notional value within position limits
        - Basic sanity checks

        Returns:
            Dict with 'valid' bool and 'reason' if invalid
        """
        asset_type = asset_type.lower()
        multiplier = self.get_contract_multiplier(asset_type, symbol)
        max_contracts = self.get_max_contracts(asset_type)
        notional = quantity * price * multiplier

        # Check contract limit
        if quantity > max_contracts:
            return {
                'valid': False,
                'reason': f"Quantity {quantity} exceeds max {max_contracts} contracts"
            }

        # Check position size limit
        max_position = self.account_size * self.max_position_pct
        if notional > max_position:
            return {
                'valid': False,
                'reason': f"Notional ${notional:,.2f} exceeds max ${max_position:,.2f}"
            }

        # Check minimum quantity
        if quantity <= 0:
            return {
                'valid': False,
                'reason': "Quantity must be positive"
            }

        return {
            'valid': True,
            'notional': notional,
            'multiplier': multiplier,
            'position_pct': notional / self.account_size
        }

    def update_account_size(self, new_size: float) -> None:
        """Update account size (e.g., after daily P&L)."""
        old_size = self.account_size
        self.account_size = new_size
        logger.info(f"Account updated: ${old_size:,.2f} -> ${new_size:,.2f}")


# Singleton instance for global access
_risk_manager: Optional[RiskManager] = None


def get_risk_manager(
    account_size: float = 100000,
    max_risk_per_trade: float = 0.02,
) -> RiskManager:
    """Get or create singleton RiskManager instance."""
    global _risk_manager
    if _risk_manager is None:
        _risk_manager = RiskManager(account_size, max_risk_per_trade)
    return _risk_manager


def reset_risk_manager() -> None:
    """Reset singleton (for testing)."""
    global _risk_manager
    _risk_manager = None


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Initialize with $100k account, 2% max risk per trade
    rm = RiskManager(account_size=100000, max_risk_per_trade=0.02)

    print("\n=== Stock Position ===")
    result = rm.calculate_position_size(
        price=150.00,
        stop_loss=145.00,
        asset_type='stock'
    )
    print(f"Buy {result.quantity} shares @ $150")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")

    print("\n=== Option Position (THE x100 TRAP) ===")
    result = rm.calculate_position_size(
        price=4.00,
        stop_loss=3.50,
        asset_type='option'
    )
    print(f"Buy {result.quantity} contracts @ $4.00")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")
    print(f"WITHOUT multiplier would be: {int(2000 / 0.50)} shares (WRONG!)")

    print("\n=== ES Futures Position ===")
    result = rm.calculate_position_size(
        price=5000.00,
        stop_loss=4980.00,
        asset_type='future',
        symbol='ES'
    )
    print(f"Buy {result.quantity} contracts @ $5000")
    print(f"Notional: ${result.notional_value:,.2f}, Risk: ${result.risk_amount:,.2f}")
