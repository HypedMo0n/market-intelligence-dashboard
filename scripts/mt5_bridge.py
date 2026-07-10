from __future__ import annotations

import json
import os
import statistics
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import request

from dotenv import load_dotenv

load_dotenv(".env.local")

try:
    import MetaTrader5 as mt5  # type: ignore
except ImportError as exc:  # pragma: no cover - only runs on local MT5 machine
    raise SystemExit("MetaTrader5 package is required on the local MT5 machine.") from exc


SYMBOLS = ["XAUUSD", "XAGUSD"]
TIMEFRAME = mt5.TIMEFRAME_H1
BAR_COUNT = 160
CANDLE_HISTORY_COUNT = 120


@dataclass
class Snapshot:
    instrument: str
    timestamp: str
    price: float
    atr: float
    trend: str
    structure: str
    volatility: str
    volatility_detail: str
    support: float | None
    resistance: float | None
    recent_high: float | None
    recent_low: float | None
    liquidity_zones: str
    notes: str
    candle_may_be_forming: bool
    candles: list[dict[str, float | str]]


def main() -> int:
    app_url = os.getenv("VERCEL_APP_URL", "").rstrip("/")
    ingest_secret = os.getenv("MT5_INGEST_SECRET", "")
    fred_api_key = os.getenv("FRED_API_KEY", "")

    if not app_url:
        raise SystemExit(
            "VERCEL_APP_URL is required. Check that .env.local exists in the project root, "
            "contains VERCEL_APP_URL, and can be loaded by python-dotenv."
        )
    if not ingest_secret:
        raise SystemExit("MT5_INGEST_SECRET is required.")
    if not fred_api_key:
        print("Warning: FRED_API_KEY is not set in the environment or .env.local.", file=sys.stderr)

    if not mt5.initialize():
        raise SystemExit(f"MT5 initialize failed: {mt5.last_error()}")

    try:
        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None:
            raise SystemExit(f"MT5 account_info returned None: {mt5.last_error()}")
        if terminal is None:
            raise SystemExit(f"MT5 terminal_info returned None: {mt5.last_error()}")
        if not bool(getattr(account, "trade_allowed", False)):
            print("Warning: MT5 account trade_allowed is false. Continuing because this bridge reads data only.", file=sys.stderr)
        if not bool(getattr(terminal, "trade_allowed", False)):
            print("Warning: MT5 terminal AutoTrading/trade_allowed is false. Continuing because this bridge reads data only.", file=sys.stderr)

        login = int(getattr(account, "login", 0))
        if login != 4401376:
            raise SystemExit(f"Connected MT5 account is {login}, expected demo account 4401376.")
        if not is_demo_account(account):
            raise SystemExit("Connected account does not look like a demo account. Refusing to post snapshots.")

        snapshots = []
        for requested_symbol in SYMBOLS:
            actual_symbol = resolve_symbol(requested_symbol)
            if actual_symbol is None:
                print(f"Skipping {requested_symbol}: symbol not selectable", file=sys.stderr)
                continue
            rates = mt5.copy_rates_from_pos(actual_symbol, TIMEFRAME, 0, BAR_COUNT)
            if rates is None or len(rates) < 60:
                print(f"Skipping {requested_symbol}: insufficient candles", file=sys.stderr)
                continue
            snapshots.append(asdict(build_snapshot(requested_symbol, rates)))

        if not snapshots:
            raise SystemExit("No MT5 snapshots were produced.")

        payload = json.dumps({"snapshots": snapshots}).encode("utf-8")
        req = request.Request(
            f"{app_url}/api/mt5-ingest",
            data=payload,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-mt5-ingest-secret": ingest_secret,
            },
        )
        with request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            print(body)
    finally:
        mt5.shutdown()

    return 0


def is_demo_account(account: Any) -> bool:
    server = str(getattr(account, "server", "")).lower()
    company = str(getattr(account, "company", "")).lower()
    name = str(getattr(account, "name", "")).lower()
    return "demo" in server or "demo" in company or "demo" in name


def resolve_symbol(requested_symbol: str) -> str | None:
    candidates = [requested_symbol, f"{requested_symbol}.var"]
    matches = mt5.symbols_get(f"{requested_symbol}*") or []
    candidates.extend(symbol.name for symbol in matches)
    for candidate in dict.fromkeys(candidates):
        info = mt5.symbol_info(candidate)
        if info is not None and mt5.symbol_select(candidate, True):
            return candidate
    return None


