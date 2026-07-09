from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from turtleos.backtester import BacktestResult, TurtleBacktester
from turtleos.reporting import summarize_result
from turtleos.research.candidate_compare import _rolling_frame
from turtleos.research.risk_control import _portfolio_equity_curve
from turtleos.research.robustness import (
    combined_trades,
    config_from_row,
    equity_diagnostics,
    portfolio_summary,
    trade_distribution,
    write_bar_svg,
    write_histogram_svg,
    write_line_svg,
)
from turtleos.research.validation import OUT_OF_SAMPLE_END, OUT_OF_SAMPLE_START


@dataclass(frozen=True)
class OOSValidationInputs:
    symbol_data: dict[str, pd.DataFrame]
    output_dir: Path
    in_sample_dir: Path
    initial_equity: float = 10_000.0


FROZEN_CANDIDATE = {
    "candidate_id": "lower_risk",
    "entry_window": 15,
    "exit_window": 8,
    "atr_period": 20,
    "stop_atr_multiplier": 2.0,
    "pyramid_atr_interval": 0.75,
    "risk_per_unit_pct": 0.00125,
    "max_total_lots": 10.0,
    "max_account_leverage": 5.0,
    "max_open_risk_pct": 0.01,
    "symbol_drawdown_pause_pct": None,
    "portfolio_drawdown_pause_pct": None,
}


def run_oos_validation(inputs: OOSValidationInputs) -> dict:
    _assert_oos_only(inputs.symbol_data)
    inputs.output_dir.mkdir(parents=True, exist_ok=True)

    results = {
        symbol: TurtleBacktester(config_from_row(symbol, FROZEN_CANDIDATE, inputs.initial_equity)).run(data)
        for symbol, data in inputs.symbol_data.items()
    }
    trades = combined_trades(results)
    equity = _portfolio_equity_curve(results)
    initial_total = inputs.initial_equity * len(inputs.symbol_data)
    combined = portfolio_summary(trades, equity, initial_total)
    combined["max_exposure_pct"] = float(equity["exposure_pct"].max()) if not equity.empty else 0.0
    combined["drawdown_gate_passed"] = combined["max_drawdown_pct"] <= 0.25
    combined["candidate_id"] = FROZEN_CANDIDATE["candidate_id"]

    per_symbol = _per_symbol_metrics(results)
    distribution = trade_distribution(trades)
    diagnostics = equity_diagnostics(equity, trades)
    rolling = _rolling_frame(diagnostics)
    regime = _regime_summary(distribution, diagnostics)
    in_sample = _load_in_sample_reference(inputs.in_sample_dir)
    comparison = _compare_in_sample_oos(in_sample, combined, per_symbol, trades)
    verdict = _phase1_verdict(combined, per_symbol, comparison)

    paths = _write_artifacts(
        inputs.output_dir,
        combined,
        per_symbol,
        trades,
        equity,
        distribution,
        diagnostics,
        rolling,
        regime,
        comparison,
        verdict,
    )
    summary = {
        "phase": "Phase 1 final out-of-sample validation",
        "oos_unlock": "This run loaded the locked out-of-sample period for final validation.",
        "out_of_sample_period": {"start": OUT_OF_SAMPLE_START, "end": OUT_OF_SAMPLE_END},
        "frozen_candidate": FROZEN_CANDIDATE,
        "combined_portfolio_metrics": combined,
        "per_symbol_metrics": per_symbol,
        "in_sample_vs_out_of_sample": comparison,
        "oos_regime_summary": regime,
        "final_phase_1_verdict": verdict,
        "artifacts": {key: str(value) for key, value in paths.items()},
    }
    summary_path = inputs.output_dir / "oos-validation-summary.json"
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    report_path = _write_report(inputs.output_dir, summary)
    summary["artifacts"]["markdown_report"] = str(report_path)
    summary_path.write_text(json.dumps(_jsonable(summary), indent=2, allow_nan=False), encoding="utf-8")
    return summary


def _assert_oos_only(symbol_data: dict[str, pd.DataFrame]) -> None:
    start = pd.Timestamp(OUT_OF_SAMPLE_START)
    end = pd.Timestamp(OUT_OF_SAMPLE_END)
    for symbol, data in symbol_data.items():
        if data.empty:
            raise ValueError(f"No out-of-sample data loaded for {symbol}")
        if data.index.min() < start or data.index.max() > end:
            raise ValueError(
                f"{symbol} data must stay within {OUT_OF_SAMPLE_START} through {OUT_OF_SAMPLE_END}; "
                f"loaded {data.index.min()} through {data.index.max()}."
            )


