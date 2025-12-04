#!/usr/bin/env python3
"""
Supabase Publisher - Bridge between Python calculations and React UI.

This module publishes gamma intelligence, regime data, and other calculations
to Supabase tables that the React frontend subscribes to for real-time updates.

Architecture:
    Python (calculations) → Supabase (tables) → React (realtime subscriptions)

Tables:
    - dealer_positioning: Current gamma positioning by symbol
    - gamma_walls: Support/resistance levels from options OI
    - market_regime_live: Current market regime
    - gamma_flip_events: Historical gamma flip events
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

import pandas as pd

logger = logging.getLogger("AlphaFactory.Publisher")


class SupabasePublisher:
    """
    Publishes Python calculations to Supabase for React UI consumption.

    Uses the service role key for write access. The React frontend uses
    the anon key with realtime subscriptions for read-only access.
    """

    def __init__(self, url: str = None, key: str = None):
        """
        Initialize publisher with Supabase credentials.

        Args:
            url: Supabase project URL (defaults to env var)
            key: Supabase service role key (defaults to env var)
        """
        self.url = url or os.environ.get("SUPABASE_URL")
        self.key = key or os.environ.get("SUPABASE_SERVICE_KEY")

        if not self.url or not self.key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
            )

        # Lazy import to avoid dependency issues
        from supabase import create_client, Client
        self.client: Client = create_client(self.url, self.key)
        logger.info("SupabasePublisher initialized")

    # =========================================================================
    # GAMMA INTELLIGENCE
    # =========================================================================

    def publish_gamma_positioning(
        self,
        symbol: str,
        net_gex: float,
        call_gex: float,
        put_gex: float,
        spot_price: float,
        zero_gamma_level: float,
        positioning: str,  # 'LONG_GAMMA' or 'SHORT_GAMMA'
        positioning_strength: float = None
    ) -> bool:
        """
        Publish dealer gamma positioning to Supabase.

        This updates the dealer_positioning table which the React
        GammaIntelligenceMonitor subscribes to.

        Args:
            symbol: Ticker symbol (e.g., 'SPY', 'QQQ')
            net_gex: Net gamma exposure in dollars
            call_gex: Call contribution to GEX
            put_gex: Put contribution to GEX
            spot_price: Current underlying price
            zero_gamma_level: Price where GEX flips sign
            positioning: 'LONG_GAMMA', 'SHORT_GAMMA', or 'NEUTRAL'
            positioning_strength: 0-100 strength score (auto-calculated if None)

        Returns:
            True if successful, False otherwise
        """
        # Calculate positioning strength if not provided
        if positioning_strength is None:
            # Normalize GEX to 0-100 scale based on typical ranges
            # Typical SPY GEX ranges from -$5B to +$5B
            gex_normalized = min(abs(net_gex) / 5_000_000_000, 1.0) * 100
            positioning_strength = gex_normalized

        # Determine vol impact
        if positioning == 'SHORT_GAMMA':
            vol_impact = 'AMPLIFIED'
        elif positioning == 'LONG_GAMMA':
            vol_impact = 'DAMPENED'
        else:
            vol_impact = 'NEUTRAL'

        payload = {
            "symbol": symbol,
            "positioning": positioning,
            "positioning_strength": min(positioning_strength, 100),
            "net_gamma": float(net_gex),
            "call_gamma": float(call_gex),
            "put_gamma": float(put_gex),
            "gamma_notional": float(abs(net_gex)),
            "spot_price": float(spot_price),
            "zero_gamma_level": float(zero_gamma_level) if zero_gamma_level else None,
            "vol_impact": vol_impact,
            "data_source": "calculated",
            "calculation_timestamp": datetime.now().isoformat()
        }

        try:
            self.client.table("dealer_positioning").upsert(
                payload,
                on_conflict="symbol"  # Upsert on symbol
            ).execute()
            logger.info(f"✅ Published gamma positioning for {symbol}: {positioning}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to publish gamma positioning: {e}")
            return False

    def publish_gamma_walls(
        self,
        symbol: str,
        walls: List[Dict[str, Any]],
        spot_price: float
    ) -> bool:
        """
        Publish gamma walls (support/resistance levels) to Supabase.

        Args:
            symbol: Ticker symbol
            walls: List of wall dicts with keys:
                - strike: Strike price
                - wall_type: 'SUPPORT', 'RESISTANCE', 'MAGNET', 'FLIP_ZONE'
                - wall_strength: 0-100 strength
                - gamma_at_strike: GEX at this strike (optional)
                - open_interest: OI at strike (optional)
            spot_price: Current underlying price

        Returns:
            True if successful, False otherwise
        """
        # First, delete old walls for this symbol
        try:
            self.client.table("gamma_walls").delete().eq("symbol", symbol).execute()
        except Exception as e:
            logger.warning(f"Failed to delete old walls: {e}")

        # Prepare payloads
        payloads = []
        for wall in walls:
            strike = wall.get("strike", 0)
            payloads.append({
                "symbol": symbol,
                "strike": float(strike),
                "wall_type": wall.get("wall_type", "SUPPORT"),
                "wall_strength": min(wall.get("wall_strength", 50), 100),
                "distance_from_spot": float(strike - spot_price),
                "gamma_at_strike": wall.get("gamma_at_strike"),
                "open_interest": wall.get("open_interest"),
                "data_source": "calculated"
            })

        if not payloads:
            logger.warning(f"No walls to publish for {symbol}")
            return True

        try:
            self.client.table("gamma_walls").insert(payloads).execute()
            logger.info(f"✅ Published {len(payloads)} gamma walls for {symbol}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to publish gamma walls: {e}")
            return False

    def publish_from_gamma_exposure(
        self,
        symbol: str,
        gamma_exposure,  # GammaExposure dataclass from gamma_calc.py
        spot_price: float
    ) -> bool:
        """
        Publish complete gamma intelligence from a GammaExposure result.

        This is the main entry point - takes the output of GammaCalculator.calculate_gex()
        and publishes both positioning and walls.

        Args:
            symbol: Ticker symbol
            gamma_exposure: GammaExposure dataclass from gamma_calc.py
            spot_price: Current underlying price

        Returns:
            True if all publishes successful
        """
        success = True

        # Publish positioning
        success &= self.publish_gamma_positioning(
            symbol=symbol,
            net_gex=gamma_exposure.net_gex,
            call_gex=gamma_exposure.call_gex,
            put_gex=gamma_exposure.put_gex,
            spot_price=spot_price,
            zero_gamma_level=gamma_exposure.zero_gamma_level,
            positioning=gamma_exposure.dealer_position
        )

        # Build walls list
        walls = []

        # Call wall (resistance)
        if gamma_exposure.max_call_wall and not pd.isna(gamma_exposure.max_call_wall):
            walls.append({
                "strike": gamma_exposure.max_call_wall,
                "wall_type": "RESISTANCE",
                "wall_strength": 80  # Could derive from GEX magnitude
            })

        # Put wall (support)
        if gamma_exposure.max_put_wall and not pd.isna(gamma_exposure.max_put_wall):
            walls.append({
                "strike": gamma_exposure.max_put_wall,
                "wall_type": "SUPPORT",
                "wall_strength": 80
            })

        # Zero gamma level (magnet)
        if gamma_exposure.zero_gamma_level and not pd.isna(gamma_exposure.zero_gamma_level):
            walls.append({
                "strike": gamma_exposure.zero_gamma_level,
                "wall_type": "MAGNET",
                "wall_strength": 60
            })

        if walls:
            success &= self.publish_gamma_walls(symbol, walls, spot_price)

        return success

    # =========================================================================
    # MARKET REGIME
    # =========================================================================

    def publish_regime(
        self,
        vix_level: float,
        vix_regime: str,
        spy_price: float = None,
        spy_trend: str = None,
        sma_20: float = None,
        sma_50: float = None,
        sma_200: float = None,
        sector_correlation: float = None,
        correlation_regime: str = None,
        position_multiplier: float = 1.0
    ) -> bool:
        """
        Publish current market regime to Supabase.

        Args:
            vix_level: Current VIX level
            vix_regime: 'OPTIMAL', 'SUBOPTIMAL', 'PAUSE'
            spy_price: Current SPY price
            spy_trend: 'STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN'
            sma_20/50/200: Moving average levels
            sector_correlation: Average pairwise sector correlation
            correlation_regime: 'RISK_ON', 'RISK_OFF', 'TRANSITIONING'
            position_multiplier: Suggested position size multiplier

        Returns:
            True if successful
        """
        # First, mark all existing as not current
        try:
            self.client.table("market_regime_live").update(
                {"is_current": False}
            ).eq("is_current", True).execute()
        except Exception as e:
            logger.warning(f"Failed to clear old regime: {e}")

        payload = {
            "is_current": True,
            "vix_level": float(vix_level),
            "vix_regime": vix_regime,
            "spy_price": float(spy_price) if spy_price else None,
            "spy_trend": spy_trend,
            "sma_20": float(sma_20) if sma_20 else None,
            "sma_50": float(sma_50) if sma_50 else None,
            "sma_200": float(sma_200) if sma_200 else None,
            "sector_correlation": float(sector_correlation) if sector_correlation else None,
            "correlation_regime": correlation_regime,
            "position_multiplier": min(max(position_multiplier, 0), 2.0),
            "data_source": "calculated",
            "calculation_timestamp": datetime.now().isoformat()
        }

        try:
            self.client.table("market_regime_live").insert(payload).execute()
            logger.info(f"✅ Published regime: VIX {vix_level:.1f} ({vix_regime})")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to publish regime: {e}")
            return False

    # =========================================================================
    # GAMMA FLIP EVENTS
    # =========================================================================

    def record_gamma_flip(
        self,
        symbol: str,
        from_positioning: str,
        to_positioning: str,
        spot_price: float,
        zero_gamma_level: float = None,
        net_gex_before: float = None,
        net_gex_after: float = None
    ) -> bool:
        """
        Record a gamma flip event for historical analysis.

        Args:
            symbol: Ticker symbol
            from_positioning: Previous positioning
            to_positioning: New positioning
            spot_price: Price at flip
            zero_gamma_level: ZGL at flip
            net_gex_before/after: GEX before and after flip

        Returns:
            True if successful
        """
        payload = {
            "symbol": symbol,
            "flip_timestamp": datetime.now().isoformat(),
            "from_positioning": from_positioning,
            "to_positioning": to_positioning,
            "spot_price_at_flip": float(spot_price),
            "zero_gamma_level": float(zero_gamma_level) if zero_gamma_level else None,
            "net_gex_before": float(net_gex_before) if net_gex_before else None,
            "net_gex_after": float(net_gex_after) if net_gex_after else None
        }

        try:
            self.client.table("gamma_flip_events").insert(payload).execute()
            logger.info(f"✅ Recorded gamma flip: {symbol} {from_positioning} → {to_positioning}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to record gamma flip: {e}")
            return False


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

_publisher: Optional[SupabasePublisher] = None


def get_publisher() -> SupabasePublisher:
    """Get or create singleton publisher instance."""
    global _publisher
    if _publisher is None:
        _publisher = SupabasePublisher()
    return _publisher


def publish_gamma(symbol: str, gamma_exposure, spot_price: float) -> bool:
    """Convenience function to publish gamma data."""
    return get_publisher().publish_from_gamma_exposure(symbol, gamma_exposure, spot_price)


def publish_regime(**kwargs) -> bool:
    """Convenience function to publish regime data."""
    return get_publisher().publish_regime(**kwargs)
