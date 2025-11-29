"""
Exit Engine V1 - Intelligent Multi-Factor Exits

INTELLIGENT EXIT FRAMEWORK:
- Exit when DETECTOR SCORE drops (regime that triggered entry is fading)
- Exit when profit target hit (capture wins)
- Exit when max loss hit (protect capital)
- Exit when max time hit (backstop)

Exit Decision Order (MANDATORY):
1. RISK: Max loss stop (protect capital)
2. DETECTOR: Profile detector score drops (regime opportunity fading)
3. TIME: Max hold backstop (prevent eternal losers)

NO PROFIT TARGETS - Detector score determines when edge is exhausted.

Uses daily bars with T+1 open execution.
"""

from dataclasses import dataclass
from typing import Dict, Optional, Callable
from datetime import date
import pandas as pd
import numpy as np
from ..profiles.detectors import ProfileDetectors


@dataclass
class ExitConfig:
    """Exit configuration for a single profile"""

    # Risk management
    max_loss_pct: float          # Max loss before forced exit (e.g., -0.50 = -50%)
    max_hold_days: int           # Max days to hold (backstop)

    # Detector threshold
    detector_exit_threshold: float  # Exit when detector score drops below this

    # Condition exit function
    condition_exit_fn: Callable[[Dict, Dict, int], bool]  # Function that checks market conditions + days_held


