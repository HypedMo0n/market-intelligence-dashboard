from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from turtleos.backtester import BacktestResult, TurtleBacktester
from turtleos.config import BacktestConfig, InstrumentConfig, TurtleOSConfig, TurtleRulesConfig
from turtleos.reporting import summarize_result
from turtleos.research.risk_control import _portfolio_equity_curve
from turtleos.research.validation import IN_SAMPLE_END, IN_SAMPLE_START, ParameterCandidate, assert_no_out_of_sample


METRICS = ["profit_factor", "expectancy", "net_profit", "max_drawdown_pct", "win_rate"]


@dataclass(frozen=True)
class RobustnessInputs:
    symbol_data: dict[str, pd.DataFrame]
    survivor_csv: Path
    output_dir: Path
    initial_equity: float = 10_000.0
    simulations: int = 10_000
    random_seed: int = 42


def run_robustness_report(inputs: RobustnessInputs) -> dict:
    for data in inputs.symbol_data.values():
        assert_no_out_of_sample(data)
    inputs.output_dir.mkdir(parents=True, exist_ok=True)

    risk_sweep = pd.read_csv(inputs.survivor_csv)
    survivors = risk_sweep[risk_sweep["drawdown_gate_passed"] == True].copy()  # noqa: E712
    if survivors.empty:
        raise ValueError("No drawdown-gate-passing configurations found")

    stability = build_stability_table(survivors)
    stability = enrich_stability_win_rate(stability, survivors, inputs.symbol_data, inputs.initial_equity)
    stability_path = inputs.output_dir / "parameter-stability-rankings.csv"
    stability.to_csv(stability_path, index=False)
    heatmap_paths = write_stability_heatmaps(stability, inputs.output_dir)

    strongest = choose_strongest_candidate(survivors)
    exact_results = run_exact_candidate(inputs.symbol_data, strongest, inputs.initial_equity)
    trades = combined_trades(exact_results)
    equity = _portfolio_equity_curve(exact_results)
    trades_path = inputs.output_dir / "strongest-candidate-trades.csv"
    equity_path = inputs.output_dir / "strongest-candidate-equity.csv"
    trades.to_csv(trades_path, index=False)
    equity.to_csv(equity_path)

    neighborhood = run_neighborhood(inputs.symbol_data, strongest, inputs.initial_equity)
    neighborhood_path = inputs.output_dir / "neighborhood-analysis.csv"
    neighborhood.to_csv(neighborhood_path, index=False)

    rng = np.random.default_rng(inputs.random_seed)
    mc_stats, mc_runs = monte_carlo_trade_order(trades["net_pl"].to_numpy(), inputs.initial_equity * len(inputs.symbol_data), inputs.simulations, rng)
    mc_path = inputs.output_dir / "monte-carlo-simulations.csv"
    mc_runs.to_csv(mc_path, index=False)

    boot_stats, boot_runs = bootstrap_trades(trades["net_pl"].to_numpy(), inputs.simulations, rng)
    boot_path = inputs.output_dir / "bootstrap-simulations.csv"
    boot_runs.to_csv(boot_path, index=False)

    distribution = trade_distribution(trades)
    diagnostics = equity_diagnostics(equity, trades)

    chart_paths = {}
    chart_paths["mc_drawdown_histogram"] = write_histogram_svg(
        mc_runs["max_drawdown_pct"],
        inputs.output_dir / "monte-carlo-drawdown-histogram.svg",
        "Monte Carlo Max Drawdown",
        x_label="Max drawdown",
        percent_x=True,
    )
    chart_paths["bootstrap_expectancy_histogram"] = write_histogram_svg(
        boot_runs["expectancy"],
        inputs.output_dir / "bootstrap-expectancy-histogram.svg",
        "Bootstrap Expectancy",
        x_label="Expectancy",
    )
    chart_paths["trade_return_histogram"] = write_histogram_svg(
        trades["net_pl"],
        inputs.output_dir / "trade-return-histogram.svg",
        "Trade P/L Distribution",
        x_label="Net P/L",
    )
    chart_paths["equity_curve"] = write_line_svg(
        equity["equity"],
        inputs.output_dir / "equity-curve.svg",
        "Equity Curve",
        y_label="Equity",
    )
    underwater = ((equity["equity"] / equity["equity"].cummax()) - 1.0).fillna(0.0)
    chart_paths["underwater_drawdown"] = write_line_svg(
        underwater,
        inputs.output_dir / "underwater-drawdown.svg",
        "Underwater Drawdown",
        y_label="Drawdown",
        percent_y=True,
    )
    chart_paths["rolling_profit_factor"] = write_line_svg(
        diagnostics["rolling_profit_factor"],
        inputs.output_dir / "rolling-profit-factor.svg",
        "Rolling Profit Factor",
        y_label="Profit factor",
    )
    chart_paths["rolling_expectancy"] = write_line_svg(
        diagnostics["rolling_expectancy"],
        inputs.output_dir / "rolling-expectancy.svg",
        "Rolling Expectancy",
        y_label="Expectancy",
    )
    chart_paths["rolling_win_rate"] = write_line_svg(
        diagnostics["rolling_win_rate"],
        inputs.output_dir / "rolling-win-rate.svg",
        "Rolling Win Rate",
        y_label="Win rate",
        percent_y=True,
    )
    chart_paths["monthly_returns"] = write_bar_svg(
        distribution["monthly_returns"]["return"],
        inputs.output_dir / "monthly-return-distribution.svg",
        "Monthly Return Distribution",
        y_label="Return",
        percent_y=True,
    )
    chart_paths["annual_returns"] = write_bar_svg(
        distribution["annual_returns"]["return"],
        inputs.output_dir / "annual-return-distribution.svg",
        "Annual Return Distribution",
        y_label="Return",
        percent_y=True,
    )

    distribution_paths = write_distribution_tables(distribution, inputs.output_dir)
    diagnostics_paths = write_diagnostics_tables(diagnostics, inputs.output_dir)

    verdict = final_verdict(stability, neighborhood, mc_stats, boot_stats, diagnostics)
    summary = {
        "phase": "Phase 1 robustness and statistical validation, in-sample only",
        "out_of_sample_guard": "No data on or after 2023-01-01 was loaded or evaluated.",
        "in_sample_period": {"start": IN_SAMPLE_START, "end": IN_SAMPLE_END},
        "strongest_candidate_selection": "Passing drawdown gate, positive expectancy on both symbols, lowest max drawdown, then highest expectancy.",
        "strongest_candidate": _jsonable(strongest.to_dict()),
        "monte_carlo": mc_stats,
        "bootstrap": boot_stats,
        "verdict": verdict,
        "artifacts": {
            "stability_csv": str(stability_path),
            "neighborhood_csv": str(neighborhood_path),
            "trades_csv": str(trades_path),
            "equity_csv": str(equity_path),
            "monte_carlo_csv": str(mc_path),
            "bootstrap_csv": str(boot_path),
            "heatmaps": heatmap_paths,
            "charts": chart_paths,
            "distribution_tables": distribution_paths,
            "diagnostics_tables": diagnostics_paths,
        },
    }
    summary_path = inputs.output_dir / "robustness-summary.json"
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    report_path = write_markdown_report(inputs.output_dir, summary, stability, neighborhood, distribution, diagnostics)
    summary["artifacts"]["markdown_report"] = str(report_path)
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    return summary


