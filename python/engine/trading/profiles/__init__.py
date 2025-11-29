"""
Individual profile implementations for convexity rotation backtesting.

Each profile defines:
- Trade structure (legs, strikes, expiries)
- Entry logic (score threshold, regime filter)
- Exit logic (roll rules, regime transitions)
- Hedging requirements
"""

from .profile_1 import Profile1LongDatedGamma
from .profile_2 import Profile2ShortDatedGamma
from .profile_3 import Profile3CharmDecay
from .profile_4 import Profile4Vanna
from .profile_5 import Profile5SkewConvexity
from .profile_6 import Profile6VolOfVol

__all__ = [
    'Profile1LongDatedGamma',
    'Profile2ShortDatedGamma',
    'Profile3CharmDecay',
    'Profile4Vanna',
    'Profile5SkewConvexity',
    'Profile6VolOfVol'
]
