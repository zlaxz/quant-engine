"""
Visualization tools for rotation engine results.

Creates charts for:
- Portfolio P&L over time
- Allocation heatmap
- Regime transitions
- Drawdown curve
- Per-profile attribution
- Per-regime attribution
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, Optional, List


class PortfolioVisualizer:
    """
    Generate visualizations for rotation engine results.
    """

    def __init__(self, figsize=(14, 8)):
        """
        Initialize visualizer.

        Parameters:
        -----------
        figsize : tuple
            Default figure size
        """
        self.figsize = figsize
        sns.set_style('whitegrid')

    def plot_all(
        self,
        results: Dict,
        save_path: Optional[str] = None
    ):
        """
        Generate all standard charts.

        Parameters:
        -----------
        results : dict
            Results from RotationEngine.run()
        save_path : str, optional
            Directory to save plots (if None, display only)
        """
        print("Generating visualizations...")

        # 1. Portfolio P&L
        self.plot_portfolio_pnl(results['portfolio'], save_path)

        # 2. Allocation heatmap
        self.plot_allocation_heatmap(results['exposure_over_time'], save_path)

        # 3. Attribution charts
        self.plot_attribution(
            results['attribution_by_profile'],
            results['attribution_by_regime'],
            save_path
        )

        # 4. Regime distribution
        self.plot_regime_distribution(results['regime_distribution'], save_path)

        print("Visualizations complete!")

    def plot_portfolio_pnl(
        self,
        portfolio: pd.DataFrame,
        save_path: Optional[str] = None
    ):
        """
        Plot portfolio P&L and drawdown.

        Parameters:
        -----------
        portfolio : pd.DataFrame
            Portfolio DataFrame
        save_path : str, optional
            Save location
        """
        fig, axes = plt.subplots(2, 1, figsize=self.figsize, sharex=True)

        # Plot 1: Cumulative P&L
        ax1 = axes[0]
        ax1.plot(portfolio['date'], portfolio['cumulative_pnl'], linewidth=2, color='steelblue')
        ax1.axhline(0, color='black', linestyle='--', alpha=0.3)
        ax1.set_ylabel('Cumulative P&L ($)', fontsize=12)
        ax1.set_title('Portfolio Performance', fontsize=14, fontweight='bold')
        ax1.grid(True, alpha=0.3)

        # Plot 2: Drawdown
        ax2 = axes[1]
        running_max = portfolio['cumulative_pnl'].expanding().max()
        drawdown = portfolio['cumulative_pnl'] - running_max

        ax2.fill_between(portfolio['date'], 0, drawdown, color='red', alpha=0.3)
        ax2.set_ylabel('Drawdown ($)', fontsize=12)
        ax2.set_xlabel('Date', fontsize=12)
        ax2.grid(True, alpha=0.3)

        plt.tight_layout()

        if save_path:
            plt.savefig(f'{save_path}/portfolio_pnl.png', dpi=300, bbox_inches='tight')
            print(f"  Saved: {save_path}/portfolio_pnl.png")
        else:
            plt.show()

        plt.close()

    def plot_allocation_heatmap(
        self,
        exposure: pd.DataFrame,
        save_path: Optional[str] = None
    ):
        """
        Plot allocation weights as heatmap over time.

        Parameters:
        -----------
        exposure : pd.DataFrame
            Exposure over time DataFrame
        save_path : str, optional
            Save location
        """
        # Get weight columns
        weight_cols = [col for col in exposure.columns if col.endswith('_weight')]

        # Create pivot for heatmap
        heatmap_data = exposure[weight_cols].T

        fig, ax = plt.subplots(figsize=(16, 6))

        # Plot heatmap
        sns.heatmap(
            heatmap_data,
            cmap='YlOrRd',
            cbar_kws={'label': 'Allocation Weight'},
            ax=ax,
            vmin=0,
            vmax=0.4  # Max 40%
        )

        # Set labels
        ax.set_xlabel('Date Index', fontsize=12)
        ax.set_ylabel('Profile', fontsize=12)
        ax.set_title('Allocation Weights Over Time', fontsize=14, fontweight='bold')

        # Clean up y-axis labels
        y_labels = [col.replace('_weight', '').replace('_', ' ').title() for col in weight_cols]
        ax.set_yticklabels(y_labels, rotation=0)

        plt.tight_layout()

        if save_path:
            plt.savefig(f'{save_path}/allocation_heatmap.png', dpi=300, bbox_inches='tight')
            print(f"  Saved: {save_path}/allocation_heatmap.png")
        else:
            plt.show()

        plt.close()

    def plot_attribution(
        self,
        attribution_by_profile: pd.DataFrame,
        attribution_by_regime: pd.DataFrame,
        save_path: Optional[str] = None
    ):
        """
        Plot P&L attribution by profile and regime.

        Parameters:
        -----------
        attribution_by_profile : pd.DataFrame
            Attribution by profile
        attribution_by_regime : pd.DataFrame
            Attribution by regime
        save_path : str, optional
            Save location
        """
        fig, axes = plt.subplots(1, 2, figsize=(16, 6))

        # Plot 1: Attribution by profile
        ax1 = axes[0]
        profiles = attribution_by_profile['profile'].str.replace('profile_', 'P')
        colors = ['green' if x > 0 else 'red' for x in attribution_by_profile['total_pnl']]

        ax1.barh(profiles, attribution_by_profile['total_pnl'], color=colors, alpha=0.7)
        ax1.axvline(0, color='black', linestyle='--', alpha=0.3)
        ax1.set_xlabel('Total P&L ($)', fontsize=12)
        ax1.set_ylabel('Profile', fontsize=12)
        ax1.set_title('P&L Attribution by Profile', fontsize=14, fontweight='bold')
        ax1.grid(True, alpha=0.3, axis='x')

        # Plot 2: Attribution by regime
        ax2 = axes[1]
        regime_labels = [f'Regime {int(r)}' for r in attribution_by_regime['regime']]
        colors = ['green' if x > 0 else 'red' for x in attribution_by_regime['total_pnl']]

        ax2.barh(regime_labels, attribution_by_regime['total_pnl'], color=colors, alpha=0.7)
        ax2.axvline(0, color='black', linestyle='--', alpha=0.3)
        ax2.set_xlabel('Total P&L ($)', fontsize=12)
        ax2.set_ylabel('Regime', fontsize=12)
        ax2.set_title('P&L Attribution by Regime', fontsize=14, fontweight='bold')
        ax2.grid(True, alpha=0.3, axis='x')

        plt.tight_layout()

        if save_path:
            plt.savefig(f'{save_path}/attribution.png', dpi=300, bbox_inches='tight')
            print(f"  Saved: {save_path}/attribution.png")
        else:
            plt.show()

        plt.close()

    def plot_regime_distribution(
        self,
        regime_dist: pd.DataFrame,
        save_path: Optional[str] = None
    ):
        """
        Plot regime distribution (pie chart).

        Parameters:
        -----------
        regime_dist : pd.DataFrame
            Regime distribution
        save_path : str, optional
            Save location
        """
        fig, ax = plt.subplots(figsize=(10, 6))

        labels = [f'Regime {int(r)}' for r in regime_dist['regime']]
        sizes = regime_dist['days']

        colors = plt.cm.Set3(np.linspace(0, 1, len(labels)))

        ax.pie(
            sizes,
            labels=labels,
            autopct='%1.1f%%',
            colors=colors,
            startangle=90
        )
        ax.set_title('Time Distribution Across Regimes', fontsize=14, fontweight='bold')

        plt.tight_layout()

        if save_path:
            plt.savefig(f'{save_path}/regime_distribution.png', dpi=300, bbox_inches='tight')
            print(f"  Saved: {save_path}/regime_distribution.png")
        else:
            plt.show()

        plt.close()

    def plot_allocation_evolution(
        self,
        portfolio: pd.DataFrame,
        save_path: Optional[str] = None
    ):
        """
        Plot allocation weights as stacked area chart.

        Parameters:
        -----------
        portfolio : pd.DataFrame
            Portfolio DataFrame with weight columns
        save_path : str, optional
            Save location
        """
        weight_cols = [col for col in portfolio.columns if col.endswith('_weight')]

        fig, ax = plt.subplots(figsize=self.figsize)

        # Prepare data for stacked area
        weights_df = portfolio[['date'] + weight_cols].set_index('date')

        # Plot stacked area
        ax.stackplot(
            weights_df.index,
            *[weights_df[col] for col in weight_cols],
            labels=[col.replace('_weight', '').replace('_', ' ').title() for col in weight_cols],
            alpha=0.7
        )

        ax.set_xlabel('Date', fontsize=12)
        ax.set_ylabel('Allocation Weight', fontsize=12)
        ax.set_title('Allocation Evolution Over Time', fontsize=14, fontweight='bold')
        ax.legend(loc='upper left', bbox_to_anchor=(1, 1))
        ax.grid(True, alpha=0.3)

        plt.tight_layout()

        if save_path:
            plt.savefig(f'{save_path}/allocation_evolution.png', dpi=300, bbox_inches='tight')
            print(f"  Saved: {save_path}/allocation_evolution.png")
        else:
            plt.show()

        plt.close()
