"""
Utility functions for trading module.
"""

from datetime import date, datetime
import pandas as pd


def normalize_date(date_input):
    """
    Normalize date input to datetime.date object.

    Provides a single canonical conversion point for all date types used
    throughout the trading system (pd.Timestamp, datetime, date, str).

    Args:
        date_input: Can be datetime.date, pd.Timestamp, str, or datetime.datetime

    Returns:
        datetime.date object

    Raises:
        TypeError: If date_input cannot be converted to a date

    Examples:
        >>> normalize_date(pd.Timestamp('2023-01-15'))
        datetime.date(2023, 1, 15)

        >>> normalize_date(datetime(2023, 1, 15, 10, 30))
        datetime.date(2023, 1, 15)

        >>> normalize_date('2023-01-15')
        datetime.date(2023, 1, 15)
    """
    # Already a date (but not datetime which is a date subclass)
    if isinstance(date_input, date) and not isinstance(date_input, datetime):
        return date_input

    # pd.Timestamp or datetime
    elif isinstance(date_input, (pd.Timestamp, datetime)):
        return date_input.date()

    # String representation
    elif isinstance(date_input, str):
        return pd.to_datetime(date_input).date()

    else:
        raise TypeError(
            f"Cannot convert {type(date_input).__name__} to date. "
            f"Expected date, datetime, pd.Timestamp, or str."
        )
