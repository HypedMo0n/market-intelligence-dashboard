from __future__ import annotations

import pandas as pd


def true_range(ohlc: pd.DataFrame) -> pd.Series:
    """True Range: max(high-low, abs(high-prev_close), abs(low-prev_close))."""

    required = {"high", "low", "close"}
    missing = required.difference(ohlc.columns)
    if missing:
        raise ValueError(f"OHLC data missing columns: {sorted(missing)}")

    high_low = ohlc["high"] - ohlc["low"]
    prev_close = ohlc["close"].shift(1)
    high_prev_close = (ohlc["high"] - prev_close).abs()
    low_prev_close = (ohlc["low"] - prev_close).abs()
    return pd.concat([high_low, high_prev_close, low_prev_close], axis=1).max(axis=1)


def atr_wilder(ohlc: pd.DataFrame, period: int = 20) -> pd.Series:
    """Average True Range using Wilder smoothing."""

    if period <= 0:
        raise ValueError("ATR period must be positive")

    tr = true_range(ohlc)
    atr = pd.Series(index=ohlc.index, dtype="float64", name=f"atr_{period}")
    if len(tr) < period:
        return atr

    first_pos = period - 1
    atr.iloc[first_pos] = tr.iloc[:period].mean()
    for pos in range(first_pos + 1, len(tr)):
        atr.iloc[pos] = ((atr.iloc[pos - 1] * (period - 1)) + tr.iloc[pos]) / period
    return atr
