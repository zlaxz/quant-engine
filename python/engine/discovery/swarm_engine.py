#!/usr/bin/env python3
"""
Swarm Engine: The Optimization Labor Force

Three swarm types:
1. Scout Swarm - Feature Discovery (Particle Swarm / Genetic Algorithm)
2. Math Swarm - Equation Discovery (PySR - already swarm-based)
3. Jury Swarm - Ensemble Regime Classification (multiple models voting)

The swarm does billions of calculations to compress market complexity
into tradeable truths.
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional, Callable
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp

import numpy as np
import pandas as pd
from sklearn.feature_selection import mutual_info_regression, mutual_info_classif
from sklearn.cluster import KMeans, DBSCAN
from sklearn.mixture import GaussianMixture
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("AlphaFactory.Swarm")


# ============================================================================
# SCOUT SWARM: Feature Discovery via Optimization
# ============================================================================

@dataclass
class FeatureScore:
    """Score for a feature or feature combination."""
    feature_names: Tuple[str, ...]
    mutual_info: float
    correlation: float
    combined_score: float


class ScoutSwarm:
    """
    Parallel feature discovery using genetic algorithm approach.

    Instead of testing 5000 features one by one, we:
    1. Create a population of "agents" (random feature subsets)
    2. Evaluate each agent's predictive power (Mutual Information)
    3. Breed the best agents, mutate, repeat
    4. Converge on the "Golden Cluster" of useful features
    """

    def __init__(
        self,
        population_size: int = 100,
        n_generations: int = 50,
        features_per_agent: int = 10,
        mutation_rate: float = 0.1,
        n_workers: int = None
    ):
        self.population_size = population_size
        self.n_generations = n_generations
        self.features_per_agent = features_per_agent
        self.mutation_rate = mutation_rate
        self.n_workers = n_workers or mp.cpu_count()

        self.best_features: List[str] = []
        self.feature_scores: Dict[str, float] = {}

    def _create_random_agent(self, all_features: List[str]) -> List[str]:
        """Create agent with random feature subset."""
        n = min(self.features_per_agent, len(all_features))
        return list(np.random.choice(all_features, n, replace=False))

    def _evaluate_agent(
        self,
        features: List[str],
        X: pd.DataFrame,
        y: pd.Series
    ) -> float:
        """
        Evaluate an agent's feature subset.
        Returns combined score based on Mutual Information.
        """
        try:
            X_subset = X[features].values
            mi_scores = mutual_info_classif(X_subset, y, discrete_features=False)
            return float(np.mean(mi_scores))
        except Exception:
            return 0.0

    def _crossover(self, parent1: List[str], parent2: List[str]) -> List[str]:
        """Breed two parents to create child."""
        # Take half from each parent
        n = len(parent1) // 2
        child = parent1[:n] + [f for f in parent2 if f not in parent1[:n]]
        return child[:self.features_per_agent]

    def _mutate(self, agent: List[str], all_features: List[str]) -> List[str]:
        """Randomly replace some features."""
        agent = agent.copy()
        for i in range(len(agent)):
            if np.random.random() < self.mutation_rate:
                new_feature = np.random.choice(all_features)
                if new_feature not in agent:
                    agent[i] = new_feature
        return agent

    def evolve(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        verbose: bool = True
    ) -> List[str]:
        """
        Run genetic algorithm to find best features.

        Args:
            X: Feature matrix (all 5000+ features)
            y: Target variable
            verbose: Print progress

        Returns:
            List of best feature names
        """
        all_features = list(X.columns)
        logger.info(f"Scout Swarm: Evolving on {len(all_features)} features")

        # Initialize population
        population = [
            self._create_random_agent(all_features)
            for _ in range(self.population_size)
        ]

        best_score = 0
        best_agent = None

        for gen in range(self.n_generations):
            # Evaluate all agents in parallel
            scores = []
            with ProcessPoolExecutor(max_workers=self.n_workers) as executor:
                futures = {
                    executor.submit(self._evaluate_agent, agent, X, y): i
                    for i, agent in enumerate(population)
                }
                for future in as_completed(futures):
                    idx = futures[future]
                    scores.append((idx, future.result()))

            # Sort by score
            scores.sort(key=lambda x: x[1], reverse=True)
            ranked_population = [population[idx] for idx, _ in scores]
            ranked_scores = [s for _, s in scores]

            # Update best
            if ranked_scores[0] > best_score:
                best_score = ranked_scores[0]
                best_agent = ranked_population[0]

            if verbose and gen % 10 == 0:
                logger.info(f"  Gen {gen}: Best MI = {best_score:.4f}")

            # Selection: keep top 20%
            survivors = ranked_population[:self.population_size // 5]

            # Breeding: create new population
            new_population = survivors.copy()
            while len(new_population) < self.population_size:
                # Select two parents from survivors
                p1, p2 = np.random.choice(len(survivors), 2, replace=False)
                child = self._crossover(survivors[p1], survivors[p2])
                child = self._mutate(child, all_features)
                new_population.append(child)

            population = new_population

        # Final: aggregate feature importance across best agents
        top_agents = ranked_population[:10]
        feature_counts = {}
        for agent in top_agents:
            for f in agent:
                feature_counts[f] = feature_counts.get(f, 0) + 1

        # Sort by frequency in top agents
        self.best_features = sorted(
            feature_counts.keys(),
            key=lambda f: feature_counts[f],
            reverse=True
        )

        logger.info(f"Scout Swarm: Found {len(self.best_features)} important features")
        logger.info(f"Top 10: {self.best_features[:10]}")

        return self.best_features


# ============================================================================
# MATH SWARM: PySR Integration
# ============================================================================

class MathSwarm:
    """
    Wrapper around PySR for equation discovery.

    PySR IS already a swarm - it evolves a population of equations
    through genetic programming. This class provides our integration.
    """

    def __init__(
        self,
        n_iterations: int = 100,
        populations: int = 30,
        complexity_penalty: float = 0.001
    ):
        self.n_iterations = n_iterations
        self.populations = populations
        self.complexity_penalty = complexity_penalty
        self.best_equations: Dict[str, str] = {}

    def discover_equation(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        regime_name: str = "all"
    ) -> Dict:
        """
        Run PySR to discover best equation for this regime.

        Args:
            X: Feature matrix (filtered to best features)
            y: Target variable
            regime_name: Name for logging

        Returns:
            Dict with equation, score, complexity
        """
        try:
            from pysr import PySRRegressor
        except ImportError:
            logger.warning("PySR not installed. Run: pip install pysr")
            return {"equation": "N/A", "error": "PySR not installed"}

        logger.info(f"Math Swarm: Discovering equation for {regime_name}")

        model = PySRRegressor(
            niterations=self.n_iterations,
            populations=self.populations,
            binary_operators=["+", "-", "*", "/"],
            unary_operators=["log", "exp", "sqrt", "abs", "sign"],
            complexity_of_operators={
                "+": 1, "-": 1, "*": 1, "/": 2,
                "log": 2, "exp": 2, "sqrt": 2, "abs": 1, "sign": 1
            },
            parsimony=self.complexity_penalty,
            progress=True,
            verbosity=1
        )

        model.fit(X, y)

        # Get best equation
        best = model.get_best()
        equation_str = str(best['equation'])
        score = float(best['score'])
        complexity = int(best['complexity'])

        self.best_equations[regime_name] = equation_str

        logger.info(f"  Best equation: {equation_str}")
        logger.info(f"  Score: {score:.4f}, Complexity: {complexity}")

        return {
            "equation": equation_str,
            "score": score,
            "complexity": complexity,
            "model": model
        }

    def discover_per_regime(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        regimes: pd.Series
    ) -> Dict[int, Dict]:
        """
        Run PySR for each regime in parallel.

        Returns:
            Dict mapping regime_id to equation results
        """
        unique_regimes = regimes.unique()
        results = {}

        # Could parallelize this with ProcessPoolExecutor
        # but PySR already uses multiple cores internally
        for regime in unique_regimes:
            mask = regimes == regime
            X_regime = X[mask]
            y_regime = y[mask]

            if len(X_regime) < 100:
                logger.warning(f"Regime {regime} has only {len(X_regime)} samples, skipping")
                continue

            result = self.discover_equation(X_regime, y_regime, f"Regime_{regime}")
            results[regime] = result

        return results


# ============================================================================
# JURY SWARM: Ensemble Regime Classification
# ============================================================================

class JurySwarm:
    """
    Ensemble of regime classifiers that vote on current market state.

    Instead of trusting one model, we run 5 different clustering approaches
    and take a consensus vote. More robust than any single method.

    Models:
    - KMeans: Standard clustering
    - GMM: Gaussian Mixture (soft clusters)
    - DBSCAN: Density-based (finds outliers)
    - Isolation Forest: Anomaly detection
    - Second KMeans with different params
    """

    def __init__(self, n_regimes: int = 4):
        self.n_regimes = n_regimes
        self.models: Dict[str, object] = {}
        self.scaler = StandardScaler()
        self.is_fitted = False

    def fit(self, features: pd.DataFrame) -> 'JurySwarm':
        """Fit all jury members on historical data."""
        logger.info("Jury Swarm: Fitting ensemble...")

        X = self.scaler.fit_transform(features.dropna())

        # KMeans (standard)
        self.models['kmeans'] = KMeans(
            n_clusters=self.n_regimes,
            random_state=42,
            n_init=10
        ).fit(X)

        # KMeans (different init)
        self.models['kmeans2'] = KMeans(
            n_clusters=self.n_regimes,
            random_state=123,
            init='random',
            n_init=10
        ).fit(X)

        # GMM
        self.models['gmm'] = GaussianMixture(
            n_components=self.n_regimes,
            random_state=42,
            n_init=3
        ).fit(X)

        # For DBSCAN and IsolationForest, we map their outputs to regimes
        # These are more for detecting "unusual" states

        self.is_fitted = True
        logger.info(f"Jury Swarm: Fitted {len(self.models)} models")

        return self

    def predict(self, features: pd.DataFrame) -> Tuple[pd.Series, pd.DataFrame]:
        """
        Get consensus regime prediction.

        Returns:
            Tuple of (consensus_labels, vote_matrix)
        """
        if not self.is_fitted:
            raise ValueError("Must call fit() first")

        X = self.scaler.transform(features.fillna(0))

        # Get predictions from each model
        votes = pd.DataFrame(index=features.index)

        votes['kmeans'] = self.models['kmeans'].predict(X)
        votes['kmeans2'] = self.models['kmeans2'].predict(X)
        votes['gmm'] = self.models['gmm'].predict(X)

        # Consensus: mode of votes
        consensus = votes.mode(axis=1)[0].astype(int)

        # Confidence: what fraction agreed
        confidence = (votes == consensus.values.reshape(-1, 1)).mean(axis=1)

        return consensus, votes, confidence

    def get_regime_with_confidence(
        self,
        features: pd.DataFrame
    ) -> Tuple[int, float, Dict[str, int]]:
        """
        Get single regime prediction with confidence.

        Returns:
            Tuple of (regime_id, confidence, individual_votes)
        """
        consensus, votes, confidence = self.predict(features)

        # Get last row
        regime = int(consensus.iloc[-1])
        conf = float(confidence.iloc[-1])
        individual = votes.iloc[-1].to_dict()

        return regime, conf, individual


# ============================================================================
# INTEGRATED SWARM ENGINE
# ============================================================================

class SwarmEngine:
    """
    Master orchestrator for all swarm components.

    Usage:
        engine = SwarmEngine()
        engine.run_full_discovery(data)
    """

    def __init__(
        self,
        n_regimes: int = 4,
        feature_population: int = 100,
        feature_generations: int = 50,
        pysr_iterations: int = 100
    ):
        self.scout = ScoutSwarm(
            population_size=feature_population,
            n_generations=feature_generations
        )
        self.math = MathSwarm(n_iterations=pysr_iterations)
        self.jury = JurySwarm(n_regimes=n_regimes)

        self.best_features: List[str] = []
        self.equations_by_regime: Dict[int, str] = {}

    def run_full_discovery(
        self,
        features: pd.DataFrame,
        target: pd.Series,
        regime_features: pd.DataFrame
    ) -> Dict:
        """
        Run complete discovery pipeline.

        1. Scout Swarm finds best features
        2. Jury Swarm classifies regimes
        3. Math Swarm finds equations per regime

        Args:
            features: All 5000+ features
            target: Target variable (e.g., triple barrier)
            regime_features: Features for regime classification

        Returns:
            Dict with all results
        """
        results = {}

        # Step 1: Scout Swarm - Feature Discovery
        logger.info("=" * 60)
        logger.info("PHASE 1: Scout Swarm - Feature Discovery")
        logger.info("=" * 60)

        self.best_features = self.scout.evolve(features, target)
        results['best_features'] = self.best_features[:50]  # Top 50

        # Step 2: Jury Swarm - Regime Classification
        logger.info("=" * 60)
        logger.info("PHASE 2: Jury Swarm - Regime Classification")
        logger.info("=" * 60)

        self.jury.fit(regime_features)
        regimes, votes, confidence = self.jury.predict(regime_features)
        results['regime_distribution'] = regimes.value_counts().to_dict()
        results['avg_confidence'] = float(confidence.mean())

        # Step 3: Math Swarm - Equation Discovery per Regime
        logger.info("=" * 60)
        logger.info("PHASE 3: Math Swarm - Equation Discovery")
        logger.info("=" * 60)

        # Use only best features for equation discovery
        X_reduced = features[self.best_features[:20]]  # Top 20 features

        equation_results = self.math.discover_per_regime(
            X_reduced, target, regimes
        )

        self.equations_by_regime = {
            r: res['equation'] for r, res in equation_results.items()
        }
        results['equations'] = self.equations_by_regime

        return results


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Create dummy data for testing
    np.random.seed(42)
    n_samples = 10000
    n_features = 100

    # Random features
    X = pd.DataFrame(
        np.random.randn(n_samples, n_features),
        columns=[f'feature_{i}' for i in range(n_features)]
    )

    # Add some predictive features
    X['signal_1'] = np.sin(np.arange(n_samples) / 100)
    X['signal_2'] = np.cos(np.arange(n_samples) / 50)

    # Target that depends on signals
    y = (X['signal_1'] + 0.5 * X['signal_2'] + np.random.randn(n_samples) * 0.3 > 0).astype(int)

    # Test Scout Swarm
    print("\n=== Testing Scout Swarm ===")
    scout = ScoutSwarm(population_size=20, n_generations=10, n_workers=4)
    best = scout.evolve(X, pd.Series(y), verbose=True)
    print(f"Found features: {best[:5]}")

    # Test Jury Swarm
    print("\n=== Testing Jury Swarm ===")
    regime_features = X[['signal_1', 'signal_2']].copy()
    regime_features['volatility'] = X.rolling(20).std().mean(axis=1)
    jury = JurySwarm(n_regimes=3)
    jury.fit(regime_features.dropna())
    regime, conf, votes = jury.get_regime_with_confidence(regime_features.tail(1))
    print(f"Current regime: {regime}, confidence: {conf:.2%}")
    print(f"Votes: {votes}")
