"""
Utilities for loading the event calendar used by the regime classifier.
"""

import csv
from datetime import datetime, date
from pathlib import Path
from typing import List, Optional

DEFAULT_EVENT_FILE = Path(__file__).resolve().parent / "event_calendar.csv"


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
            except Exception:
                continue

    return event_dates
