from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import pandas as pd

from turtleos.config import TurtleOSConfig
from turtleos.fees import commission_for_lots, spread_adjusted_price
from turtleos.rules import build_rule_frame
from turtleos.sizing import volatility_adjusted_lots


@dataclass
class PositionUnit:
    direction: int
    entry_time: pd.Timestamp
    entry_price: float
    raw_entry_price: float
    lots: float
    atr_at_entry: float
    stop_price: float
    entry_commission: float
    pyramid_index: int


@dataclass
class TradeRecord:
    symbol: str
    direction: str
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    lots: float
    stop_price: float
    pyramid_index: int
    exit_reason: str
    gross_pl: float
    commission: float
    net_pl: float


@dataclass
class EventRecord:
    time: str
    event_type: str
    direction: str
    price: float
    lots: float
    stop_price: float
    pyramid_index: int
    reason: str


@dataclass
class BacktestResult:
    config: TurtleOSConfig
    trades: list[TradeRecord]
    events: list[EventRecord]
    equity_curve: pd.DataFrame
    ranges: list[tuple[str, str]] | None = None

    def trades_as_dicts(self) -> list[dict]:
        return [asdict(trade) for trade in self.trades]

    def events_as_dicts(self) -> list[dict]:
        return [asdict(event) for event in self.events]


