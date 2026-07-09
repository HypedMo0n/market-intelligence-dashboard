from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import product
from typing import Iterable

import pandas as pd

from turtleos.backtester import TurtleBacktester
from turtleos.config import TurtleOSConfig
from turtleos.reporting import summarize_result

IN_SAMPLE_START = "2013-12-24"
IN_SAMPLE_END = "2022-12-31"
OUT_OF_SAMPLE_START = "2023-01-01"
OUT_OF_SAMPLE_END = "2026-07-08"


@dataclass(frozen=True)
class ParameterCandidate:
    entry_window: int
    exit_window: int
    atr_period: int
    stop_atr_multiplier: float
    pyramid_atr_interval: float


@dataclass(frozen=True)
class WalkForwardWindow:
    train_start: str
    train_end: str
    test_start: str
    test_end: str


ENTRY_WINDOWS = [15, 20, 25, 40, 55, 70]
STOP_MULTIPLIERS = [1.5, 2.0, 2.5, 3.0]
PYRAMID_INTERVALS = [0.25, 0.5, 0.75]


def split_in_out_sample(ohlc: pd.DataFrame, out_sample_fraction: float = 0.3) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not 0 < out_sample_fraction < 1:
        raise ValueError("out_sample_fraction must be between 0 and 1")
    split_at = int(len(ohlc) * (1 - out_sample_fraction))
    return ohlc.iloc[:split_at].copy(), ohlc.iloc[split_at:].copy()


def run_parameter_sweep(
    ohlc: pd.DataFrame,
    base_config: TurtleOSConfig,
    candidates: Iterable[ParameterCandidate] | None = None,
) -> pd.DataFrame:
    """Run a constrained Turtle parameter sweep for Phase 1 research."""

    if candidates is None:
        candidates = _default_candidates()

    rows: list[dict] = []
    for candidate in candidates:
        config = _config_for_candidate(base_config, candidate)
        result = TurtleBacktester(config).run(ohlc)
        summary = summarize_result(result)
        rows.append(
            {
                **candidate.__dict__,
                "trade_count": summary["trade_count"],
                "win_rate": summary["win_rate"],
                "profit_factor": float("inf") if summary["profit_factor_is_infinite"] else summary["profit_factor"],
                "max_drawdown_pct": summary["max_drawdown_pct"],
                "expectancy": summary["expectancy"],
                "gate_passed": summary["phase_1_gate"]["passed"],
            }
        )
    return pd.DataFrame(rows).sort_values(["expectancy", "max_drawdown_pct"], ascending=[False, True])


def in_sample_slice(ohlc: pd.DataFrame) -> pd.DataFrame:
    return ohlc.loc[(ohlc.index >= pd.Timestamp(IN_SAMPLE_START)) & (ohlc.index <= pd.Timestamp(IN_SAMPLE_END))].copy()


def assert_no_out_of_sample(ohlc: pd.DataFrame) -> None:
    if not ohlc.empty and ohlc.index.max() >= pd.Timestamp(OUT_OF_SAMPLE_START):
        raise ValueError(
            f"Out-of-sample data begins at {OUT_OF_SAMPLE_START}; current operation must stop at {IN_SAMPLE_END}."
        )


def default_phase1_candidates() -> list[ParameterCandidate]:
    return [
        ParameterCandidate(
            entry_window=entry,
            exit_window=max(5, round(entry / 2)),
            atr_period=20,
            stop_atr_multiplier=stop,
            pyramid_atr_interval=pyramid,
        )
        for entry, stop, pyramid in product(ENTRY_WINDOWS, STOP_MULTIPLIERS, PYRAMID_INTERVALS)
    ]


