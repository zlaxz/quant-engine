#!/usr/bin/env python3
"""
Verify Quant Engine Installation
Run this from the python/ directory to check imports work correctly.
"""

import sys
import os

# Ensure we are running from the python/ directory
if not os.path.exists('engine'):
    print("Error: Run this from the python/ directory")
    sys.exit(1)

print("Verifying Quant Engine Imports...")
errors = []

# Test 1: Engine package
try:
    import engine
    print("[OK] Package 'engine' found")
except ImportError as e:
    errors.append(f"engine package: {e}")
    print(f"[FAIL] engine package: {e}")

# Test 2: RegimeEngine (core analysis)
try:
    from engine.analysis.regime_engine import RegimeEngine
    print("[OK] RegimeEngine imported successfully")
except ImportError as e:
    errors.append(f"RegimeEngine: {e}")
    print(f"[FAIL] RegimeEngine: {e}")

# Test 3: TradeSimulator (core trading)
try:
    from engine.trading.simulator import TradeSimulator
    print("[OK] TradeSimulator imported successfully")
except ImportError as e:
    errors.append(f"TradeSimulator: {e}")
    print(f"[FAIL] TradeSimulator: {e}")

# Test 4: Data loaders
try:
    from engine.data.loaders import load_spy_data
    print("[OK] load_spy_data imported successfully")
except ImportError as e:
    errors.append(f"load_spy_data: {e}")
    print(f"[FAIL] load_spy_data: {e}")

# Test 5: Greeks pricing
try:
    from engine.pricing.greeks import calculate_all_greeks
    print("[OK] calculate_all_greeks imported successfully")
except ImportError as e:
    errors.append(f"calculate_all_greeks: {e}")
    print(f"[FAIL] calculate_all_greeks: {e}")

# Test 6: Workers
try:
    from workers.deep_validator import DeepValidationWorker
    print("[OK] DeepValidationWorker imported successfully")
except ImportError as e:
    errors.append(f"DeepValidationWorker: {e}")
    print(f"[FAIL] DeepValidationWorker: {e}")

# Summary
print("\n" + "=" * 50)
if not errors:
    print("SMOKE TEST PASSED: The Monorepo is wired correctly.")
else:
    print(f"SMOKE TEST FAILED: {len(errors)} import(s) failed")
    print("\nTip: Ensure you have __init__.py in:")
    print("  - python/")
    print("  - python/engine/")
    print("  - python/workers/")
    print("  - All subdirectories of python/engine/")