def build_stability_table(survivors: pd.DataFrame) -> pd.DataFrame:
    keys = ["entry_window", "stop_atr_multiplier", "pyramid_atr_interval", "risk_per_unit_pct"]
    rows = []
    for key, group in survivors.groupby(keys, dropna=False):
        row = dict(zip(keys, key, strict=True))
        row.update(
            {
                "config_count": int(len(group)),
                "expectancy_median": float(group["expectancy"].median()),
                "expectancy_min": float(group["expectancy"].min()),
                "profit_factor_median": float(group["profit_factor"].median()),
                "net_profit_median": float(group["net_profit"].median()),
                "max_drawdown_pct_median": float(group["max_drawdown_pct"].median()),
                "win_rate_median": np.nan,
                "positive_both_symbols_rate": float(group["all_symbols_positive_expectancy"].mean()),
                "drawdown_gate_rate": float(group["drawdown_gate_passed"].mean()),
                "max_exposure_pct_median": float(group["max_exposure_pct"].median()),
            }
        )
        rows.append(row)
    out = pd.DataFrame(rows)
    out["neighbor_expectancy_median"] = out.apply(lambda row: _neighbor_median(out, row, "expectancy_median"), axis=1)
    out["neighbor_drawdown_median"] = out.apply(lambda row: _neighbor_median(out, row, "max_drawdown_pct_median"), axis=1)
    out["cliff_score"] = (
        (out["expectancy_median"] - out["neighbor_expectancy_median"]).abs().fillna(0)
        / out["expectancy_median"].abs().clip(lower=1.0)
    )
    classifications = out.apply(classify_stability_row, axis=1)
    out["classification"] = [item[0] for item in classifications]
    out["classification_reason"] = [item[1] for item in classifications]
    return out.sort_values(["classification", "max_drawdown_pct_median", "expectancy_median"], ascending=[True, True, False])


