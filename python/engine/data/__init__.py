"""
Data Module - Dual Engine Architecture

Engine A (The Map): Massive.com / Polygon
    - Stock history, OHLCV, market-wide scans
    - Historical options data
    - Used for DISCOVERY

Engine B (The Sniper): ThetaData
    - Live options quotes, Greeks
    - Real-time Vanna/Charm (2nd order)
    - Used for EXECUTION

Use get_data_router() for intelligent routing.
"""

from .loaders import OptionsDataLoader, DataSpine
from .features import add_derived_features, validate_features
from .polygon_options import PolygonOptionsLoader
from .theta_client import (
    ThetaClient,
    OptionGreeks,
    OptionSnapshot,
    ThetaTerminalStatus,
    get_theta_client,
)

__all__ = [
    # Loaders
    'OptionsDataLoader',
    'DataSpine',
    'PolygonOptionsLoader',

    # Features
    'add_derived_features',
    'validate_features',

    # ThetaData (Engine B)
    'ThetaClient',
    'OptionGreeks',
    'OptionSnapshot',
    'ThetaTerminalStatus',
    'get_theta_client',

    # Router
    'get_data_router',
    'DataRouter',
]


# =============================================================================
# Unified Data Router
# =============================================================================

class DataRouter:
    """
    Intelligent router for the Dual-Engine Data Architecture.

    Routes requests to the appropriate data engine:
    - Massive (Polygon): Stock history, OHLCV, discovery scans
    - ThetaData: Live options, Greeks, execution data
    """

    def __init__(self):
        self._polygon_loader = None
        self._theta_client = None

    @property
    def polygon(self) -> PolygonOptionsLoader:
        """Lazy-load Polygon loader."""
        if self._polygon_loader is None:
            try:
                self._polygon_loader = PolygonOptionsLoader()
            except Exception as e:
                raise RuntimeError(f"Polygon data unavailable: {e}")
        return self._polygon_loader

    @property
    def theta(self) -> ThetaClient:
        """Lazy-load ThetaData client."""
        if self._theta_client is None:
            self._theta_client = get_theta_client()
        return self._theta_client

    def get_market_data(
        self,
        ticker: str,
        asset_type: str = 'stock',  # 'stock' | 'option'
        data_type: str = 'historical',  # 'historical' | 'live'
        use_case: str = 'discovery',  # 'discovery' | 'execution'
        **kwargs
    ):
        """
        Unified data access with intelligent routing.

        Routing Logic:
        - stock OR discovery -> Massive (Polygon)
        - option AND execution -> ThetaData
        - option AND discovery -> Massive (Polygon historical)
        - live stock quotes -> ThetaData (fallback to Massive)

        Args:
            ticker: Symbol (e.g., 'SPY')
            asset_type: 'stock' or 'option'
            data_type: 'historical' or 'live'
            use_case: 'discovery' or 'execution'
            **kwargs: Additional parameters for the specific engine

        Returns:
            Data from the appropriate engine
        """
        # Route to appropriate engine
        if asset_type == 'stock' or use_case == 'discovery':
            # Engine A: Massive/Polygon for discovery
            return self._route_to_massive(ticker, asset_type, data_type, **kwargs)
        elif asset_type == 'option' and use_case == 'execution':
            # Engine B: ThetaData for execution
            return self._route_to_theta(ticker, data_type, **kwargs)
        else:
            # Default to Massive
            return self._route_to_massive(ticker, asset_type, data_type, **kwargs)

    def _route_to_massive(self, ticker: str, asset_type: str, data_type: str, **kwargs):
        """Route to Massive/Polygon data."""
        if asset_type == 'option':
            # Use Polygon options loader
            trade_date = kwargs.get('trade_date')
            if trade_date:
                return self.polygon.load_day(trade_date)
            return None
        else:
            # Stock data - would need Massive API integration
            # For now, return None - implement when Massive SDK added
            return None

    def _route_to_theta(self, ticker: str, data_type: str, **kwargs):
        """Route to ThetaData."""
        if not self.theta.is_terminal_running():
            raise RuntimeError("ThetaData Terminal not running")

        if data_type == 'live':
            # Get live Greeks
            expiration = kwargs.get('expiration')
            strike = kwargs.get('strike')
            right = kwargs.get('right', 'C')

            if expiration and strike:
                return self.theta.get_live_greeks(ticker, expiration, strike, right)
            else:
                # Get full chain snapshot
                return self.theta.get_option_chain_snapshot(ticker, expiration)
        else:
            # Historical Greeks
            start_date = kwargs.get('start_date')
            end_date = kwargs.get('end_date')
            expiration = kwargs.get('expiration')
            strike = kwargs.get('strike')
            right = kwargs.get('right', 'C')

            if all([start_date, end_date, expiration, strike]):
                return self.theta.get_greeks_history(
                    ticker, expiration, strike, right, start_date, end_date
                )
            return None

    def get_engine_status(self) -> dict:
        """Get status of both engines."""
        return {
            'massive': {
                'available': self._polygon_loader is not None or True,  # Always try
                'type': 'Polygon Historical Data',
            },
            'theta': {
                'available': self.theta.is_terminal_running(),
                'status': self.theta.check_terminal_status().value,
                'type': 'ThetaData Live Terminal',
            }
        }


# Singleton router
_data_router: DataRouter = None


def get_data_router() -> DataRouter:
    """Get or create singleton DataRouter instance."""
    global _data_router
    if _data_router is None:
        _data_router = DataRouter()
    return _data_router
