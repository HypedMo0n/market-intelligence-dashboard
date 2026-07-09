from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import product
import json
from pathlib import Path

import pandas as pd

from turtleos.backtester import BacktestResult, TurtleBacktester
from turtleos.config import BacktestConfig, TurtleOSConfig
from turtleos.reporting import summarize_result
from turtleos.research.validation import ParameterCandidate, assert_no_out_of_sample


@dataclass(frozen=True)
class ExposureProfile:
    name: str
    max_total_lots: float
    max_account_leverage: float


@dataclass(frozen=True)
class DrawdownPolicy:
    name: str
    symbol_drawdown_pause_pct: float | None
    portfolio_drawdown_pause_pct: float | None


@dataclass(frozen=True)
class RiskControlConfig:
    candidate_name: str
    candidate: ParameterCandidate
    risk_per_unit_pct: float
    exposure_profile: ExposureProfile
    max_open_risk_pct: float | None
    drawdown_policy: DrawdownPolicy


RISK_PER_UNIT_VALUES = [0.01, 0.0075, 0.005, 0.0025]
EXPOSURE_PROFILES = [
    ExposureProfile("base_10_lots_5x", 10.0, 5.0),
    ExposureProfile("capped_2_lots_2x", 2.0, 2.0),
]
OPEN_RISK_CAPS = [0.04, 0.02]
DD_POLICIES = [
    DrawdownPolicy("none", None, None),
    DrawdownPolicy("symbol_pause_15", 0.15, None),
    DrawdownPolicy("symbol_pause_20", 0.20, None),
    DrawdownPolicy("symbol_pause_25", 0.25, None),
    DrawdownPolicy("portfolio_pause_15", None, 0.15),
    DrawdownPolicy("portfolio_pause_20", None, 0.20),
    DrawdownPolicy("portfolio_pause_25", None, 0.25),
    DrawdownPolicy("symbol_and_portfolio_pause_15", 0.15, 0.15),
    DrawdownPolicy("symbol_and_portfolio_pause_20", 0.20, 0.20),
    DrawdownPolicy("symbol_and_portfolio_pause_25", 0.25, 0.25),
]