class ExitEngineV1:
    """
    Intelligent exit engine using risk management, profit targets, and conditions.

    Decision order:
    1. Risk (max loss)
    2. TP2 (full exit on big profit)
    3. TP1 (partial exit on moderate profit)
    4. Condition (regime/indicator based)
    5. Time (max hold backstop)
    """

    def __init__(self):
        """Initialize Exit Engine V1 with profile configurations"""
        self.configs = self._get_profile_configs()
        self.tp1_hit = {}  # Track if TP1 already hit for each trade
        self.detector = ProfileDetectors()  # For calculating detector scores

        # Detector score exit thresholds (exit when score drops below)
        self.detector_exit_threshold = 0.30  # Exit when regime score < 0.3

    def _get_profile_configs(self) -> Dict[str, ExitConfig]:
        """
        Define exit configurations for all 6 profiles.

        Based on PrimeGPT's Exit Engine V1 specification.
        """

        # DETECTOR-BASED INTELLIGENT EXITS
        # Exit when regime score drops (opportunity fading)
        # NO profit targets - detector determines exit timing

        configs = {
            'Profile_1_LDG': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=14,        # Backstop
                detector_exit_threshold=0.30,  # Exit when score < 0.3
                condition_exit_fn=self._condition_exit_profile_1
            ),

            'Profile_2_SDG': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=5,         # Short-dated, faster backstop
                detector_exit_threshold=0.30,
                condition_exit_fn=self._condition_exit_profile_2
            ),

            'Profile_3_CHARM': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=14,        # Backstop
                detector_exit_threshold=0.30,
                condition_exit_fn=self._condition_exit_profile_3
            ),

            'Profile_4_VANNA': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=16,        # Peaks late (day 13)
                detector_exit_threshold=0.30,
                condition_exit_fn=self._condition_exit_profile_4
            ),

            'Profile_5_SKEW': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=5,         # Fear trades exit fast
                detector_exit_threshold=0.30,
                condition_exit_fn=self._condition_exit_profile_5
            ),

            'Profile_6_VOV': ExitConfig(
                max_loss_pct=-0.50,      # -50% stop
                max_hold_days=14,        # Backstop
                detector_exit_threshold=0.30,
                condition_exit_fn=self._condition_exit_profile_6
            ),
        }

        return configs

    def should_exit(
        self,
        profile_id: str,
        trade_id: str,
        days_held: int,
        pnl_pct: float,
        market_conditions: Dict,
        position_greeks: Dict
    ) -> tuple[bool, float, str]:
        """
        Determine if position should exit and how much.

        Args:
            profile_id: Profile identifier (e.g., 'Profile_1_LDG')
            trade_id: Unique trade identifier (for tracking TP1 status)
            days_held: Days since entry
            pnl_pct: Current P&L as percentage of entry cost
            market_conditions: Dict with market indicators (slope_MA20, RV5, etc.)
            position_greeks: Dict with current Greeks (delta, gamma, etc.)

        Returns:
            (should_exit: bool, fraction_to_close: float, reason: str)
            - fraction_to_close: 0.0-1.0 (1.0 = close all)
        """
        cfg = self.configs.get(profile_id)
        if not cfg:
            # Unknown profile - use time backstop
            return (days_held >= 14, 1.0, "unknown_profile_time_stop")

        # Track TP1 status per trade
        tp1_key = f"{profile_id}_{trade_id}"
        if tp1_key not in self.tp1_hit:
            self.tp1_hit[tp1_key] = False

        # DECISION ORDER (MANDATORY - DO NOT CHANGE):

        # 1. RISK: Max loss stop (highest priority)
        if pnl_pct <= cfg.max_loss_pct:
            return (True, 1.0, f"max_loss_{cfg.max_loss_pct:.0%}")

        # 2. DETECTOR: Regime score drops (opportunity fading)
        if cfg.condition_exit_fn(market_conditions, position_greeks, days_held):
            return (True, 1.0, "detector_exit")

        # 3. TIME: Max hold backstop
        if days_held >= cfg.max_hold_days:
            return (True, 1.0, f"time_stop_day{cfg.max_hold_days}")

        # No exit triggered
        return (False, 0.0, "")

    def _condition_exit_profile_1(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 1 (LDG) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (vol compressed + uptrend)
        Exit: Detector score drops LOW (regime opportunity fading)

        This is regime-aware and adaptive.
        """
        # Allow minimum hold for edge to develop
        if days_held < 2:
            return False

        # Calculate current detector score
        current_score = self._calculate_detector_score('Profile_1_LDG', market)

        if current_score is None:
            # No score available (missing data), fall back to simple logic
            slope_ma20 = market.get('slope_MA20')
            return slope_ma20 is not None and slope_ma20 <= 0

        # Exit when detector score drops below threshold
        # Entry was at score ~0.7+, exit when drops to 0.3-
        if current_score < self.detector_exit_threshold:
            return True

        return False

    def _condition_exit_profile_2(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 2 (SDG) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (RV spike + large move + VVIX rising)
        Exit: Detector score drops LOW (spike fading)
        """
        if days_held < 1:  # Short-dated, allow quick exits
            return False

        current_score = self._calculate_detector_score('Profile_2_SDG', market)

        if current_score is None:
            return False  # No data, hold

        if current_score < self.detector_exit_threshold:
            return True

        return False

    def _condition_exit_profile_3(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 3 (CHARM) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (IV rich + pinned + VVIX declining)
        Exit: Detector score drops LOW (charm opportunity fading)
        """
        if days_held < 2:
            return False

        current_score = self._calculate_detector_score('Profile_3_CHARM', market)

        if current_score is None:
            return False

        if current_score < self.detector_exit_threshold:
            return True

        return False

    def _condition_exit_profile_4(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 4 (VANNA) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (low IV rank + uptrend + VVIX stable)
        Exit: Detector score drops LOW (vanna opportunity fading)

        This is THE MOST PROFITABLE PROFILE - intelligent exits critical.
        """
        if days_held < 2:
            return False

        current_score = self._calculate_detector_score('Profile_4_VANNA', market)

        if current_score is None:
            # Fallback to trend break
            slope_ma20 = market.get('slope_MA20')
            return slope_ma20 is not None and slope_ma20 <= 0

        if current_score < self.detector_exit_threshold:
            return True

        return False

    def _condition_exit_profile_5(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 5 (SKEW) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (skew steep + VVIX rising + RV>IV)
        Exit: Detector score drops LOW (fear fading)
        """
        if days_held < 1:  # Fast exits for fear trades
            return False

        current_score = self._calculate_detector_score('Profile_5_SKEW', market)

        if current_score is None:
            return False

        if current_score < self.detector_exit_threshold:
            return True

        return False

    def _condition_exit_profile_6(self, market: Dict, greeks: Dict, days_held: int) -> bool:
        """
        Profile 6 (VOV) - INTELLIGENT detector-based exit

        Entry: Detector score HIGH (VVIX elevated + rising + IV cheap + RV compressed)
        Exit: Detector score drops LOW (vol-of-vol opportunity fading)
        """
        if days_held < 2:
            return False

        current_score = self._calculate_detector_score('Profile_6_VOV', market)

        if current_score is None:
            return False

        if current_score < self.detector_exit_threshold:
            return True

        return False

    def get_config(self, profile_id: str) -> Optional[ExitConfig]:
        """Get exit configuration for a profile"""
        return self.configs.get(profile_id)

    def _calculate_detector_score(self, profile_id: str, market: Dict) -> float:
        """
        Calculate current detector score for a profile.

        This tells us if the regime that triggered entry is still favorable.
        High score (0.7+): Regime still favorable
        Low score (0.3-): Regime fading, exit opportunity

        Args:
            profile_id: Profile identifier
            market: Market conditions dict with required features

        Returns:
            Detector score in [0, 1], or None if data missing
        """
        # Convert market dict to DataFrame row for detector calculation
        try:
            df_row = pd.DataFrame([market])

            # Calculate all profiles (detector needs full feature set)
            df_with_scores = self.detector.compute_all_profiles(df_row)

            # Extract score for this profile
            score_col_map = {
                'Profile_1_LDG': 'profile_1_LDG',
                'Profile_2_SDG': 'profile_2_SDG',
                'Profile_3_CHARM': 'profile_3_CHARM',
                'Profile_4_VANNA': 'profile_4_VANNA',
                'Profile_5_SKEW': 'profile_5_SKEW',
                'Profile_6_VOV': 'profile_6_VOV'
            }

            score_col = score_col_map.get(profile_id)
            if score_col and score_col in df_with_scores.columns:
                score = df_with_scores[score_col].iloc[0]
                return score if not pd.isna(score) else None

            return None

        except Exception as e:
            # If detector calculation fails, return None (skip detector exit)
            return None

    def reset_tp1_tracking(self):
        """Reset TP1 tracking (call at start of backtest)"""
        self.tp1_hit = {}

    def apply_to_tracked_trade(
        self,
        profile_id: str,
        trade_data: Dict
    ) -> Dict:
        """
        Apply Exit Engine V1 logic to a tracked trade.

        Takes complete 14-day tracked trade and determines when exit would
        have triggered based on Exit Engine V1 rules.

        Args:
            profile_id: Profile identifier
            trade_data: Complete trade data from TradeTracker with 'path' and 'entry'

        Returns:
            Dict with exit info:
                - exit_day: Day exit triggered (0-14)
                - exit_reason: Why exit triggered
                - exit_pnl: P&L at exit
                - exit_fraction: Fraction closed (for TP1 partials)
        """
        # FIXED: Don't use abs() - preserves sign for short positions
        # Short positions have negative entry_cost (premium collected)
        entry_cost = trade_data['entry']['entry_cost']
        daily_path = trade_data['path']

        # FIXED Round 2: Generate unique trade ID (date + strike + expiry)
        # Using only date causes collisions for same-day trades
        entry_info = trade_data['entry']
        trade_id = f"{entry_info['entry_date']}_{entry_info.get('strike', 0)}_{entry_info.get('expiry', '')}"

        # FIXED Round 2: Guard against empty path
        if not daily_path or len(daily_path) == 0:
            return {
                'exit_day': 0,
                'exit_reason': 'no_tracking_data',
                'exit_pnl': -entry_cost,  # Lost entry cost
                'exit_fraction': 1.0,
                'entry_cost': entry_cost,
                'pnl_pct': -1.0
            }

        # Check each day for exit trigger
        for day in daily_path:
            day_idx = day['day']
            mtm_pnl = day['mtm_pnl']

            # Calculate P&L percentage (FIXED Round 2: use abs() for credit positions)
            # For shorts (negative entry_cost): pnl_pct = mtm_pnl / abs(entry_cost)
            # This gives: -$100 loss / $500 premium = -20% (correct)
            if abs(entry_cost) < 0.01:  # Near-zero entry cost (break-even)
                pnl_pct = 0
            else:
                pnl_pct = mtm_pnl / abs(entry_cost)

            # Check if exit triggered
            should_exit, fraction, reason = self.should_exit(
                profile_id=profile_id,
                trade_id=trade_id,
                days_held=day_idx,
                pnl_pct=pnl_pct,
                market_conditions=day.get('market_conditions', {}),
                position_greeks=day.get('greeks', {})
            )

            if should_exit:
                # FIXED Round 2: Scale exit P&L by fraction for partial exits
                # If TP1 closes 50% of position, only realize 50% of current P&L
                scaled_pnl = mtm_pnl * fraction

                return {
                    'exit_day': day_idx,
                    'exit_reason': reason,
                    'exit_pnl': scaled_pnl,  # Scaled by fraction
                    'exit_fraction': fraction,
                    'entry_cost': entry_cost,
                    'pnl_pct': pnl_pct
                }

        # No exit triggered - use last day (14-day backstop)
        last_day = daily_path[-1]

        # FIXED Round 2: Use abs() for credit position P&L percentage
        if abs(entry_cost) < 0.01:
            final_pnl_pct = 0
        else:
            final_pnl_pct = last_day['mtm_pnl'] / abs(entry_cost)

        return {
            'exit_day': last_day['day'],
            'exit_reason': 'max_tracking_days',
            'exit_pnl': last_day['mtm_pnl'],
            'exit_fraction': 1.0,
            'entry_cost': entry_cost,
            'pnl_pct': final_pnl_pct
        }
