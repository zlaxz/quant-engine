#!/usr/bin/env python3
"""
Demo: StrategyMapper with Real Factor Data

Shows how to use StrategyMapper to select option strategies based on
factor signals from the Market Physics Engine.

Usage:
    python3 scripts/demo_strategy_mapper.py --symbol SPY
"""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

import argparse
import pandas as pd
import logging
from datetime import datetime, timedelta

from engine.factors import StrategyMapper, StrategyRule
from engine.ui_bridge import emit_ui_event, ui_table, ui_pnl_chart

logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_factor_data(symbol: str) -> pd.DataFrame:
    """
    Load factor data from master features parquet.

    Args:
        symbol: Ticker symbol (e.g., 'SPY')

    Returns:
        DataFrame with factor features
    """
    features_path = f'/Volumes/VelocityData/velocity_om/features/{symbol}_master_features.parquet'

    if not Path(features_path).exists():
        logger.error(f"Features file not found: {features_path}")
        logger.info("Run main_harvest.py first to generate features")
        return None

    logger.info(f"Loading features from {features_path}")
    df = pd.read_parquet(features_path)

    # Ensure datetime index
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)

    logger.info(f"Loaded {len(df)} rows, {len(df.columns)} columns")
    logger.info(f"Date range: {df.index.min()} to {df.index.max()}")

    return df


def demo_strategy_selection(
    factors: pd.DataFrame,
    symbol: str,
    start_date: str = None,
    end_date: str = None,
    portfolio_value: float = 100000
):
    """
    Demo strategy selection over time period.

    Args:
        factors: Factor DataFrame
        symbol: Ticker symbol
        start_date: Start date (YYYY-MM-DD) or None for first date
        end_date: End date (YYYY-MM-DD) or None for last date
        portfolio_value: Portfolio value for position sizing
    """
    # Initialize mapper
    mapper = StrategyMapper()

    emit_ui_event(
        activity_type="discovery",
        message=f"Strategy Mapper Demo: {symbol}",
        notification={
            "type": "info",
            "title": "Strategy Mapper",
            "message": f"Running demo on {symbol}"
        }
    )

    # Filter date range
    if start_date:
        factors = factors[factors.index >= pd.Timestamp(start_date)]
    if end_date:
        factors = factors[factors.index <= pd.Timestamp(end_date)]

    logger.info(f"Analyzing {len(factors)} days from {factors.index[0]} to {factors.index[-1]}")

    # Track selections
    selections = []
    strategy_counts = {}

    # Simulate strategy selection for each day
    for date in factors.index:
        factor_row = factors.loc[date]

        # Need current price - use 'close' if available
        if 'close' in factor_row.index:
            current_price = factor_row['close']
        else:
            current_price = 100.0  # Placeholder

        # Select strategy
        rule = mapper.select_strategy(factor_row, current_price, verbose=False)

        if rule:
            # Calculate position size
            contracts = mapper.get_position_size(
                rule,
                portfolio_value,
                current_price
            )

            notional = contracts * current_price * 100

            selections.append({
                'date': date,
                'rule_name': rule.name,
                'structure': rule.structure_dna.structure_type.value,
                'dte': rule.structure_dna.dte_bucket.value,
                'delta': rule.structure_dna.delta_bucket.value,
                'contracts': contracts,
                'notional': notional,
                'position_size_pct': rule.position_size_pct,
                'profit_target': rule.profit_target_pct,
                'stop_loss': rule.stop_loss_pct,
                'max_hold_days': rule.max_hold_days,
                'current_price': current_price,
            })

            # Count strategies
            strategy_counts[rule.name] = strategy_counts.get(rule.name, 0) + 1
        else:
            selections.append({
                'date': date,
                'rule_name': 'NO_MATCH',
                'structure': None,
                'dte': None,
                'delta': None,
                'contracts': 0,
                'notional': 0,
                'position_size_pct': 0,
                'profit_target': 0,
                'stop_loss': 0,
                'max_hold_days': 0,
                'current_price': current_price,
            })

    # Convert to DataFrame
    selections_df = pd.DataFrame(selections)

    # Summary statistics
    logger.info("\n" + "=" * 80)
    logger.info("STRATEGY SELECTION SUMMARY")
    logger.info("=" * 80)

    total_days = len(selections_df)
    matched_days = len(selections_df[selections_df['rule_name'] != 'NO_MATCH'])
    match_rate = matched_days / total_days if total_days > 0 else 0

    logger.info(f"Total Days: {total_days}")
    logger.info(f"Days with Strategy: {matched_days} ({match_rate:.1%})")
    logger.info(f"Days without Strategy: {total_days - matched_days} ({1-match_rate:.1%})")

    logger.info("\nStrategy Distribution:")
    for strategy, count in sorted(strategy_counts.items(), key=lambda x: -x[1]):
        pct = count / matched_days if matched_days > 0 else 0
        logger.info(f"  {strategy}: {count} ({pct:.1%})")

    # Average position sizing
    avg_contracts = selections_df[selections_df['contracts'] > 0]['contracts'].mean()
    avg_notional = selections_df[selections_df['notional'] > 0]['notional'].mean()

    logger.info(f"\nAverage Position:")
    logger.info(f"  Contracts: {avg_contracts:.1f}")
    logger.info(f"  Notional: ${avg_notional:,.0f}")

    # Emit results to UI
    ui_table(
        title=f"Strategy Selection Summary - {symbol}",
        columns=[
            {"key": "rule_name", "label": "Strategy", "type": "text"},
            {"key": "count", "label": "Count", "type": "number"},
            {"key": "pct", "label": "% of Days", "type": "percent"},
        ],
        rows=[
            {
                "rule_name": strategy,
                "count": count,
                "pct": count / matched_days if matched_days > 0 else 0
            }
            for strategy, count in sorted(strategy_counts.items(), key=lambda x: -x[1])
        ]
    )

    # Show recent selections (last 10 days)
    logger.info("\n" + "=" * 80)
    logger.info("RECENT SELECTIONS (Last 10 Days)")
    logger.info("=" * 80)

    recent = selections_df.tail(10)
    for _, row in recent.iterrows():
        if row['rule_name'] != 'NO_MATCH':
            logger.info(
                f"{row['date'].strftime('%Y-%m-%d')}: {row['rule_name']} | "
                f"{row['structure']} {row['dte']}DTE {row['delta']} | "
                f"{row['contracts']} contracts (${row['notional']:,.0f})"
            )
        else:
            logger.info(f"{row['date'].strftime('%Y-%m-%d')}: NO_MATCH")

    # Save to CSV
    output_path = f'/tmp/strategy_selections_{symbol}.csv'
    selections_df.to_csv(output_path, index=False)
    logger.info(f"\nSaved full results to: {output_path}")

    return selections_df, strategy_counts


