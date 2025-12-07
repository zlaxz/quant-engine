#!/usr/bin/env python3
"""
Pipeline Tracker - Tracks items through the Alpha Factory Pipeline.

This module publishes pipeline state to Supabase for the AlphaFactoryPipeline
UI component to visualize the complete journey from features to live trading.

Stages:
    1. Features    - 7 modules calculating 127+ features
    2. Discovery   - MorphologyScanner detecting opportunities
    3. Mission     - Goals with specific targets
    4. Strategy    - Configuration hypotheses
    5. Backtest    - Historical validation
    6. Audit       - Red Team adversarial validation
    7. Shadow      - Paper trading live market
    8. Graduate    - Proving it works
    9. Live        - Real money trading

Usage:
    from engine.data.pipeline_tracker import PipelineTracker

    tracker = PipelineTracker()

    # Track a feature pipeline run
    run_id = tracker.start_pipeline_run(symbols=['SPY', 'QQQ'])
    tracker.update_module_status(run_id, 'regime', 'completed', features=12)
    tracker.complete_pipeline_run(run_id, success=True)

    # Track a discovery event
    event_id = tracker.record_discovery(
        event_type='REGIME_TRANSITION',
        symbol='SPY',
        confidence=87.5,
        details={'from_regime': 'OPTIMAL', 'to_regime': 'SUBOPTIMAL'}
    )

    # Create a pipeline item and track its journey
    item_id = tracker.create_pipeline_item(
        item_type='opportunity',
        display_name='SPY Regime Shift Response',
        discovery_event_id=event_id
    )
    tracker.transition_stage(item_id, 'discovery', 'mission')
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from uuid import UUID

logger = logging.getLogger("AlphaFactory.PipelineTracker")


class PipelineTracker:
    """
    Tracks items through the Alpha Factory Pipeline.

    Publishes to Supabase tables:
    - pipeline_runs: Feature pipeline execution
    - pipeline_module_status: Per-module status
    - discovery_events: Detected opportunities
    - backtest_runs: Backtest results
    - red_team_audits: Audit results
    - graduation_progress: Shadow to live progress
    - pipeline_items: Cross-stage item tracking
    - stage_transitions: Stage transition log
    """

    STAGES = [
        'features', 'discovery', 'mission', 'strategy',
        'backtest', 'audit', 'shadow', 'graduate', 'live'
    ]

    MODULES = [
        'raw_features', 'regime', 'sector_regime', 'domain_features',
        'momentum_logic', 'cross_asset', 'gamma_calc'
    ]

    def __init__(self, url: str = None, key: str = None):
        """
        Initialize tracker with Supabase credentials.

        Args:
            url: Supabase project URL (defaults to env var)
            key: Supabase service role key (defaults to env var)
        """
        self.url = url or os.environ.get("SUPABASE_URL")
        self.key = key or os.environ.get("SUPABASE_SERVICE_KEY")

        if not self.url or not self.key:
            logger.warning(
                "SUPABASE_URL or SUPABASE_SERVICE_KEY not set - pipeline tracking disabled"
            )
            self.client = None
            return

        try:
            from supabase import create_client, Client
            self.client: Client = create_client(self.url, self.key)
            logger.info("PipelineTracker initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            self.client = None

    def _is_enabled(self) -> bool:
        """Check if tracking is enabled."""
        return self.client is not None

    # =========================================================================
    # STAGE 1: FEATURE PIPELINE
    # =========================================================================

    def start_pipeline_run(
        self,
        symbols: List[str],
        run_type: str = 'daemon'
    ) -> Optional[str]:
        """
        Start tracking a feature pipeline run.

        Args:
            symbols: List of symbols being processed
            run_type: 'scheduled', 'manual', or 'daemon'

        Returns:
            Run ID if successful, None otherwise
        """
        if not self._is_enabled():
            return None

        payload = {
            "run_type": run_type,
            "status": "running",
            "symbols_requested": symbols,
            "symbols_completed": [],
            "symbols_failed": [],
        }

        try:
            result = self.client.table("pipeline_runs").insert(payload).execute()
            run_id = result.data[0]["id"]

            # Initialize module statuses - batch insert for efficiency
            module_statuses = [
                {"run_id": run_id, "module_name": module, "status": "pending"}
                for module in self.MODULES
            ]
            self.client.table("pipeline_module_status").insert(module_statuses).execute()

            logger.info(f"Started pipeline run {run_id} for {len(symbols)} symbols")
            return run_id
        except Exception as e:
            logger.error(f"Failed to start pipeline run: {e}")
            return None

    def update_module_status(
        self,
        run_id: str,
        module_name: str,
        status: str,
        features_calculated: int = 0,
        duration_ms: int = None,
        error_message: str = None
    ) -> bool:
        """
        Update status of a feature module within a run.

        Args:
            run_id: Pipeline run ID
            module_name: One of the 7 modules
            status: 'pending', 'running', 'completed', 'failed'
            features_calculated: Number of features calculated
            duration_ms: Time taken in milliseconds
            error_message: Error message if failed
        """
        if not self._is_enabled():
            return False

        try:
            self.client.table("pipeline_module_status").update({
                "status": status,
                "features_calculated": features_calculated,
                "duration_ms": duration_ms,
                "error_message": error_message,
            }).eq("run_id", run_id).eq("module_name", module_name).execute()

            logger.debug(f"Module {module_name} status: {status}")
            return True
        except Exception as e:
            logger.error(f"Failed to update module status: {e}")
            return False

    def complete_pipeline_run(
        self,
        run_id: str,
        success: bool,
        symbols_completed: List[str] = None,
        symbols_failed: List[str] = None,
        total_features: int = 0,
        duration_seconds: float = None,
        errors: List[Dict] = None
    ) -> bool:
        """
        Mark a pipeline run as complete.

        Args:
            run_id: Pipeline run ID
            success: Whether the run succeeded
            symbols_completed: Successfully processed symbols
            symbols_failed: Failed symbols
            total_features: Total features calculated
            duration_seconds: Total run duration
            errors: List of error dicts
        """
        if not self._is_enabled():
            return False

        try:
            self.client.table("pipeline_runs").update({
                "status": "completed" if success else "failed",
                "symbols_completed": symbols_completed or [],
                "symbols_failed": symbols_failed or [],
                "total_features_calculated": total_features,
                "duration_seconds": duration_seconds,
                "errors": errors or [],
            }).eq("id", run_id).execute()

            logger.info(f"Pipeline run {run_id} completed: {'success' if success else 'failed'}")
            return True
        except Exception as e:
            logger.error(f"Failed to complete pipeline run: {e}")
            return False

    # =========================================================================
    # STAGE 2: DISCOVERY
    # =========================================================================

    def record_discovery(
        self,
        event_type: str,
        symbol: str,
        confidence: float,
        details: Dict[str, Any],
        mission_created_id: str = None
    ) -> Optional[str]:
        """
        Record a discovery event from MorphologyScanner.

        Args:
            event_type: 'REGIME_TRANSITION', 'VOL_EXTREME', 'MOMENTUM_EXTREME',
                       'GAMMA_FLIP', 'SECTOR_ROTATION', 'CORRELATION_BREAK'
            symbol: Symbol the event relates to
            confidence: Confidence score 0-100
            details: Event-specific details
            mission_created_id: ID of mission if one was created

        Returns:
            Event ID if successful
        """
        if not self._is_enabled():
            return None

        payload = {
            "event_type": event_type,
            "symbol": symbol,
            "confidence": min(max(confidence, 0), 100),
            "details": details,
            "mission_created_id": mission_created_id,
        }

        try:
            result = self.client.table("discovery_events").insert(payload).execute()
            event_id = result.data[0]["id"]
            logger.info(f"Recorded discovery: {event_type} on {symbol} (conf: {confidence:.1f}%)")
            return event_id
        except Exception as e:
            logger.error(f"Failed to record discovery: {e}")
            return None

    # =========================================================================
    # STAGE 5: BACKTEST
    # =========================================================================

    def record_backtest_run(
        self,
        strategy_id: str,
        mission_id: str,
        start_date: str,
        end_date: str,
        initial_capital: float,
        results: Dict[str, Any]
    ) -> Optional[str]:
        """
        Record a backtest run and its results.

        Args:
            strategy_id: Strategy genome ID
            mission_id: Mission ID
            start_date: Backtest start date (YYYY-MM-DD)
            end_date: Backtest end date
            initial_capital: Starting capital
            results: Dict with total_return, sharpe_ratio, max_drawdown, etc.

        Returns:
            Backtest run ID if successful
        """
        if not self._is_enabled():
            return None

        # Determine if passed criteria
        sharpe = results.get('sharpe_ratio', 0)
        max_dd = results.get('max_drawdown', 1)
        trades = results.get('total_trades', 0)

        passed = sharpe > 1.0 and max_dd < 0.25 and trades >= 30
        failure_reasons = []
        if sharpe <= 1.0:
            failure_reasons.append(f"Sharpe {sharpe:.2f} < 1.0")
        if max_dd >= 0.25:
            failure_reasons.append(f"Max DD {max_dd:.1%} >= 25%")
        if trades < 30:
            failure_reasons.append(f"Trades {trades} < 30")

        payload = {
            "strategy_id": strategy_id,
            "mission_id": mission_id,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
            "status": "completed",
            "total_return": results.get('total_return'),
            "sharpe_ratio": sharpe,
            "max_drawdown": max_dd,
            "win_rate": results.get('win_rate'),
            "profit_factor": results.get('profit_factor'),
            "total_trades": trades,
            "passed_criteria": passed,
            "failure_reasons": failure_reasons if not passed else [],
            "full_metrics": results,
        }

        try:
            result = self.client.table("backtest_runs").insert(payload).execute()
            run_id = result.data[0]["id"]
            logger.info(f"Recorded backtest: Sharpe {sharpe:.2f}, DD {max_dd:.1%} - {'PASSED' if passed else 'FAILED'}")
            return run_id
        except Exception as e:
            logger.error(f"Failed to record backtest: {e}")
            return None

    # =========================================================================
    # STAGE 6: RED TEAM AUDIT
    # =========================================================================

    def record_red_team_audit(
        self,
        strategy_id: str,
        backtest_id: str,
        persona_scores: Dict[str, float],
        critical_issues: List[str] = None,
        warnings: List[str] = None,
        reasoning_chains: Dict[str, str] = None,
        duration_seconds: float = None
    ) -> Optional[str]:
        """
        Record a Red Team audit result.

        Args:
            strategy_id: Strategy genome ID
            backtest_id: Associated backtest run ID
            persona_scores: Dict with scores for each persona (0-100)
                Keys: liquidity_realist, macro_shock, overfitting_hunter,
                      fee_paranoid, correlation_saboteur, regime_blindspot
            critical_issues: List of critical issues found
            warnings: List of warnings
            reasoning_chains: Dict of persona -> reasoning text
            duration_seconds: How long the audit took

        Returns:
            Audit ID if successful
        """
        if not self._is_enabled():
            return None

        # Calculate overall score (average of all personas)
        scores = list(persona_scores.values())
        overall_score = sum(scores) / len(scores) if scores else 0

        # Pass if all personas score > 60
        is_passed = all(score > 60 for score in scores)

        payload = {
            "strategy_id": strategy_id,
            "backtest_id": backtest_id,
            "overall_score": overall_score,
            "is_passed": is_passed,
            "liquidity_realist_score": persona_scores.get('liquidity_realist'),
            "macro_shock_score": persona_scores.get('macro_shock'),
            "overfitting_hunter_score": persona_scores.get('overfitting_hunter'),
            "fee_paranoid_score": persona_scores.get('fee_paranoid'),
            "correlation_saboteur_score": persona_scores.get('correlation_saboteur'),
            "regime_blindspot_score": persona_scores.get('regime_blindspot'),
            "critical_issues": critical_issues or [],
            "warnings": warnings or [],
            "reasoning_chains": reasoning_chains or {},
            "duration_seconds": duration_seconds,
        }

        try:
            result = self.client.table("red_team_audits").insert(payload).execute()
            audit_id = result.data[0]["id"]
            logger.info(f"Recorded audit: Score {overall_score:.1f} - {'PASSED' if is_passed else 'FAILED'}")
            return audit_id
        except Exception as e:
            logger.error(f"Failed to record audit: {e}")
            return None

    # =========================================================================
    # STAGE 8: GRADUATION
    # =========================================================================

    def update_graduation_progress(
        self,
        strategy_id: str,
        strategy_name: str,
        total_trades: int,
        winning_trades: int,
        current_sharpe: float,
        max_drawdown: float,
        total_pnl: float
    ) -> bool:
        """
        Update graduation progress for a strategy in shadow trading.

        Args:
            strategy_id: Strategy genome ID
            strategy_name: Display name
            total_trades: Number of completed trades
            winning_trades: Number of winning trades
            current_sharpe: Current Sharpe ratio
            max_drawdown: Maximum drawdown experienced
            total_pnl: Total P&L

        Returns:
            True if successful
        """
        if not self._is_enabled():
            return False

        # Check requirements
        trades_met = total_trades >= 20
        sharpe_met = current_sharpe >= 1.0
        dd_met = max_drawdown < 0.15

        is_eligible = trades_met and sharpe_met and dd_met

        blocking_reasons = []
        if not trades_met:
            blocking_reasons.append(f"Need {20 - total_trades} more trades")
        if not sharpe_met:
            blocking_reasons.append(f"Sharpe {current_sharpe:.2f} < 1.0")
        if not dd_met:
            blocking_reasons.append(f"Drawdown {max_drawdown:.1%} >= 15%")

        payload = {
            "strategy_id": strategy_id,
            "strategy_name": strategy_name,
            "total_trades": total_trades,
            "winning_trades": winning_trades,
            "current_sharpe": current_sharpe,
            "max_drawdown": max_drawdown,
            "total_pnl": total_pnl,
            "trades_requirement_met": trades_met,
            "sharpe_requirement_met": sharpe_met,
            "drawdown_requirement_met": dd_met,
            "is_eligible": is_eligible,
            "blocking_reasons": blocking_reasons,
            "last_evaluated": datetime.now().isoformat(),
        }

        try:
            # Upsert on strategy_id
            self.client.table("graduation_progress").upsert(
                payload,
                on_conflict="strategy_id"
            ).execute()

            if is_eligible:
                logger.info(f"Strategy {strategy_name} ELIGIBLE for graduation!")
            else:
                logger.debug(f"Graduation progress updated for {strategy_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to update graduation progress: {e}")
            return False

    # =========================================================================
    # PIPELINE ITEMS & JOURNEY TRACKING
    # =========================================================================

    def create_pipeline_item(
        self,
        item_type: str,
        display_name: str,
        discovery_event_id: str = None,
        mission_id: str = None,
        strategy_id: str = None
    ) -> Optional[str]:
        """
        Create a pipeline item to track through stages.

        Args:
            item_type: 'opportunity' or 'strategy'
            display_name: Human-readable name
            discovery_event_id: Optional discovery event ID
            mission_id: Optional mission ID
            strategy_id: Optional strategy ID

        Returns:
            Pipeline item ID if successful
        """
        if not self._is_enabled():
            return None

        # Determine initial stage
        if discovery_event_id:
            current_stage = 'discovery'
        elif mission_id:
            current_stage = 'mission'
        elif strategy_id:
            current_stage = 'strategy'
        else:
            current_stage = 'features'

        payload = {
            "item_type": item_type,
            "display_name": display_name,
            "current_stage": current_stage,
            "discovery_event_id": discovery_event_id,
            "mission_id": mission_id,
            "strategy_id": strategy_id,
            "final_outcome": "in_progress",
        }

        try:
            result = self.client.table("pipeline_items").insert(payload).execute()
            item_id = result.data[0]["id"]
            logger.info(f"Created pipeline item: {display_name} at stage {current_stage}")
            return item_id
        except Exception as e:
            logger.error(f"Failed to create pipeline item: {e}")
            return None

    def transition_stage(
        self,
        item_id: str,
        from_stage: str,
        to_stage: str,
        success: bool = True,
        failure_reason: str = None,
        metadata: Dict = None
    ) -> bool:
        """
        Record a stage transition for a pipeline item.

        Args:
            item_id: Pipeline item ID
            from_stage: Source stage
            to_stage: Destination stage
            success: Whether transition was successful
            failure_reason: Reason if not successful
            metadata: Additional metadata
        """
        if not self._is_enabled():
            return False

        # Record the transition
        transition_payload = {
            "pipeline_item_id": item_id,
            "from_stage": from_stage,
            "to_stage": to_stage,
            "success": success,
            "failure_reason": failure_reason,
            "metadata": metadata or {},
        }

        # Update the item's current stage
        item_update = {
            "current_stage": to_stage,
            "stage_entered_at": datetime.now().isoformat(),
        }

        # If failed, update outcome
        if not success:
            outcome_map = {
                'backtest': 'failed_backtest',
                'audit': 'failed_audit',
                'shadow': 'failed_shadow',
            }
            item_update["final_outcome"] = outcome_map.get(to_stage, 'abandoned')

        try:
            self.client.table("stage_transitions").insert(transition_payload).execute()
            self.client.table("pipeline_items").update(item_update).eq("id", item_id).execute()

            logger.info(f"Transitioned item {item_id}: {from_stage} → {to_stage} ({'✓' if success else '✗'})")
            return True
        except Exception as e:
            logger.error(f"Failed to record transition: {e}")
            return False

    def complete_journey(
        self,
        item_id: str,
        outcome: str,
        final_stage: str = 'live'
    ) -> bool:
        """
        Mark a pipeline item's journey as complete.

        Args:
            item_id: Pipeline item ID
            outcome: 'graduated', 'abandoned', 'failed_backtest', etc.
            final_stage: The stage it ended at
        """
        if not self._is_enabled():
            return False

        try:
            self.client.table("pipeline_items").update({
                "current_stage": final_stage,
                "final_outcome": outcome,
                "journey_completed_at": datetime.now().isoformat(),
            }).eq("id", item_id).execute()

            logger.info(f"Journey completed for {item_id}: {outcome}")
            return True
        except Exception as e:
            logger.error(f"Failed to complete journey: {e}")
            return False


# =============================================================================
# SINGLETON & CONVENIENCE
# =============================================================================

_tracker: Optional[PipelineTracker] = None


def get_tracker() -> PipelineTracker:
    """Get or create singleton tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = PipelineTracker()
    return _tracker