class TurtleBacktester:
    def __init__(self, config: TurtleOSConfig = TurtleOSConfig(), pause_new_entries_dates: set[pd.Timestamp] | None = None) -> None:
        self.config = config
        self.pause_new_entries_dates = {pd.Timestamp(date).normalize() for date in pause_new_entries_dates or set()}

    def run(
        self,
        ohlc: pd.DataFrame,
        ranges: Iterable[tuple[str | pd.Timestamp, str | pd.Timestamp]] | None = None,
    ) -> BacktestResult:
        if ranges is None:
            slices = [(ohlc.index.min(), ohlc.index.max(), ohlc)]
        else:
            slices = []
            for start, end in ranges:
                start_ts = pd.Timestamp(start)
                end_ts = pd.Timestamp(end)
                slices.append((start_ts, end_ts, ohlc.loc[(ohlc.index >= start_ts) & (ohlc.index <= end_ts)]))

        all_trades: list[TradeRecord] = []
        all_events: list[EventRecord] = []
        all_equity: list[pd.DataFrame] = []

        for start, end, data_slice in slices:
            if data_slice.empty:
                continue
            result = self._run_single(data_slice)
            all_trades.extend(result.trades)
            all_events.extend(result.events)
            all_equity.append(result.equity_curve)

        equity_curve = pd.concat(all_equity).sort_index() if all_equity else pd.DataFrame()
        range_labels = [(str(start), str(end)) for start, end, _ in slices]
        return BacktestResult(self.config, all_trades, all_events, equity_curve, range_labels)

    def _run_single(self, ohlc: pd.DataFrame) -> BacktestResult:
        frame = build_rule_frame(ohlc, self.config.rules)
        realized_pl = 0.0
        units: list[PositionUnit] = []
        trades: list[TradeRecord] = []
        events: list[EventRecord] = []
        equity_rows: list[dict] = []
        last_add_raw_price: float | None = None
        peak_equity = self.config.backtest.initial_equity

        for time, row in frame.iterrows():
            spread_points = self._spread_for_row(row)
            if pd.isna(row["atr"]) or pd.isna(row["long_entry"]) or pd.isna(row["long_exit"]):
                equity_row = self._equity_row(time, row["close"], spread_points, realized_pl, units)
                peak_equity = max(peak_equity, equity_row["equity"])
                equity_rows.append(equity_row)
                continue

            blocked_new_entry = False

            for unit in list(units):
                stop_hit = row["low"] <= unit.stop_price if unit.direction == 1 else row["high"] >= unit.stop_price
                if stop_hit:
                    realized_pl += self._close_unit(unit, time, unit.stop_price, spread_points, "stop", trades, events)
                    units.remove(unit)
                    blocked_new_entry = True

            if units:
                direction = units[0].direction
                channel_exit = (
                    direction == 1 and bool(row["long_channel_exit"])
                ) or (
                    direction == -1 and bool(row["short_channel_exit"])
                )
                if channel_exit:
                    raw_exit = float(row["close"])
                    for unit in list(units):
                        realized_pl += self._close_unit(unit, time, raw_exit, spread_points, "channel_exit", trades, events)
                        units.remove(unit)
                    blocked_new_entry = True

            equity_snapshot = self._equity_row(time, row["close"], spread_points, realized_pl, units)
            peak_equity = max(peak_equity, equity_snapshot["equity"])
            risk_paused = self._risk_paused(time, equity_snapshot["equity"], peak_equity)

            if units and not risk_paused:
                added = self._maybe_add_pyramid_unit(
                    time=time,
                    row=row,
                    units=units,
                    realized_pl=realized_pl,
                    events=events,
                    last_add_raw_price=last_add_raw_price,
                )
                if added is not None:
                    unit, commission = added
                    units.append(unit)
                    realized_pl -= commission
                    last_add_raw_price = unit.raw_entry_price

            if not units:
                last_add_raw_price = None

            if not units and not blocked_new_entry and not risk_paused:
                direction = 0
                if bool(row["long_breakout"]):
                    direction = 1
                elif self.config.rules.allow_short and bool(row["short_breakout"]):
                    direction = -1

                if direction:
                    raw_entry = float(row["close"])
                    unit = self._open_unit(time, raw_entry, direction, float(row["atr"]), spread_points, realized_pl, 0)
                    if unit is not None:
                        units.append(unit)
                        realized_pl -= unit.entry_commission
                        last_add_raw_price = unit.raw_entry_price
                        events.append(
                            self._event(time, "entry", direction, unit.entry_price, unit.lots, unit.stop_price, 0, "breakout")
                        )

            equity_row = self._equity_row(time, row["close"], spread_points, realized_pl, units)
            peak_equity = max(peak_equity, equity_row["equity"])
            equity_row["new_entries_paused"] = risk_paused
            equity_rows.append(equity_row)

        if units:
            final_time = frame.index[-1]
            final_price = float(frame.iloc[-1]["close"])
            final_spread = self._spread_for_row(frame.iloc[-1])
            for unit in list(units):
                realized_pl += self._close_unit(unit, final_time, final_price, final_spread, "end_of_data", trades, events)
                units.remove(unit)
            equity_rows.append(self._equity_row(final_time, final_price, final_spread, realized_pl, units))

        equity_curve = pd.DataFrame(equity_rows).drop_duplicates("time", keep="last").set_index("time")
        return BacktestResult(self.config, trades, events, equity_curve)

    def _maybe_add_pyramid_unit(
        self,
        time: pd.Timestamp,
        row: pd.Series,
        units: list[PositionUnit],
        realized_pl: float,
        events: list[EventRecord],
        last_add_raw_price: float | None,
    ) -> tuple[PositionUnit, float] | None:
        if len(units) >= self.config.rules.max_pyramid_units or last_add_raw_price is None:
            return None

        direction = units[0].direction
        interval = self.config.rules.pyramid_atr_interval * float(row["atr"])
        threshold = last_add_raw_price + interval if direction == 1 else last_add_raw_price - interval
        hit = row["high"] >= threshold if direction == 1 else row["low"] <= threshold
        if not hit:
            return None

        spread_points = self._spread_for_row(row)
        unrealized = self._unrealized_pl(float(row["close"]), units, spread_points)
        current_equity = self.config.backtest.initial_equity + realized_pl + unrealized
        existing_lots = sum(unit.lots for unit in units)
        lots = volatility_adjusted_lots(
            equity=current_equity,
            atr=float(row["atr"]),
            price=float(row["close"]),
            instrument=self.config.instrument,
            rules=self.config.rules,
            backtest=self.config.backtest,
            existing_lots=existing_lots,
        )
        if lots <= 0:
            return None

        entry_price = spread_adjusted_price(threshold, direction, True, spread_points)
        stop_price = threshold - (self.config.rules.stop_atr_multiplier * float(row["atr"]) * direction)
        if not self._open_risk_allowed(units, threshold, stop_price, lots, current_equity):
            return None
        commission = commission_for_lots(lots, self.config.fees)
        pyramid_index = len(units)
        unit = PositionUnit(direction, time, entry_price, threshold, lots, float(row["atr"]), stop_price, commission, pyramid_index)
        events.append(self._event(time, "pyramid", direction, entry_price, lots, stop_price, pyramid_index, "0.5N_add"))
        return unit, commission

    def _open_unit(
        self,
        time: pd.Timestamp,
        raw_entry: float,
        direction: int,
        atr: float,
        spread_points: float,
        realized_pl: float,
        pyramid_index: int,
    ) -> PositionUnit | None:
        current_equity = self.config.backtest.initial_equity + realized_pl
        lots = volatility_adjusted_lots(
            equity=current_equity,
            atr=atr,
            price=raw_entry,
            instrument=self.config.instrument,
            rules=self.config.rules,
            backtest=self.config.backtest,
            existing_lots=0.0,
        )
        if lots <= 0:
            return None

        entry_price = spread_adjusted_price(raw_entry, direction, True, spread_points)
        stop_price = raw_entry - (self.config.rules.stop_atr_multiplier * atr * direction)
        if not self._open_risk_allowed([], raw_entry, stop_price, lots, current_equity):
            return None
        commission = commission_for_lots(lots, self.config.fees)
        return PositionUnit(direction, time, entry_price, raw_entry, lots, atr, stop_price, commission, pyramid_index)

    def _close_unit(
        self,
        unit: PositionUnit,
        exit_time: pd.Timestamp,
        raw_exit_price: float,
        spread_points: float,
        reason: str,
        trades: list[TradeRecord],
        events: list[EventRecord],
    ) -> float:
        exit_price = spread_adjusted_price(raw_exit_price, unit.direction, False, spread_points)
        gross = (
            (exit_price - unit.entry_price)
            * unit.direction
            * unit.lots
            * self.config.instrument.dollar_per_point_per_lot
        )
        exit_commission = commission_for_lots(unit.lots, self.config.fees) if self.config.fees.charge_exit_commission else 0.0
        total_commission = unit.entry_commission + exit_commission
        net = gross - total_commission
        direction_label = "long" if unit.direction == 1 else "short"
        trades.append(
            TradeRecord(
                symbol=self.config.instrument.symbol,
                direction=direction_label,
                entry_time=str(unit.entry_time),
                exit_time=str(exit_time),
                entry_price=unit.entry_price,
                exit_price=exit_price,
                lots=unit.lots,
                stop_price=unit.stop_price,
                pyramid_index=unit.pyramid_index,
                exit_reason=reason,
                gross_pl=gross,
                commission=total_commission,
                net_pl=net,
            )
        )
        events.append(self._event(exit_time, "exit", unit.direction, exit_price, unit.lots, unit.stop_price, unit.pyramid_index, reason))
        return gross - exit_commission

    def _equity_row(
        self,
        time: pd.Timestamp,
        close_price: float,
        spread_points: float,
        realized_pl: float,
        units: list[PositionUnit],
    ) -> dict:
        unrealized = self._unrealized_pl(close_price, units, spread_points)
        equity = self.config.backtest.initial_equity + realized_pl + unrealized
        return {
            "time": time,
            "realized_pl": realized_pl,
            "unrealized_pl": unrealized,
            "equity": equity,
            "open_units": len(units),
            "open_lots": sum(unit.lots for unit in units),
            "exposure_pct": self._exposure_pct(close_price, equity, units),
            "open_risk_pct": self._open_risk(units) / equity if equity > 0 else 0.0,
            "new_entries_paused": False,
        }

    def _unrealized_pl(self, raw_price: float, units: list[PositionUnit], spread_points: float) -> float:
        return sum(
            (spread_adjusted_price(raw_price, unit.direction, False, spread_points) - unit.entry_price)
            * unit.direction
            * unit.lots
            * self.config.instrument.dollar_per_point_per_lot
            for unit in units
        )

    def _spread_for_row(self, row: pd.Series) -> float:
        if "spread_price" in row and pd.notna(row["spread_price"]):
            return float(row["spread_price"])
        return self.config.instrument.spread_points

    def _risk_paused(self, time: pd.Timestamp, equity: float, peak_equity: float) -> bool:
        if pd.Timestamp(time).normalize() in self.pause_new_entries_dates:
            return True
        pause_pct = self.config.backtest.symbol_drawdown_pause_pct
        if pause_pct is None or peak_equity <= 0:
            return False
        drawdown_pct = max(0.0, (peak_equity - equity) / peak_equity)
        return drawdown_pct >= pause_pct

    def _open_risk_allowed(
        self,
        units: list[PositionUnit],
        raw_entry: float,
        stop_price: float,
        lots: float,
        equity: float,
    ) -> bool:
        cap = self.config.backtest.max_open_risk_pct
        if cap is None:
            return True
        new_risk = abs(raw_entry - stop_price) * lots * self.config.instrument.dollar_per_point_per_lot
        return self._open_risk(units) + new_risk <= equity * cap

    def _open_risk(self, units: list[PositionUnit]) -> float:
        return sum(
            abs(unit.raw_entry_price - unit.stop_price) * unit.lots * self.config.instrument.dollar_per_point_per_lot
            for unit in units
        )

    def _exposure_pct(self, close_price: float, equity: float, units: list[PositionUnit]) -> float:
        if equity <= 0:
            return 0.0
        notional = sum(unit.lots for unit in units) * close_price * self.config.instrument.contract_size
        return notional / equity

    @staticmethod
    def _event(
        time: pd.Timestamp,
        event_type: str,
        direction: int,
        price: float,
        lots: float,
        stop_price: float,
        pyramid_index: int,
        reason: str,
    ) -> EventRecord:
        return EventRecord(
            time=str(time),
            event_type=event_type,
            direction="long" if direction == 1 else "short",
            price=price,
            lots=lots,
            stop_price=stop_price,
            pyramid_index=pyramid_index,
            reason=reason,
        )
