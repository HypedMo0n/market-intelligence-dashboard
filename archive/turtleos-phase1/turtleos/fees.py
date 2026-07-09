from __future__ import annotations

from turtleos.config import FeeConfig


def commission_for_lots(lots: float, config: FeeConfig = FeeConfig()) -> float:
    """Commission for one order side using $0.05 per 0.01 lot by default."""

    if lots < 0:
        raise ValueError("lots must be non-negative")
    return (lots / 0.01) * config.commission_per_001_lot


def spread_adjusted_price(raw_price: float, direction: int, is_entry: bool, spread_points: float) -> float:
    """Apply half-spread against the trade.

    direction: 1 for long, -1 for short.
    Long entry buys ask; long exit sells bid. Short entry sells bid; short exit
    buys ask.
    """

    half_spread = spread_points / 2.0
    if direction not in {1, -1}:
        raise ValueError("direction must be 1 for long or -1 for short")

    if direction == 1:
        return raw_price + half_spread if is_entry else raw_price - half_spread
    return raw_price - half_spread if is_entry else raw_price + half_spread
