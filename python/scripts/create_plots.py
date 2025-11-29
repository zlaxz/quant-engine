#!/usr/bin/env python3
"""Create regime validation plots."""

import sys
from pathlib import Path
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, str(Path(__file__).parent / 'src'))

from data import DataSpine
from regimes import RegimeClassifier
from regimes.validator import RegimeValidator

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt

print("Loading data and classifying regimes...")
spine = DataSpine()
spy_data = spine.build_spine(
    start_date=datetime(2020, 1, 1),
    end_date=datetime(2024, 12, 31)
)

classifier = RegimeClassifier()
df_classified = classifier.classify_period(spy_data)

stats = classifier.compute_regime_statistics(df_classified)
validator = RegimeValidator()

print("\nGenerating plots...")

# Plot 1: Regime bands 2020-2024
print("  - Regime bands (full period 2020-2024)...")
fig1 = validator.plot_regime_bands(df_classified,
                                   start_date='2020-01-01',
                                   end_date='2024-12-31')
fig1.savefig('regime_bands_2020_2024.png', dpi=150, bbox_inches='tight')
plt.close(fig1)

# Plot 2: Regime bands 2020 only (COVID crash)
print("  - Regime bands (2020 - COVID crash)...")
fig2 = validator.plot_regime_bands(df_classified,
                                   start_date='2020-01-01',
                                   end_date='2020-12-31')
fig2.savefig('regime_bands_2020.png', dpi=150, bbox_inches='tight')
plt.close(fig2)

# Plot 3: Regime bands 2022 (bear market)
print("  - Regime bands (2022 - bear market)...")
fig3 = validator.plot_regime_bands(df_classified,
                                   start_date='2022-01-01',
                                   end_date='2022-12-31')
fig3.savefig('regime_bands_2022.png', dpi=150, bbox_inches='tight')
plt.close(fig3)

# Plot 4: Regime statistics
print("  - Regime statistics...")
fig4 = validator.plot_regime_statistics(stats)
fig4.savefig('regime_statistics.png', dpi=150, bbox_inches='tight')
plt.close(fig4)

print("\n✅ Plots saved:")
print("   - regime_bands_2020_2024.png")
print("   - regime_bands_2020.png")
print("   - regime_bands_2022.png")
print("   - regime_statistics.png")
