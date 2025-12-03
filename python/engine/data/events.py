#!/usr/bin/env python3
"""
Event Horizon - Macro Event Risk Filter
========================================
THE THREAT: Your algo finds a "perfect" setup on SPY. Two minutes later,
the Fed Chair speaks or CPI drops. The market gaps 2% against you.

A Guardian does not gamble on binary events.

This module blocks new entries (and optionally tightens stops) during
"Red Folder" economic events like FOMC, CPI, NFP, etc.
"""

import os
import csv
import pandas as pd
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Tuple, List, Optional
import logging

logger = logging.getLogger(__name__)

DEFAULT_EVENT_FILE = Path(__file__).resolve().parent / "event_calendar.csv"


# ============================================================
# LEGACY FUNCTION - Keep for backward compatibility
# ============================================================

def load_event_dates(file_path: Optional[Path] = None) -> List[date]:
    """
    Load event dates from the default calendar CSV.

    Returns a list of python ``date`` objects that can be fed into
    ``RegimeSignals.add_event_flags`` / ``RegimeClassifier``.
    """
    path = Path(file_path) if file_path else DEFAULT_EVENT_FILE
    if not path.exists():
        return []

    event_dates: List[date] = []
    with path.open(newline='') as handle:
        reader = csv.DictReader(line for line in handle if line.strip())
        for row in reader:
            try:
                dt = datetime.strptime(row['date'], "%Y-%m-%d").date()
                event_dates.append(dt)
            except (ValueError, KeyError) as e:
                logging.warning(f"Failed to parse event date from row: {e}")
                continue

    return event_dates


# ============================================================
# EVENT RISK MANAGER - The Guardian's Macro Awareness
# ============================================================

