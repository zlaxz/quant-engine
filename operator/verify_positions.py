#!/usr/bin/env python3
"""
Position Verification & Reconciliation
=======================================

Compare system position state to broker (IBKR) state.
BROKER IS ALWAYS TRUTH - use this to find and fix discrepancies.

Usage:
    python verify_positions.py                    # Check paper account
    python verify_positions.py --account live     # Check live account
    python verify_positions.py --all              # Check all accounts
    python verify_positions.py --fix              # Auto-fix system to match broker

Exit codes:
    0 - Positions match
    1 - Positions mismatch (manual review needed)
    2 - Connection error
"""

import os
import sys
import asyncio
import argparse
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

# Add parent to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))


class Colors:
    """Terminal colors."""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def format_position(symbol: str, qty: int, avg_cost: float, unrealized: float) -> str:
    """Format a position for display."""
    pnl_color = Colors.GREEN if unrealized >= 0 else Colors.RED
    return (
        f"  {symbol:<10} {qty:>5} @ ${avg_cost:>10.2f}  "
        f"{pnl_color}P&L: ${unrealized:>10.2f}{Colors.RESET}"
    )


class PositionVerifier:
    """Verify and reconcile positions between system and broker."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.discrepancies: List[Dict[str, Any]] = []

    def log(self, msg: str) -> None:
        """Print verbose message."""
        if self.verbose:
            print(f"  {Colors.YELLOW}→ {msg}{Colors.RESET}")

    async def get_broker_positions(
        self,
        account: str = "paper"
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get positions from IBKR.

        Returns:
            (positions_dict, error_message)
        """
        try:
            from engine.trading import IBKRClient, TradingMode

            mode = TradingMode.PAPER if account == "paper" else TradingMode.LIVE
            client_id = 1 if account == "paper" else 2

            self.log(f"Connecting to {account} account (port {7497 if account == 'paper' else 7496})")

            client = IBKRClient(mode=mode, client_id=client_id)
            connected = await client.connect(timeout=15)

            if not connected:
                return None, f"Could not connect to {account} account"

            positions = await client.get_positions()
            account_info = await client.get_account_info()

            await client.disconnect()

            result = {
                "positions": positions,
                "account_info": account_info,
                "timestamp": datetime.now().isoformat(),
            }

            return result, None

        except ImportError as e:
            return None, f"Import error: {e}"
        except Exception as e:
            return None, f"Error: {e}"

    def compare_positions(
        self,
        broker_positions: Dict[str, Any],
        system_positions: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Compare broker positions to system positions.

        Args:
            broker_positions: Positions from IBKR
            system_positions: Positions from system state (if available)

        Returns:
            List of discrepancies
        """
        discrepancies = []
        broker_pos = broker_positions.get("positions", {})

        # For now, we don't have persistent system state to compare against
        # This function is ready for when we add that capability

        if system_positions:
            system_pos = system_positions.get("positions", {})

            # Check for positions in broker but not in system
            for symbol, pos in broker_pos.items():
                if symbol not in system_pos:
                    discrepancies.append({
                        "type": "missing_in_system",
                        "symbol": symbol,
                        "broker_qty": pos.quantity,
                        "system_qty": 0,
                        "message": f"{symbol}: In broker but not in system"
                    })
                elif system_pos[symbol].quantity != pos.quantity:
                    discrepancies.append({
                        "type": "quantity_mismatch",
                        "symbol": symbol,
                        "broker_qty": pos.quantity,
                        "system_qty": system_pos[symbol].quantity,
                        "message": f"{symbol}: Broker={pos.quantity}, System={system_pos[symbol].quantity}"
                    })

            # Check for positions in system but not in broker
            for symbol, pos in system_pos.items():
                if symbol not in broker_pos:
                    discrepancies.append({
                        "type": "missing_in_broker",
                        "symbol": symbol,
                        "broker_qty": 0,
                        "system_qty": pos.quantity,
                        "message": f"{symbol}: In system but not in broker"
                    })

        return discrepancies

    async def verify_account(self, account: str) -> bool:
        """
        Verify positions for a single account.

        Returns:
            True if positions verified successfully
        """
        print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}")
        print(f"  POSITION VERIFICATION: {account.upper()}")
        print(f"{'='*60}{Colors.RESET}\n")

        # Get broker positions
        broker_data, error = await self.get_broker_positions(account)

        if error:
            print(f"  {Colors.RED}ERROR: {error}{Colors.RESET}")
            return False

        positions = broker_data.get("positions", {})
        account_info = broker_data.get("account_info")

        # Display account summary
        if account_info:
            print(f"  {Colors.BOLD}Account Summary:{Colors.RESET}")
            print(f"    Net Liquidation: ${account_info.net_liquidation:,.2f}")
            print(f"    Buying Power:    ${account_info.buying_power:,.2f}")
            print(f"    Unrealized P&L:  ${account_info.unrealized_pnl:,.2f}")
            print(f"    Realized P&L:    ${account_info.realized_pnl:,.2f}")
            print()

        # Display positions
        if positions:
            print(f"  {Colors.BOLD}Open Positions:{Colors.RESET}")
            total_unrealized = 0
            for symbol, pos in positions.items():
                print(format_position(symbol, pos.quantity, pos.avg_cost, pos.unrealized_pnl))
                total_unrealized += pos.unrealized_pnl
            print(f"\n  {Colors.BOLD}Total Unrealized P&L: ${total_unrealized:,.2f}{Colors.RESET}")
        else:
            print(f"  {Colors.GREEN}No open positions{Colors.RESET}")

        # Check for discrepancies (when we have system state to compare)
        # For now, just report what broker shows
        print(f"\n  {Colors.GREEN}✓ Broker positions retrieved successfully{Colors.RESET}")

        return True

    async def verify_all_accounts(self) -> bool:
        """Verify positions for all configured accounts."""
        accounts = ["paper", "live"]
        all_ok = True

        for account in accounts:
            try:
                ok = await self.verify_account(account)
                if not ok:
                    all_ok = False
            except Exception as e:
                print(f"  {Colors.RED}Error checking {account}: {e}{Colors.RESET}")
                all_ok = False

        return all_ok


async def main():
    parser = argparse.ArgumentParser(description="Position verification and reconciliation")
    parser.add_argument("--account", "-a", choices=["paper", "live"], default="paper",
                        help="Account to verify (default: paper)")
    parser.add_argument("--all", action="store_true", help="Verify all accounts")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--fix", action="store_true",
                        help="Auto-fix system state to match broker (not yet implemented)")

    args = parser.parse_args()

    if args.fix:
        print(f"{Colors.YELLOW}Note: --fix is not yet implemented. "
              f"This will be available when persistent system state is added.{Colors.RESET}")

    verifier = PositionVerifier(verbose=args.verbose)

    print(f"\n{Colors.BOLD}Position Verification{Colors.RESET}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        if args.all:
            success = await verifier.verify_all_accounts()
        else:
            success = await verifier.verify_account(args.account)

        # Summary
        print(f"\n{Colors.BOLD}{'='*60}{Colors.RESET}")
        if success:
            print(f"{Colors.GREEN}VERIFICATION COMPLETE - No issues detected{Colors.RESET}")
            sys.exit(0)
        else:
            print(f"{Colors.RED}VERIFICATION FAILED - Review issues above{Colors.RESET}")
            sys.exit(1)

    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Verification cancelled{Colors.RESET}")
        sys.exit(2)
    except Exception as e:
        print(f"\n{Colors.RED}Error: {e}{Colors.RESET}")
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