def enrich_stability_win_rate(
    stability: pd.DataFrame,
    survivors: pd.DataFrame,
    symbol_data: dict[str, pd.DataFrame],
    initial_equity: float,
) -> pd.DataFrame:
    out = stability.copy()
    keys = ["entry_window", "stop_atr_multiplier", "pyramid_atr_interval", "risk_per_unit_pct"]
    for idx, row in out.iterrows():
        mask = pd.Series(True, index=survivors.index)
        for key in keys:
            mask &= survivors[key] == row[key]
        representative = survivors[mask].sort_values(["max_drawdown_pct", "expectancy"], ascending=[True, False]).iloc[0]
        results = run_exact_candidate(symbol_data, representative, initial_equity)
        trades = combined_trades(results)
        win_rate = float((trades["net_pl"] > 0).mean()) if len(trades) else 0.0
        out.at[idx, "win_rate_median"] = win_rate
    return out


def classify_stability_row(row: pd.Series) -> tuple[str, str]:
    if row["positive_both_symbols_rate"] < 0.5 or row["profit_factor_median"] < 1.05:
        return "Overfit", "Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough."
    if row["cliff_score"] > 0.75 and row["neighbor_expectancy_median"] < row["expectancy_median"] * 0.5:
        return "Fragile", "Nearby survivor settings have much weaker expectancy, indicating a parameter cliff."
    if row["profit_factor_median"] >= 1.25 and row["max_drawdown_pct_median"] <= 0.15 and row["positive_both_symbols_rate"] >= 0.8:
        return "Robust", "Positive expectancy, PF >= 1.25, drawdown <= 15%, and positive on both symbols across most risk variants."
    if row["profit_factor_median"] >= 1.10 and row["max_drawdown_pct_median"] <= 0.25:
        return "Acceptable", "Positive but thinner edge or less consistent symbol-level behavior."
    return "Fragile", "Positive result exists, but margin of safety is thin."


def choose_strongest_candidate(survivors: pd.DataFrame) -> pd.Series:
    candidates = survivors[
        (survivors["expectancy"] > 0)
        & (survivors["all_symbols_positive_expectancy"] == True)  # noqa: E712
    ].copy()
    if candidates.empty:
        candidates = survivors[survivors["expectancy"] > 0].copy()
    return candidates.sort_values(["max_drawdown_pct", "expectancy"], ascending=[True, False]).iloc[0]


def run_exact_candidate(
    symbol_data: dict[str, pd.DataFrame],
    candidate: pd.Series,
    initial_equity: float,
) -> dict[str, BacktestResult]:
    results = {}
    for symbol, data in symbol_data.items():
        config = config_from_row(symbol, candidate, initial_equity)
        results[symbol] = TurtleBacktester(config).run(data)
    return results


def config_from_row(symbol: str, row: pd.Series | dict, initial_equity: float) -> TurtleOSConfig:
    get = row.get if isinstance(row, dict) else row.__getitem__
    return TurtleOSConfig(
        instrument=InstrumentConfig(symbol=symbol),
        rules=TurtleRulesConfig(
            entry_window=int(get("entry_window")),
            exit_window=int(get("exit_window")),
            atr_period=int(get("atr_period")),
            stop_atr_multiplier=float(get("stop_atr_multiplier")),
            pyramid_atr_interval=float(get("pyramid_atr_interval")),
            risk_per_unit_pct=float(get("risk_per_unit_pct")),
            max_pyramid_units=4,
        ),
        backtest=BacktestConfig(
            initial_equity=initial_equity,
            max_total_lots=float(get("max_total_lots")),
            max_account_leverage=float(get("max_account_leverage")),
            max_open_risk_pct=_none_if_nan(get("max_open_risk_pct")),
            symbol_drawdown_pause_pct=_none_if_nan(get("symbol_drawdown_pause_pct")),
        ),
    )


def combined_trades(results: dict[str, BacktestResult]) -> pd.DataFrame:
    rows = []
    for symbol, result in results.items():
        for trade in result.trades_as_dicts():
            trade["symbol"] = symbol
            rows.append(trade)
    trades = pd.DataFrame(rows)
    if trades.empty:
        return pd.DataFrame(
            columns=[
                "symbol",
                "direction",
                "entry_time",
                "exit_time",
                "entry_price",
                "exit_price",
                "lots",
                "stop_price",
                "pyramid_index",
                "exit_reason",
                "gross_pl",
                "commission",
                "net_pl",
            ]
        )
    trades["exit_time"] = pd.to_datetime(trades["exit_time"])
    trades["entry_time"] = pd.to_datetime(trades["entry_time"])
    return trades.sort_values("exit_time").reset_index(drop=True)


