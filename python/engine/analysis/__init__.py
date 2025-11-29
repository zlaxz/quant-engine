"""Analysis module for performance metrics and visualization."""

# Using custom metrics.py (fixed and verified in Rounds 1-3)
# empyrical library incompatible with Python 3.14 (abandonware)
# Custom implementation audited and working
from .metrics import PerformanceMetrics
from .visualization import PortfolioVisualizer

__all__ = [
    'PerformanceMetrics',
    'PortfolioVisualizer'
]
