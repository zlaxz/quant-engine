#!/usr/bin/env python3
"""
Diagnose Missed Peaks

Investigate why the AI Exit Engine is missing the "Peak Potential".
1. Runs Profile 4 (VANNA) simulation.
2. Tracks "Perfect Peak" (max P&L during trade) vs "AI Exit".
3. Logs model probabilities around the peak.
4. Identifies "Missed Opportunities" (High Peak, Low Exit).
"""

import pandas as pd
import numpy as np
import sys
from datetime import datetime
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.trading.simulator import TradeSimulator, SimulationConfig
from src.trading.ai_exit_strategy import AIExitStrategy
from src.data.loaders import load_spy_data
from src.profiles.detectors import get_profile_scores
from src.trading.profiles.profile_4 import Profile4Vanna

def analyze_missed_peaks():
    # 1. Load Data
    print("Loading data...")
    data = load_spy_data(
        start_date=datetime(2020, 1, 1),
        end_date=datetime(2024, 12, 31),
        include_regimes=True
    )
    
    print("Computing scores...")
    # Fix: Get scores and assign directly, don't merge if it causes duplication/renaming issues
    # But wait, load_spy_data returns a DF. get_profile_scores returns a DF with scores.
    # The issue in backtest_ai_exit.py was that get_profile_scores returned the FULL df.
    # Let's check get_profile_scores again.
    # Ah, in detectors.py: "df = df.copy() ... return df". It returns the full DF.
    # So we should just do:
    data = get_profile_scores(data)
    
    # Rename for Profile 4
    data = data.rename(columns={'profile_4_VANNA': 'profile_4_score'})
    
    # Ensure 'close' column exists (handle case sensitivity if needed)
    if 'close' not in data.columns and 'Close' in data.columns:
        data['close'] = data['Close']
    
    # 2. Load Model
    print("Loading AI model...")
    ai_strategy = AIExitStrategy(
        model_path="models/exit_model_v1.json",
        feature_path="models/model_features.json",
        threshold=0.55
    )
    
    # 3. Setup Simulation Loop
    from src.trading.profiles.profile_1 import Profile1LongDatedGamma
    from src.trading.profiles.profile_2 import Profile2ShortDatedGamma
    from src.trading.profiles.profile_3 import Profile3CharmDecay
    from src.trading.profiles.profile_4 import Profile4Vanna
    from src.trading.profiles.profile_5 import Profile5SkewConvexity
    from src.trading.profiles.profile_6 import Profile6VolOfVol
    
    profiles = [
        ('Profile_1_LDG', Profile1LongDatedGamma, 'profile_1_score'),
        ('Profile_2_SDG', Profile2ShortDatedGamma, 'profile_2_score'),
        ('Profile_3_CHARM', Profile3CharmDecay, 'profile_3_score'),
        ('Profile_4_VANNA', Profile4Vanna, 'profile_4_score'),
        ('Profile_5_SKEW', Profile5SkewConvexity, 'profile_5_score'),
        ('Profile_6_VOV', Profile6VolOfVol, 'profile_6_score')
    ]
    
    # Rename columns for all profiles
    rename_map = {
        'profile_1_LDG': 'profile_1_score',
        'profile_2_SDG': 'profile_2_score',
        'profile_3_CHARM': 'profile_3_score',
        'profile_4_VANNA': 'profile_4_score',
        'profile_5_SKEW': 'profile_5_score',
        'profile_6_VOV': 'profile_6_score'
    }
    data = data.rename(columns=rename_map)
    
    grand_total_potential = 0.0
    grand_total_realized = 0.0
    
    for name, cls, score_col in profiles:
        print(f"\nAnalyzing {name}...")
        try:
            profile = cls(score_threshold=0.5) # Standard threshold
        except:
            continue
            
        config = SimulationConfig(max_days_in_trade=120, max_loss_pct=0.50)
        simulator = TradeSimulator(data, config=config, use_real_options_data=True)
        
        results = simulator.simulate(
            entry_logic=profile.entry_logic,
            trade_constructor=profile.trade_constructor,
            exit_strategy=ai_strategy,
            profile_name=name
        )
        
        # Analyze
        p_potential = 0.0
        p_realized = 0.0
        
        for trade in simulator.trades:
            peak = trade.metadata.get('peak_pnl', -9999)
            if peak > 0:
                p_potential += peak
            p_realized += trade.realized_pnl
            
        print(f"  Potential: ${p_potential:,.2f}")
        print(f"  Realized:  ${p_realized:,.2f}")
        
        grand_total_potential += p_potential
        grand_total_realized += p_realized
        
    print(f"\n=== GRAND TOTAL ===")
    print(f"Total Peak Potential: ${grand_total_potential:,.2f}")
    print(f"Total Realized P&L:   ${grand_total_realized:,.2f}")

if __name__ == "__main__":
    analyze_missed_peaks()
