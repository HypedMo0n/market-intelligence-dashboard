from __future__ import annotations

import pandas as pd

from turtleos.config import TurtleRulesConfig
from turtleos.indicators import atr_wilder


def breakout_levels(ohlc: pd.DataFrame, window: int) -> pd.DataFrame:
    """Prior-bar breakout levels to avoid lookahead bias."""

    if window <= 0:
        raise ValueError("Breakout window must be positive")
    return pd.DataFrame(
        {
            "long_entry": ohlc["high"].rolling(window).max().shift(1),
            "short_entry": ohlc["low"].rolling(window).min().shift(1),
        },
        index=ohlc.index,
    )


def exit_levels(ohlc: pd.DataFrame, window: int) -> pd.DataFrame:
    """Prior-bar channel exit levels to avoid lookahead bias."""

    if window <= 0:
        raise ValueError("Exit window must be positive")
    return pd.DataFrame(
        {
            "long_exit": ohlc["low"].rolling(window).min().shift(1),
            "short_exit": ohlc["high"].rolling(window).max().shift(1),
        },
        index=ohlc.index,
    )


def build_rule_frame(ohlc: pd.DataFrame, config: TurtleRulesConfig) -> pd.DataFrame:
    levels = breakout_levels(ohlc, config.entry_window)
    exits = exit_levels(ohlc, config.exit_window)
    out = ohlc.copy()
    out["atr"] = atr_wilder(ohlc, config.atr_period)
    out = out.join(levels).join(exits)
    out["long_breakout"] = out["close"] >= out["long_entry"]
    out["short_breakout"] = out["close"] <= out["short_entry"]
    out["long_channel_exit"] = out["close"] <= out["long_exit"]
    out["short_channel_exit"] = out["close"] >= out["short_exit"]
    return out