def run_neighborhood(
    symbol_data: dict[str, pd.DataFrame],
    strongest: pd.Series,
    initial_equity: float,
) -> pd.DataFrame:
    base = strongest.to_dict()
    variations = [("base", "none", base)]
    for value in [int(base["entry_window"]) - 1, int(base["entry_window"]) + 1]:
        if value > 1:
            row = {**base, "entry_window": value, "exit_window": max(5, round(value / 2))}
            variations.append(("breakout", str(value), row))
    for value in [float(base["stop_atr_multiplier"]) - 0.25, float(base["stop_atr_multiplier"]) + 0.25]:
        if value > 0:
            variations.append(("stop", str(value), {**base, "stop_atr_multiplier": value}))
    for value in [float(base["pyramid_atr_interval"]) - 0.25, float(base["pyramid_atr_interval"]) + 0.25]:
        if value > 0:
            variations.append(("pyramid", str(value), {**base, "pyramid_atr_interval": value}))
    for value in sorted(set([max(0.00125, float(base["risk_per_unit_pct"]) - 0.0025), float(base["risk_per_unit_pct"]) + 0.0025])):
        variations.append(("risk", str(value), {**base, "risk_per_unit_pct": value}))

    rows = []
    for dimension, value, row in variations:
        results = {}
        for symbol, data in symbol_data.items():
            results[symbol] = TurtleBacktester(config_from_row(symbol, row, initial_equity)).run(data)
        trades = combined_trades(results)
        equity = _portfolio_equity_curve(results)
        summary = portfolio_summary(trades, equity, initial_equity * len(symbol_data))
        per_symbol_positive = []
        for result in results.values():
            per_symbol_positive.append(summarize_result(result)["expectancy"] > 0)
        rows.append(
            {
                "dimension": dimension,
                "value": value,
                "entry_window": row["entry_window"],
                "stop_atr_multiplier": row["stop_atr_multiplier"],
                "pyramid_atr_interval": row["pyramid_atr_interval"],
                "risk_per_unit_pct": row["risk_per_unit_pct"],
                **summary,
                "all_symbols_positive_expectancy": all(per_symbol_positive),
            }
        )
    out = pd.DataFrame(rows)
    base_expectancy = float(out.loc[out["dimension"] == "base", "expectancy"].iloc[0])
    out["expectancy_retention_vs_base"] = out["expectancy"] / base_expectancy if base_expectancy else 0.0
    return out


def portfolio_summary(trades: pd.DataFrame, equity: pd.DataFrame, initial_equity: float) -> dict:
    pnl = trades["net_pl"].to_numpy()
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    gross_profit = float(wins.sum())
    gross_loss = abs(float(losses.sum()))
    running_peak = equity["equity"].cummax()
    dd = ((running_peak - equity["equity"]) / running_peak).fillna(0.0)
    return {
        "expectancy": float(pnl.mean()) if len(pnl) else 0.0,
        "profit_factor": gross_profit / gross_loss if gross_loss else (float("inf") if gross_profit else 0.0),
        "win_rate": float((pnl > 0).mean()) if len(pnl) else 0.0,
        "max_drawdown_pct": float(dd.max()) if len(dd) else 0.0,
        "net_profit": float(equity["equity"].iloc[-1] - initial_equity) if not equity.empty else 0.0,
        "trade_count": int(len(pnl)),
    }


def monte_carlo_trade_order(pnl: np.ndarray, initial_equity: float, simulations: int, rng: np.random.Generator) -> tuple[dict, pd.DataFrame]:
    rows = []
    for _ in range(simulations):
        permuted = rng.permutation(pnl)
        equity = initial_equity + np.cumsum(permuted)
        peak = np.maximum.accumulate(equity)
        dd = (peak - equity) / peak
        rows.append(
            {
                "return": float((equity[-1] - initial_equity) / initial_equity),
                "max_drawdown_pct": float(dd.max()) if len(dd) else 0.0,
            }
        )
    runs = pd.DataFrame(rows)
    stats = {
        "median_return": float(runs["return"].median()),
        "mean_return": float(runs["return"].mean()),
        "worst_5pct_drawdown": float(runs["max_drawdown_pct"].quantile(0.95)),
        "worst_drawdown_observed": float(runs["max_drawdown_pct"].max()),
        "best_drawdown_observed": float(runs["max_drawdown_pct"].min()),
        "return_95pct_ci": [float(runs["return"].quantile(0.025)), float(runs["return"].quantile(0.975))],
        "prob_drawdown_gt_10pct": float((runs["max_drawdown_pct"] > 0.10).mean()),
        "prob_drawdown_gt_15pct": float((runs["max_drawdown_pct"] > 0.15).mean()),
        "prob_drawdown_gt_20pct": float((runs["max_drawdown_pct"] > 0.20).mean()),
        "prob_drawdown_gt_25pct": float((runs["max_drawdown_pct"] > 0.25).mean()),
        "note": "Trade-order randomization keeps total return fixed; drawdown distribution changes with order.",
    }
    return stats, runs