def run_phase1_parameter_sweep(
    symbol_data: dict[str, pd.DataFrame],
    base_config: TurtleOSConfig,
    candidates: Iterable[ParameterCandidate] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    candidates = list(candidates or default_phase1_candidates())
    per_symbol_rows: list[dict] = []

    for symbol, data in symbol_data.items():
        assert_no_out_of_sample(data)
        for candidate in candidates:
            config = replace(base_config, instrument=replace(base_config.instrument, symbol=symbol))
            config = _config_for_candidate(config, candidate)
            summary = summarize_result(TurtleBacktester(config).run(data))
            per_symbol_rows.append(_summary_row(symbol, candidate, summary))

    per_symbol = pd.DataFrame(per_symbol_rows)
    combined = combine_symbol_summaries(per_symbol)
    combined = flag_isolated_peaks(combined)
    return (
        per_symbol.sort_values(["symbol", "expectancy"], ascending=[True, False]).reset_index(drop=True),
        combined.sort_values(["combined_expectancy", "max_symbol_drawdown_pct"], ascending=[False, True]).reset_index(drop=True),
    )


def combine_symbol_summaries(per_symbol: pd.DataFrame) -> pd.DataFrame:
    group_cols = ["entry_window", "exit_window", "atr_period", "stop_atr_multiplier", "pyramid_atr_interval"]
    rows: list[dict] = []
    for keys, group in per_symbol.groupby(group_cols, dropna=False):
        trades = int(group["trade_count"].sum())
        rows.append(
            {
                **dict(zip(group_cols, keys, strict=True)),
                "symbols_tested": ",".join(sorted(group["symbol"].unique())),
                "combined_trade_count": trades,
                "combined_expectancy": _weighted_average(group["expectancy"], group["trade_count"]),
                "combined_win_rate": _weighted_average(group["win_rate"], group["trade_count"]),
                "combined_profit_factor": _profit_factor_from_group(group),
                "max_symbol_drawdown_pct": float(group["max_drawdown_pct"].max()),
                "all_symbols_positive_expectancy": bool((group["expectancy"] > 0).all()),
                "symbols_passing_gate": int(group["gate_passed"].sum()),
            }
        )
    return pd.DataFrame(rows)


def flag_isolated_peaks(combined: pd.DataFrame) -> pd.DataFrame:
    out = combined.copy()
    out["neighbor_count"] = 0
    out["neighbor_expectancy_median"] = pd.NA
    out["isolated_peak_red_flag"] = False

    key_cols = ["entry_window", "stop_atr_multiplier", "pyramid_atr_interval"]
    for idx, row in out.iterrows():
        neighbors = []
        for _, other in out.iterrows():
            diffs = sum(row[col] != other[col] for col in key_cols)
            if diffs != 1:
                continue
            if _is_adjacent(row, other, "entry_window", ENTRY_WINDOWS) or _is_adjacent(
                row, other, "stop_atr_multiplier", STOP_MULTIPLIERS
            ) or _is_adjacent(row, other, "pyramid_atr_interval", PYRAMID_INTERVALS):
                neighbors.append(float(other["combined_expectancy"]))

        if not neighbors:
            continue
        median_neighbor = float(pd.Series(neighbors).median())
        out.at[idx, "neighbor_count"] = len(neighbors)
        out.at[idx, "neighbor_expectancy_median"] = median_neighbor
        expectancy = float(row["combined_expectancy"])
        out.at[idx, "isolated_peak_red_flag"] = expectancy > 0 and median_neighbor < max(0.0, expectancy * 0.5)

    return out


def expanding_walk_forward_windows() -> list[WalkForwardWindow]:
    return [
        WalkForwardWindow(IN_SAMPLE_START, "2018-12-31", "2019-01-01", "2019-12-31"),
        WalkForwardWindow(IN_SAMPLE_START, "2019-12-31", "2020-01-01", "2020-12-31"),
        WalkForwardWindow(IN_SAMPLE_START, "2020-12-31", "2021-01-01", "2021-12-31"),
        WalkForwardWindow(IN_SAMPLE_START, "2021-12-31", "2022-01-01", "2022-12-31"),
    ]


def run_expanding_walk_forward(
    symbol_data: dict[str, pd.DataFrame],
    base_config: TurtleOSConfig,
    candidates: Iterable[ParameterCandidate] | None = None,
    top_n: int = 5,
) -> pd.DataFrame:
    candidates = list(candidates or default_phase1_candidates())
    rows: list[dict] = []

    for window in expanding_walk_forward_windows():
        train_data = {
            symbol: data.loc[(data.index >= pd.Timestamp(window.train_start)) & (data.index <= pd.Timestamp(window.train_end))]
            for symbol, data in symbol_data.items()
        }
        test_data = {
            symbol: data.loc[(data.index >= pd.Timestamp(window.test_start)) & (data.index <= pd.Timestamp(window.test_end))]
            for symbol, data in symbol_data.items()
        }
        _, ranked = run_phase1_parameter_sweep(train_data, base_config, candidates)
        selected = ranked.head(top_n)

        for rank, candidate_row in enumerate(selected.to_dict(orient="records"), start=1):
            candidate = ParameterCandidate(
                entry_window=int(candidate_row["entry_window"]),
                exit_window=int(candidate_row["exit_window"]),
                atr_period=int(candidate_row["atr_period"]),
                stop_atr_multiplier=float(candidate_row["stop_atr_multiplier"]),
                pyramid_atr_interval=float(candidate_row["pyramid_atr_interval"]),
            )
            per_symbol, combined = run_phase1_parameter_sweep(test_data, base_config, [candidate])
            test_row = combined.iloc[0].to_dict()
            rows.append(
                {
                    "train_start": window.train_start,
                    "train_end": window.train_end,
                    "test_start": window.test_start,
                    "test_end": window.test_end,
                    "train_rank": rank,
                    "train_combined_expectancy": candidate_row["combined_expectancy"],
                    "train_max_symbol_drawdown_pct": candidate_row["max_symbol_drawdown_pct"],
                    **test_row,
                }
            )
    return pd.DataFrame(rows)


def walk_forward_validate(
    ohlc: pd.DataFrame,
    base_config: TurtleOSConfig,
    candidate: ParameterCandidate,
    train_bars: int,
    test_bars: int,
) -> pd.DataFrame:
    """Retest fixed parameters on rolling forward windows."""

    if train_bars <= 0 or test_bars <= 0:
        raise ValueError("train_bars and test_bars must be positive")

    config = _config_for_candidate(base_config, candidate)
    rows: list[dict] = []
    start = 0
    while start + train_bars + test_bars <= len(ohlc):
        test_start = start + train_bars
        test_end = test_start + test_bars
        test = ohlc.iloc[test_start:test_end]
        result = TurtleBacktester(config).run(test)
        summary = summarize_result(result)
        rows.append(
            {
                "train_start": str(ohlc.index[start]),
                "train_end": str(ohlc.index[test_start - 1]),
                "test_start": str(test.index[0]),
                "test_end": str(test.index[-1]),
                "trade_count": summary["trade_count"],
                "expectancy": summary["expectancy"],
                "profit_factor": float("inf") if summary["profit_factor_is_infinite"] else summary["profit_factor"],
                "max_drawdown_pct": summary["max_drawdown_pct"],
                "gate_passed": summary["phase_1_gate"]["passed"],
            }
        )
        start += test_bars
    return pd.DataFrame(rows)


def _config_for_candidate(base: TurtleOSConfig, candidate: ParameterCandidate) -> TurtleOSConfig:
    rules = replace(
        base.rules,
        entry_window=candidate.entry_window,
        exit_window=candidate.exit_window,
        atr_period=candidate.atr_period,
        stop_atr_multiplier=candidate.stop_atr_multiplier,
        pyramid_atr_interval=candidate.pyramid_atr_interval,
    )
    return replace(base, rules=rules)


def _default_candidates() -> list[ParameterCandidate]:
    return default_phase1_candidates()


def _summary_row(symbol: str, candidate: ParameterCandidate, summary: dict) -> dict:
    return {
        "symbol": symbol,
        **candidate.__dict__,
        "trade_count": summary["trade_count"],
        "win_rate": summary["win_rate"],
        "profit_factor": float("inf") if summary["profit_factor_is_infinite"] else summary["profit_factor"],
        "max_drawdown_pct": summary["max_drawdown_pct"],
        "expectancy": summary["expectancy"],
        "gross_profit": summary["gross_profit"],
        "gross_loss": summary["gross_loss"],
        "gate_passed": summary["phase_1_gate"]["passed"],
    }


def _weighted_average(values: pd.Series, weights: pd.Series) -> float:
    total_weight = float(weights.sum())
    if total_weight == 0:
        return 0.0
    return float((values * weights).sum() / total_weight)


def _profit_factor_from_group(group: pd.DataFrame) -> float:
    gross_profit = float(group["gross_profit"].sum())
    gross_loss = float(group["gross_loss"].sum())
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def _is_adjacent(left: pd.Series, right: pd.Series, col: str, values: list[float | int]) -> bool:
    if left[col] == right[col]:
        return False
    left_idx = values.index(left[col])
    right_idx = values.index(right[col])
    other_cols = {"entry_window", "stop_atr_multiplier", "pyramid_atr_interval"} - {col}
    return abs(left_idx - right_idx) == 1 and all(left[other] == right[other] for other in other_cols)