class EventRiskManager:
    """
    Manages macro event risk by detecting when we're near high-impact events.

    Usage:
        event_mgr = EventRiskManager()
        is_risky, reason = event_mgr.is_high_risk_window(current_time)
        if is_risky:
            return None  # Trade rejected
    """

    # High-impact events (RED FOLDER) - these can move markets 1-3%
    RED_FOLDER_EVENTS = [
        'FOMC',           # Federal Reserve meetings
        'CPI',            # Consumer Price Index
        'NFP',            # Non-Farm Payrolls (Jobs Report)
        'PCE',            # Personal Consumption Expenditures
        'GDP',            # GDP releases
        'RETAIL_SALES',   # Retail Sales
        'ISM',            # ISM Manufacturing/Services
        'JOBLESS_CLAIMS', # Weekly jobless claims (Thursday)
    ]

    # Medium-impact events (YELLOW FOLDER) - can move 0.5-1%
    YELLOW_FOLDER_EVENTS = [
        'FED_SPEECH',     # Fed officials speaking
        'EARNINGS_SPY',   # Major SPY component earnings
        'HOUSING',        # Housing data
        'CONSUMER_CONF',  # Consumer confidence
    ]

    def __init__(self, calendar_path: Optional[str] = None):
        """
        Initialize the EventRiskManager.

        Args:
            calendar_path: Path to CSV with columns [timestamp, event_name, impact_level]
                          If None, uses embedded 2024-2025 calendar
        """
        self.calendar = self._load_calendar(calendar_path)
        self._cache_time = None
        self._cache_result = None

    def _load_calendar(self, calendar_path: Optional[str]) -> pd.DataFrame:
        """Load event calendar from file or use embedded defaults."""
        if calendar_path and os.path.exists(calendar_path):
            try:
                df = pd.read_csv(calendar_path, parse_dates=['timestamp'])
                logger.info(f"Loaded {len(df)} events from {calendar_path}")
                return df
            except Exception as e:
                logger.warning(f"Failed to load calendar from {calendar_path}: {e}")

        # Try the legacy format from DEFAULT_EVENT_FILE
        if DEFAULT_EVENT_FILE.exists():
            try:
                dates = load_event_dates()
                if dates:
                    # Convert to new format
                    events = []
                    for d in dates:
                        events.append({
                            'timestamp': pd.Timestamp(d),
                            'event_name': 'MACRO_EVENT',
                            'impact_level': 'RED'
                        })
                    return pd.DataFrame(events)
            except Exception as e:
                logger.warning(f"Failed to load legacy calendar: {e}")

        # Embedded 2024-2025 key dates (FOMC meetings + major releases)
        # This is a fallback - in production, load from external source
        events = [
            # 2024 FOMC Meetings (announcement dates, 2:00 PM ET)
            ('2024-01-31 14:00:00', 'FOMC', 'RED'),
            ('2024-03-20 14:00:00', 'FOMC', 'RED'),
            ('2024-05-01 14:00:00', 'FOMC', 'RED'),
            ('2024-06-12 14:00:00', 'FOMC', 'RED'),
            ('2024-07-31 14:00:00', 'FOMC', 'RED'),
            ('2024-09-18 14:00:00', 'FOMC', 'RED'),
            ('2024-11-07 14:00:00', 'FOMC', 'RED'),
            ('2024-12-18 14:00:00', 'FOMC', 'RED'),
            # 2025 FOMC Meetings
            ('2025-01-29 14:00:00', 'FOMC', 'RED'),
            ('2025-03-19 14:00:00', 'FOMC', 'RED'),
            ('2025-05-07 14:00:00', 'FOMC', 'RED'),
            ('2025-06-18 14:00:00', 'FOMC', 'RED'),
            ('2025-07-30 14:00:00', 'FOMC', 'RED'),
            ('2025-09-17 14:00:00', 'FOMC', 'RED'),
            ('2025-11-05 14:00:00', 'FOMC', 'RED'),
            ('2025-12-17 14:00:00', 'FOMC', 'RED'),
            # Sample CPI dates (8:30 AM ET, monthly)
            ('2024-12-11 08:30:00', 'CPI', 'RED'),
            ('2025-01-15 08:30:00', 'CPI', 'RED'),
            ('2025-02-12 08:30:00', 'CPI', 'RED'),
            ('2025-03-12 08:30:00', 'CPI', 'RED'),
            # Sample NFP dates (8:30 AM ET, first Friday)
            ('2024-12-06 08:30:00', 'NFP', 'RED'),
            ('2025-01-10 08:30:00', 'NFP', 'RED'),
            ('2025-02-07 08:30:00', 'NFP', 'RED'),
            ('2025-03-07 08:30:00', 'NFP', 'RED'),
        ]

        df = pd.DataFrame(events, columns=['timestamp', 'event_name', 'impact_level'])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        logger.info(f"Using embedded calendar with {len(df)} events")
        return df

    def is_high_risk_window(
        self,
        current_time: datetime,
        buffer_minutes_before: int = 30,
        buffer_minutes_after: int = 60
    ) -> Tuple[bool, str]:
        """
        Check if current time is within a high-risk event window.

        Args:
            current_time: The time to check
            buffer_minutes_before: Minutes before event to start blocking
            buffer_minutes_after: Minutes after event to continue blocking

        Returns:
            (is_risky, reason): Tuple of boolean and explanation string
        """
        if self.calendar.empty:
            return False, "CLEAR - No event calendar loaded"

        # Convert to pandas Timestamp for comparison
        check_time = pd.Timestamp(current_time)

        # Find events within the window
        before_buffer = timedelta(minutes=buffer_minutes_before)
        after_buffer = timedelta(minutes=buffer_minutes_after)

        for _, event in self.calendar.iterrows():
            event_time = event['timestamp']

            # Check if we're in the danger zone
            window_start = event_time - before_buffer
            window_end = event_time + after_buffer

            if window_start <= check_time <= window_end:
                event_name = event['event_name']
                impact = event.get('impact_level', 'RED')

                time_to_event = (event_time - check_time).total_seconds() / 60

                if time_to_event > 0:
                    position = f"T-{abs(time_to_event):.0f}m"
                else:
                    position = f"T+{abs(time_to_event):.0f}m"

                return True, f"HIGH RISK [{impact}]: {event_name} {position}"

        return False, "CLEAR"

    def get_upcoming_events(
        self,
        current_time: datetime,
        hours_ahead: int = 24
    ) -> List[dict]:
        """
        Get list of upcoming events within the specified window.

        Args:
            current_time: The current time
            hours_ahead: How many hours ahead to look

        Returns:
            List of event dictionaries with time until and details
        """
        if self.calendar.empty:
            return []

        check_time = pd.Timestamp(current_time)
        window_end = check_time + timedelta(hours=hours_ahead)

        upcoming = []
        for _, event in self.calendar.iterrows():
            event_time = event['timestamp']

            if check_time <= event_time <= window_end:
                time_until = (event_time - check_time).total_seconds() / 60
                upcoming.append({
                    'event_name': event['event_name'],
                    'timestamp': event_time.isoformat(),
                    'impact_level': event.get('impact_level', 'RED'),
                    'minutes_until': round(time_until),
                    'hours_until': round(time_until / 60, 1)
                })

        # Sort by time
        upcoming.sort(key=lambda x: x['minutes_until'])
        return upcoming

    def should_tighten_stops(
        self,
        current_time: datetime,
        hours_to_event: float = 2.0
    ) -> Tuple[bool, str]:
        """
        Check if we should tighten stops due to upcoming event.

        This is more lenient than entry blocking - we don't exit positions
        but we do reduce risk by tightening stops.

        Args:
            current_time: Current time
            hours_to_event: Hours before event to start tightening

        Returns:
            (should_tighten, reason)
        """
        upcoming = self.get_upcoming_events(current_time, hours_ahead=int(hours_to_event + 1))

        for event in upcoming:
            if event['hours_until'] <= hours_to_event:
                return True, f"Tighten stops: {event['event_name']} in {event['hours_until']}h"

        return False, "Normal stop levels"


# Module-level singleton
_event_manager_instance: Optional[EventRiskManager] = None


def get_event_manager(calendar_path: Optional[str] = None) -> EventRiskManager:
    """Get or create the EventRiskManager singleton."""
    global _event_manager_instance
    if _event_manager_instance is None:
        _event_manager_instance = EventRiskManager(calendar_path)
    return _event_manager_instance
