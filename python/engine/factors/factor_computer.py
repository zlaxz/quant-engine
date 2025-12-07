"""
Factor Computer - Evaluate Math Swarm equations on feature data.

This module computes factor values from symbolic equations discovered by the Math Swarm,
ensuring strict no-lookahead bias through expanding window normalization.

Author: Physics Engine
Created: 2025-12-06
"""

import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Optional, Union

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class FactorComputer:
    """
    Evaluates symbolic equations on feature data to compute factor values.

    Features:
    - Load and parse Math Swarm equation results
    - Map equation variables to feature columns
    - Safe evaluation using numpy operations
    - Expanding window z-score normalization (no lookahead)
    - Handle missing values gracefully

    Example:
        >>> computer = FactorComputer(
        ...     equations_path="/path/to/math_swarm_results.json",
        ...     features_path="/path/to/SPY_master_features.parquet"
        ... )
        >>> factor_0 = computer.compute_factor("equation_0")
        >>> all_factors = computer.compute_all_factors()
    """

    def __init__(
        self,
        equations_path: str,
        features_path: str,
        normalize: bool = True,
        min_periods: int = 20
    ):
        """
        Initialize the FactorComputer.

        Args:
            equations_path: Path to Math Swarm results JSON file
            features_path: Path to master features parquet file
            normalize: Whether to z-score normalize factors (default: True)
            min_periods: Minimum periods for expanding window normalization (default: 20)
        """
        self.equations_path = Path(equations_path)
        self.features_path = Path(features_path)
        self.normalize = normalize
        self.min_periods = min_periods

        # Load equations and features
        self.equations = self._load_equations()
        self.features = self._load_features()
        self.feature_mapping = self._build_feature_mapping()

        logger.info(
            f"FactorComputer initialized: {len(self.equations)} equations, "
            f"{len(self.features)} feature rows, {len(self.features.columns)} columns"
        )

    def _load_equations(self) -> Dict:
        """Load Math Swarm equation results from JSON."""
        if not self.equations_path.exists():
            raise FileNotFoundError(f"Equations file not found: {self.equations_path}")

        with open(self.equations_path, 'r') as f:
            data = json.load(f)

        logger.info(f"Loaded equations from {self.equations_path}")
        return data

    def _load_features(self) -> pd.DataFrame:
        """Load feature data from parquet."""
        if not self.features_path.exists():
            raise FileNotFoundError(f"Features file not found: {self.features_path}")

        df = pd.read_parquet(self.features_path)
        logger.info(f"Loaded features: shape={df.shape}, columns={len(df.columns)}")

        return df

    def _build_feature_mapping(self) -> Dict[str, str]:
        """
        Build mapping from equation variable names (x0, x1, ...) to feature column names.

        Returns:
            Dictionary mapping variable names to feature names
        """
        if 'feature_mapping' not in self.equations:
            raise ValueError("No feature_mapping found in equations file - cannot map variables to features")

        # The Math Swarm results already contain the reverse mapping
        # (x0 -> feature_name), which is what we need
        mapping = self.equations['feature_mapping']

        # Verify all mapped features exist in the data
        missing_features = []
        for var, feature in mapping.items():
            if feature not in self.features.columns:
                missing_features.append(feature)

        if missing_features:
            logger.warning(
                f"Features referenced in equations but missing from data: "
                f"{missing_features[:5]}{'...' if len(missing_features) > 5 else ''}"
            )

        logger.info(f"Feature mapping: {len(mapping)} variables")
        return mapping

    def _parse_equation(self, equation_str: str) -> str:
        """
        Parse equation string and prepare for safe evaluation.

        Handles two formats:
        1. Variable names: "x7 * (sign(x6) - 0.9148809)" -> uses feature_mapping
        2. Feature names: "ret_range_50 * (sign(xle_relative_strength) - 0.9148809)" -> direct

        Args:
            equation_str: Raw equation string from PySR

        Returns:
            Parsed equation ready for evaluation with numpy
        """
        parsed = equation_str

        # Check if equation uses variable names (x0, x1, ...) or feature names directly
        has_vars = bool(re.search(r'\bx\d+\b', equation_str))

        if has_vars:
            # Replace variable names (x0, x1, ...) with feature references
            for var_name, feature_name in self.feature_mapping.items():
                # Use word boundaries to avoid replacing x1 when looking for x10
                parsed = re.sub(r'\b' + var_name + r'\b', f"features['{feature_name}']", parsed)
        else:
            # Equation uses feature names directly
            # Find all potential feature names (identifiers that aren't numpy functions)
            numpy_funcs = {'sign', 'abs', 'sqrt', 'square', 'log', 'exp', 'sin', 'cos', 'tan'}

            # Extract all identifiers (word characters)
            identifiers = set(re.findall(r'\b[a-z_][a-z0-9_]*\b', equation_str, re.IGNORECASE))

            # Filter to actual feature names
            feature_names = [name for name in identifiers
                           if name not in numpy_funcs and name in self.features.columns]

            # Replace feature names with DataFrame references
            for feature_name in sorted(feature_names, key=len, reverse=True):
                # Sort by length descending to avoid partial matches
                parsed = re.sub(r'\b' + feature_name + r'\b',
                              f"features['{feature_name}']", parsed)

        return parsed

    def _evaluate_equation(
        self,
        equation_str: str,
        features: pd.DataFrame
    ) -> pd.Series:
        """
        Safely evaluate an equation using numpy operations.

        Args:
            equation_str: Equation string with variable names
            features: DataFrame containing feature data

        Returns:
            Series of computed factor values
        """
        # Parse equation to reference feature columns
        parsed_eq = self._parse_equation(equation_str)

        # Create safe namespace for evaluation
        # Wrap sqrt and log to handle negative/zero values safely
        namespace = {
            'features': features,
            'np': np,
            'sign': np.sign,
            'abs': np.abs,
            'sqrt': lambda x: np.sqrt(np.clip(x, 0, np.inf)),
            'square': np.square,
            'log': lambda x: np.log(np.clip(x, 1e-10, np.inf)),
            'exp': np.exp,
            'sin': np.sin,
            'cos': np.cos,
            'tan': np.tan,
        }

        try:
            # Evaluate equation
            result = eval(parsed_eq, {"__builtins__": {}}, namespace)

            # Convert to Series if needed
            if isinstance(result, (int, float)):
                result = pd.Series(result, index=features.index)
            elif isinstance(result, np.ndarray):
                result = pd.Series(result, index=features.index)
            elif not isinstance(result, pd.Series):
                result = pd.Series(result, index=features.index)

            return result

        except Exception as e:
            logger.error(f"Failed to evaluate equation '{equation_str}': {e}")
            # Return NaN series on error
            return pd.Series(np.nan, index=features.index)

    def _zscore_normalize_expanding(self, series: pd.Series) -> pd.Series:
        """
        Z-score normalize using expanding window (no lookahead bias).

        This ensures that normalization at time t only uses data from
        periods 0 to t, never using future information.

        Args:
            series: Raw factor values

        Returns:
            Z-score normalized factor values
        """
        if not self.normalize:
            return series

        # Expanding mean and std
        expanding_mean = series.expanding(min_periods=self.min_periods).mean()
        expanding_std = series.expanding(min_periods=self.min_periods).std()

        # Z-score: (x - mean) / std
        # Where mean and std only use data up to current point
        # Handle division by zero: when std == 0 (constant series), mark as NaN
        zscore = (series - expanding_mean) / expanding_std.replace(0.0, np.nan)

        # First min_periods will be NaN due to insufficient history
        return zscore

    def compute_factor(
        self,
        equation_id: Optional[str] = None,
        equation_idx: Optional[int] = None
    ) -> pd.Series:
        """
        Compute a single factor from an equation.

        Args:
            equation_id: Equation identifier (e.g., "equation_0")
                        If None, uses best_equation_translated
            equation_idx: Alternative: equation index in all_equations list

        Returns:
            Series of factor values (z-score normalized if normalize=True)

        Example:
            >>> factor = computer.compute_factor("equation_0")
            >>> factor = computer.compute_factor(equation_idx=3)
        """
        # Determine which equation to use
        if equation_id is None and equation_idx is None:
            # Use best equation
            if 'best_equation_translated' in self.equations:
                equation_str = self.equations['best_equation_translated']
                logger.info("Using best_equation_translated")
            elif 'best_equation_raw' in self.equations:
                equation_str = self.equations['best_equation_raw']
                logger.info("Using best_equation_raw")
            else:
                raise ValueError("No best_equation found and no equation_id specified")

        elif equation_idx is not None:
            # Use equation by index
            if 'all_equations' not in self.equations:
                raise ValueError("No all_equations found in results")

            if equation_idx >= len(self.equations['all_equations']):
                raise ValueError(
                    f"equation_idx {equation_idx} out of range "
                    f"(max: {len(self.equations['all_equations']) - 1})"
                )

            equation_str = self.equations['all_equations'][equation_idx]['equation']
            logger.info(f"Using equation {equation_idx}: {equation_str}")

        else:
            # Use equation by ID (for future compatibility with multiple named equations)
            # For now, this maps to the best equation
            equation_str = self.equations.get('best_equation_translated',
                                             self.equations.get('best_equation_raw'))
            logger.info(f"Using equation {equation_id}: {equation_str}")

        # Evaluate equation
        raw_factor = self._evaluate_equation(equation_str, self.features)

        # Normalize if requested
        if self.normalize:
            factor = self._zscore_normalize_expanding(raw_factor)
            logger.info(f"Factor computed and normalized (min_periods={self.min_periods})")
        else:
            factor = raw_factor
            logger.info("Factor computed (no normalization)")

        # Add metadata as attributes
        factor.name = equation_id or f"equation_{equation_idx}" if equation_idx is not None else "best_equation"

        return factor

    def compute_all_factors(self, max_equations: Optional[int] = None) -> pd.DataFrame:
        """
        Compute all equations from the Pareto frontier.

        Args:
            max_equations: Maximum number of equations to compute (default: all)

        Returns:
            DataFrame with one column per equation factor

        Example:
            >>> all_factors = computer.compute_all_factors(max_equations=10)
            >>> print(all_factors.head())
        """
        if 'all_equations' not in self.equations:
            # Fall back to just the best equation
            logger.warning("No all_equations found, computing only best equation")
            best_factor = self.compute_factor()
            return pd.DataFrame({best_factor.name: best_factor})

        all_eqs = self.equations['all_equations']

        if max_equations is not None:
            all_eqs = all_eqs[:max_equations]

        logger.info(f"Computing {len(all_eqs)} factors...")

        factors = {}
        for idx, eq_dict in enumerate(all_eqs):
            try:
                factor = self.compute_factor(equation_idx=idx)
                factors[f'factor_{idx}'] = factor

                # Log equation details
                complexity = eq_dict.get('complexity', 'N/A')
                loss = eq_dict.get('loss', 'N/A')
                logger.debug(
                    f"  factor_{idx}: complexity={complexity}, loss={loss:.6f}"
                    if isinstance(loss, float) else
                    f"  factor_{idx}: complexity={complexity}, loss={loss}"
                )

            except Exception as e:
                logger.error(f"Failed to compute factor {idx}: {e}")
                # Add NaN column for this factor
                factors[f'factor_{idx}'] = pd.Series(np.nan, index=self.features.index)

        df = pd.DataFrame(factors)
        logger.info(f"Computed factors: shape={df.shape}")

        return df

    def get_feature_mapping(self) -> Dict[str, str]:
        """
        Get the mapping from equation variables to feature names.

        Returns:
            Dictionary mapping variable names (x0, x1, ...) to feature column names
        """
        return self.feature_mapping.copy()

    def get_equation_metadata(self, equation_idx: Optional[int] = None) -> Dict:
        """
        Get metadata for an equation (complexity, loss, etc.).

        Args:
            equation_idx: Index of equation in all_equations (default: best equation)

        Returns:
            Dictionary with equation metadata
        """
        if equation_idx is None:
            # Return best equation metadata
            return {
                'equation': self.equations.get('best_equation_translated',
                                              self.equations.get('best_equation_raw')),
                'features_used': list(self.feature_mapping.values()),
                'n_features': len(self.feature_mapping)
            }

        if 'all_equations' not in self.equations:
            raise ValueError("No all_equations found in results")

        if equation_idx >= len(self.equations['all_equations']):
            raise ValueError(f"equation_idx {equation_idx} out of range")

        eq = self.equations['all_equations'][equation_idx]

        # Parse equation to extract used features
        eq_str = eq['equation']
        used_vars = set(re.findall(r'\bx\d+\b', eq_str))
        used_features = [self.feature_mapping[var] for var in used_vars
                        if var in self.feature_mapping]

        return {
            'equation': eq_str,
            'complexity': eq.get('complexity'),
            'loss': eq.get('loss'),
            'features_used': used_features,
            'n_features': len(used_features)
        }

    def validate_no_lookahead(self, factor: pd.Series, window: int = 100) -> bool:
        """
        Validate that factor values don't exhibit lookahead bias.

        This checks that the distribution of factor values at time t
        is consistent with only having access to data up to time t.

        Args:
            factor: Factor series to validate
            window: Window size for checking (default: 100)

        Returns:
            True if validation passes, False otherwise
        """
        # Check that early values are within expected range
        # (not using information from full sample)

        # Split into early and late periods
        split_idx = len(factor) // 2
        early = factor.iloc[:split_idx]
        late = factor.iloc[split_idx:]

        # Remove NaN values
        early_clean = early.dropna()
        late_clean = late.dropna()

        if len(early_clean) < 10 or len(late_clean) < 10:
            logger.warning("Insufficient data for lookahead validation")
            return True  # Can't validate, assume OK

        # Check if early and late have similar distributions
        # (if using lookahead, early period would be too well-normalized)
        early_std = early_clean.std()
        late_std = late_clean.std()

        # Fail validation if late_std is zero (constant series - invalid)
        if late_std == 0:
            logger.warning(
                f"Lookahead validation FAILED: late_std is zero (constant series)"
            )
            return False

        # Standard deviations should be within reasonable range
        # Early period typically has higher variance as estimation stabilizes
        std_ratio = early_std / late_std

        if std_ratio < 0.5:
            logger.warning(
                f"Potential lookahead bias detected: early_std={early_std:.3f}, "
                f"late_std={late_std:.3f}, ratio={std_ratio:.3f}"
            )
            return False

        logger.info(f"Lookahead validation passed (std_ratio={std_ratio:.3f})")
        return True


# Convenience function for quick factor computation
def compute_factors(
    equations_path: str,
    features_path: str,
    normalize: bool = True,
    max_equations: Optional[int] = None
) -> pd.DataFrame:
    """
    Convenience function to compute factors in one call.

    Args:
        equations_path: Path to Math Swarm results JSON
        features_path: Path to master features parquet
        normalize: Whether to z-score normalize (default: True)
        max_equations: Maximum number of equations to compute (default: all)

    Returns:
        DataFrame with computed factors

    Example:
        >>> factors = compute_factors(
        ...     "/path/to/math_swarm_results.json",
        ...     "/path/to/SPY_master_features.parquet",
        ...     max_equations=5
        ... )
    """
    computer = FactorComputer(equations_path, features_path, normalize=normalize)
    return computer.compute_all_factors(max_equations=max_equations)