def demo_custom_rule(factors: pd.DataFrame, symbol: str):
    """
    Demo adding and testing a custom rule.

    Args:
        factors: Factor DataFrame
        symbol: Ticker symbol
    """
    from engine.discovery.structure_dna import (
        StructureDNA, StructureType, DTEBucket, DeltaBucket
    )

    logger.info("\n" + "=" * 80)
    logger.info("CUSTOM RULE DEMO")
    logger.info("=" * 80)

    # Create mapper with default rules
    mapper = StrategyMapper()

    # Add custom rule
    custom_rule = StrategyRule(
        name="Extreme Compression Breakout",
        conditions=[
            ("ret_range_1m", "<", 0.005),  # Very low realized vol
            ("xle_strength_1m", "<", -0.3),  # Strong negative correlation
        ],
        structure_dna=StructureDNA(
            structure_type=StructureType.LONG_STRANGLE,
            dte_bucket=DTEBucket.DTE_14,
            delta_bucket=DeltaBucket.D25,
            profit_target_pct=1.50,
            stop_loss_pct=0.60,
        ),
        position_size_pct=0.06,  # 6% allocation
        max_hold_days=14,
        priority=25,  # Highest priority
        description="Buy gamma during extreme vol compression with market stress"
    )

    mapper.add_rule(custom_rule)

    logger.info(f"Added custom rule: {custom_rule.name}")
    logger.info(f"Priority: {custom_rule.priority}")
    logger.info(f"Conditions: {custom_rule.conditions}")

    # Test on recent data
    recent_data = factors.tail(30)  # Last 30 days

    matches = 0
    for date in recent_data.index:
        factor_row = recent_data.loc[date]
        current_price = factor_row.get('close', 100.0)

        rule = mapper.select_strategy(factor_row, current_price, verbose=False)

        if rule and rule.name == custom_rule.name:
            matches += 1
            logger.info(
                f"  ✓ {date.strftime('%Y-%m-%d')}: Custom rule matched! "
                f"ret_range={factor_row.get('ret_range_1m', 0):.4f}, "
                f"xle_strength={factor_row.get('xle_strength_1m', 0):.4f}"
            )

    logger.info(f"\nCustom rule matched {matches}/{len(recent_data)} days ({matches/len(recent_data):.1%})")


def main():
    parser = argparse.ArgumentParser(description='Demo StrategyMapper with factor data')
    parser.add_argument('--symbol', type=str, default='SPY', help='Ticker symbol')
    parser.add_argument('--start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--portfolio', type=float, default=100000, help='Portfolio value')
    parser.add_argument('--custom', action='store_true', help='Demo custom rule')

    args = parser.parse_args()

    # Load factor data
    factors = load_factor_data(args.symbol)

    if factors is None:
        logger.error("Failed to load factor data. Exiting.")
        return

    # Demo strategy selection
    selections_df, strategy_counts = demo_strategy_selection(
        factors,
        args.symbol,
        start_date=args.start,
        end_date=args.end,
        portfolio_value=args.portfolio
    )

    # Demo custom rule if requested
    if args.custom:
        demo_custom_rule(factors, args.symbol)

    logger.info("\n" + "=" * 80)
    logger.info("Demo complete!")
    logger.info("=" * 80)


if __name__ == '__main__':
    main()