def build_snapshot(instrument: str, rates: Any) -> Snapshot:
    bars = [dict(zip(rates.dtype.names, row)) for row in rates]
    closes = [float(bar["close"]) for bar in bars]
    highs = [float(bar["high"]) for bar in bars]
    lows = [float(bar["low"]) for bar in bars]
    current = closes[-1]
    ema = exponential_average(closes[-50:])
    ema_prev = exponential_average(closes[-55:-5])
    atr_values = atr(highs, lows, closes, 14)
    current_atr = atr_values[-1]
    atr_avg = statistics.mean(atr_values[-30:]) if len(atr_values) >= 30 else current_atr

    if current > ema and ema > ema_prev:
        trend = "up"
    elif current < ema and ema < ema_prev:
        trend = "down"
    else:
        trend = "sideways"

    swing_highs, swing_lows = swings(highs, lows, window=2)
    structure = classify_structure(swing_highs[-3:], swing_lows[-3:])
    volatility = classify_volatility(current_atr, atr_avg)
    volatility_detail = describe_volatility(volatility, current_atr, atr_avg)
    recent_high = max(highs[-24:])
    recent_low = min(lows[-24:])
    support = nearest_below(current, swing_lows) or recent_low
    resistance = nearest_above(current, swing_highs) or recent_high
    timestamp = datetime.fromtimestamp(int(bars[-1]["time"]), tz=timezone.utc).isoformat()

    return Snapshot(
        instrument=instrument,
        timestamp=timestamp,
        price=round(current, 5),
        atr=round(current_atr, 5),
        trend=trend,
        structure=structure,
        volatility=volatility,
        volatility_detail=volatility_detail,
        support=round(support, 5) if support is not None else None,
        resistance=round(resistance, 5) if resistance is not None else None,
        recent_high=round(recent_high, 5),
        recent_low=round(recent_low, 5),
        liquidity_zones="Potential stop areas may sit near the recent high and low.",
        notes=f"{instrument} is {trend} on H1 with {structure}; volatility is {volatility}.",
        candle_may_be_forming=True,
        candles=build_candles(bars[-CANDLE_HISTORY_COUNT:]),
    )


def build_candles(bars: list[dict[str, Any]]) -> list[dict[str, float | str]]:
    candles: list[dict[str, float | str]] = []
    for bar in bars:
        candles.append(
            {
                "time": datetime.fromtimestamp(int(bar["time"]), tz=timezone.utc).isoformat(),
                "open": round(float(bar["open"]), 5),
                "high": round(float(bar["high"]), 5),
                "low": round(float(bar["low"]), 5),
                "close": round(float(bar["close"]), 5),
            }
        )
    return candles


def exponential_average(values: list[float]) -> float:
    if not values:
        return 0.0
    alpha = 2 / (len(values) + 1)
    value = values[0]
    for item in values[1:]:
        value = alpha * item + (1 - alpha) * value
    return value


def atr(highs: list[float], lows: list[float], closes: list[float], period: int) -> list[float]:
    ranges = []
    for index in range(1, len(closes)):
        ranges.append(max(highs[index] - lows[index], abs(highs[index] - closes[index - 1]), abs(lows[index] - closes[index - 1])))
    if not ranges:
        return [0.0]
    values = []
    seed = statistics.mean(ranges[:period])
    values.append(seed)
    for true_range in ranges[period:]:
        values.append(((values[-1] * (period - 1)) + true_range) / period)
    return values


def swings(highs: list[float], lows: list[float], window: int) -> tuple[list[float], list[float]]:
    swing_highs: list[float] = []
    swing_lows: list[float] = []
    for index in range(window, len(highs) - window):
        high_slice = highs[index - window : index + window + 1]
        low_slice = lows[index - window : index + window + 1]
        if highs[index] == max(high_slice):
            swing_highs.append(highs[index])
        if lows[index] == min(low_slice):
            swing_lows.append(lows[index])
    return swing_highs, swing_lows


def classify_structure(swing_highs: list[float], swing_lows: list[float]) -> str:
    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        higher_highs = all(a < b for a, b in zip(swing_highs, swing_highs[1:]))
        higher_lows = all(a < b for a, b in zip(swing_lows, swing_lows[1:]))
        lower_highs = all(a > b for a, b in zip(swing_highs, swing_highs[1:]))
        lower_lows = all(a > b for a, b in zip(swing_lows, swing_lows[1:]))
        if higher_highs and higher_lows:
            return "higher highs and higher lows"
        if lower_highs and lower_lows:
            return "lower highs and lower lows"
    return "range or choppy"


def classify_volatility(current_atr: float, average_atr: float) -> str:
    if average_atr <= 0:
        return "normal"
    ratio = current_atr / average_atr
    if ratio >= 1.25:
        return "aggressive"
    if ratio <= 0.75:
        return "calm"
    return "normal"


def describe_volatility(volatility: str, current_atr: float, average_atr: float) -> str:
    if average_atr <= 0:
        return volatility
    ratio = current_atr / average_atr
    if abs(ratio - 0.75) <= 0.05:
        return f"{volatility}, close to calm threshold"
    if abs(ratio - 1.25) <= 0.05:
        return f"{volatility}, close to aggressive threshold"
    return volatility


def nearest_below(price: float, values: list[float]) -> float | None:
    candidates = [value for value in values if value < price]
    return max(candidates) if candidates else None


def nearest_above(price: float, values: list[float]) -> float | None:
    candidates = [value for value in values if value > price]
    return min(candidates) if candidates else None


if __name__ == "__main__":
    raise SystemExit(main())
