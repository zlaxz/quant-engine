"""
ThetaData REST Client - Engine B (The Sniper)

Precision execution data for options trading:
- Real-time Greeks (1st, 2nd, 3rd order)
- Live option chain snapshots
- Tick-level execution data

This is the "kill" engine - used when we need precise execution data
after the "scan" engine (Massive.com) has identified targets.

Architecture:
    Theta Terminal (Java) runs locally and connects to ThetaData servers.
    This client connects to the terminal's REST API on localhost.

Ports:
    - 25510: v2 REST API (historical, greeks_second_order)
    - 25503: v3 REST API (snapshots, real-time)
    - 25520: WebSocket (streaming - see thetadata_client.py)

Usage:
    client = ThetaClient()

    # Get live Greeks for a specific contract
    greeks = client.get_live_greeks('SPY', date(2024, 12, 20), 500.0, 'C')
    print(f"Delta: {greeks['delta']}, Vanna: {greeks['vanna']}, Charm: {greeks['charm']}")

    # Get full option chain snapshot
    chain = client.get_option_chain_snapshot('SPY', date(2024, 12, 20))

    # Get second-order Greeks history
    history = client.get_greeks_history('SPY', date(2024, 12, 20), 500.0, 'C',
                                         start_date=date(2024, 11, 1),
                                         end_date=date(2024, 11, 30))
"""

import os
import time
import requests
import logging
from datetime import date, datetime
from typing import Optional, Dict, List, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


# =============================================================================
# Circuit Breaker for Connection Resilience
# =============================================================================

