#!/usr/bin/env python3
"""
Train Exit Model

Trains an XGBoost classifier to predict optimal exit timing.
Target: 'should_exit' (1 if day_idx >= day_of_peak, else 0)
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
import joblib
from pathlib import Path
import json

def load_data(filepath):
    return pd.read_parquet(filepath)

def create_features_and_target(df):
    """Create features and target label."""
    
    # Target: We should exit if we are at or past the peak
    # But we only want to exit if the peak was actually profitable?
    # For now, let's just try to find the peak regardless of P&L magnitude.
    # Refinement: Only learn from "winning" trades? 
    # No, we need to learn to cut losers too.
    # For losers, "peak" is the "least bad" point (often day 0 or early).
    
    df['target'] = (df['days_until_peak'] <= 0).astype(int)
    
    features = [
        # Trade State
        'days_held', 'mtm_pnl', 'peak_so_far', 'dd_from_peak', 'pnl_change_1d',
        
        # Greeks
        'delta', 'gamma', 'theta', 'vega',
        
        # Market
        'spot', 'RV5', 'RV20', 'slope_MA20', 'ATR5'
    ]
    
    # Fill NaNs
    df[features] = df[features].fillna(0)
    
    return df, features

def main():
    # Config
    input_path = Path("data/processed/exit_training_data.parquet")
    model_dir = Path("models")
    model_dir.mkdir(exist_ok=True)
    
    # Load
    print("Loading data...")
    df = load_data(input_path)
    
    # Preprocess
    df['date'] = pd.to_datetime(df['date'])
    df['days_held'] = df['day_idx'] # Alias
    
    df, feature_cols = create_features_and_target(df)
    
    # Split by Date (Walk-Forward)
    train_mask = df['date'] < '2023-01-01'
    val_mask = (df['date'] >= '2023-01-01') & (df['date'] < '2024-01-01')
    test_mask = df['date'] >= '2024-01-01'
    
    X_train = df.loc[train_mask, feature_cols]
    y_train = df.loc[train_mask, 'target']
    
    X_val = df.loc[val_mask, feature_cols]
    y_val = df.loc[val_mask, 'target']
    
    X_test = df.loc[test_mask, feature_cols]
    y_test = df.loc[test_mask, 'target']
    
    print(f"Train size: {len(X_train)}")
    print(f"Val size: {len(X_val)}")
    print(f"Test size: {len(X_test)}")
    
    # Train
    print("Training XGBoost...")
    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        objective='binary:logistic',
        eval_metric='auc',
        early_stopping_rounds=10,
        random_state=42
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=True
    )
    
    # Evaluate
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    
    acc = accuracy_score(y_test, y_pred)
    auc = roc_auc_score(y_test, y_prob)
    
    print(f"\nTest Results:")
    print(f"Accuracy: {acc:.4f}")
    print(f"AUC: {auc:.4f}")
    
    # Feature Importance
    importance = pd.DataFrame({
        'feature': feature_cols,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    print("\nTop 5 Features:")
    print(importance.head(5))
    
    # Save
    model_path = model_dir / "exit_model_v1.json"
    print(f"\nSaving model to {model_path}...")
    model.save_model(model_path)
    
    # Save feature list for inference
    with open(model_dir / "model_features.json", 'w') as f:
        json.dump(feature_cols, f)
        
    print("Done.")

if __name__ == "__main__":
    main()
