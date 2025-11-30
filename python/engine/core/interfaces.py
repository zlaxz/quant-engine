#!/usr/bin/env python3
"""
Quant Module Interface
======================
Abstract base class for all dynamically loaded analysis plugins.

All plugins in engine/plugins/ must implement this interface.

Usage:
    from engine.core.interfaces import QuantModule

    class MyAnalysis(QuantModule):
        name = "my_analysis"
        description = "Does something useful"

        def run(self, data: pd.DataFrame, params: dict) -> dict:
            # Your analysis logic here
            return {'result': 'value'}
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
import pandas as pd


class QuantModule(ABC):
    """
    Abstract base class for all Quant Engine plugins.

    Plugins are dynamically discovered and loaded from engine/plugins/.
    Each plugin must:
    1. Inherit from QuantModule
    2. Define class attributes: name, description
    3. Implement the run() method

    Attributes:
        name (str): Unique identifier for the plugin (used in API routes)
        description (str): Human-readable description
        version (str): Plugin version (default "1.0.0")
        author (str): Plugin author (default "Chief Quant")
        required_columns (List[str]): DataFrame columns required for run()
    """

    # Required class attributes (must be overridden)
    name: str = ""
    description: str = ""

    # Optional class attributes
    version: str = "1.0.0"
    author: str = "Chief Quant"
    required_columns: List[str] = []

    @abstractmethod
    def run(self, data: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute the analysis on the provided data.

        Args:
            data: DataFrame with market data. Guaranteed to have columns
                  specified in required_columns.
            params: Optional parameters for the analysis. Plugin-specific.

        Returns:
            JSON-serializable dict with analysis results.
            Must include at minimum:
            {
                'success': True/False,
                'plugin': self.name,
                'result': <analysis output>
            }

        Raises:
            ValueError: If data doesn't meet requirements
            Exception: Any analysis-specific errors (will be caught by API)
        """
        pass

    def validate_data(self, data: pd.DataFrame) -> bool:
        """
        Validate that DataFrame has required columns.

        Args:
            data: DataFrame to validate

        Returns:
            True if valid, raises ValueError otherwise
        """
        if data is None or len(data) == 0:
            raise ValueError("Empty or None DataFrame provided")

        missing = [col for col in self.required_columns if col not in data.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        return True

    def get_info(self) -> Dict[str, Any]:
        """
        Get plugin metadata.

        Returns:
            Dict with plugin information for discovery endpoint
        """
        return {
            'name': self.name,
            'description': self.description,
            'version': self.version,
            'author': self.author,
            'required_columns': self.required_columns
        }

    def __repr__(self) -> str:
        return f"<QuantModule:{self.name} v{self.version}>"
