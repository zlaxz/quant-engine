"""
Discovery Module - Autonomous Market Scanning

This module enables truly autonomous operation by scanning market
structure and creating missions without human intervention.
"""

from .morphology_scan import (
    MorphologyScanner,
    MarketOpportunity,
    OpportunityType,
    scan_for_opportunities,
)

__all__ = [
    'MorphologyScanner',
    'MarketOpportunity',
    'OpportunityType',
    'scan_for_opportunities',
]
