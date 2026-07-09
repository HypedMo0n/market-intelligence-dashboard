from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from turtleos.backtester import BacktestResult, TurtleBacktester
from turtleos.reporting import summarize_result
from turtleos.research.risk_control import _portfolio_equity_curve
from turtleos.research.robustness import (
    bootstrap_trades,
    combined_trades,
    config_from_row,
    equity_diagnostics,
    monte_carlo_trade_order,
    portfolio_summary,
    trade_distribution,
    write_bar_svg,
    write_histogram_svg,
    write_line_svg,
)
from turtleos.research.validation import IN_SAMPLE_END, IN_SAMPLE_START, assert_no_out_of_sample


@dataclass(frozen=True)
class CandidateDefinition:
    candidate_id: str
    label: str
    entry_window: int
    stop_atr_multiplier: float
    pyramid_atr_interval: float
    risk_per_unit_pct: float


@dataclass(frozen=True)
class CandidateComparisonInputs:
    symbol_data: dict[str, pd.DataFrame]
    output_dir: Path
    initial_equity: float = 10_000.0
    simulations: int = 10_000
    random_seed: int = 1729


DEFAULT_CANDIDATES = [
    CandidateDefinition("base", "Base", 15, 2.0, 0.75, 0.0025),
    CandidateDefinition("lower_risk", "Lower-risk", 15, 2.0, 0.75, 0.00125),
    CandidateDefinition("wider_pyramid", "Wider pyramid", 15, 2.0, 1.0, 0.0025),
    CandidateDefinition("lower_stop", "Lower stop", 15, 1.75, 0.75, 0.0025),
]


FIXED_RISK_CONTROLS = {
    "exit_window": 8,
    "atr_period": 20,
    "max_total_lots": 10.0,
    "max_account_leverage": 5.0,
    "max_open_risk_pct": 0.01,
    "symbol_drawdown_pause_pct": None,
    "portfolio_drawdown_pause_pct": None,
}