def _per_symbol_metrics(results: dict[str, BacktestResult]) -> list[dict]:
    rows = []
    for symbol, result in results.items():
        summary = summarize_result(result)
        curve = result.equity_curve
        rows.append(
            {
                "candidate_id": FROZEN_CANDIDATE["candidate_id"],
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


def _load_in_sample_reference(in_sample_dir: Path) -> dict:
    combined = pd.read_csv(in_sample_dir / "combined-metrics.csv")
    per_symbol = pd.read_csv(in_sample_dir / "per-symbol-metrics.csv")
    combined_row = combined[combined["candidate_id"] == FROZEN_CANDIDATE["candidate_id"]]
    per_symbol_rows = per_symbol[per_symbol["candidate_id"] == FROZEN_CANDIDATE["candidate_id"]]
    if combined_row.empty or per_symbol_rows.empty:
        raise ValueError("Could not find lower_risk in-sample reference metrics")
    return {
        "combined": combined_row.iloc[0].to_dict(),
        "per_symbol": per_symbol_rows.to_dict(orient="records"),
    }


def _compare_in_sample_oos(in_sample: dict, oos_combined: dict, oos_per_symbol: list[dict], oos_trades: pd.DataFrame) -> dict:
    is_combined = in_sample["combined"]
    is_trade_years = _years_between("2013-12-24", "2022-12-31")
    oos_trade_years = _years_between(OUT_OF_SAMPLE_START, OUT_OF_SAMPLE_END)
    is_trades_per_year = float(is_combined["trade_count"]) / is_trade_years
    oos_trades_per_year = float(oos_combined["trade_count"]) / oos_trade_years
    is_per_symbol = {row["symbol"]: row for row in in_sample["per_symbol"]}
    oos_per_symbol_map = {row["symbol"]: row for row in oos_per_symbol}
    return {
        "in_sample_expectancy": float(is_combined["expectancy"]),
        "out_of_sample_expectancy": float(oos_combined["expectancy"]),
        "expectancy_retention": _safe_ratio(oos_combined["expectancy"], is_combined["expectancy"]),
        "in_sample_profit_factor": float(is_combined["profit_factor"]),
        "out_of_sample_profit_factor": float(oos_combined["profit_factor"]),
        "profit_factor_retention": _safe_ratio(oos_combined["profit_factor"], is_combined["profit_factor"]),
        "in_sample_max_drawdown_pct": float(is_combined["max_drawdown_pct"]),
        "out_of_sample_max_drawdown_pct": float(oos_combined["max_drawdown_pct"]),
        "drawdown_expansion_ratio": _safe_ratio(oos_combined["max_drawdown_pct"], is_combined["max_drawdown_pct"]),
        "drawdown_expansion_pct_points": float(oos_combined["max_drawdown_pct"] - is_combined["max_drawdown_pct"]),
        "in_sample_trades_per_year": is_trades_per_year,
        "out_of_sample_trades_per_year": oos_trades_per_year,
        "trade_frequency_change_ratio": _safe_ratio(oos_trades_per_year, is_trades_per_year),
        "out_of_sample_trade_count": int(oos_combined["trade_count"]),
        "symbols_positive_expectancy": bool(all(row["positive_expectancy"] for row in oos_per_symbol)),
        "per_symbol_expectancy_retention": {
            symbol: _safe_ratio(oos_per_symbol_map[symbol]["expectancy"], is_row["expectancy"])
            for symbol, is_row in is_per_symbol.items()
            if symbol in oos_per_symbol_map
        },
        "edge_generalized": _edge_generalized(oos_combined, oos_per_symbol, oos_trades),
    }


def _edge_generalized(oos_combined: dict, oos_per_symbol: list[dict], oos_trades: pd.DataFrame) -> bool:
    return bool(
        oos_combined["expectancy"] > 0
        and oos_combined["profit_factor"] > 1.0
        and oos_combined["max_drawdown_pct"] <= 0.25
        and oos_combined["trade_count"] >= 20
        and all(row["positive_expectancy"] for row in oos_per_symbol)
        and not oos_trades.empty
    )


def _regime_summary(distribution: dict, diagnostics: dict) -> dict:
    monthly = distribution["monthly_returns"].copy()
    annual = distribution["annual_returns"].copy()
    rolling = _rolling_frame(diagnostics)
    worst_month = monthly.loc[monthly["return"].idxmin()] if not monthly.empty else pd.Series(dtype=object)
    best_month = monthly.loc[monthly["return"].idxmax()] if not monthly.empty else pd.Series(dtype=object)
    worst_year = annual.loc[annual["return"].idxmin()] if not annual.empty else pd.Series(dtype=object)
    best_year = annual.loc[annual["return"].idxmax()] if not annual.empty else pd.Series(dtype=object)
    worst_rolling_exp = rolling.loc[rolling["rolling_expectancy"].idxmin()] if not rolling["rolling_expectancy"].dropna().empty else pd.Series(dtype=object)
    worst_rolling_pf = rolling.loc[rolling["rolling_profit_factor"].idxmin()] if not rolling["rolling_profit_factor"].dropna().empty else pd.Series(dtype=object)
    return {
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
        "worst_rolling_profit_factor_time": str(worst_rolling_pf.get("time", "")),
        "worst_rolling_profit_factor": _float_or_none(worst_rolling_pf.get("rolling_profit_factor")),
        "degraded_rolling_windows": int(len(diagnostics["degraded_periods"])),
    }


def _phase1_verdict(combined: dict, per_symbol: list[dict], comparison: dict) -> dict:
    reasons = []
    if combined["expectancy"] <= 0:
        reasons.append("OOS combined expectancy is not positive.")
    if combined["profit_factor"] <= 1.0:
        reasons.append("OOS profit factor is not above 1.0.")
    if combined["max_drawdown_pct"] > 0.25:
        reasons.append("OOS max drawdown exceeds the 25% gate.")
    if not all(row["positive_expectancy"] for row in per_symbol):
        reasons.append("Not all symbols have positive OOS expectancy.")
    if combined["trade_count"] < 20:
        reasons.append("OOS trade count is too small to call the edge confirmed.")

    if not reasons and comparison["expectancy_retention"] >= 0.50 and comparison["profit_factor_retention"] >= 0.65:
        label = "Pass Phase 1"
        reasons.append("OOS edge generalized with positive expectancy, PF > 1, both symbols positive, sub-25% drawdown, and acceptable retention.")
    elif not reasons:
        label = "Conditional Pass"
        reasons.append("OOS passed core gates but retention versus in-sample was materially weaker.")
    elif combined["expectancy"] > 0 and combined["profit_factor"] > 1.0 and combined["max_drawdown_pct"] <= 0.25:
        label = "Conditional Pass"
        reasons.append("OOS portfolio passed core gates, but one or more confirmation checks failed.")
    else:
        label = "Fail Phase 1"
    return {
        "classification": label,
        "reasons": reasons,
        "no_oos_tuning_policy": "No parameter tuning, filtering, or reselection is allowed from this OOS result.",
    }


def _write_artifacts(
    output_dir: Path,
    combined: dict,
    per_symbol: list[dict],
    trades: pd.DataFrame,
    equity: pd.DataFrame,
    distribution: dict,
    diagnostics: dict,
    rolling: pd.DataFrame,
    regime: dict,
    comparison: dict,
    verdict: dict,
) -> dict:
    paths = {
        "combined_metrics_csv": output_dir / "combined-metrics.csv",
        "per_symbol_metrics_csv": output_dir / "per-symbol-metrics.csv",
        "trades_csv": output_dir / "trades.csv",
        "equity_csv": output_dir / "equity.csv",
        "monthly_returns_csv": output_dir / "monthly-returns.csv",
        "annual_returns_csv": output_dir / "annual-returns.csv",
        "rolling_diagnostics_csv": output_dir / "rolling-diagnostics.csv",
        "degraded_periods_csv": output_dir / "degraded-rolling-periods.csv",
        "regime_summary_csv": output_dir / "regime-summary.csv",
        "is_oos_comparison_csv": output_dir / "in-sample-vs-oos.csv",
        "verdict_json": output_dir / "phase1-verdict.json",
        "equity_curve_chart": output_dir / "equity-curve.svg",
        "underwater_drawdown_chart": output_dir / "underwater-drawdown.svg",
        "rolling_expectancy_chart": output_dir / "rolling-expectancy.svg",
        "rolling_profit_factor_chart": output_dir / "rolling-profit-factor.svg",
        "monthly_returns_chart": output_dir / "monthly-returns.svg",
        "annual_returns_chart": output_dir / "annual-returns.svg",
        "trade_return_histogram": output_dir / "trade-return-histogram.svg",
    }
    pd.DataFrame([combined]).to_csv(paths["combined_metrics_csv"], index=False)
    pd.DataFrame(per_symbol).to_csv(paths["per_symbol_metrics_csv"], index=False)
    trades.to_csv(paths["trades_csv"], index=False)
    equity.to_csv(paths["equity_csv"])
    distribution["monthly_returns"].to_csv(paths["monthly_returns_csv"], index=False)
    distribution["annual_returns"].to_csv(paths["annual_returns_csv"], index=False)
    rolling.to_csv(paths["rolling_diagnostics_csv"], index=False)
    diagnostics["degraded_periods"].to_csv(paths["degraded_periods_csv"], index=False)
    pd.DataFrame([regime]).to_csv(paths["regime_summary_csv"], index=False)
    pd.DataFrame([comparison]).to_csv(paths["is_oos_comparison_csv"], index=False)
    paths["verdict_json"].write_text(json.dumps(_jsonable(verdict), indent=2), encoding="utf-8")
    write_line_svg(equity["equity"], paths["equity_curve_chart"], "OOS Equity Curve", "Equity")
    underwater = ((equity["equity"] / equity["equity"].cummax()) - 1.0).fillna(0.0)
    write_line_svg(underwater, paths["underwater_drawdown_chart"], "OOS Underwater Drawdown", "Drawdown", percent_y=True)
    write_line_svg(diagnostics["rolling_expectancy"], paths["rolling_expectancy_chart"], "OOS Rolling Expectancy", "Expectancy")
    write_line_svg(diagnostics["rolling_profit_factor"], paths["rolling_profit_factor_chart"], "OOS Rolling Profit Factor", "Profit factor")
    write_bar_svg(distribution["monthly_returns"]["return"], paths["monthly_returns_chart"], "OOS Monthly Returns", "Return", percent_y=True)
    write_bar_svg(distribution["annual_returns"]["return"], paths["annual_returns_chart"], "OOS Annual Returns", "Return", percent_y=True)
    write_histogram_svg(trades["net_pl"], paths["trade_return_histogram"], "OOS Trade P/L Distribution", "Net P/L")
    return paths


def _write_report(output_dir: Path, summary: dict) -> Path:
    path = output_dir / "oos-validation-report.md"
    combined = summary["combined_portfolio_metrics"]
    comparison = summary["in_sample_vs_out_of_sample"]
    verdict = summary["final_phase_1_verdict"]
    lines = [
        "# TurtleOS Phase 1 Final Out-of-Sample Validation",
        "",
        "Scope: frozen lower_risk candidate only, out-of-sample period 2023-01-01 through 2026-07-08.",
        "",
        "No parameters were tuned, no filters were added, and no alternate candidate was selected from this result.",
        "",
        f"## Verdict: {verdict['classification']}",
        "",
        *[f"- {reason}" for reason in verdict["reasons"]],
        "",
        "## Combined Portfolio Metrics",
        "",
        _markdown_table(pd.DataFrame([combined])),
        "",
        "## Per-Symbol Metrics",
        "",
        _markdown_table(pd.DataFrame(summary["per_symbol_metrics"])),
        "",
        "## In-Sample vs Out-of-Sample",
        "",
        _markdown_table(pd.DataFrame([comparison])),
        "",
        "## OOS Regime Summary",
        "",
        _markdown_table(pd.DataFrame([summary["oos_regime_summary"]])),
        "",
        "Charts and CSV evidence are saved alongside this report.",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


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


def _years_between(start: str, end: str) -> float:
    return max((pd.Timestamp(end) - pd.Timestamp(start)).days / 365.25, 1e-9)


def _safe_ratio(numerator: object, denominator: object) -> float | None:
    denominator_float = _float_or_none(denominator)
    numerator_float = _float_or_none(numerator)
    if denominator_float is None or numerator_float is None or math.isclose(denominator_float, 0.0):
        return None
    return numerator_float / denominator_float


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
