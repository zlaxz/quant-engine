"""
AI Exit Strategy

Uses trained XGBoost model to predict optimal exit timing.
"""

import pandas as pd
import numpy as np
import xgboost as xgb
import json
from pathlib import Path
from typing import Dict, Optional
from .trade import Trade

class AIExitStrategy:
    """
    AI-powered exit strategy.
    Predicts 'should_exit' (1) or 'hold' (0) based on trained model.
    """
    
    def __init__(self, model_path: str, feature_path: str, threshold: float = 0.5):
        """
        Initialize AI Exit Strategy.
        
        Args:
            model_path: Path to saved XGBoost model
            feature_path: Path to saved feature list JSON
            threshold: Probability threshold for exit (default 0.5)
        """
        self.model = xgb.Booster()
        self.model.load_model(model_path)
        
        with open(feature_path, 'r') as f:
            self.features = json.load(f)
            
        self.threshold = threshold
        
    def should_exit(self, trade: Trade, market_data: pd.Series, current_greeks: Dict) -> bool:
        """
        Determine if trade should be exited.
        
        Args:
            trade: Current trade object
            market_data: Current daily market data row
            current_greeks: Dictionary of current position Greeks
            
        Returns:
            True if model predicts exit, False otherwise
        """
        # 1. Construct feature vector
        # We need to reconstruct the features used during training
        
        # Calculate P&L state
        # Note: In live simulation, we need to track peak_so_far.
        # The Trade object might not have this, so we might need to calculate it 
        # or rely on the Simulator to pass it.
        # For now, let's assume the Trade object has been updated with daily stats 
        # OR we calculate it here if possible.
        
        # Actually, the Simulator tracks MTM. 
        # We might need to update the Simulator to pass this state.
        # Let's assume for now we can get it from the trade metadata if we add it there.
        
        mtm_pnl = trade.metadata.get('mtm_pnl', 0.0)
        peak_so_far = trade.metadata.get('peak_pnl', 0.0)
        
        if peak_so_far == 0:
            dd_from_peak = 0
        else:
            dd_from_peak = mtm_pnl - peak_so_far
            
        # Days held
        days_held = (pd.to_datetime(market_data['date']) - pd.to_datetime(trade.entry_date)).days
        
        # Construct row
        row = {
            'days_held': days_held,
            'mtm_pnl': mtm_pnl,
            'peak_so_far': peak_so_far,
            'dd_from_peak': dd_from_peak,
            'pnl_change_1d': trade.metadata.get('pnl_change_1d', 0.0), # Needs tracking
            
            # Greeks
            'delta': current_greeks.get('delta', 0),
            'gamma': current_greeks.get('gamma', 0),
            'theta': current_greeks.get('theta', 0),
            'vega': current_greeks.get('vega', 0),
            
            # Market
            'spot': market_data['close'],
            'RV5': market_data.get('RV5', 0),
            'RV20': market_data.get('RV20', 0),
            'slope_MA20': market_data.get('slope_MA20', 0),
            'ATR5': market_data.get('ATR5', 0)
        }
        
        # Convert to DMatrix
        # Ensure order matches training features
        feature_values = []
        for f in self.features:
            feature_values.append(row.get(f, 0.0))
            
        dtest = xgb.DMatrix([feature_values], feature_names=self.features)
        
        # Predict
        prob = self.model.predict(dtest)[0]
        
        return prob > self.threshold