def bootstrap_trades(pnl: np.ndarray, simulations: int, rng: np.random.Generator) -> tuple[dict, pd.DataFrame]:
    rows = []
    n = len(pnl)
    for _ in range(simulations):
        sample = rng.choice(pnl, size=n, replace=True)
        wins = sample[sample > 0]
        losses = sample[sample < 0]
        gross_profit = float(wins.sum())
        gross_loss = abs(float(losses.sum()))
        rows.append(
            {
                "expectancy": float(sample.mean()),
                "profit_factor": gross_profit / gross_loss if gross_loss else (float("inf") if gross_profit else 0.0),
                "win_rate": float((sample > 0).mean()),
            }
        )
    runs = pd.DataFrame(rows).replace([np.inf, -np.inf], np.nan).dropna()
    stats = {
        "expectancy_ci": [float(runs["expectancy"].quantile(0.025)), float(runs["expectancy"].quantile(0.975))],
        "profit_factor_ci": [float(runs["profit_factor"].quantile(0.025)), float(runs["profit_factor"].quantile(0.975))],
        "win_rate_ci": [float(runs["win_rate"].quantile(0.025)), float(runs["win_rate"].quantile(0.975))],
        "expectancy_median": float(runs["expectancy"].median()),
        "profit_factor_median": float(runs["profit_factor"].median()),
        "win_rate_median": float(runs["win_rate"].median()),
        "prob_expectancy_positive": float((runs["expectancy"] > 0).mean()),
        "prob_profit_factor_gt_1": float((runs["profit_factor"] > 1.0).mean()),
    }
    return stats, runs


def trade_distribution(trades: pd.DataFrame) -> dict:
    pnl = trades["net_pl"]
    monthly = trades.groupby(trades["exit_time"].dt.to_period("M"))["net_pl"].sum().to_frame("net_pl")
    annual = trades.groupby(trades["exit_time"].dt.to_period("Y"))["net_pl"].sum().to_frame("net_pl")
    monthly["return"] = monthly["net_pl"] / 20_000.0
    annual["return"] = annual["net_pl"] / 20_000.0
    return {
        "largest_winners": trades.sort_values("net_pl", ascending=False).head(10),
        "largest_losers": trades.sort_values("net_pl").head(10),
        "streaks": streaks(trades),
        "monthly_returns": monthly.reset_index().astype({"exit_time": str}) if "exit_time" in monthly.reset_index().columns else monthly.reset_index(),
        "annual_returns": annual.reset_index().astype({"exit_time": str}) if "exit_time" in annual.reset_index().columns else annual.reset_index(),
        "pnl_summary": {
            "mean": float(pnl.mean()),
            "median": float(pnl.median()),
            "skew_proxy": float((pnl.mean() - pnl.median())),
            "largest_win": float(pnl.max()),
            "largest_loss": float(pnl.min()),
        },
    }


def streaks(trades: pd.DataFrame) -> pd.DataFrame:
    rows = []
    current_type = None
    current_count = 0
    current_start = None
    current_pl = 0.0
    for _, trade in trades.sort_values("exit_time").iterrows():
        kind = "win" if trade["net_pl"] > 0 else "loss"
        if kind != current_type:
            if current_type is not None:
                rows.append({"type": current_type, "length": current_count, "start": current_start, "end": prev_time, "net_pl": current_pl})
            current_type = kind
            current_count = 0
            current_start = trade["exit_time"]
            current_pl = 0.0
        current_count += 1
        current_pl += float(trade["net_pl"])
        prev_time = trade["exit_time"]
    if current_type is not None:
        rows.append({"type": current_type, "length": current_count, "start": current_start, "end": prev_time, "net_pl": current_pl})
    return pd.DataFrame(rows).sort_values(["length", "net_pl"], ascending=[False, True])