class CircuitBreaker:
    """
    Simple circuit breaker to prevent hammering a dead service.

    States:
    - CLOSED: Normal operation, requests go through
    - OPEN: Service is down, fail fast without trying
    - HALF_OPEN: Testing if service recovered
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max_calls: int = 1,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

        self._failure_count = 0
        self._last_failure_time: Optional[float] = None
        self._state = "CLOSED"
        self._half_open_calls = 0

    @property
    def state(self) -> str:
        """Get current circuit state, auto-transitioning OPEN -> HALF_OPEN if timeout elapsed."""
        if self._state == "OPEN":
            if self._last_failure_time and (time.time() - self._last_failure_time) >= self.recovery_timeout:
                self._state = "HALF_OPEN"
                self._half_open_calls = 0
        return self._state

    def can_execute(self) -> bool:
        """Check if a request can be executed."""
        state = self.state
        if state == "CLOSED":
            return True
        if state == "HALF_OPEN":
            return self._half_open_calls < self.half_open_max_calls
        return False  # OPEN

    def record_success(self) -> None:
        """Record a successful request."""
        self._failure_count = 0
        self._state = "CLOSED"
        self._half_open_calls = 0

    def record_failure(self) -> None:
        """Record a failed request."""
        self._failure_count += 1
        self._last_failure_time = time.time()

        if self._state == "HALF_OPEN":
            # Failed during recovery test - back to OPEN
            self._state = "OPEN"
        elif self._failure_count >= self.failure_threshold:
            self._state = "OPEN"
            logger.warning(f"Circuit breaker OPEN after {self._failure_count} failures")

    def reset(self) -> None:
        """Reset circuit breaker to initial state."""
        self._failure_count = 0
        self._last_failure_time = None
        self._state = "CLOSED"
        self._half_open_calls = 0


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class OptionGreeks:
    """
    Complete Greeks for an option contract.

    Includes 1st, 2nd, and 3rd order Greeks when available.
    """
    # 1st Order
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    rho: float = 0.0

    # 2nd Order (The "Hidden Forces")
    vanna: float = 0.0      # dDelta/dIV - How delta changes with volatility
    charm: float = 0.0      # dDelta/dTime - How delta decays over time
    vomma: float = 0.0      # dVega/dIV - Vega convexity
    veta: float = 0.0       # dVega/dTime - Vega decay

    # 3rd Order (Advanced)
    speed: float = 0.0      # dGamma/dSpot
    zomma: float = 0.0      # dGamma/dIV
    color: float = 0.0      # dGamma/dTime
    ultima: float = 0.0     # dVomma/dIV

    # Market data
    implied_volatility: float = 0.0
    underlying_price: float = 0.0
    bid: float = 0.0
    ask: float = 0.0
    mid: float = 0.0
    timestamp: Optional[datetime] = None


@dataclass
class OptionSnapshot:
    """
    Real-time snapshot of an option contract.
    """
    root: str
    expiration: date
    strike: float
    right: str  # 'C' or 'P'

    # Prices
    bid: float = 0.0
    ask: float = 0.0
    mid: float = 0.0
    last: float = 0.0
    volume: int = 0
    open_interest: int = 0

    # Greeks (if requested)
    greeks: Optional[OptionGreeks] = None

    # Timestamp
    timestamp: Optional[datetime] = None


class ThetaTerminalStatus(Enum):
    """Status of the local Theta Terminal."""
    CONNECTED = 'connected'
    DISCONNECTED = 'disconnected'
    ERROR = 'error'


# =============================================================================
# ThetaData REST Client
# =============================================================================

class ThetaClient:
    """
    REST client for ThetaData local terminal.

    Provides precision data for options execution:
    - Live Greeks (all orders)
    - Option chain snapshots
    - Historical Greeks data

    Features:
    - Connection pooling via requests.Session
    - Automatic retry with exponential backoff
    - Circuit breaker to fail fast when service is down
    """

    # Default ports for Theta Terminal
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_V2_PORT = 25510  # Historical, Greeks
    DEFAULT_V3_PORT = 25503  # Snapshots, real-time

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        v2_port: Optional[int] = None,
        v3_port: Optional[int] = None,
        timeout: int = 30,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        """
        Initialize ThetaData client.

        Args:
            host: Theta Terminal host (default localhost)
            v2_port: Port for v2 API (historical)
            v3_port: Port for v3 API (snapshots)
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts for failed requests
            backoff_factor: Exponential backoff factor between retries
        """
        self.host = host
        self.v2_port = v2_port or int(os.environ.get('THETADATA_HTTP_PORT', self.DEFAULT_V2_PORT))
        self.v3_port = v3_port or int(os.environ.get('THETADATA_V3_PORT', self.DEFAULT_V3_PORT))
        self.timeout = timeout

        # Base URLs
        self.v2_base = f"http://{host}:{self.v2_port}/v2"
        self.v3_base = f"http://{host}:{self.v3_port}/v3"

        # Connection pooling with retry logic
        self._session = requests.Session()
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=[408, 429, 500, 502, 503, 504],
            allowed_methods=["GET"],
        )
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=20,
        )
        self._session.mount("http://", adapter)
        self._session.mount("https://", adapter)

        # Circuit breaker for fail-fast behavior
        self._circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=30.0,
        )

        logger.info(f"ThetaClient initialized")
        logger.info(f"  v2 API: {self.v2_base}")
        logger.info(f"  v3 API: {self.v3_base}")
        logger.info(f"  Retry: {max_retries}x with {backoff_factor}s backoff")

    def _request(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        timeout: Optional[int] = None,
    ) -> Optional[requests.Response]:
        """
        Make a GET request with circuit breaker protection.

        Args:
            url: Full URL to request
            params: Query parameters
            timeout: Request timeout (uses default if None)

        Returns:
            Response object or None if circuit is open or request failed
        """
        if not self._circuit_breaker.can_execute():
            logger.debug(f"Circuit breaker OPEN - skipping request to {url}")
            return None

        try:
            response = self._session.get(
                url,
                params=params,
                timeout=timeout or self.timeout,
            )
            self._circuit_breaker.record_success()
            return response

        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Connection error to {url}: {e}")
            self._circuit_breaker.record_failure()
            return None
        except requests.exceptions.Timeout as e:
            logger.warning(f"Timeout on {url}: {e}")
            self._circuit_breaker.record_failure()
            return None
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for {url}: {e}")
            self._circuit_breaker.record_failure()
            return None

    def close(self) -> None:
        """Close the session and release connection pool."""
        self._session.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # -------------------------------------------------------------------------
    # Health Check
    # -------------------------------------------------------------------------

    def check_terminal_status(self) -> ThetaTerminalStatus:
        """
        Check if Theta Terminal is running and responsive.

        Returns:
            ThetaTerminalStatus enum
        """
        try:
            # Try a snapshot request - will return "No data found" if working but market closed
            response = self._request(
                f"{self.v3_base}/option/snapshot/greeks/all",
                params={'symbol': 'SPY', 'expiration': '*'},
                timeout=5
            )
            if response is None:
                return ThetaTerminalStatus.DISCONNECTED

            # 200 = working, 410 = deprecated (v2), 404 = endpoint not found
            if response.status_code in [200, 404]:
                # Even "No data found" response means terminal is connected
                return ThetaTerminalStatus.CONNECTED
            return ThetaTerminalStatus.ERROR

        except Exception as e:
            logger.error(f"Terminal status check failed: {e}")
            return ThetaTerminalStatus.ERROR

    def is_terminal_running(self) -> bool:
        """Quick check if terminal is running."""
        return self.check_terminal_status() == ThetaTerminalStatus.CONNECTED

    # -------------------------------------------------------------------------
    # Live Greeks (Real-time)
    # -------------------------------------------------------------------------

    def get_live_greeks(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str,
        include_second_order: bool = True,
        include_third_order: bool = False,
    ) -> Optional[OptionGreeks]:
        """
        Get real-time Greeks for a specific option contract.

        Uses v3 snapshot API for live data.

        Args:
            root: Underlying symbol (e.g., 'SPY')
            expiration: Option expiration date
            strike: Strike price (e.g., 500.0)
            right: 'C' for call, 'P' for put
            include_second_order: Include Vanna, Charm, etc.
            include_third_order: Include Speed, Zomma, etc.

        Returns:
            OptionGreeks object or None if unavailable
        """
        try:
            # v3 API uses YYYY-MM-DD format and decimal strike price
            exp_str = expiration.strftime('%Y-%m-%d')
            right_str = 'call' if right.upper() == 'C' else 'put'

            # v3 snapshot Greeks endpoint
            url = f"{self.v3_base}/option/snapshot/greeks/all"
            params = {
                'symbol': root.upper(),
                'expiration': exp_str,
                'strike': f"{strike:.2f}",  # Decimal format: 500.00
                'right': right_str,
            }

            response = self._request(url, params=params)

            if response is None:
                logger.warning("Greeks request failed: no response")
                return None
            if not response.ok:
                logger.warning(f"Greeks request failed: {response.status_code}")
                return None

            data = response.json()

            # Parse response
            if not data or 'response' not in data:
                return None

            greeks_data = data['response']

            # Extract and validate prices
            bid = greeks_data.get('bid', 0.0)
            ask = greeks_data.get('ask', 0.0)
            underlying = greeks_data.get('underlying_price', 0.0)
            iv = greeks_data.get('implied_volatility', 0.0)
            delta = greeks_data.get('delta', 0.0)

            # Price validation - reject garbage data
            if bid < 0 or ask < 0:
                logger.warning(f"Negative bid/ask rejected: bid={bid}, ask={ask}")
                return None
            if bid > 0 and ask > 0 and bid > ask:
                logger.warning(f"Inverted market rejected: bid={bid} > ask={ask}")
                return None
            if underlying <= 0:
                logger.warning(f"Invalid underlying price: {underlying}")
                return None
            if iv < 0 or iv > 5.0:  # IV > 500% is nonsense
                logger.warning(f"Invalid IV rejected: {iv}")
                return None
            # Delta bounds check (allow slight tolerance for rounding)
            if delta < -1.05 or delta > 1.05:
                logger.warning(f"Invalid delta rejected: {delta}")
                return None

            greeks = OptionGreeks(
                # 1st Order
                delta=delta,
                gamma=greeks_data.get('gamma', 0.0),
                theta=greeks_data.get('theta', 0.0),
                vega=greeks_data.get('vega', 0.0),
                rho=greeks_data.get('rho', 0.0),

                # Market data
                implied_volatility=iv,
                underlying_price=underlying,
                bid=bid,
                ask=ask,
                mid=(bid + ask) / 2 if bid > 0 and ask > 0 else max(bid, ask),
            )

            # 2nd Order Greeks (from separate endpoint if needed)
            if include_second_order:
                second_order = self._get_second_order_greeks_snapshot(
                    root, expiration, strike, right
                )
                if second_order:
                    greeks.vanna = second_order.get('vanna', 0.0)
                    greeks.charm = second_order.get('charm', 0.0)
                    greeks.vomma = second_order.get('vomma', 0.0)
                    greeks.veta = second_order.get('veta', 0.0)

            return greeks

        except Exception as e:
            logger.error(f"Error fetching live Greeks: {e}")
            return None

    def _get_second_order_greeks_snapshot(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str,
    ) -> Optional[Dict[str, float]]:
        """Get second-order Greeks from the latest available data."""
        try:
            # Use historical endpoint with today's date
            today = date.today()
            strike_int = int(strike * 1000)
            exp_str = expiration.strftime('%Y%m%d')
            date_str = today.strftime('%Y%m%d')

            url = f"{self.v2_base}/hist/option/greeks_second_order"
            params = {
                'root': root.upper(),
                'exp': exp_str,
                'strike': strike_int,
                'right': right.upper(),
                'start_date': date_str,
                'end_date': date_str,
                'ivl': 0,  # Latest tick
            }

            response = self._request(url, params=params)

            if response is None or not response.ok:
                return None

            data = response.json()

            # Response format: header + response array
            if not data or 'response' not in data:
                return None

            # Get the latest entry
            entries = data['response']
            if not entries:
                return None

            # Parse the last entry
            # Format: [ms_of_day, bid, ask, gamma, vanna, charm, vomma, veta, implied_vol, ...]
            latest = entries[-1]

            return {
                'gamma': latest[3] if len(latest) > 3 else 0.0,
                'vanna': latest[4] if len(latest) > 4 else 0.0,
                'charm': latest[5] if len(latest) > 5 else 0.0,
                'vomma': latest[6] if len(latest) > 6 else 0.0,
                'veta': latest[7] if len(latest) > 7 else 0.0,
            }

        except Exception as e:
            logger.debug(f"Second order Greeks fetch failed: {e}")
            return None

    # -------------------------------------------------------------------------
    # Option Chain Snapshots
    # -------------------------------------------------------------------------

    def get_option_chain_snapshot(
        self,
        root: str,
        expiration: Optional[date] = None,
        include_greeks: bool = True,
    ) -> List[OptionSnapshot]:
        """
        Get real-time snapshot of entire option chain.

        Args:
            root: Underlying symbol
            expiration: Specific expiration (None = all expirations)
            include_greeks: Include Greeks with each contract

        Returns:
            List of OptionSnapshot objects
        """
        try:
            # v3 API uses YYYY-MM-DD format or * for all
            exp_str = expiration.strftime('%Y-%m-%d') if expiration else '*'

            # Use v3 bulk snapshot endpoint
            url = f"{self.v3_base}/option/snapshot/greeks/all"
            params = {
                'symbol': root.upper(),
                'expiration': exp_str,
            }

            response = self._request(url, params=params)

            if response is None:
                logger.warning("Chain snapshot failed: no response")
                return []
            if not response.ok:
                logger.warning(f"Chain snapshot failed: {response.status_code}")
                return []

            data = response.json()

            if not data or 'response' not in data:
                return []

            snapshots = []

            for contract in data['response']:
                try:
                    # Parse contract info
                    exp_date = datetime.strptime(str(contract.get('expiration', '')), '%Y%m%d').date()
                    strike_val = contract.get('strike', 0) / 1000.0
                    right_val = 'C' if contract.get('right', '').lower() == 'call' else 'P'

                    snapshot = OptionSnapshot(
                        root=root.upper(),
                        expiration=exp_date,
                        strike=strike_val,
                        right=right_val,
                        bid=contract.get('bid', 0.0),
                        ask=contract.get('ask', 0.0),
                        mid=(contract.get('bid', 0.0) + contract.get('ask', 0.0)) / 2,
                        last=contract.get('last', 0.0),
                        volume=contract.get('volume', 0),
                        open_interest=contract.get('open_interest', 0),
                    )

                    # Add Greeks if requested and available
                    if include_greeks:
                        snapshot.greeks = OptionGreeks(
                            delta=contract.get('delta', 0.0),
                            gamma=contract.get('gamma', 0.0),
                            theta=contract.get('theta', 0.0),
                            vega=contract.get('vega', 0.0),
                            implied_volatility=contract.get('implied_volatility', 0.0),
                            underlying_price=contract.get('underlying_price', 0.0),
                        )

                    snapshots.append(snapshot)

                except Exception as e:
                    logger.debug(f"Error parsing contract: {e}")
                    continue

            logger.info(f"Retrieved {len(snapshots)} contracts for {root}")
            return snapshots

        except Exception as e:
            logger.error(f"Error fetching chain snapshot: {e}")
            return []

    def stream_option_chain(
        self,
        root: str,
        callback: callable,
        expiration: Optional[date] = None,
        poll_interval: float = 1.0,
    ):
        """
        Stream option chain updates by polling.

        For true streaming, use the WebSocket client (thetadata_client.py).
        This method provides a polling-based alternative.

        Args:
            root: Underlying symbol
            callback: Function to call with updated chain
            expiration: Specific expiration (None = all)
            poll_interval: Seconds between updates
        """
        import time

        logger.info(f"Starting option chain stream for {root}")

        while True:
            try:
                chain = self.get_option_chain_snapshot(root, expiration)
                if chain:
                    callback(chain)
                time.sleep(poll_interval)

            except KeyboardInterrupt:
                logger.info("Chain stream stopped")
                break
            except Exception as e:
                logger.error(f"Stream error: {e}")
                time.sleep(poll_interval)

    # -------------------------------------------------------------------------
    # Historical Greeks
    # -------------------------------------------------------------------------

    def get_greeks_history(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str,
        start_date: date,
        end_date: date,
        interval_ms: int = 60000,  # 1 minute default
    ) -> List[Dict[str, Any]]:
        """
        Get historical second-order Greeks data.

        Args:
            root: Underlying symbol
            expiration: Option expiration
            strike: Strike price
            right: 'C' or 'P'
            start_date: Start of date range
            end_date: End of date range
            interval_ms: Sampling interval in milliseconds

        Returns:
            List of dicts with Greeks at each timestamp
        """
        try:
            strike_int = int(strike * 1000)
            exp_str = expiration.strftime('%Y%m%d')
            start_str = start_date.strftime('%Y%m%d')
            end_str = end_date.strftime('%Y%m%d')

            url = f"{self.v2_base}/hist/option/greeks_second_order"
            params = {
                'root': root.upper(),
                'exp': exp_str,
                'strike': strike_int,
                'right': right.upper(),
                'start_date': start_str,
                'end_date': end_str,
                'ivl': interval_ms,
            }

            response = self._request(url, params=params)

            if response is None:
                logger.warning("Greeks history failed: no response")
                return []
            if not response.ok:
                logger.warning(f"Greeks history failed: {response.status_code}")
                return []

            data = response.json()

            if not data or 'response' not in data:
                return []

            # Parse response array
            # Format: [ms_of_day, bid, ask, gamma, vanna, charm, vomma, veta, implied_vol, iv_error, ms_of_day2, underlying_price, date]
            results = []

            for entry in data['response']:
                if len(entry) < 12:
                    continue

                results.append({
                    'ms_of_day': entry[0],
                    'bid': entry[1],
                    'ask': entry[2],
                    'gamma': entry[3],
                    'vanna': entry[4],
                    'charm': entry[5],
                    'vomma': entry[6],
                    'veta': entry[7],
                    'implied_volatility': entry[8],
                    'iv_error': entry[9],
                    'underlying_price': entry[11],
                    'date': entry[12] if len(entry) > 12 else None,
                })

            logger.info(f"Retrieved {len(results)} Greeks history entries")
            return results

        except Exception as e:
            logger.error(f"Error fetching Greeks history: {e}")
            return []

    # -------------------------------------------------------------------------
    # Quote Data
    # -------------------------------------------------------------------------

    def get_quote(
        self,
        root: str,
        expiration: date,
        strike: float,
        right: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Get current quote for a specific option.

        Args:
            root: Underlying symbol
            expiration: Option expiration
            strike: Strike price
            right: 'C' or 'P'

        Returns:
            Dict with bid, ask, mid, etc.
        """
        try:
            strike_int = int(strike * 1000)
            exp_str = expiration.strftime('%Y%m%d')
            right_str = 'call' if right.upper() == 'C' else 'put'

            url = f"{self.v3_base}/option/snapshot/quote"
            params = {
                'symbol': root.upper(),
                'expiration': exp_str,
                'strike': strike_int,
                'right': right_str,
            }

            response = self._request(url, params=params)

            if response is None or not response.ok:
                return None

            data = response.json()

            if not data or 'response' not in data:
                return None

            quote = data['response']

            return {
                'bid': quote.get('bid', 0.0),
                'ask': quote.get('ask', 0.0),
                'mid': (quote.get('bid', 0.0) + quote.get('ask', 0.0)) / 2,
                'bid_size': quote.get('bid_size', 0),
                'ask_size': quote.get('ask_size', 0),
                'bid_exchange': quote.get('bid_exchange', ''),
                'ask_exchange': quote.get('ask_exchange', ''),
                'timestamp': datetime.now(),
            }

        except Exception as e:
            logger.error(f"Error fetching quote: {e}")
            return None