def run_candidate_comparison(inputs: CandidateComparisonInputs) -> dict:
    for data in inputs.symbol_data.values():
        assert_no_out_of_sample(data)
    inputs.output_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(inputs.random_seed)
    combined_rows: list[dict] = []
    per_symbol_rows: list[dict] = []
    bootstrap_rows: list[dict] = []
    mc_rows: list[dict] = []
    regime_rows: list[dict] = []
    artifact_rows: list[dict] = []
    comparison_payload: list[dict] = []

    for definition in DEFAULT_CANDIDATES:
        candidate_dir = inputs.output_dir / definition.candidate_id
        candidate_dir.mkdir(parents=True, exist_ok=True)
        row = _candidate_row(definition)
        results = _run_candidate(inputs.symbol_data, row, inputs.initial_equity)
        trades = combined_trades(results)
        equity = _portfolio_equity_curve(results)
        initial_total = inputs.initial_equity * len(inputs.symbol_data)
        combined = portfolio_summary(trades, equity, initial_total)
        combined["max_exposure_pct"] = float(equity["exposure_pct"].max()) if not equity.empty else 0.0
        combined["drawdown_gate_passed"] = combined["max_drawdown_pct"] <= 0.25
        combined_rows.append({"candidate_id": definition.candidate_id, "label": definition.label, **row, **combined})

        per_symbol = _per_symbol_metrics(definition, results)
        per_symbol_rows.extend(per_symbol)

        trades_path = candidate_dir / "trades.csv"
        equity_path = candidate_dir / "equity.csv"
        trades.to_csv(trades_path, index=False)
        equity.to_csv(equity_path)

        boot_stats, boot_runs = bootstrap_trades(trades["net_pl"].to_numpy(), inputs.simulations, rng)
        boot_path = candidate_dir / "bootstrap-simulations.csv"
        boot_runs.to_csv(boot_path, index=False)
        bootstrap_rows.append({"candidate_id": definition.candidate_id, **boot_stats})

        mc_stats, mc_runs = monte_carlo_trade_order(
            trades["net_pl"].to_numpy(),
            initial_total,
            inputs.simulations,
            rng,
        )
        mc_path = candidate_dir / "monte-carlo-simulations.csv"
        mc_runs.to_csv(mc_path, index=False)
        mc_rows.append({"candidate_id": definition.candidate_id, **mc_stats})

        distribution = trade_distribution(trades)
        monthly_path = candidate_dir / "monthly-returns.csv"
        annual_path = candidate_dir / "annual-returns.csv"
        distribution["monthly_returns"].to_csv(monthly_path, index=False)
        distribution["annual_returns"].to_csv(annual_path, index=False)
        distribution["largest_winners"].to_csv(candidate_dir / "largest-winners.csv", index=False)
        distribution["largest_losers"].to_csv(candidate_dir / "largest-losers.csv", index=False)
        distribution["streaks"].to_csv(candidate_dir / "streaks.csv", index=False)

        diagnostics = equity_diagnostics(equity, trades)
        rolling_path = candidate_dir / "rolling-diagnostics.csv"
        rolling = _rolling_frame(diagnostics)
        rolling.to_csv(rolling_path, index=False)
        diagnostics["degraded_periods"].to_csv(candidate_dir / "degraded-rolling-periods.csv", index=False)

        regime = _regime_summary(definition, distribution, diagnostics)
        regime_rows.append(regime)

        chart_paths = _write_candidate_charts(candidate_dir, equity, trades, mc_runs, boot_runs, distribution, diagnostics)
        artifact_rows.append(
            {
                "candidate_id": definition.candidate_id,
                "trades_csv": str(trades_path),
                "equity_csv": str(equity_path),
                "bootstrap_csv": str(boot_path),
                "monte_carlo_csv": str(mc_path),
                "monthly_returns_csv": str(monthly_path),
                "annual_returns_csv": str(annual_path),
                "rolling_diagnostics_csv": str(rolling_path),
                **chart_paths,
            }
        )
        comparison_payload.append(
            {
                "definition": asdict(definition),
                "combined": combined,
                "per_symbol": per_symbol,
                "bootstrap": boot_stats,
                "monte_carlo": mc_stats,
                "regimes": regime,
                "artifacts": artifact_rows[-1],
            }
        )

    combined_frame = pd.DataFrame(combined_rows)
    per_symbol_frame = pd.DataFrame(per_symbol_rows)
    bootstrap_frame = pd.DataFrame(bootstrap_rows)
    mc_frame = pd.DataFrame(mc_rows)
    regime_frame = pd.DataFrame(regime_rows)
    artifact_frame = pd.DataFrame(artifact_rows)
    ranking = _rank_candidates(combined_frame, per_symbol_frame, bootstrap_frame, mc_frame, regime_frame)

    paths = {
        "combined_metrics_csv": inputs.output_dir / "combined-metrics.csv",
        "per_symbol_metrics_csv": inputs.output_dir / "per-symbol-metrics.csv",
        "bootstrap_summary_csv": inputs.output_dir / "bootstrap-summary.csv",
        "monte_carlo_summary_csv": inputs.output_dir / "monte-carlo-summary.csv",
        "regime_summary_csv": inputs.output_dir / "regime-summary.csv",
        "candidate_artifacts_csv": inputs.output_dir / "candidate-artifacts.csv",
        "candidate_ranking_csv": inputs.output_dir / "candidate-ranking.csv",
    }
    combined_frame.to_csv(paths["combined_metrics_csv"], index=False)
    per_symbol_frame.to_csv(paths["per_symbol_metrics_csv"], index=False)
    bootstrap_frame.to_csv(paths["bootstrap_summary_csv"], index=False)
    mc_frame.to_csv(paths["monte_carlo_summary_csv"], index=False)
    regime_frame.to_csv(paths["regime_summary_csv"], index=False)
    artifact_frame.to_csv(paths["candidate_artifacts_csv"], index=False)
    ranking.to_csv(paths["candidate_ranking_csv"], index=False)

    recommendation = _recommendation(ranking, combined_frame, bootstrap_frame, mc_frame, per_symbol_frame, regime_frame)
    summary = {
        "phase": "Phase 1 focused candidate comparison, in-sample only",
        "out_of_sample_guard": "No data on or after 2023-01-01 was loaded or evaluated.",
        "in_sample_period": {"start": IN_SAMPLE_START, "end": IN_SAMPLE_END},
        "fixed_risk_controls": FIXED_RISK_CONTROLS,
        "candidate_policy": "Only the four user-specified candidates were evaluated; strategy rules were not optimized further.",
        "ranking_policy": [
            "Statistical robustness",
            "Drawdown control",
            "Stability across symbols",
            "Stability across regimes",
            "Simplicity / closeness to original Turtle logic",
        ],
        "recommendation": recommendation,
        "candidates": comparison_payload,
        "artifacts": {key: str(value) for key, value in paths.items()},
    }
    summary_path = inputs.output_dir / "candidate-comparison-summary.json"
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    report_path = _write_report(inputs.output_dir, summary, combined_frame, per_symbol_frame, bootstrap_frame, mc_frame, regime_frame, ranking)
    summary["artifacts"]["markdown_report"] = str(report_path)
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    return summary