def equity_diagnostics(equity: pd.DataFrame, trades: pd.DataFrame, rolling_window: int = 30) -> dict:
    pnl = trades.sort_values("exit_time")["net_pl"].reset_index(drop=True)
    rolling_expectancy = pnl.rolling(rolling_window).mean()
    rolling_win_rate = (pnl > 0).rolling(rolling_window).mean()
    rolling_pf = pnl.rolling(rolling_window).apply(_rolling_pf, raw=True)
    rolling_index = trades.sort_values("exit_time")["exit_time"].reset_index(drop=True)
    diag = pd.DataFrame(
        {
            "rolling_profit_factor": rolling_pf.to_numpy(),
            "rolling_expectancy": rolling_expectancy.to_numpy(),
            "rolling_win_rate": rolling_win_rate.to_numpy(),
        },
        index=rolling_index,
    )
    degraded = diag[(diag["rolling_profit_factor"] < 1.0) | (diag["rolling_expectancy"] < 0)].dropna()
    return {
        "rolling_profit_factor": diag["rolling_profit_factor"].dropna(),
        "rolling_expectancy": diag["rolling_expectancy"].dropna(),
        "rolling_win_rate": diag["rolling_win_rate"].dropna(),
        "degraded_periods": degraded.reset_index().rename(columns={"exit_time": "time"}),
    }


def _rolling_pf(values: np.ndarray) -> float:
    wins = values[values > 0].sum()
    losses = abs(values[values < 0].sum())
    if losses == 0:
        return np.nan
    return float(wins / losses)


def final_verdict(stability: pd.DataFrame, neighborhood: pd.DataFrame, mc_stats: dict, boot_stats: dict, diagnostics: dict) -> dict:
    robust_count = int((stability["classification"] == "Robust").sum())
    neigh = neighborhood[neighborhood["dimension"] != "base"]
    neighbor_retention = float(neigh["expectancy_retention_vs_base"].median()) if not neigh.empty else 0.0
    degraded_count = int(len(diagnostics["degraded_periods"]))
    if (
        robust_count > 0
        and neighbor_retention >= 0.7
        and boot_stats["prob_expectancy_positive"] >= 0.95
        and mc_stats["prob_drawdown_gt_25pct"] <= 0.05
    ):
        label = "Ready for Out-of-Sample Validation"
    elif boot_stats["prob_expectancy_positive"] >= 0.8 and mc_stats["prob_drawdown_gt_25pct"] <= 0.20:
        label = "Promising but Needs Further Research"
    elif robust_count == 0 or neighbor_retention < 0.4:
        label = "Overfit"
    else:
        label = "Not Suitable for Automation"
    return {
        "classification": label,
        "robust_parameter_regions": robust_count,
        "median_neighbor_expectancy_retention": neighbor_retention,
        "degraded_rolling_windows": degraded_count,
        "reasoning": (
            "Verdict uses in-sample evidence only: survivor stability, immediate-neighbor retention, "
            "Monte Carlo drawdown risk, bootstrap edge confidence, and rolling degradation."
        ),
    }


def write_distribution_tables(distribution: dict, output_dir: Path) -> dict:
    paths = {}
    for key in ["largest_winners", "largest_losers", "streaks", "monthly_returns", "annual_returns"]:
        path = output_dir / f"{key}.csv"
        distribution[key].to_csv(path, index=False)
        paths[key] = str(path)
    return paths


def write_diagnostics_tables(diagnostics: dict, output_dir: Path) -> dict:
    paths = {}
    path = output_dir / "degraded-rolling-periods.csv"
    diagnostics["degraded_periods"].to_csv(path, index=False)
    paths["degraded_periods"] = str(path)
    return paths


def write_stability_heatmaps(stability: pd.DataFrame, output_dir: Path) -> dict:
    paths = {}
    for metric in METRICS:
        metric_col = f"{metric}_median" if f"{metric}_median" in stability.columns else metric
        if metric == "profit_factor":
            metric_col = "profit_factor_median"
        elif metric == "net_profit":
            metric_col = "net_profit_median"
        elif metric == "max_drawdown":
            metric_col = "max_drawdown_pct_median"
        elif metric == "win_rate":
            metric_col = "win_rate_median"
        elif metric == "expectancy":
            metric_col = "expectancy_median"

        for pyramid in sorted(stability["pyramid_atr_interval"].unique()):
            subset = stability[stability["pyramid_atr_interval"] == pyramid]
            pivot = subset.pivot_table(index="stop_atr_multiplier", columns="risk_per_unit_pct", values=metric_col, aggfunc="median")
            path = output_dir / f"heatmap-{metric}-pyramid-{pyramid}.svg"
            write_heatmap_svg(pivot, path, f"{metric.replace('_', ' ').title()} | Pyramid {pyramid}N")
            paths[f"{metric}_pyramid_{pyramid}"] = str(path)
    return paths


