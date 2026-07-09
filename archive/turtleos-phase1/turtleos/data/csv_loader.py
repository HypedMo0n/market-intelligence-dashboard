from __future__ import annotations

from pathlib import Path

import pandas as pd


REQUIRED_COLUMNS = {"time", "open", "high", "low", "close"}


def normalize_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    missing = REQUIRED_COLUMNS.difference(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {sorted(missing)}")

    out = df.copy()
    out["time"] = pd.to_datetime(out["time"], utc=False)
    out = out.sort_values("time").drop_duplicates("time").set_index("time")

    for col in ["open", "high", "low", "close", "spread", "spread_price"]:
        if col not in out.columns:
            continue
        out[col] = pd.to_numeric(out[col], errors="raise")

    return out


def load_csv_ohlc(path: str | Path) -> pd.DataFrame:
    return normalize_ohlc(pd.read_csv(path))