def _candidate_row(definition: CandidateDefinition) -> dict:
    return {
        "entry_window": definition.entry_window,
        "exit_window": FIXED_RISK_CONTROLS["exit_window"],
        "atr_period": FIXED_RISK_CONTROLS["atr_period"],
        "stop_atr_multiplier": definition.stop_atr_multiplier,
        "pyramid_atr_interval": definition.pyramid_atr_interval,
        "risk_per_unit_pct": definition.risk_per_unit_pct,
        "max_total_lots": FIXED_RISK_CONTROLS["max_total_lots"],
        "max_account_leverage": FIXED_RISK_CONTROLS["max_account_leverage"],
        "max_open_risk_pct": FIXED_RISK_CONTROLS["max_open_risk_pct"],
        "symbol_drawdown_pause_pct": FIXED_RISK_CONTROLS["symbol_drawdown_pause_pct"],
    }


def _run_candidate(symbol_data: dict[str, pd.DataFrame], row: dict, initial_equity: float) -> dict[str, BacktestResult]:
    return {
        symbol: TurtleBacktester(config_from_row(symbol, row, initial_equity)).run(data)
        for symbol, data in symbol_data.items()
    }


def _per_symbol_metrics(definition: CandidateDefinition, results: dict[str, BacktestResult]) -> list[dict]:
    rows = []
    for symbol, result in results.items():
        summary = summarize_result(result)
        curve = result.equity_curve
        rows.append(
            {
                "candidate_id": definition.candidate_id,
                "label": definition.label,
                "symbol": symbol,
                "expectancy": summary["expectancy"],
                "profit_factor": summary["profit_factor"],
                "win_rate": summary["win_rate"],
                "max_drawdown_pct": summary["max_drawdown_pct"],
                "net_profit": summary["net_profit"],
                "trade_count": summary["trade_count"],
                "max_exposure_pct": float(curve["exposure_pct"].max()) if not curve.empty else 0.0,
                "positive_expectancy": summary["expectancy"] > 0,
                "drawdown_gate_passed": summary["max_drawdown_pct"] <= 0.25,
            }
        )
    return rows


def _rolling_frame(diagnostics: dict) -> pd.DataFrame:
    rolling = pd.concat(
        [
            diagnostics["rolling_expectancy"].rename("rolling_expectancy"),
            diagnostics["rolling_profit_factor"].rename("rolling_profit_factor"),
            diagnostics["rolling_win_rate"].rename("rolling_win_rate"),
        ],
        axis=1,
    )
    return rolling.reset_index().rename(columns={"exit_time": "time", "index": "time"})