def write_markdown_report(output_dir: Path, summary: dict, stability: pd.DataFrame, neighborhood: pd.DataFrame, distribution: dict, diagnostics: dict) -> Path:
    verdict = summary["verdict"]
    strongest = summary["strongest_candidate"]
    lines = [
        "# TurtleOS Phase 1 Robustness Report",
        "",
        "Scope: in-sample only, 2013-12-24 through 2022-12-31. The held-out 2023-01-01 onward period was not loaded or evaluated.",
        "",
        f"## Verdict: {verdict['classification']}",
        "",
        verdict["reasoning"],
        "",
        "## Strongest Candidate",
        "",
        f"- Entry window: {strongest['entry_window']}",
        f"- Exit window: {strongest['exit_window']}",
        f"- ATR stop: {strongest['stop_atr_multiplier']}N",
        f"- Pyramid spacing: {strongest['pyramid_atr_interval']}N",
        f"- Risk per unit: {float(strongest['risk_per_unit_pct']) * 100:.2f}%",
        f"- Max open risk cap: {float(strongest['max_open_risk_pct']) * 100:.2f}%",
        f"- Max drawdown: {float(strongest['max_drawdown_pct']) * 100:.2f}%",
        f"- Profit factor: {float(strongest['profit_factor']):.2f}",
        f"- Expectancy: {float(strongest['expectancy']):.2f}",
        "",
        "## Stability",
        "",
        _markdown_table(
            stability[
                [
                    "entry_window",
                    "stop_atr_multiplier",
                    "pyramid_atr_interval",
                    "risk_per_unit_pct",
                    "classification",
                    "classification_reason",
                ]
            ].head(20)
        ),
        "",
        "## Neighborhood",
        "",
        _markdown_table(
            neighborhood[
                [
                    "dimension",
                    "value",
                    "expectancy",
                    "profit_factor",
                    "max_drawdown_pct",
                    "expectancy_retention_vs_base",
                    "all_symbols_positive_expectancy",
                ]
            ]
        ),
        "",
        "## Monte Carlo",
        "",
        json.dumps(summary["monte_carlo"], indent=2),
        "",
        "## Bootstrap",
        "",
        json.dumps(summary["bootstrap"], indent=2),
        "",
        "## Distribution Notes",
        "",
        f"- Largest win: {distribution['pnl_summary']['largest_win']:.2f}",
        f"- Largest loss: {distribution['pnl_summary']['largest_loss']:.2f}",
        f"- Degraded rolling windows: {len(diagnostics['degraded_periods'])}",
        "",
        "Charts and CSVs are referenced in `robustness-summary.json`.",
    ]
    path = output_dir / "robustness-report.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_histogram_svg(series: pd.Series, path: Path, title: str, x_label: str, percent_x: bool = False) -> str:
    values = pd.Series(series).dropna().astype(float)
    counts, edges = np.histogram(values, bins=30)
    bars = pd.Series(counts, index=pd.IntervalIndex.from_breaks(edges))
    return write_bar_svg(bars, path, title, y_label="Count", x_label=x_label, percent_x=percent_x)


def write_bar_svg(series: pd.Series, path: Path, title: str, y_label: str, x_label: str = "", percent_y: bool = False, percent_x: bool = False) -> str:
    labels = [str(idx) for idx in series.index]
    values = pd.Series(series).fillna(0).astype(float).to_numpy()
    width, height = 980, 520
    margin = 70
    max_abs = max(abs(values).max() if len(values) else 1, 1e-9)
    zero_y = height - margin if values.min() >= 0 else margin + (height - 2 * margin) * (values.max() / (values.max() - values.min()))
    bar_w = (width - 2 * margin) / max(len(values), 1)
    elements = [_svg_header(width, height, title), f'<text x="{margin}" y="35" class="axis">{_esc(y_label)}</text>']
    for idx, value in enumerate(values):
        x = margin + idx * bar_w
        y = zero_y - (value / max_abs) * (height - 2 * margin) if value >= 0 else zero_y
        h = abs(value / max_abs) * (height - 2 * margin)
        color = "#2f9e44" if value >= 0 else "#c92a2a"
        elements.append(f'<rect x="{x:.2f}" y="{min(y, zero_y):.2f}" width="{max(bar_w - 2, 1):.2f}" height="{h:.2f}" fill="{color}" opacity="0.82"/>')
    elements.append(f'<line x1="{margin}" x2="{width-margin}" y1="{zero_y:.2f}" y2="{zero_y:.2f}" stroke="#444"/>')
    elements.append("</svg>")
    path.write_text("\n".join(elements), encoding="utf-8")
    return str(path)


