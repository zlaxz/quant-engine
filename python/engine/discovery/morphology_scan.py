#!/usr/bin/env python3
"""
Morphology Scanner - The Market Cartographer's Eye.

Autonomous market structure scanner that:
1. Analyzes current regime (vol, trend, momentum)
2. Identifies regime transitions and opportunities
3. Generates mission hypotheses based on market state
4. Detects inefficiencies ripe for exploitation

This enables the daemon to be TRULY AUTONOMOUS - not just reactive to
manually created missions, but proactively creating missions from
market observations.

Usage:
    scanner = MorphologyScanner(data_dir='/path/to/data')
    opportunities = scanner.scan()
    for opp in opportunities:
        print(f"Found opportunity: {opp.hypothesis}")
"""

import os
import logging
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from enum import Enum

import pandas as pd
import numpy as np

logger = logging.getLogger("NightShift.Discovery")


class OpportunityType(Enum):
    """Classification of market opportunities."""
    REGIME_TRANSITION = "regime_transition"      # Market changing state
    VOL_EXPANSION = "vol_expansion"              # IV spike = premium selling
    VOL_COMPRESSION = "vol_compression"          # Low IV = cheap options
    MOMENTUM_EXTREME = "momentum_extreme"        # RSI/trend extremes
    MEAN_REVERSION = "mean_reversion"            # Price at support/resistance
    GAMMA_SCALP = "gamma_scalp"                  # High gamma environment
    CALENDAR_ANOMALY = "calendar_anomaly"        # Known calendar effects


@dataclass
class MarketOpportunity:
    """A discovered market opportunity that could become a mission."""
    opportunity_type: OpportunityType
    symbol: str
    hypothesis: str
    confidence: float  # 0.0 to 1.0
    suggested_metric: str  # e.g., "sharpe_ratio"
    suggested_target: float  # e.g., 1.5
    context: Dict[str, Any]  # Raw data supporting the hypothesis
    detected_at: datetime

    def to_mission_params(self) -> Dict[str, Any]:
        """Convert opportunity to mission creation parameters."""
        return {
            'name': f"Auto: {self.hypothesis[:50]}",
            'objective': self.hypothesis,
            'target_metric': self.suggested_metric,
            'target_value': self.suggested_target,
            'target_operator': '>=',
            'max_drawdown': 0.15,  # Default conservative drawdown
            'priority': int(self.confidence * 100),
            'source': 'morphology_scanner',
            'context': self.context
        }