# =============================================================================
# Factory Functions
# =============================================================================

# Singleton instance
_theta_client: Optional[ThetaClient] = None


def get_theta_client() -> ThetaClient:
    """Get or create singleton ThetaClient instance."""
    global _theta_client
    if _theta_client is None:
        _theta_client = ThetaClient()
    return _theta_client


def reset_theta_client() -> None:
    """Reset the singleton client (for testing or reconnection)."""
    global _theta_client
    if _theta_client is not None:
        _theta_client.close()  # Release connection pool
    _theta_client = None


def reset_circuit_breaker() -> None:
    """Reset the circuit breaker without recreating the client."""
    global _theta_client
    if _theta_client is not None:
        _theta_client._circuit_breaker.reset()
        logger.info("Circuit breaker reset")


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    from datetime import date

    # Initialize client
    client = ThetaClient()

    # Check if terminal is running
    status = client.check_terminal_status()
    print(f"Terminal Status: {status.value}")

    if status == ThetaTerminalStatus.CONNECTED:
        # Get live Greeks for SPY option
        greeks = client.get_live_greeks(
            root='SPY',
            expiration=date(2024, 12, 20),
            strike=500.0,
            right='C',
        )

        if greeks:
            print(f"\nSPY Dec 500 Call Greeks:")
            print(f"  Delta: {greeks.delta:.4f}")
            print(f"  Gamma: {greeks.gamma:.6f}")
            print(f"  Vanna: {greeks.vanna:.6f}")
            print(f"  Charm: {greeks.charm:.6f}")
            print(f"  IV: {greeks.implied_volatility:.2%}")
        else:
            print("Could not fetch Greeks")

        # Get option chain snapshot
        print("\nFetching SPY option chain...")
        chain = client.get_option_chain_snapshot('SPY', date(2024, 12, 20))
        print(f"Retrieved {len(chain)} contracts")

    else:
        print("Theta Terminal not running. Please start it first.")