def write_line_svg(series: pd.Series, path: Path, title: str, y_label: str, percent_y: bool = False) -> str:
    values = pd.Series(series).dropna().astype(float)
    width, height = 980, 520
    margin = 70
    if values.empty:
        values = pd.Series([0.0])
    min_v, max_v = float(values.min()), float(values.max())
    if math.isclose(min_v, max_v):
        min_v -= 1
        max_v += 1
    points = []
    for idx, value in enumerate(values):
        x = margin + idx * (width - 2 * margin) / max(len(values) - 1, 1)
        y = height - margin - ((value - min_v) / (max_v - min_v)) * (height - 2 * margin)
        points.append(f"{x:.2f},{y:.2f}")
    elements = [_svg_header(width, height, title), f'<text x="{margin}" y="35" class="axis">{_esc(y_label)}</text>']
    elements.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="#1c7ed6" stroke-width="2"/>')
    elements.append(f'<line x1="{margin}" x2="{margin}" y1="{margin}" y2="{height-margin}" stroke="#444"/>')
    elements.append(f'<line x1="{margin}" x2="{width-margin}" y1="{height-margin}" y2="{height-margin}" stroke="#444"/>')
    elements.append("</svg>")
    path.write_text("\n".join(elements), encoding="utf-8")
    return str(path)


def write_heatmap_svg(pivot: pd.DataFrame, path: Path, title: str) -> str:
    width, height = 740, 460
    margin = 95
    values = pivot.to_numpy(dtype=float)
    finite = values[np.isfinite(values)]
    min_v, max_v = (float(finite.min()), float(finite.max())) if len(finite) else (0.0, 1.0)
    rows, cols = pivot.shape
    cell_w = (width - 2 * margin) / max(cols, 1)
    cell_h = (height - 2 * margin) / max(rows, 1)
    elements = [_svg_header(width, height, title)]
    for r, row_label in enumerate(pivot.index):
        elements.append(f'<text x="20" y="{margin + r * cell_h + cell_h / 2:.1f}" class="axis">{row_label}</text>')
        for c, col_label in enumerate(pivot.columns):
            value = pivot.iloc[r, c]
            color = _heat_color(value, min_v, max_v)
            x = margin + c * cell_w
            y = margin + r * cell_h
            elements.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell_w:.1f}" height="{cell_h:.1f}" fill="{color}" stroke="#111"/>')
            label = "" if pd.isna(value) else f"{value:.2f}"
            elements.append(f'<text x="{x + cell_w / 2:.1f}" y="{y + cell_h / 2:.1f}" text-anchor="middle" class="cell">{label}</text>')
    for c, col_label in enumerate(pivot.columns):
        x = margin + c * cell_w + cell_w / 2
        elements.append(f'<text x="{x:.1f}" y="{height - 35}" text-anchor="middle" class="axis">{float(col_label)*100:.2f}%</text>')
    elements.append("</svg>")
    path.write_text("\n".join(elements), encoding="utf-8")
    return str(path)


def _neighbor_median(frame: pd.DataFrame, row: pd.Series, metric: str) -> float:
    diffs = []
    for _, other in frame.iterrows():
        changed = sum(
            row[col] != other[col]
            for col in ["entry_window", "stop_atr_multiplier", "pyramid_atr_interval", "risk_per_unit_pct"]
        )
        if changed == 1:
            diffs.append(other[metric])
    return float(pd.Series(diffs).median()) if diffs else np.nan


def _heat_color(value: float, min_v: float, max_v: float) -> str:
    if pd.isna(value):
        return "#202020"
    t = 0.5 if math.isclose(min_v, max_v) else (float(value) - min_v) / (max_v - min_v)
    r = int(200 * (1 - t) + 30 * t)
    g = int(60 * (1 - t) + 150 * t)
    b = int(55 * (1 - t) + 80 * t)
    return f"#{r:02x}{g:02x}{b:02x}"


def _svg_header(width: int, height: int, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        '<style>text{font-family:Arial,sans-serif;fill:#e9ecef}.title{font-size:20px;font-weight:700}.axis{font-size:12px;fill:#adb5bd}.cell{font-size:11px;fill:#fff}</style>'
        f'<rect width="100%" height="100%" fill="#0b0f14"/><text x="24" y="28" class="title">{_esc(title)}</text>'
    )


def _esc(value: object) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _markdown_table(frame: pd.DataFrame) -> str:
    headers = list(frame.columns)
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for _, row in frame.iterrows():
        values = []
        for value in row:
            if isinstance(value, float):
                values.append(f"{value:.4f}")
            else:
                values.append(str(value).replace("|", "/"))
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def _none_if_nan(value: object) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    return float(value)


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, pd.Timestamp):
        return str(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value