# Convenience functions
def start_pipeline_run(symbols: List[str], run_type: str = 'daemon') -> Optional[str]:
    return get_tracker().start_pipeline_run(symbols, run_type)


def update_module_status(run_id: str, module: str, status: str, **kwargs) -> bool:
    return get_tracker().update_module_status(run_id, module, status, **kwargs)


def complete_pipeline_run(run_id: str, success: bool, **kwargs) -> bool:
    return get_tracker().complete_pipeline_run(run_id, success, **kwargs)


def record_discovery(event_type: str, symbol: str, confidence: float, details: Dict) -> Optional[str]:
    return get_tracker().record_discovery(event_type, symbol, confidence, details)


def record_backtest(strategy_id: str, mission_id: str, start: str, end: str, capital: float, results: Dict) -> Optional[str]:
    return get_tracker().record_backtest_run(strategy_id, mission_id, start, end, capital, results)


def record_audit(strategy_id: str, backtest_id: str, scores: Dict, **kwargs) -> Optional[str]:
    return get_tracker().record_red_team_audit(strategy_id, backtest_id, scores, **kwargs)


def track_graduation(strategy_id: str, name: str, trades: int, wins: int, sharpe: float, dd: float, pnl: float) -> bool:
    return get_tracker().update_graduation_progress(strategy_id, name, trades, wins, sharpe, dd, pnl)
