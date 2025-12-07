"""
FRED Economic Data Integration
==============================

Fetches economic indicators from Federal Reserve Economic Data (FRED)
for enhanced regime prediction.

Key Indicators:
- Unemployment Rate (UNRATE)
- CPI Inflation (CPIAUCSL)
- Manufacturing PMI (ISM proxy)
- Policy Uncertainty Index (USEPUINDXD)
- Credit Spreads (via yield differentials)
- Fed Funds Rate (FEDFUNDS)
- Treasury Yields (DGS10, DGS2)

Usage:
    client = FREDClient(api_key='your_key')
    data = client.fetch_macro_indicators(start='2020-01-01')
    df = client.add_macro_features(price_df)

Requires: fredapi package (pip install fredapi)
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
import os

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Key FRED series for regime prediction
FRED_SERIES = {
    # Labor Market
    'UNRATE': 'Unemployment Rate',
    'PAYEMS': 'Total Nonfarm Payrolls',
    'ICSA': 'Initial Jobless Claims',

    # Inflation
    'CPIAUCSL': 'CPI All Items',
    'CPILFESL': 'Core CPI (ex Food & Energy)',
    'PCEPI': 'PCE Price Index',

    # Manufacturing / Business
    'INDPRO': 'Industrial Production',
    'RSXFS': 'Retail Sales ex Autos',

    # Financial Conditions
    'FEDFUNDS': 'Fed Funds Rate',
    'DGS10': '10Y Treasury Yield',
    'DGS2': '2Y Treasury Yield',
    'T10Y2Y': '10Y-2Y Spread',
    'BAMLH0A0HYM2': 'High Yield Spread',

    # Policy/Uncertainty
    'USEPUINDXD': 'Policy Uncertainty Index',
    'VIXCLS': 'VIX Index',

    # Money/Credit
    'M2SL': 'M2 Money Supply',
    'TOTLL': 'Total Loans',
}


@dataclass
class MacroState:
    """Current macroeconomic state summary."""
    unemployment: float             # Current unemployment rate
    unemployment_trend: str         # 'rising', 'falling', 'stable'
    inflation_yoy: float            # Year-over-year CPI change
    inflation_trend: str            # 'rising', 'falling', 'stable'
    yield_curve_slope: float        # 10Y - 2Y spread
    yield_curve_inverted: bool      # Recession signal
    credit_spread: float            # High yield spread
    credit_stress: bool             # Spread > 5%
    policy_uncertainty: float       # Policy uncertainty index
    fed_funds_rate: float           # Current Fed Funds rate
    regime: str                     # 'expansion', 'slowdown', 'recession', 'recovery'
    timestamp: datetime = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()


class FREDClient:
    """
    Client for fetching FRED economic data.

    Requires FRED API key from: https://fred.stlouisfed.org/docs/api/api_key.html
    Set via environment variable FRED_API_KEY or pass to constructor.
    """

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize FRED client.

        Args:
            api_key: FRED API key (or set FRED_API_KEY env var)
        """
        self.api_key = api_key or os.environ.get('FRED_API_KEY')
        self._fred = None

        if self.api_key:
            try:
                from fredapi import Fred
                self._fred = Fred(api_key=self.api_key)
                logger.info("FRED client initialized successfully")
            except ImportError:
                logger.warning("fredapi not installed. Run: pip install fredapi")
            except Exception as e:
                logger.error(f"FRED initialization failed: {e}")
        else:
            logger.warning("No FRED API key provided. Using synthetic/cached data.")

    def fetch_series(
        self,
        series_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> pd.Series:
        """
        Fetch a single FRED series.

        Args:
            series_id: FRED series ID (e.g., 'UNRATE')
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)

        Returns:
            Pandas Series with data
        """
        if self._fred is None:
            logger.warning(f"FRED not available, returning empty series for {series_id}")
            return pd.Series(dtype=float, name=series_id)

        try:
            data = self._fred.get_series(
                series_id,
                observation_start=start_date,
                observation_end=end_date
            )
            data.name = series_id
            return data
        except Exception as e:
            logger.error(f"Failed to fetch {series_id}: {e}")
            return pd.Series(dtype=float, name=series_id)

    def fetch_macro_indicators(
        self,
        start_date: str = '2010-01-01',
        end_date: Optional[str] = None,
        series_ids: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Fetch multiple macro indicators and combine into DataFrame.

        Args:
            start_date: Start date
            end_date: End date (default: today)
            series_ids: List of series to fetch (default: key indicators)

        Returns:
            DataFrame with economic indicators
        """
        if series_ids is None:
            # Default: key indicators for regime prediction
            series_ids = [
                'UNRATE', 'CPIAUCSL', 'FEDFUNDS',
                'DGS10', 'DGS2', 'T10Y2Y',
                'BAMLH0A0HYM2', 'VIXCLS'
            ]

        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')

        dfs = []
        for series_id in series_ids:
            data = self.fetch_series(series_id, start_date, end_date)
            if len(data) > 0:
                df = data.to_frame()
                dfs.append(df)

        if not dfs:
            logger.warning("No data fetched from FRED")
            return pd.DataFrame()

        # Combine all series (outer join to keep all dates)
        result = dfs[0]
        for df in dfs[1:]:
            result = result.join(df, how='outer')

        # Forward fill to handle different release frequencies
        result = result.ffill()

        return result

    def get_macro_state(
        self,
        as_of_date: Optional[datetime] = None
    ) -> MacroState:
        """
        Get current macroeconomic state summary.

        Args:
            as_of_date: Date for state (default: most recent)

        Returns:
            MacroState dataclass with current conditions
        """
        if as_of_date is None:
            as_of_date = datetime.now()

        # Fetch recent data
        start = (as_of_date - timedelta(days=365)).strftime('%Y-%m-%d')
        end = as_of_date.strftime('%Y-%m-%d')

        data = self.fetch_macro_indicators(start, end)

        if data.empty:
            return self._synthetic_macro_state()

        # Extract latest values
        latest = data.iloc[-1]

        # Unemployment
        unemployment = latest.get('UNRATE', 4.0)
        if len(data) > 3:
            unemployment_3m_ago = data['UNRATE'].iloc[-90] if 'UNRATE' in data else unemployment
            if unemployment > unemployment_3m_ago + 0.3:
                unemployment_trend = 'rising'
            elif unemployment < unemployment_3m_ago - 0.3:
                unemployment_trend = 'falling'
            else:
                unemployment_trend = 'stable'
        else:
            unemployment_trend = 'stable'

        # Inflation (YoY)
        if 'CPIAUCSL' in data.columns and len(data) > 252:
            cpi_now = data['CPIAUCSL'].iloc[-1]
            cpi_1y_ago = data['CPIAUCSL'].iloc[-252]
            inflation_yoy = (cpi_now - cpi_1y_ago) / cpi_1y_ago * 100
            cpi_6m_ago = data['CPIAUCSL'].iloc[-126]
            inflation_6m = (cpi_now - cpi_6m_ago) / cpi_6m_ago * 200  # Annualized

            if inflation_6m > inflation_yoy + 0.5:
                inflation_trend = 'rising'
            elif inflation_6m < inflation_yoy - 0.5:
                inflation_trend = 'falling'
            else:
                inflation_trend = 'stable'
        else:
            inflation_yoy = 3.0
            inflation_trend = 'stable'

        # Yield Curve
        yield_curve_slope = latest.get('T10Y2Y', 0.5)
        yield_curve_inverted = yield_curve_slope < 0

        # Credit Spread
        credit_spread = latest.get('BAMLH0A0HYM2', 4.0)
        credit_stress = credit_spread > 5.0

        # Policy Uncertainty
        policy_uncertainty = latest.get('USEPUINDXD', 100)

        # Fed Funds
        fed_funds_rate = latest.get('FEDFUNDS', 5.0)

        # Determine regime
        regime = self._classify_regime(
            unemployment, unemployment_trend,
            inflation_yoy, yield_curve_inverted,
            credit_stress
        )

        return MacroState(
            unemployment=unemployment,
            unemployment_trend=unemployment_trend,
            inflation_yoy=inflation_yoy,
            inflation_trend=inflation_trend,
            yield_curve_slope=yield_curve_slope,
            yield_curve_inverted=yield_curve_inverted,
            credit_spread=credit_spread,
            credit_stress=credit_stress,
            policy_uncertainty=policy_uncertainty,
            fed_funds_rate=fed_funds_rate,
            regime=regime,
            timestamp=as_of_date
        )

    def _classify_regime(
        self,
        unemployment: float,
        unemployment_trend: str,
        inflation: float,
        yield_curve_inverted: bool,
        credit_stress: bool
    ) -> str:
        """
        Classify current economic regime.

        Regimes:
        - expansion: Low unemployment, stable/low inflation
        - slowdown: Rising unemployment or inverted yield curve
        - recession: High unemployment, credit stress
        - recovery: Falling unemployment from high levels
        """
        # Recession signals
        if credit_stress and unemployment > 5.5:
            return 'recession'
        if yield_curve_inverted and unemployment_trend == 'rising':
            return 'slowdown'

        # Recovery
        if unemployment > 5.0 and unemployment_trend == 'falling':
            return 'recovery'

        # Expansion
        if unemployment < 5.0 and unemployment_trend != 'rising':
            return 'expansion'

        # Default to slowdown if uncertain
        if unemployment_trend == 'rising':
            return 'slowdown'

        return 'expansion'

    def _synthetic_macro_state(self) -> MacroState:
        """Return synthetic state when FRED unavailable."""
        return MacroState(
            unemployment=4.0,
            unemployment_trend='stable',
            inflation_yoy=3.0,
            inflation_trend='stable',
            yield_curve_slope=0.5,
            yield_curve_inverted=False,
            credit_spread=4.0,
            credit_stress=False,
            policy_uncertainty=100,
            fed_funds_rate=5.0,
            regime='expansion'
        )

    def add_macro_features(
        self,
        df: pd.DataFrame,
        lag: int = 1
    ) -> pd.DataFrame:
        """
        Add macro features to a price DataFrame.

        Features added:
        - unemployment_rate: Current unemployment
        - inflation_yoy: YoY inflation rate
        - yield_curve: 10Y-2Y spread
        - yield_curve_inverted: Binary inversion flag
        - credit_spread: High yield spread
        - fed_funds: Fed Funds rate
        - macro_regime: Economic regime classification

        Args:
            df: DataFrame with datetime index
            lag: Lag for lookahead prevention

        Returns:
            DataFrame with macro features
        """
        result = df.copy()

        # Determine date range
        if isinstance(df.index, pd.DatetimeIndex):
            start = df.index.min().strftime('%Y-%m-%d')
            end = df.index.max().strftime('%Y-%m-%d')
        else:
            logger.warning("DataFrame index is not DatetimeIndex, using defaults")
            start = '2020-01-01'
            end = datetime.now().strftime('%Y-%m-%d')

        # Fetch macro data
        macro = self.fetch_macro_indicators(start, end)

        if macro.empty:
            logger.warning("No macro data available, adding synthetic features")
            result['unemployment_rate'] = 4.0
            result['inflation_yoy'] = 3.0
            result['yield_curve'] = 0.5
            result['yield_curve_inverted'] = 0
            result['credit_spread'] = 4.0
            result['fed_funds'] = 5.0
            result['macro_regime'] = 'expansion'
            return result

        # Resample macro data to match price data frequency
        # Forward fill to handle different release frequencies
        macro = macro.resample('D').ffill()

        # Merge with price data
        if isinstance(df.index, pd.DatetimeIndex):
            result['_date'] = df.index.date
        else:
            result['_date'] = pd.to_datetime(df.index).date

        macro['_date'] = macro.index.date

        for col in ['UNRATE', 'T10Y2Y', 'BAMLH0A0HYM2', 'FEDFUNDS']:
            if col in macro.columns:
                col_map = macro.set_index('_date')[col]
                result[col] = result['_date'].map(col_map)

        # Rename and process
        if 'UNRATE' in result.columns:
            result['unemployment_rate'] = result['UNRATE'].shift(lag)
            result = result.drop('UNRATE', axis=1)

        if 'T10Y2Y' in result.columns:
            result['yield_curve'] = result['T10Y2Y'].shift(lag)
            result['yield_curve_inverted'] = (result['yield_curve'] < 0).astype(int)
            result = result.drop('T10Y2Y', axis=1)

        if 'BAMLH0A0HYM2' in result.columns:
            result['credit_spread'] = result['BAMLH0A0HYM2'].shift(lag)
            result = result.drop('BAMLH0A0HYM2', axis=1)

        if 'FEDFUNDS' in result.columns:
            result['fed_funds'] = result['FEDFUNDS'].shift(lag)
            result = result.drop('FEDFUNDS', axis=1)

        # Calculate inflation YoY if CPI available
        if 'CPIAUCSL' in macro.columns:
            cpi = macro['CPIAUCSL']
            inflation_yoy = cpi.pct_change(252) * 100
            inflation_yoy.name = 'inflation_yoy'
            inflation_map = inflation_yoy.to_frame()
            inflation_map['_date'] = inflation_map.index.date
            inflation_map = inflation_map.set_index('_date')['inflation_yoy']
            result['inflation_yoy'] = result['_date'].map(inflation_map).shift(lag)

        # Add regime classification
        result['macro_regime'] = 'expansion'  # Default
        if 'yield_curve_inverted' in result.columns and 'unemployment_rate' in result.columns:
            # Simple regime logic
            result.loc[result['yield_curve_inverted'] == 1, 'macro_regime'] = 'slowdown'
            result.loc[result['unemployment_rate'] > 6.0, 'macro_regime'] = 'recession'

        # Clean up
        result = result.drop('_date', axis=1, errors='ignore')
        result = result.ffill()

        return result


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    print("=" * 60)
    print("FRED ECONOMIC DATA CLIENT TEST")
    print("=" * 60)

    # Initialize client (without API key for demo)
    client = FREDClient()

    print("\n--- Macro State (Synthetic) ---")
    state = client.get_macro_state()
    print(f"Unemployment: {state.unemployment:.1f}%")
    print(f"Unemployment Trend: {state.unemployment_trend}")
    print(f"Inflation YoY: {state.inflation_yoy:.1f}%")
    print(f"Inflation Trend: {state.inflation_trend}")
    print(f"Yield Curve Slope: {state.yield_curve_slope:.2f}%")
    print(f"Yield Curve Inverted: {state.yield_curve_inverted}")
    print(f"Credit Spread: {state.credit_spread:.2f}%")
    print(f"Credit Stress: {state.credit_stress}")
    print(f"Fed Funds Rate: {state.fed_funds_rate:.2f}%")
    print(f"Economic Regime: {state.regime}")

    print("\n--- DataFrame Integration ---")
    # Create sample price data
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    df = pd.DataFrame({
        'close': 450 + np.random.randn(100).cumsum(),
        'volume': np.random.randint(1000000, 5000000, 100)
    }, index=dates)

    df_with_macro = client.add_macro_features(df)
    macro_cols = [c for c in df_with_macro.columns if c not in ['close', 'volume']]
    print(f"Added columns: {macro_cols}")
    print(f"\nSample data:")
    print(df_with_macro[['close', 'unemployment_rate', 'yield_curve', 'macro_regime']].tail())

    print("\n--- Available FRED Series ---")
    print("Key series for regime prediction:")
    for series_id, desc in list(FRED_SERIES.items())[:10]:
        print(f"  {series_id}: {desc}")

    print("\n=== FRED Client Test Complete ===")
    print("\nNote: To fetch real data, set FRED_API_KEY environment variable")
    print("Get your free API key at: https://fred.stlouisfed.org/docs/api/api_key.html")
