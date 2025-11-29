"""Debug script to understand why allocations are zero."""

import pandas as pd
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'src'))

from data.loaders import load_spy_data
from profiles.detectors import ProfileDetectors
from backtest.rotation import RotationAllocator, REGIME_COMPATIBILITY

# Load data
print("Loading data...")
data = load_spy_data()
data = data[data['date'] >= pd.to_datetime('2020-01-01').date()]
data = data[data['date'] <= pd.to_datetime('2020-01-31').date()]  # Just January 2020

print(f"Loaded {len(data)} days")

# Compute profile scores
print("\nComputing profile scores...")
detector = ProfileDetectors()
data_with_scores = detector.compute_all_profiles(data)

# Check profile scores
print("\nProfile scores (first 5 days):")
profile_cols = [col for col in data_with_scores.columns if 'profile_' in col and any(x in col for x in ['LDG', 'SDG', 'CHARM', 'VANNA', 'SKEW', 'VOV'])]
print(data_with_scores[['date', 'regime'] + profile_cols].head())

# Check allocation
print("\nTesting allocator...")
allocator = RotationAllocator()

# Take a specific day
test_day = data_with_scores.iloc[10]
regime = int(test_day['regime'])
rv20 = test_day['RV20']

print(f"\nTest day: {test_day['date']}")
print(f"Regime: {regime}")
print(f"RV20: {rv20:.4f}")

# Extract profile scores
profile_scores = {
    'profile_1': test_day['profile_1_LDG'],
    'profile_2': test_day['profile_2_SDG'],
    'profile_3': test_day['profile_3_CHARM'],
    'profile_4': test_day['profile_4_VANNA'],
    'profile_5': test_day['profile_5_SKEW'],
    'profile_6': test_day['profile_6_VOV']
}

print("\nProfile scores:")
for profile, score in profile_scores.items():
    print(f"  {profile}: {score:.4f}")

# Calculate desirability
print(f"\nRegime compatibility for Regime {regime}:")
for profile, compat in REGIME_COMPATIBILITY[regime].items():
    print(f"  {profile}: {compat:.2f}")

desirability = allocator.calculate_desirability(profile_scores, regime)

print("\nDesirability scores:")
for profile, desire in desirability.items():
    print(f"  {profile}: {desire:.4f}")

# Calculate weights
weights = allocator.allocate(profile_scores, regime, rv20)

print("\nFinal weights:")
for profile, weight in weights.items():
    print(f"  {profile}: {weight:.4f}")