def _regime_summary(definition: CandidateDefinition, distribution: dict, diagnostics: dict) -> dict:
    monthly = distribution["monthly_returns"].copy()
    annual = distribution["annual_returns"].copy()
    rolling = _rolling_frame(diagnostics)
    worst_month = monthly.loc[monthly["return"].idxmin()] if not monthly.empty else pd.Series(dtype=object)
    best_month = monthly.loc[monthly["return"].idxmax()] if not monthly.empty else pd.Series(dtype=object)
    worst_year = annual.loc[annual["return"].idxmin()] if not annual.empty else pd.Series(dtype=object)
    best_year = annual.loc[annual["return"].idxmax()] if not annual.empty else pd.Series(dtype=object)
    worst_rolling_exp = rolling.loc[rolling["rolling_expectancy"].idxmin()] if not rolling["rolling_expectancy"].dropna().empty else pd.Series(dtype=object)
    best_rolling_exp = rolling.loc[rolling["rolling_expectancy"].idxmax()] if not rolling["rolling_expectancy"].dropna().empty else pd.Series(dtype=object)
    worst_rolling_pf = rolling.loc[rolling["rolling_profit_factor"].idxmin()] if not rolling["rolling_profit_factor"].dropna().empty else pd.Series(dtype=object)
    best_rolling_pf = rolling.loc[rolling["rolling_profit_factor"].idxmax()] if not rolling["rolling_profit_factor"].dropna().empty else pd.Series(dtype=object)
    return {
        "candidate_id": definition.candidate_id,
        "worst_month": str(worst_month.get("exit_time", "")),
        "worst_month_return": _float_or_none(worst_month.get("return")),
        "best_month": str(best_month.get("exit_time", "")),
        "best_month_return": _float_or_none(best_month.get("return")),
        "worst_year": str(worst_year.get("exit_time", "")),
        "worst_year_return": _float_or_none(worst_year.get("return")),
        "best_year": str(best_year.get("exit_time", "")),
        "best_year_return": _float_or_none(best_year.get("return")),
        "worst_rolling_expectancy_time": str(worst_rolling_exp.get("time", "")),
        "worst_rolling_expectancy": _float_or_none(worst_rolling_exp.get("rolling_expectancy")),
        "best_rolling_expectancy_time": str(best_rolling_exp.get("time", "")),
        "best_rolling_expectancy": _float_or_none(best_rolling_exp.get("rolling_expectancy")),
        "worst_rolling_profit_factor_time": str(worst_rolling_pf.get("time", "")),
        "worst_rolling_profit_factor": _float_or_none(worst_rolling_pf.get("rolling_profit_factor")),
        "best_rolling_profit_factor_time": str(best_rolling_pf.get("time", "")),
        "best_rolling_profit_factor": _float_or_none(best_rolling_pf.get("rolling_profit_factor")),
        "degraded_rolling_windows": int(len(diagnostics["degraded_periods"])),
    }