def candidates_from_prior_summary(path: str | Path, top_n: int = 3) -> list[tuple[str, ParameterCandidate]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        summary = json.load(handle)
    rows = summary["top_combined_candidates"]
    selected: list[tuple[str, ParameterCandidate]] = []
    for row in rows:
        if row.get("isolated_peak_red_flag"):
            continue
        if not row.get("all_symbols_positive_expectancy"):
            continue
        candidate = ParameterCandidate(
            entry_window=int(row["entry_window"]),
            exit_window=int(row["exit_window"]),
            atr_period=int(row["atr_period"]),
            stop_atr_multiplier=float(row["stop_atr_multiplier"]),
            pyramid_atr_interval=float(row["pyramid_atr_interval"]),
        )
        name = (
            f"entry_{candidate.entry_window}_exit_{candidate.exit_window}_"
            f"stop_{candidate.stop_atr_multiplier}_pyr_{candidate.pyramid_atr_interval}"
        )
        selected.append((name, candidate))
        if len(selected) >= top_n:
            break
    if not selected:
        raise ValueError("No non-isolated positive-expectancy candidates found in prior summary")
    return selected


def default_risk_control_grid(candidates: list[tuple[str, ParameterCandidate]]) -> list[RiskControlConfig]:
    configs: list[RiskControlConfig] = []
    for (candidate_name, candidate), risk_pct, exposure, open_risk, policy in product(
        candidates,
        RISK_PER_UNIT_VALUES,
        EXPOSURE_PROFILES,
        OPEN_RISK_CAPS,
        DD_POLICIES,
    ):
        configs.append(
            RiskControlConfig(
                candidate_name=candidate_name,
                candidate=candidate,
                risk_per_unit_pct=risk_pct,
                exposure_profile=exposure,
                max_open_risk_pct=open_risk,
                drawdown_policy=policy,
            )
        )
    return configs


def run_risk_control_sweep(
    symbol_data: dict[str, pd.DataFrame],
    base_config: TurtleOSConfig,
    configs: list[RiskControlConfig],
    portfolio_iterations: int = 3,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    for data in symbol_data.values():
        assert_no_out_of_sample(data)

    summary_rows: list[dict] = []
    per_symbol_rows: list[dict] = []
    for index, risk_config in enumerate(configs, start=1):
        results = _run_with_portfolio_pause(symbol_data, base_config, risk_config, portfolio_iterations)
        per_symbol_summary = _per_symbol_summary(results)
        combined = _combined_summary(results, per_symbol_summary)
        summary_rows.append(
            {
                "config_id": index,
                "candidate_name": risk_config.candidate_name,
                "entry_window": risk_config.candidate.entry_window,
                "exit_window": risk_config.candidate.exit_window,
                "atr_period": risk_config.candidate.atr_period,
                "stop_atr_multiplier": risk_config.candidate.stop_atr_multiplier,
                "pyramid_atr_interval": risk_config.candidate.pyramid_atr_interval,
                "risk_per_unit_pct": risk_config.risk_per_unit_pct,
                "exposure_profile": risk_config.exposure_profile.name,
                "max_total_lots": risk_config.exposure_profile.max_total_lots,
                "max_account_leverage": risk_config.exposure_profile.max_account_leverage,
                "max_open_risk_pct": risk_config.max_open_risk_pct,
                "symbol_drawdown_pause_pct": risk_config.drawdown_policy.symbol_drawdown_pause_pct,
                "portfolio_drawdown_pause_pct": risk_config.drawdown_policy.portfolio_drawdown_pause_pct,
                "drawdown_policy": risk_config.drawdown_policy.name,
                **combined,
            }
        )
        for row in per_symbol_summary:
            per_symbol_rows.append({"config_id": index, **row})

    summary = pd.DataFrame(summary_rows).sort_values(
        ["drawdown_gate_passed", "all_symbols_positive_expectancy", "max_drawdown_pct", "expectancy"],
        ascending=[False, False, True, False],
    )
    return summary.reset_index(drop=True), pd.DataFrame(per_symbol_rows)


def _run_with_portfolio_pause(
    symbol_data: dict[str, pd.DataFrame],
    base_config: TurtleOSConfig,
    risk_config: RiskControlConfig,
    iterations: int,
) -> dict[str, BacktestResult]:
    pause_dates: set[pd.Timestamp] = set()
    results: dict[str, BacktestResult] = {}
    for _ in range(iterations):
        results = {
            symbol: TurtleBacktester(
                _config_for_symbol(base_config, symbol, risk_config),
                pause_new_entries_dates=pause_dates,
            ).run(data)
            for symbol, data in symbol_data.items()
        }
        next_pause_dates = _portfolio_pause_dates(results, risk_config.drawdown_policy.portfolio_drawdown_pause_pct)
        if next_pause_dates == pause_dates:
            break
        pause_dates = next_pause_dates
    return results


def _config_for_symbol(base_config: TurtleOSConfig, symbol: str, risk_config: RiskControlConfig) -> TurtleOSConfig:
    rules = replace(
        base_config.rules,
        entry_window=risk_config.candidate.entry_window,
        exit_window=risk_config.candidate.exit_window,
        atr_period=risk_config.candidate.atr_period,
        stop_atr_multiplier=risk_config.candidate.stop_atr_multiplier,
        pyramid_atr_interval=risk_config.candidate.pyramid_atr_interval,
        risk_per_unit_pct=risk_config.risk_per_unit_pct,
        max_pyramid_units=4,
    )
    backtest = replace(
        base_config.backtest,
        max_total_lots=risk_config.exposure_profile.max_total_lots,
        max_account_leverage=risk_config.exposure_profile.max_account_leverage,
        max_open_risk_pct=risk_config.max_open_risk_pct,
        symbol_drawdown_pause_pct=risk_config.drawdown_policy.symbol_drawdown_pause_pct,
    )
    return replace(base_config, instrument=replace(base_config.instrument, symbol=symbol), rules=rules, backtest=backtest)


def _portfolio_pause_dates(results: dict[str, BacktestResult], threshold: float | None) -> set[pd.Timestamp]:
    if threshold is None:
        return set()
    curve = _portfolio_equity_curve(results)
    running_peak = curve["equity"].cummax()
    drawdown_pct = (running_peak - curve["equity"]) / running_peak
    return {pd.Timestamp(idx).normalize() for idx, value in drawdown_pct.items() if value >= threshold}


def _portfolio_equity_curve(results: dict[str, BacktestResult]) -> pd.DataFrame:
    equity_frames = []
    for symbol, result in results.items():
        frame = result.equity_curve[["equity", "exposure_pct"]].copy()
        frame = frame.rename(columns={"equity": f"{symbol}_equity", "exposure_pct": f"{symbol}_exposure_pct"})
        equity_frames.append(frame)
    portfolio = pd.concat(equity_frames, axis=1).sort_index().ffill().dropna(how="all")
    equity_cols = [col for col in portfolio.columns if col.endswith("_equity")]
    exposure_cols = [col for col in portfolio.columns if col.endswith("_exposure_pct")]
    initial_total = sum(result.config.backtest.initial_equity for result in results.values())
    portfolio["equity"] = portfolio[equity_cols].sum(axis=1)
    portfolio["exposure_pct"] = portfolio[exposure_cols].sum(axis=1) if exposure_cols else 0.0
    if portfolio.empty:
        return pd.DataFrame({"equity": [initial_total], "exposure_pct": [0.0]})
    return portfolio[["equity", "exposure_pct"]]


def _per_symbol_summary(results: dict[str, BacktestResult]) -> list[dict]:
    rows: list[dict] = []
    for symbol, result in results.items():
        summary = summarize_result(result)
        curve = result.equity_curve
        rows.append(
            {
                "symbol": symbol,
                "expectancy": summary["expectancy"],
                "profit_factor": summary["profit_factor"],
                "max_drawdown_pct": summary["max_drawdown_pct"],
                "net_profit": summary["net_profit"],
                "trade_count": summary["trade_count"],
                "max_exposure_pct": float(curve["exposure_pct"].max()) if not curve.empty else 0.0,
                "positive_expectancy": summary["expectancy"] > 0,
                "drawdown_gate_passed": summary["max_drawdown_pct"] <= 0.25,
            }
        )
    return rows


def _combined_summary(results: dict[str, BacktestResult], per_symbol: list[dict]) -> dict:
    portfolio_curve = _portfolio_equity_curve(results)
    running_peak = portfolio_curve["equity"].cummax()
    drawdown_pct = ((running_peak - portfolio_curve["equity"]) / running_peak).fillna(0.0)
    trades = [trade for result in results.values() for trade in result.trades]
    wins = [trade.net_pl for trade in trades if trade.net_pl > 0]
    losses = [trade.net_pl for trade in trades if trade.net_pl < 0]
    gross_profit = float(sum(wins))
    gross_loss = abs(float(sum(losses)))
    trade_count = len(trades)
    expectancy = float(sum(trade.net_pl for trade in trades) / trade_count) if trade_count else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss else (float("inf") if gross_profit > 0 else 0.0)
    max_drawdown_pct = float(drawdown_pct.max()) if not drawdown_pct.empty else 0.0
    initial_total = sum(result.config.backtest.initial_equity for result in results.values())
    ending_equity = float(portfolio_curve["equity"].iloc[-1]) if not portfolio_curve.empty else initial_total
    return {
        "expectancy": expectancy,
        "profit_factor": profit_factor,
        "max_drawdown_pct": max_drawdown_pct,
        "net_profit": ending_equity - initial_total,
        "trade_count": trade_count,
        "max_exposure_pct": float(portfolio_curve["exposure_pct"].max()) if not portfolio_curve.empty else 0.0,
        "all_symbols_positive_expectancy": all(row["positive_expectancy"] for row in per_symbol),
        "drawdown_gate_passed": max_drawdown_pct <= 0.25,
    }