class MorphologyScanner:
    """
    Scans market structure to autonomously identify opportunities.

    The "eyes" of the autonomous system - looks at market data and
    generates hypotheses that become missions for the daemon to pursue.
    """

    # Default symbols to scan
    DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'AMZN', 'GOOGL']

    # Regime thresholds
    HIGH_IV_THRESHOLD = 0.25      # IV > 25% = high vol environment
    LOW_IV_THRESHOLD = 0.15       # IV < 15% = low vol environment
    RSI_OVERBOUGHT = 70           # RSI > 70 = overbought
    RSI_OVERSOLD = 30             # RSI < 30 = oversold
    TREND_LOOKBACK = 50           # Days for trend calculation
    VOL_LOOKBACK = 20             # Days for volatility calculation

    def __init__(
        self,
        data_dir: str,
        symbols: Optional[List[str]] = None,
        min_confidence: float = 0.6
    ):
        """
        Initialize the morphology scanner.

        Args:
            data_dir: Path to market data (Parquet files)
            symbols: List of symbols to scan (default: DEFAULT_SYMBOLS)
            min_confidence: Minimum confidence to report opportunity
        """
        self.data_dir = data_dir
        self.symbols = symbols or self.DEFAULT_SYMBOLS
        self.min_confidence = min_confidence

        # Cache for loaded data
        self._data_cache: Dict[str, pd.DataFrame] = {}
        self._cache_time: Optional[datetime] = None
        self._cache_ttl = timedelta(minutes=5)  # Refresh cache every 5 min

    def _load_symbol_data(self, symbol: str, days: int = 100) -> Optional[pd.DataFrame]:
        """
        Load price and IV data for a symbol.

        Looks for Parquet files in the data directory.
        """
        try:
            # Try various path patterns
            patterns = [
                os.path.join(self.data_dir, f"{symbol}_daily.parquet"),
                os.path.join(self.data_dir, f"daily/{symbol}.parquet"),
                os.path.join(self.data_dir, f"stocks/{symbol}.parquet"),
                os.path.join(self.data_dir, f"{symbol.lower()}_daily.parquet"),
            ]

            for path in patterns:
                if os.path.exists(path):
                    df = pd.read_parquet(path)
                    # Ensure we have required columns
                    if 'close' in df.columns:
                        # Calculate IV if not present
                        if 'iv' not in df.columns and 'implied_volatility' in df.columns:
                            df['iv'] = df['implied_volatility']
                        elif 'iv' not in df.columns:
                            # Estimate IV from realized volatility
                            df['iv'] = df['close'].pct_change().rolling(20).std() * np.sqrt(252)

                        return df.tail(days)

            logger.debug(f"No data found for {symbol}")
            return None

        except Exception as e:
            logger.warning(f"Failed to load data for {symbol}: {e}")
            return None

    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> float:
        """Calculate RSI for a price series."""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()

        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))

        return rsi.iloc[-1] if not pd.isna(rsi.iloc[-1]) else 50.0

    def _detect_regime_transition(self, df: pd.DataFrame, symbol: str) -> Optional[MarketOpportunity]:
        """
        Detect if market is transitioning between regimes.

        Regime transitions = high opportunity for strategy adaptation.
        """
        if len(df) < self.TREND_LOOKBACK:
            return None

        # Calculate short and long term volatility
        short_vol = df['close'].pct_change().tail(5).std() * np.sqrt(252)
        long_vol = df['close'].pct_change().tail(20).std() * np.sqrt(252)

        # Calculate trend
        sma_short = df['close'].tail(10).mean()
        sma_long = df['close'].tail(50).mean()
        current_price = df['close'].iloc[-1]

        # Detect transitions
        vol_change = abs(short_vol - long_vol) / long_vol if long_vol > 0 else 0
        trend_flip = (current_price > sma_short > sma_long) or (current_price < sma_short < sma_long)

        if vol_change > 0.3 or trend_flip:
            confidence = min(0.9, 0.5 + vol_change)

            if short_vol > long_vol:
                hypothesis = f"Vol expansion in {symbol} - premium selling opportunity"
                target = 1.8  # Higher Sharpe target for vol selling
            else:
                hypothesis = f"Vol compression in {symbol} - trend following opportunity"
                target = 1.5

            return MarketOpportunity(
                opportunity_type=OpportunityType.REGIME_TRANSITION,
                symbol=symbol,
                hypothesis=hypothesis,
                confidence=confidence,
                suggested_metric='sharpe_ratio',
                suggested_target=target,
                context={
                    'short_vol': float(short_vol),
                    'long_vol': float(long_vol),
                    'vol_change': float(vol_change),
                    'trend_flip': trend_flip,
                    'current_price': float(current_price)
                },
                detected_at=datetime.now()
            )

        return None

    def _detect_vol_extreme(self, df: pd.DataFrame, symbol: str) -> Optional[MarketOpportunity]:
        """
        Detect volatility extremes (very high or very low IV).
        """
        if 'iv' not in df.columns:
            return None

        current_iv = df['iv'].iloc[-1]
        if pd.isna(current_iv):
            return None

        # Normalize if needed
        if current_iv > 5:
            current_iv = current_iv / 100

        # Calculate IV rank (where current IV sits in historical range)
        iv_min = df['iv'].min()
        iv_max = df['iv'].max()
        if iv_min > 5:
            iv_min, iv_max = iv_min / 100, iv_max / 100

        iv_rank = (current_iv - iv_min) / (iv_max - iv_min) if iv_max > iv_min else 0.5

        if current_iv > self.HIGH_IV_THRESHOLD:
            return MarketOpportunity(
                opportunity_type=OpportunityType.VOL_EXPANSION,
                symbol=symbol,
                hypothesis=f"High IV ({current_iv:.1%}) in {symbol} - premium selling strategies",
                confidence=min(0.85, 0.5 + iv_rank * 0.4),
                suggested_metric='sharpe_ratio',
                suggested_target=2.0,  # Vol selling can achieve high Sharpe
                context={
                    'current_iv': float(current_iv),
                    'iv_rank': float(iv_rank),
                    'iv_percentile': float(iv_rank * 100)
                },
                detected_at=datetime.now()
            )

        elif current_iv < self.LOW_IV_THRESHOLD:
            return MarketOpportunity(
                opportunity_type=OpportunityType.VOL_COMPRESSION,
                symbol=symbol,
                hypothesis=f"Low IV ({current_iv:.1%}) in {symbol} - cheap options for directional plays",
                confidence=min(0.75, 0.4 + (1 - iv_rank) * 0.4),
                suggested_metric='total_return',
                suggested_target=0.20,  # 20% return target for cheap options
                context={
                    'current_iv': float(current_iv),
                    'iv_rank': float(iv_rank),
                    'iv_percentile': float(iv_rank * 100)
                },
                detected_at=datetime.now()
            )

        return None

    def _detect_momentum_extreme(self, df: pd.DataFrame, symbol: str) -> Optional[MarketOpportunity]:
        """
        Detect RSI and momentum extremes.
        """
        if len(df) < 20:
            return None

        rsi = self._calculate_rsi(df['close'])

        # Calculate momentum
        returns_5d = (df['close'].iloc[-1] / df['close'].iloc[-5] - 1) * 100
        returns_20d = (df['close'].iloc[-1] / df['close'].iloc[-20] - 1) * 100

        if rsi > self.RSI_OVERBOUGHT:
            return MarketOpportunity(
                opportunity_type=OpportunityType.MOMENTUM_EXTREME,
                symbol=symbol,
                hypothesis=f"Overbought RSI ({rsi:.0f}) in {symbol} - mean reversion or momentum continuation",
                confidence=min(0.7, 0.4 + (rsi - 70) / 60),
                suggested_metric='sharpe_ratio',
                suggested_target=1.5,
                context={
                    'rsi': float(rsi),
                    'returns_5d': float(returns_5d),
                    'returns_20d': float(returns_20d),
                    'signal': 'overbought'
                },
                detected_at=datetime.now()
            )

        elif rsi < self.RSI_OVERSOLD:
            return MarketOpportunity(
                opportunity_type=OpportunityType.MOMENTUM_EXTREME,
                symbol=symbol,
                hypothesis=f"Oversold RSI ({rsi:.0f}) in {symbol} - bounce or capitulation play",
                confidence=min(0.7, 0.4 + (30 - rsi) / 60),
                suggested_metric='sharpe_ratio',
                suggested_target=1.5,
                context={
                    'rsi': float(rsi),
                    'returns_5d': float(returns_5d),
                    'returns_20d': float(returns_20d),
                    'signal': 'oversold'
                },
                detected_at=datetime.now()
            )

        return None

    def scan(self) -> List[MarketOpportunity]:
        """
        Perform full market scan and return opportunities.

        This is the main entry point - runs all detectors across all symbols
        and returns opportunities that exceed the confidence threshold.

        Returns:
            List of MarketOpportunity objects sorted by confidence (highest first)
        """
        logger.info(f"🔭 Starting morphology scan across {len(self.symbols)} symbols...")
        opportunities: List[MarketOpportunity] = []

        for symbol in self.symbols:
            df = self._load_symbol_data(symbol)
            if df is None or len(df) < self.TREND_LOOKBACK:
                continue

            # Run all detectors
            detectors = [
                self._detect_regime_transition,
                self._detect_vol_extreme,
                self._detect_momentum_extreme,
            ]

            for detector in detectors:
                try:
                    opp = detector(df, symbol)
                    if opp and opp.confidence >= self.min_confidence:
                        opportunities.append(opp)
                        logger.info(f"   🎯 {symbol}: {opp.hypothesis} (confidence: {opp.confidence:.0%})")
                except Exception as e:
                    logger.warning(f"Detector {detector.__name__} failed for {symbol}: {e}")

        # Sort by confidence (highest first)
        opportunities.sort(key=lambda x: x.confidence, reverse=True)

        logger.info(f"🔭 Scan complete: {len(opportunities)} opportunities found")
        return opportunities

    def get_top_opportunity(self) -> Optional[MarketOpportunity]:
        """
        Get the single best opportunity from the scan.

        Convenience method for when you just want one mission.
        """
        opportunities = self.scan()
        return opportunities[0] if opportunities else None


# ============================================================================
# Convenience function for daemon integration
# ============================================================================

def scan_for_opportunities(
    data_dir: str,
    symbols: Optional[List[str]] = None,
    min_confidence: float = 0.6
) -> List[MarketOpportunity]:
    """
    Convenience function to run a market scan.

    Args:
        data_dir: Path to market data
        symbols: Symbols to scan (default: major indices + tech)
        min_confidence: Minimum confidence threshold

    Returns:
        List of opportunities sorted by confidence
    """
    scanner = MorphologyScanner(
        data_dir=data_dir,
        symbols=symbols,
        min_confidence=min_confidence
    )
    return scanner.scan()