def _write_candidate_charts(
    candidate_dir: Path,
    equity: pd.DataFrame,
    trades: pd.DataFrame,
    mc_runs: pd.DataFrame,
    boot_runs: pd.DataFrame,
    distribution: dict,
    diagnostics: dict,
) -> dict:
    charts = {
        "monte_carlo_drawdown_histogram": write_histogram_svg(
            mc_runs["max_drawdown_pct"],
            candidate_dir / "monte-carlo-drawdown-histogram.svg",
            "Monte Carlo Max Drawdown",
            "Max drawdown",
            percent_x=True,
        ),
        "bootstrap_expectancy_histogram": write_histogram_svg(
            boot_runs["expectancy"],
            candidate_dir / "bootstrap-expectancy-histogram.svg",
            "Bootstrap Expectancy",
            "Expectancy",
        ),
        "trade_return_histogram": write_histogram_svg(
            trades["net_pl"],
            candidate_dir / "trade-return-histogram.svg",
            "Trade P/L Distribution",
            "Net P/L",
        ),
        "equity_curve_chart": write_line_svg(
            equity["equity"],
            candidate_dir / "equity-curve.svg",
            "Equity Curve",
            "Equity",
        ),
        "rolling_expectancy_chart": write_line_svg(
            diagnostics["rolling_expectancy"],
            candidate_dir / "rolling-expectancy.svg",
            "Rolling Expectancy",
            "Expectancy",
        ),
        "rolling_profit_factor_chart": write_line_svg(
            diagnostics["rolling_profit_factor"],
            candidate_dir / "rolling-profit-factor.svg",
            "Rolling Profit Factor",
            "Profit factor",
        ),
        "rolling_win_rate_chart": write_line_svg(
            diagnostics["rolling_win_rate"],
            candidate_dir / "rolling-win-rate.svg",
            "Rolling Win Rate",
            "Win rate",
            percent_y=True,
        ),
        "monthly_returns_chart": write_bar_svg(
            distribution["monthly_returns"]["return"],
            candidate_dir / "monthly-returns.svg",
            "Monthly Returns",
            "Return",
            percent_y=True,
        ),
        "annual_returns_chart": write_bar_svg(
            distribution["annual_returns"]["return"],
            candidate_dir / "annual-returns.svg",
            "Annual Returns",
            "Return",
            percent_y=True,
        ),
    }
    underwater = ((equity["equity"] / equity["equity"].cummax()) - 1.0).fillna(0.0)
    charts["underwater_drawdown_chart"] = write_line_svg(
        underwater,
        candidate_dir / "underwater-drawdown.svg",
        "Underwater Drawdown",
        "Drawdown",
        percent_y=True,
    )
    return charts


def _rank_candidates(
    combined: pd.DataFrame,
    per_symbol: pd.DataFrame,
    bootstrap: pd.DataFrame,
    monte_carlo: pd.DataFrame,
    regimes: pd.DataFrame,
) -> pd.DataFrame:
    rows = []
    merged = combined.merge(bootstrap, on="candidate_id").merge(monte_carlo, on="candidate_id").merge(regimes, on="candidate_id")
    for _, row in merged.iterrows():
        symbol_rows = per_symbol[per_symbol["candidate_id"] == row["candidate_id"]]
        symbol_expectancies = symbol_rows["expectancy"].astype(float)
        symbol_pf = symbol_rows["profit_factor"].astype(float)
        statistical = _score_statistical(row)
        drawdown = _score_drawdown(row)
        symbol_stability = _score_symbol_stability(symbol_expectancies, symbol_pf)
        regime_stability = _score_regime_stability(row)
        simplicity = _score_simplicity(row["candidate_id"])
        total = (
            statistical * 0.35
            + drawdown * 0.20
            + symbol_stability * 0.20
            + regime_stability * 0.15
            + simplicity * 0.10
        )
        rows.append(
            {
                "candidate_id": row["candidate_id"],
                "label": row["label"],
                "statistical_robustness_score": statistical,
                "drawdown_control_score": drawdown,
                "symbol_stability_score": symbol_stability,
                "regime_stability_score": regime_stability,
                "simplicity_score": simplicity,
                "total_score": total,
                "rank_reason": _rank_reason(row, symbol_expectancies),
            }
        )
    return pd.DataFrame(rows).sort_values("total_score", ascending=False).reset_index(drop=True)


def _score_statistical(row: pd.Series) -> float:
    score = 0.0
    score += min(max((float(row["prob_expectancy_positive"]) - 0.5) / 0.5, 0.0), 1.0) * 35
    score += 25 if float(row["expectancy_ci"][0]) > 0 else max(0.0, 25 + float(row["expectancy_ci"][0]) / 10)
    score += 25 if float(row["profit_factor_ci"][0]) > 1.0 else max(0.0, float(row["profit_factor_ci"][0]) * 20)
    score += min(float(row["prob_profit_factor_gt_1"]), 1.0) * 15
    return min(score, 100.0)


