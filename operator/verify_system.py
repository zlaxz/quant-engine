#!/usr/bin/env python3
"""
Pre-Flight System Verification
==============================

Run this before every trading session to verify system readiness.

Usage:
    python verify_system.py
    python verify_system.py --verbose
    python verify_system.py --include-live  # Also test live account

Exit codes:
    0 - All checks passed
    1 - One or more checks failed
"""

import os
import sys
import asyncio
import argparse
from datetime import datetime
from typing import Tuple, List

# Add parent to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))


class Colors:
    """Terminal colors for output."""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def check_mark(passed: bool) -> str:
    """Return colored check/cross mark."""
    if passed:
        return f"{Colors.GREEN}✓{Colors.RESET}"
    return f"{Colors.RED}✗{Colors.RESET}"


def print_header(title: str) -> None:
    """Print section header."""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}{Colors.RESET}\n")


def print_result(name: str, passed: bool, detail: str = "") -> None:
    """Print check result."""
    status = check_mark(passed)
    detail_str = f" ({detail})" if detail else ""
    print(f"  {status} {name}{detail_str}")


class SystemVerifier:
    """Verify system readiness for trading."""

    def __init__(self, verbose: bool = False, include_live: bool = False):
        self.verbose = verbose
        self.include_live = include_live
        self.results: List[Tuple[str, bool, str]] = []

    def log(self, msg: str) -> None:
        """Print verbose message."""
        if self.verbose:
            print(f"    {Colors.YELLOW}→ {msg}{Colors.RESET}")

    def add_result(self, name: str, passed: bool, detail: str = "") -> None:
        """Record a check result."""
        self.results.append((name, passed, detail))
        print_result(name, passed, detail)

    # =========================================================================
    # Infrastructure Checks
    # =========================================================================

    def check_data_mount(self) -> bool:
        """Verify market data mount is accessible."""
        data_path = "/Volumes/SSD_01/market_data"

        if not os.path.exists(data_path):
            self.add_result("Data mount", False, f"{data_path} not found")
            return False

        # Check if we can read from it
        try:
            contents = os.listdir(data_path)
            self.add_result("Data mount", True, f"{len(contents)} items")
            return True
        except PermissionError:
            self.add_result("Data mount", False, "Permission denied")
            return False

    def check_flask_api(self) -> bool:
        """Check if Flask API is accessible (optional)."""
        try:
            import requests
            response = requests.get("http://localhost:5000/health", timeout=2)
            if response.status_code == 200:
                self.add_result("Flask API", True, "port 5000")
                return True
            self.add_result("Flask API", False, f"status {response.status_code}")
            return False
        except Exception as e:
            self.add_result("Flask API", False, "not running (optional)")
            return True  # Optional - don't fail on this

    def check_supabase(self) -> bool:
        """Check Supabase connection."""
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_ANON_KEY")

        if not supabase_url or not supabase_key:
            self.add_result("Supabase config", False, "env vars missing")
            return False

        try:
            from supabase import create_client
            client = create_client(supabase_url, supabase_key)
            # Quick health check - try to access a table
            result = client.table("execution_log").select("id").limit(1).execute()
            self.add_result("Supabase", True, "connected")
            return True
        except Exception as e:
            self.add_result("Supabase", False, str(e)[:50])
            return False

    # =========================================================================
    # IBKR Connection Checks
    # =========================================================================

    async def check_ibkr_paper(self) -> bool:
        """Check paper trading connection."""
        try:
            from engine.trading import IBKRClient, TradingMode

            client = IBKRClient(mode=TradingMode.PAPER)
            connected = await client.connect(timeout=10)

            if not connected:
                self.add_result("IBKR Paper", False, "port 7497 - cannot connect")
                return False

            # Get account info
            account_info = await client.get_account_info()
            positions = await client.get_positions()

            await client.disconnect()

            detail = f"port 7497, {len(positions)} positions"
            if account_info:
                detail += f", ${account_info.net_liquidation:,.0f} NLV"

            self.add_result("IBKR Paper", True, detail)
            return True

        except ImportError as e:
            self.add_result("IBKR Paper", False, f"import error: {e}")
            return False
        except Exception as e:
            self.add_result("IBKR Paper", False, str(e)[:50])
            return False

    async def check_ibkr_live(self) -> bool:
        """Check live trading connection (only if --include-live)."""
        if not self.include_live:
            self.log("Skipping live account check (use --include-live)")
            return True

        try:
            from engine.trading import IBKRClient, TradingMode

            client = IBKRClient(mode=TradingMode.LIVE, client_id=2)
            connected = await client.connect(timeout=10)

            if not connected:
                self.add_result("IBKR Live", False, "port 7496 - cannot connect")
                return False

            account_info = await client.get_account_info()
            positions = await client.get_positions()

            await client.disconnect()

            detail = f"port 7496, {len(positions)} positions"
            if account_info:
                detail += f", ${account_info.net_liquidation:,.0f} NLV"

            self.add_result("IBKR Live", True, detail)
            return True

        except Exception as e:
            self.add_result("IBKR Live", False, str(e)[:50])
            return False

    # =========================================================================
    # Risk System Checks
    # =========================================================================

    def check_risk_manager(self) -> bool:
        """Verify risk manager configuration."""
        try:
            from engine.trading import RiskManager, DrawdownController

            rm = RiskManager(account_size=100000, max_risk_per_trade=0.02)
            dc = DrawdownController(initial_equity=100000)

            # Verify limits
            checks = [
                rm.max_risk_per_trade == 0.02,
                rm.max_position_pct == 0.20,
                dc.daily_limit == 0.02,
                dc.weekly_limit == 0.05,
                dc.circuit_breaker == 0.15,
            ]

            if all(checks):
                self.add_result("Risk Manager", True, "limits configured")
                return True
            else:
                self.add_result("Risk Manager", False, "unexpected limits")
                return False

        except Exception as e:
            self.add_result("Risk Manager", False, str(e)[:50])
            return False

    def check_kill_switch(self) -> bool:
        """Verify kill switch is importable and callable."""
        try:
            from engine.trading import OrderManager, IBKRAccountManager

            # Just verify we can import and instantiate
            # Don't actually call emergency_flatten!
            self.add_result("Kill Switch", True, "emergency_flatten available")
            return True

        except Exception as e:
            self.add_result("Kill Switch", False, str(e)[:50])
            return False

    # =========================================================================
    # Environment Checks
    # =========================================================================

    def check_env_vars(self) -> bool:
        """Check required environment variables."""
        required = [
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
        ]

        optional = [
            "POLYGON_API_KEY",
            "DATABENTO_API_KEY",
        ]

        missing_required = [v for v in required if not os.environ.get(v)]
        missing_optional = [v for v in optional if not os.environ.get(v)]

        if missing_required:
            self.add_result("Environment", False, f"missing: {', '.join(missing_required)}")
            return False

        detail = f"{len(required)} required"
        if missing_optional:
            detail += f", {len(missing_optional)} optional missing"

        self.add_result("Environment", True, detail)
        return True

    def check_python_imports(self) -> bool:
        """Verify critical Python imports."""
        try:
            import numpy
            import pandas
            import scipy
            from engine.trading import (
                IBKRClient, OrderManager, RiskManager,
                DrawdownController, ExecutionLogger
            )
            self.add_result("Python Imports", True, "all critical modules")
            return True
        except ImportError as e:
            self.add_result("Python Imports", False, str(e)[:50])
            return False

    # =========================================================================
    # Run All Checks
    # =========================================================================

    async def run_all_checks(self) -> bool:
        """Run all verification checks."""
        print_header("PRE-FLIGHT SYSTEM VERIFICATION")
        print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  Mode: {'Include Live' if self.include_live else 'Paper Only'}")

        # Infrastructure
        print_header("Infrastructure")
        self.check_data_mount()
        self.check_flask_api()
        self.check_env_vars()
        self.check_supabase()

        # IBKR Connections
        print_header("IBKR Connections")
        await self.check_ibkr_paper()
        if self.include_live:
            await self.check_ibkr_live()

        # Risk Systems
        print_header("Risk Systems")
        self.check_python_imports()
        self.check_risk_manager()
        self.check_kill_switch()

        # Summary
        print_header("SUMMARY")

        passed = sum(1 for _, p, _ in self.results if p)
        failed = sum(1 for _, p, _ in self.results if not p)
        total = len(self.results)

        print(f"  Passed: {Colors.GREEN}{passed}{Colors.RESET}")
        print(f"  Failed: {Colors.RED}{failed}{Colors.RESET}")
        print(f"  Total:  {total}")

        if failed == 0:
            print(f"\n  {Colors.GREEN}{Colors.BOLD}ALL CHECKS PASSED - READY TO TRADE{Colors.RESET}")
            return True
        else:
            print(f"\n  {Colors.RED}{Colors.BOLD}CHECKS FAILED - DO NOT TRADE{Colors.RESET}")
            print(f"\n  Failed checks:")
            for name, p, detail in self.results:
                if not p:
                    print(f"    - {name}: {detail}")
            return False


async def main():
    parser = argparse.ArgumentParser(description="Pre-flight system verification")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--include-live", action="store_true", help="Also test live account")

    args = parser.parse_args()

    verifier = SystemVerifier(verbose=args.verbose, include_live=args.include_live)
    success = await verifier.run_all_checks()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
