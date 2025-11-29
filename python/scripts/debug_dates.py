#!/usr/bin/env python3
"""Debug date format issues."""

import sys
from pathlib import Path
from datetime import datetime
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent / 'src'))

from data import DataSpine
from regimes import RegimeClassifier

# Load data
spine = DataSpine()
spy_data = spine.build_spine(
    start_date=datetime(2020, 1, 1),
    end_date=datetime(2020, 4, 30)
)

print("Data info:")
print(spy_data.info())
print("\nFirst few dates:")
print(spy_data[['date', 'close']].head())
print("\nDate dtype:", spy_data['date'].dtype)

# Check specific date
target_date = pd.to_datetime('2020-03-16')
print(f"\nLooking for {target_date}...")
mask = spy_data['date'] == target_date
print(f"Found: {mask.any()}")

if mask.any():
    print("Match!")
else:
    print("No match - checking alternatives...")
    # Try as date object
    target_date_obj = target_date.date()
    mask2 = spy_data['date'] == target_date_obj
    print(f"  As date(): {mask2.any()}")

    # Show closest dates
    print("\nClosest dates in data:")
    closest = spy_data[
        (spy_data['date'] >= pd.to_datetime('2020-03-10')) &
        (spy_data['date'] <= pd.to_datetime('2020-03-20'))
    ]
    print(closest[['date', 'close']])