def _score_drawdown(row: pd.Series) -> float:
    observed = float(row["max_drawdown_pct"])
    worst_5 = float(row["worst_5pct_drawdown"])
    prob_25 = float(row["prob_drawdown_gt_25pct"])
    score = 100.0
    score -= max(0.0, observed - 0.05) * 300
    score -= max(0.0, worst_5 - 0.10) * 250
    score -= prob_25 * 100
    return max(0.0, min(score, 100.0))


def _score_symbol_stability(expectancies: pd.Series, profit_factors: pd.Series) -> float:
    if expectancies.empty:
        return 0.0
    positive_rate = float((expectancies > 0).mean())
    pf_positive_rate = float((profit_factors > 1.0).mean())
    dispersion_penalty = min(float(expectancies.std(ddof=0) / max(abs(expectancies.mean()), 1.0)), 1.0) * 25
    return max(0.0, positive_rate * 45 + pf_positive_rate * 35 + 20 - dispersion_penalty)


def _score_regime_stability(row: pd.Series) -> float:
    score = 100.0
    worst_rolling_exp = _float_or_none(row.get("worst_rolling_expectancy")) or 0.0
    worst_rolling_pf = _float_or_none(row.get("worst_rolling_profit_factor")) or 0.0
    degraded = int(row.get("degraded_rolling_windows") or 0)
    worst_month_return = _float_or_none(row.get("worst_month_return")) or 0.0
    if worst_rolling_exp < 0:
        score -= min(abs(worst_rolling_exp) / 5.0, 1.0) * 30
    if worst_rolling_pf < 1:
        score -= min((1 - worst_rolling_pf), 1.0) * 25
    score -= min(degraded / 50.0, 1.0) * 25
    if worst_month_return < -0.05:
        score -= min(abs(worst_month_return) / 0.15, 1.0) * 20
    return max(0.0, min(score, 100.0))


def _score_simplicity(candidate_id: str) -> float:
    return {
        "base": 100.0,
        "lower_risk": 95.0,
        "wider_pyramid": 80.0,
        "lower_stop": 75.0,
    }[candidate_id]


def _rank_reason(row: pd.Series, symbol_expectancies: pd.Series) -> str:
    symbol_ok = bool((symbol_expectancies > 0).all())
    return (
        f"Bootstrap P(expectancy>0)={float(row['prob_expectancy_positive']):.1%}; "
        f"observed max DD={float(row['max_drawdown_pct']):.1%}; "
        f"MC 95th percentile DD={float(row['worst_5pct_drawdown']):.1%}; "
        f"both symbols positive={symbol_ok}; "
        f"degraded rolling windows={int(row['degraded_rolling_windows'])}."
    )


