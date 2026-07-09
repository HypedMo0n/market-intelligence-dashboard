from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd

from turtleos.data.csv_loader import normalize_ohlc
from turtleos.data.mt5_connection import MT5Connection, MT5ConnectionConfig, MT5ConnectionError


class MT5HistoricalLoader:
    """Historical OHLC loader for MT5.

    Manual review required before any future demo/live execution: this class is
    historical-data only and must not be expanded into order placement without
    satisfying the PRD phase gates and risk-control checklist.
    """

    max_copy_rates_from_count = 50_000

    def __init__(self, config: MT5ConnectionConfig | None = None, terminal_path: str | None = None) -> None:
        if config is None and terminal_path is not None:
            config = MT5ConnectionConfig(terminal_path=terminal_path)
        self.connection = MT5Connection(config)
        self._mt5: Any | None = None
        self.last_symbol: str | None = None

    def initialize(self) -> None:
        self._mt5 = self.connection.connect()

    def shutdown(self) -> None:
        self.connection.disconnect()
        self._mt5 = None

    def copy_rates_range(
        self,
        symbol: str,
        timeframe: int,
        date_from: datetime,
        date_to: datetime,
    ) -> pd.DataFrame:
        if self._mt5 is None:
            self.initialize()
        actual_symbol = self.resolve_symbol(symbol)
        rates = self._mt5.copy_rates_range(actual_symbol, timeframe, date_from, date_to)
        if rates is None:
            raise MT5ConnectionError(f"MT5 copy_rates_range failed for {actual_symbol}: {self._mt5.last_error()}")
        return self._rates_to_ohlc(rates, self._symbol_point(actual_symbol))

    def copy_rates_from(
        self,
        symbol: str,
        timeframe: int,
        date_from: datetime,
        count: int,
    ) -> pd.DataFrame:
        if self._mt5 is None:
            self.initialize()
        actual_symbol = self.resolve_symbol(symbol)
        rates = self._mt5.copy_rates_from(actual_symbol, timeframe, date_from, self._effective_count(count))
        if rates is None:
            raise MT5ConnectionError(f"MT5 copy_rates_from failed for {actual_symbol}: {self._mt5.last_error()}")
        return self._rates_to_ohlc(rates, self._symbol_point(actual_symbol))

    def resolve_symbol(self, requested_symbol: str) -> str:
        if self._mt5 is None:
            self.initialize()

        candidates = [requested_symbol]
        exact = self._mt5.symbol_info(requested_symbol)
        if exact is None:
            matches = self._mt5.symbols_get(f"{requested_symbol}*") or []
            candidates.extend(symbol.name for symbol in matches)

        for candidate in dict.fromkeys(candidates):
            info = self._mt5.symbol_info(candidate)
            if info is not None and self._mt5.symbol_select(candidate, True):
                self.last_symbol = candidate
                return candidate

        visible = ", ".join(candidates[1:]) or "none"
        raise MT5ConnectionError(
            f"MT5 symbol '{requested_symbol}' is not available/selectable. Matching broker symbols: {visible}"
        )

    def discover_available_depth(
        self,
        symbol: str,
        timeframe: int,
        date_from: datetime,
        count: int = 1_000_000,
    ) -> dict[str, object]:
        actual_symbol = self.resolve_symbol(symbol)
        data = self.copy_rates_from(actual_symbol, timeframe, date_from, count)
        return {
            "requested_symbol": symbol,
            "actual_symbol": actual_symbol,
            "requested_bars": count,
            "effective_requested_bars": self._effective_count(count),
            "bars": int(len(data)),
            "first_bar": str(data.index.min()),
            "last_bar": str(data.index.max()),
        }

    def _effective_count(self, count: int) -> int:
        if self.connection.terminal_info is None:
            return count
        maxbars = getattr(self.connection.terminal_info, "maxbars", None)
        if maxbars and count > maxbars:
            count = int(maxbars)
        return min(count, self.max_copy_rates_from_count)

    def _symbol_point(self, symbol: str) -> float:
        info = self._mt5.symbol_info(symbol)
        if info is None:
            raise MT5ConnectionError(f"MT5 symbol_info returned None for selected symbol {symbol}")
        point = getattr(info, "point", None)
        if point is None or point <= 0:
            raise MT5ConnectionError(f"MT5 symbol_info has invalid point value for {symbol}: {point}")
        return float(point)

    @staticmethod
    def _rates_to_ohlc(rates: Any, point: float | None = None) -> pd.DataFrame:
        if rates is None or len(rates) == 0:
            raise ValueError("MT5 returned no historical rates")
        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        if "spread" in df.columns and point is not None:
            df["spread_price"] = df["spread"] * point
        return normalize_ohlc(df)