def _recommendation(
    ranking: pd.DataFrame,
    combined: pd.DataFrame,
    bootstrap: pd.DataFrame,
    monte_carlo: pd.DataFrame,
    per_symbol: pd.DataFrame,
    regimes: pd.DataFrame,
) -> dict:
    top = ranking.iloc[0]
    candidate_id = str(top["candidate_id"])
    combined_row = combined[combined["candidate_id"] == candidate_id].iloc[0]
    bootstrap_row = bootstrap[bootstrap["candidate_id"] == candidate_id].iloc[0]
    mc_row = monte_carlo[monte_carlo["candidate_id"] == candidate_id].iloc[0]
    regime_row = regimes[regimes["candidate_id"] == candidate_id].iloc[0]
    symbol_rows = per_symbol[per_symbol["candidate_id"] == candidate_id]
    hard_reject = (
        float(combined_row["expectancy"]) <= 0
        or float(combined_row["max_drawdown_pct"]) > 0.25
        or not bool(symbol_rows["positive_expectancy"].all())
        or float(bootstrap_row["prob_expectancy_positive"]) < 0.90
        or float(mc_row["prob_drawdown_gt_25pct"]) > 0.05
    )
    if hard_reject:
        action = "Reject all candidates"
        frozen_candidate = None
        reason = (
            "No candidate clears the minimum evidence bar: positive combined expectancy, sub-25% observed drawdown, "
            "positive expectancy on both symbols, at least 90% bootstrap probability of positive expectancy, "
            "and no more than 5% Monte Carlo probability of breaching 25% drawdown."
        )
    else:
        action = "Recommend frozen candidate for final out-of-sample validation"
        frozen_candidate = candidate_id
        reason = (
            f"{candidate_id} ranks highest across statistical robustness, drawdown control, symbol stability, "
            "regime stability, and simplicity without unlocking the out-of-sample period."
        )
    return {
        "action": action,
        "frozen_candidate": frozen_candidate,
        "reason": reason,
        "top_candidate_snapshot": {
            "candidate_id": candidate_id,
            "expectancy": float(combined_row["expectancy"]),
            "profit_factor": float(combined_row["profit_factor"]),
            "max_drawdown_pct": float(combined_row["max_drawdown_pct"]),
            "net_profit": float(combined_row["net_profit"]),
            "trade_count": int(combined_row["trade_count"]),
            "prob_expectancy_positive": float(bootstrap_row["prob_expectancy_positive"]),
            "mc_prob_drawdown_gt_25pct": float(mc_row["prob_drawdown_gt_25pct"]),
            "worst_rolling_expectancy": _float_or_none(regime_row.get("worst_rolling_expectancy")),
        },
    }


def _write_report(
    output_dir: Path,
    summary: dict,
    combined: pd.DataFrame,
    per_symbol: pd.DataFrame,
    bootstrap: pd.DataFrame,
    monte_carlo: pd.DataFrame,
    regimes: pd.DataFrame,
    ranking: pd.DataFrame,
) -> Path:
    report_path = output_dir / "candidate-comparison-report.md"
    recommendation = summary["recommendation"]
    lines = [
        "# TurtleOS Phase 1 Candidate Comparison",
        "",
        "Scope: in-sample only, 2013-12-24 through 2022-12-31. The locked out-of-sample period from 2023-01-01 onward was not loaded or evaluated.",
        "",
        "Spread policy: historical spread was used only if MT5 supplied valid positive spread for every D1 bar; otherwise the configured conservative spread assumptions are used and labeled in the CLI summary.",
        "",
        f"## Recommendation: {recommendation['action']}",
        "",
        recommendation["reason"],
        "",
        f"Frozen candidate: {recommendation['frozen_candidate'] or 'None'}",
        "",
        "## Ranking",
        "",
        _markdown_table(ranking),
        "",
        "## Combined Portfolio Metrics",
        "",
        _markdown_table(_round_frame(combined)),
        "",
        "## Per-Symbol Metrics",
        "",
        _markdown_table(_round_frame(per_symbol)),
        "",
        "## Bootstrap Confidence",
        "",
        _markdown_table(_round_frame(bootstrap)),
        "",
        "## Monte Carlo Drawdown",
        "",
        _markdown_table(_round_frame(monte_carlo)),
        "",
        "## Regime Summary",
        "",
        _markdown_table(_round_frame(regimes)),
        "",
        "Monthly returns, annual returns, rolling diagnostics, trades, equity curves, and charts are saved in each candidate subfolder.",
    ]
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return report_path


def _round_frame(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    for col in out.columns:
        if out[col].map(lambda value: isinstance(value, (list, tuple))).any():
            out[col] = out[col].map(lambda value: json.dumps(value) if isinstance(value, (list, tuple)) else value)
    return out


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


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, tuple):
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
