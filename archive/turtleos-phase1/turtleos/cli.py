from __future__ import annotations

import argparse
import json
from datetime import datetime, time, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from turtleos.backtester import TurtleBacktester
from turtleos.config import BacktestConfig, FeeConfig, InstrumentConfig, TurtleOSConfig, TurtleRulesConfig
from turtleos.data import MT5HistoricalLoader, load_csv_ohlc
from turtleos.reporting import build_report, write_json_report
from turtleos.research import (
    IN_SAMPLE_END,
    IN_SAMPLE_START,
    OUT_OF_SAMPLE_END,
    OUT_OF_SAMPLE_START,
    candidates_from_prior_summary,
    default_risk_control_grid,
    run_expanding_walk_forward,
    run_phase1_parameter_sweep,
    run_risk_control_sweep,
    RobustnessInputs,
    CandidateComparisonInputs,
    OOSValidationInputs,
    run_robustness_report,
    run_candidate_comparison,
    run_oos_validation,
)


TIMEFRAMES = {
    "M1": "TIMEFRAME_M1",
    "M5": "TIMEFRAME_M5",
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H4": "TIMEFRAME_H4",
    "D1": "TIMEFRAME_D1",
    "W1": "TIMEFRAME_W1",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="TurtleOS Phase 1 research tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backtest = subparsers.add_parser("backtest", help="Run a Phase 1 backtest from CSV or MT5 historical data")
    backtest.add_argument("--source", choices=["csv", "mt5"], default="csv")
    backtest.add_argument("--csv", help="Path to OHLC CSV when --source csv")
    backtest.add_argument("--symbol", default="XAUUSD")
    backtest.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    backtest.add_argument("--date-from", help="Start date for MT5 range, for example 2020-01-01")
    backtest.add_argument("--date-to", help="End date for MT5 range, defaults to now")
    backtest.add_argument("--bars", type=int, default=10_000, help="Fallback MT5 bar count when --date-from is omitted")
    backtest.add_argument("--initial-equity", type=float, default=10_000.0)
    backtest.add_argument("--entry-window", type=int, default=20)
    backtest.add_argument("--exit-window", type=int, default=10)
    backtest.add_argument("--atr-period", type=int, default=20)
    backtest.add_argument("--spread-points", type=float, default=0.0)
    backtest.add_argument("--risk-per-unit-pct", type=float, default=0.01)
    backtest.add_argument("--max-drawdown-pct", type=float, default=0.25)
    backtest.add_argument("--min-expectancy", type=float, default=0.0)
    backtest.add_argument("--output", help="Optional JSON report path")

    depth = subparsers.add_parser("mt5-depth", help="Discover available historical MT5 data depth")
    depth.add_argument("--symbols", nargs="+", default=["XAUUSD", "XAGUSD"])
    depth.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    depth.add_argument("--bars", type=int, default=50_000)
    depth.add_argument("--output", help="Optional JSON depth report path")

    sweep = subparsers.add_parser("phase1-sweep", help="Run locked in-sample Phase 1 MT5 parameter sweep")
    sweep.add_argument("--symbols", nargs="+", default=["XAUUSD", "XAGUSD"])
    sweep.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    sweep.add_argument("--output-dir", default="outputs")
    sweep.add_argument("--initial-equity", type=float, default=10_000.0)
    sweep.add_argument("--risk-per-unit-pct", type=float, default=0.01)
    sweep.add_argument("--max-drawdown-pct", type=float, default=0.25)
    sweep.add_argument("--min-expectancy", type=float, default=0.0)
    sweep.add_argument("--walk-forward-top-n", type=int, default=5)
    sweep.add_argument(
        "--assumed-spread",
        nargs="*",
        default=[],
        metavar="SYMBOL=PRICE",
        help="Conservative spread assumption in price units when MT5 historical D1 spread is missing/unreliable.",
    )

    risk_sweep = subparsers.add_parser("phase1-risk-sweep", help="Run locked in-sample risk-control sweep only")
    risk_sweep.add_argument("--symbols", nargs="+", default=["XAUUSD", "XAGUSD"])
    risk_sweep.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    risk_sweep.add_argument("--output-dir", default="outputs")
    risk_sweep.add_argument("--prior-summary", default="outputs/phase1-in-sample-research-summary.json")
    risk_sweep.add_argument("--top-candidates", type=int, default=2)
    risk_sweep.add_argument("--initial-equity", type=float, default=10_000.0)
    risk_sweep.add_argument("--max-drawdown-pct", type=float, default=0.25)
    risk_sweep.add_argument(
        "--assumed-spread",
        nargs="*",
        default=[],
        metavar="SYMBOL=PRICE",
        help="Conservative spread assumption in price units when MT5 historical D1 spread is missing/unreliable.",
    )

    robustness = subparsers.add_parser("phase1-robustness", help="Run in-sample robustness and statistical validation")
    robustness.add_argument("--symbols", nargs="+", default=["XAUUSD", "XAGUSD"])
    robustness.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    robustness.add_argument("--output-dir", default="outputs/robustness")
    robustness.add_argument("--survivor-csv", default="outputs/phase1-risk-control-sweep-combined.csv")
    robustness.add_argument("--initial-equity", type=float, default=10_000.0)
    robustness.add_argument("--simulations", type=int, default=10_000)
    robustness.add_argument(
        "--assumed-spread",
        nargs="*",
        default=[],
        metavar="SYMBOL=PRICE",
        help="Conservative spread assumption in price units when MT5 historical D1 spread is missing/unreliable.",
    )

    compare = subparsers.add_parser(
        "phase1-candidate-compare",
        help="Compare the four frozen in-sample candidates without touching out-of-sample data",
    )
    compare.add_argument("--symbols", nargs="+", default=["XAUUSD", "XAGUSD"])
    compare.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    compare.add_argument("--output-dir", default="outputs/candidate-comparison")
    compare.add_argument("--initial-equity", type=float, default=10_000.0)
    compare.add_argument("--simulations", type=int, default=10_000)
    compare.add_argument(
        "--assumed-spread",
        nargs="*",
        default=[],
        metavar="SYMBOL=PRICE",
        help="Conservative spread assumption in price units when MT5 historical D1 spread is missing/unreliable.",
    )

    oos = subparsers.add_parser(
        "phase1-oos-validate",
        help="Run the frozen lower_risk candidate once on the locked out-of-sample period",
    )
    oos.add_argument("--symbols", nargs="+", default=["XAUUSD.var", "XAGUSD.var"])
    oos.add_argument("--timeframe", choices=TIMEFRAMES.keys(), default="D1")
    oos.add_argument("--output-dir", default="outputs/oos-validation")
    oos.add_argument("--in-sample-dir", default="outputs/candidate-comparison")
    oos.add_argument("--initial-equity", type=float, default=10_000.0)
    oos.add_argument(
        "--assumed-spread",
        nargs="*",
        default=[],
        metavar="SYMBOL=PRICE",
        help="Conservative spread assumption in price units when MT5 historical D1 spread is missing/unreliable.",
    )

    args = parser.parse_args()
    if args.command == "backtest":
        run_backtest(args)
    elif args.command == "mt5-depth":
        run_mt5_depth(args)
    elif args.command == "phase1-sweep":
        run_phase1_sweep(args)
    elif args.command == "phase1-risk-sweep":
        run_phase1_risk_sweep(args)
    elif args.command == "phase1-robustness":
        run_phase1_robustness(args)
    elif args.command == "phase1-candidate-compare":
        run_phase1_candidate_compare(args)
    elif args.command == "phase1-oos-validate":
        run_phase1_oos_validate(args)


def run_backtest(args: argparse.Namespace) -> None:
    data = load_input_data(args)
    config = TurtleOSConfig(
        instrument=InstrumentConfig(symbol=args.symbol, spread_points=args.spread_points),
        rules=TurtleRulesConfig(
            entry_window=args.entry_window,
            exit_window=args.exit_window,
            atr_period=args.atr_period,
            risk_per_unit_pct=args.risk_per_unit_pct,
        ),
        fees=FeeConfig(),
        backtest=BacktestConfig(
            initial_equity=args.initial_equity,
            min_expectancy=args.min_expectancy,
            max_drawdown_pct=args.max_drawdown_pct,
        ),
    )
    result = TurtleBacktester(config).run(data)
    report = build_report(result)
    if args.output:
        write_json_report(result, args.output)

    print(json.dumps(report["summary"], indent=2, allow_nan=False))


def run_mt5_depth(args: argparse.Namespace) -> None:
    loader = MT5HistoricalLoader()
    try:
        loader.initialize()
        timeframe = resolve_timeframe(loader._mt5, args.timeframe)
        now = datetime.now(timezone.utc)
        report = {
            "timeframe": args.timeframe,
            "requested_bars": args.bars,
            "symbols": [
                loader.discover_available_depth(symbol, timeframe, now, args.bars)
                for symbol in args.symbols
            ],
        }
    finally:
        loader.shutdown()

    if args.output:
        from pathlib import Path

        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))


def run_phase1_sweep(args: argparse.Namespace) -> None:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    assumed_spreads = _parse_assumed_spreads(args.assumed_spread)
    symbol_data: dict[str, pd.DataFrame] = {}
    coverage: list[dict] = []
    loader = MT5HistoricalLoader()
    try:
        loader.initialize()
        timeframe = resolve_timeframe(loader._mt5, args.timeframe)
        for requested_symbol in args.symbols:
            data = loader.copy_rates_range(
                requested_symbol,
                timeframe,
                datetime.combine(pd.Timestamp(IN_SAMPLE_START).date(), time.min, tzinfo=timezone.utc),
                datetime.combine(pd.Timestamp(IN_SAMPLE_END).date(), time.max, tzinfo=timezone.utc),
            )
            actual_symbol = loader.last_symbol or requested_symbol
            data = data.loc[(data.index >= pd.Timestamp(IN_SAMPLE_START)) & (data.index <= pd.Timestamp(IN_SAMPLE_END))]
            spread_assessment = _assess_historical_spread(data)
            if spread_assessment["valid"]:
                spread_source = "mt5_historical_spread"
                spread_used = "MT5 historical spread_price"
                assumed_spread = None
            else:
                assumed_spread = _assumed_spread_for_symbol(requested_symbol, actual_symbol, assumed_spreads)
                if assumed_spread is None:
                    raise SystemExit(
                        f"MT5 historical spread for {requested_symbol} ({actual_symbol}) is not usable "
                        f"({spread_assessment['reason']}). Provide --assumed-spread {requested_symbol}=<price_units>."
                    )
                data = data.copy()
                data["mt5_spread_raw"] = data["spread"] if "spread" in data.columns else pd.NA
                data["mt5_spread_price_raw"] = data["spread_price"] if "spread_price" in data.columns else pd.NA
                data["spread_price"] = float(assumed_spread)
                spread_source = "configured_conservative_assumption"
                spread_used = f"{assumed_spread} price units per round-trip spread model input"
            symbol_data[actual_symbol] = data
            coverage.append(
                {
                    "requested_symbol": requested_symbol,
                    "actual_symbol": actual_symbol,
                    "bars": int(len(data)),
                    "first_bar": str(data.index.min()),
                    "last_bar": str(data.index.max()),
                    "mt5_historical_spread_valid": spread_assessment["valid"],
                    "mt5_historical_spread_reason": spread_assessment["reason"],
                    "mt5_average_spread_price_raw": spread_assessment["average_spread_price"],
                    "mt5_average_spread_raw": spread_assessment["average_spread_raw"],
                    "spread_source_used": spread_source,
                    "spread_used": spread_used,
                    "assumed_spread_price": assumed_spread,
                }
            )
    finally:
        loader.shutdown()

    base_config = TurtleOSConfig(
        rules=TurtleRulesConfig(risk_per_unit_pct=args.risk_per_unit_pct, max_pyramid_units=4),
        fees=FeeConfig(),
        backtest=BacktestConfig(
            initial_equity=args.initial_equity,
            min_expectancy=args.min_expectancy,
            max_drawdown_pct=args.max_drawdown_pct,
        ),
    )

    per_symbol, combined = run_phase1_parameter_sweep(symbol_data, base_config)
    walk_forward = run_expanding_walk_forward(
        symbol_data,
        base_config,
        top_n=args.walk_forward_top_n,
    )

    per_symbol_path = output_dir / "phase1-in-sample-sweep-per-symbol.csv"
    combined_path = output_dir / "phase1-in-sample-sweep-combined.csv"
    walk_forward_path = output_dir / "phase1-walk-forward.csv"
    summary_path = output_dir / "phase1-in-sample-research-summary.json"

    per_symbol.to_csv(per_symbol_path, index=False)
    combined.to_csv(combined_path, index=False)
    walk_forward.to_csv(walk_forward_path, index=False)

    top_candidates = combined.head(10)
    red_flags = combined[combined["isolated_peak_red_flag"]].head(20)
    summary = {
        "phase": "Phase 1 - in-sample research only",
        "out_of_sample_guard": "No data on or after 2023-01-01 was loaded or evaluated.",
        "in_sample_period": {"start": IN_SAMPLE_START, "end": IN_SAMPLE_END},
        "timeframe": args.timeframe,
        "coverage": coverage,
        "parameter_grid": {
            "breakout_windows": [15, 20, 25, 40, 55, 70],
            "atr_stop_multipliers": [1.5, 2.0, 2.5, 3.0],
            "pyramid_atr_intervals": [0.25, 0.5, 0.75],
            "max_pyramid_units": 4,
            "exit_window_rule": "round(entry_window / 2), minimum 5 bars",
        },
        "spread_policy": (
            "MT5 D1 historical spread is used only when every in-sample bar has a positive spread_price. "
            "Otherwise the sweep requires a clearly labeled configured conservative assumption per symbol."
        ),
        "top_combined_candidates": _safe_records(top_candidates),
        "isolated_peak_red_flags": _safe_records(red_flags),
        "walk_forward": _safe_records(walk_forward),
        "artifacts": {
            "per_symbol_csv": str(per_symbol_path),
            "combined_csv": str(combined_path),
            "walk_forward_csv": str(walk_forward_path),
        },
    }
    summary_path.write_text(json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, allow_nan=False))


def run_phase1_risk_sweep(args: argparse.Namespace) -> None:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    assumed_spreads = _parse_assumed_spreads(args.assumed_spread)
    symbol_data, coverage = _load_locked_in_sample_mt5_data(args.symbols, args.timeframe, assumed_spreads)

    base_config = TurtleOSConfig(
        fees=FeeConfig(),
        backtest=BacktestConfig(
            initial_equity=args.initial_equity,
            max_drawdown_pct=args.max_drawdown_pct,
        ),
    )
    selected_candidates = candidates_from_prior_summary(args.prior_summary, top_n=args.top_candidates)
    configs = default_risk_control_grid(selected_candidates)
    combined, per_symbol = run_risk_control_sweep(symbol_data, base_config, configs)

    combined_path = output_dir / "phase1-risk-control-sweep-combined.csv"
    per_symbol_path = output_dir / "phase1-risk-control-sweep-per-symbol.csv"
    summary_path = output_dir / "phase1-risk-control-summary.json"
    combined.to_csv(combined_path, index=False)
    per_symbol.to_csv(per_symbol_path, index=False)

    passing = combined[
        (combined["drawdown_gate_passed"])
        & (combined["all_symbols_positive_expectancy"])
        & (combined["expectancy"] > 0)
    ]
    summary = {
        "phase": "Phase 1 - in-sample risk-control sweep only",
        "out_of_sample_guard": "No data on or after 2023-01-01 was loaded or evaluated.",
        "in_sample_period": {"start": IN_SAMPLE_START, "end": IN_SAMPLE_END},
        "strategy_rules_policy": "Rules kept unchanged from strongest non-isolated candidates; only risk throttles varied.",
        "coverage": coverage,
        "selected_candidates": [
            {"name": name, **candidate.__dict__}
            for name, candidate in selected_candidates
        ],
        "risk_grid": {
            "risk_per_unit_pct": [0.01, 0.0075, 0.005, 0.0025],
            "exposure_profiles": ["base_10_lots_5x", "capped_2_lots_2x"],
            "max_open_risk_pct": [0.04, 0.02],
            "drawdown_policies": [
                "none",
                "symbol_pause_15",
                "symbol_pause_20",
                "symbol_pause_25",
                "portfolio_pause_15",
                "portfolio_pause_20",
                "portfolio_pause_25",
                "symbol_and_portfolio_pause_15",
                "symbol_and_portfolio_pause_20",
                "symbol_and_portfolio_pause_25",
            ],
        },
        "best_gate_passing_configs": _safe_records(passing.head(20)),
        "best_overall_by_drawdown_then_expectancy": _safe_records(combined.head(20)),
        "artifacts": {
            "combined_csv": str(combined_path),
            "per_symbol_csv": str(per_symbol_path),
        },
    }
    summary_path.write_text(json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, allow_nan=False))


def run_phase1_robustness(args: argparse.Namespace) -> None:
    assumed_spreads = _parse_assumed_spreads(args.assumed_spread)
    symbol_data, _coverage = _load_locked_in_sample_mt5_data(args.symbols, args.timeframe, assumed_spreads)
    summary = run_robustness_report(
        RobustnessInputs(
            symbol_data=symbol_data,
            survivor_csv=Path(args.survivor_csv),
            output_dir=Path(args.output_dir),
            initial_equity=args.initial_equity,
            simulations=args.simulations,
        )
    )
    print(json.dumps(summary, indent=2, allow_nan=False))


def run_phase1_candidate_compare(args: argparse.Namespace) -> None:
    assumed_spreads = _parse_assumed_spreads(args.assumed_spread)
    symbol_data, coverage = _load_locked_in_sample_mt5_data(args.symbols, args.timeframe, assumed_spreads)
    summary = run_candidate_comparison(
        CandidateComparisonInputs(
            symbol_data=symbol_data,
            output_dir=Path(args.output_dir),
            initial_equity=args.initial_equity,
            simulations=args.simulations,
        )
    )
    summary["coverage"] = coverage
    summary_path = Path(args.output_dir) / "candidate-comparison-summary.json"
    summary_path.write_text(json.dumps(_safe_json(summary), indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(_safe_json(summary), indent=2, allow_nan=False))


def run_phase1_oos_validate(args: argparse.Namespace) -> None:
    assumed_spreads = _parse_assumed_spreads(args.assumed_spread)
    symbol_data, coverage = _load_oos_mt5_data(args.symbols, args.timeframe, assumed_spreads)
    summary = run_oos_validation(
        OOSValidationInputs(
            symbol_data=symbol_data,
            output_dir=Path(args.output_dir),
            in_sample_dir=Path(args.in_sample_dir),
            initial_equity=args.initial_equity,
        )
    )
    summary["coverage"] = coverage
    summary_path = Path(args.output_dir) / "oos-validation-summary.json"
    summary_path.write_text(json.dumps(_safe_json(summary), indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(_safe_json(summary), indent=2, allow_nan=False))


def _load_locked_in_sample_mt5_data(
    symbols: list[str],
    timeframe_name: str,
    assumed_spreads: dict[str, float],
) -> tuple[dict[str, pd.DataFrame], list[dict]]:
    symbol_data: dict[str, pd.DataFrame] = {}
    coverage: list[dict] = []
    loader = MT5HistoricalLoader()
    try:
        loader.initialize()
        timeframe = resolve_timeframe(loader._mt5, timeframe_name)
        for requested_symbol in symbols:
            data = loader.copy_rates_range(
                requested_symbol,
                timeframe,
                datetime.combine(pd.Timestamp(IN_SAMPLE_START).date(), time.min, tzinfo=timezone.utc),
                datetime.combine(pd.Timestamp(IN_SAMPLE_END).date(), time.max, tzinfo=timezone.utc),
            )
            actual_symbol = loader.last_symbol or requested_symbol
            data = data.loc[(data.index >= pd.Timestamp(IN_SAMPLE_START)) & (data.index <= pd.Timestamp(IN_SAMPLE_END))]
            spread_assessment = _assess_historical_spread(data)
            if spread_assessment["valid"]:
                spread_source = "mt5_historical_spread"
                spread_used = "MT5 historical spread_price"
                assumed_spread = None
            else:
                assumed_spread = _assumed_spread_for_symbol(requested_symbol, actual_symbol, assumed_spreads)
                if assumed_spread is None:
                    raise SystemExit(
                        f"MT5 historical spread for {requested_symbol} ({actual_symbol}) is not usable "
                        f"({spread_assessment['reason']}). Provide --assumed-spread {requested_symbol}=<price_units>."
                    )
                data = data.copy()
                data["mt5_spread_raw"] = data["spread"] if "spread" in data.columns else pd.NA
                data["mt5_spread_price_raw"] = data["spread_price"] if "spread_price" in data.columns else pd.NA
                data["spread_price"] = float(assumed_spread)
                spread_source = "configured_conservative_assumption"
                spread_used = f"{assumed_spread} price units per spread model input"
            symbol_data[actual_symbol] = data
            coverage.append(
                {
                    "requested_symbol": requested_symbol,
                    "actual_symbol": actual_symbol,
                    "bars": int(len(data)),
                    "first_bar": str(data.index.min()),
                    "last_bar": str(data.index.max()),
                    "mt5_historical_spread_valid": spread_assessment["valid"],
                    "mt5_historical_spread_reason": spread_assessment["reason"],
                    "mt5_average_spread_price_raw": spread_assessment["average_spread_price"],
                    "mt5_average_spread_raw": spread_assessment["average_spread_raw"],
                    "spread_source_used": spread_source,
                    "spread_used": spread_used,
                    "assumed_spread_price": assumed_spread,
                }
            )
    finally:
        loader.shutdown()
    return symbol_data, coverage


def _load_oos_mt5_data(
    symbols: list[str],
    timeframe_name: str,
    assumed_spreads: dict[str, float],
) -> tuple[dict[str, pd.DataFrame], list[dict]]:
    symbol_data: dict[str, pd.DataFrame] = {}
    coverage: list[dict] = []
    loader = MT5HistoricalLoader()
    try:
        loader.initialize()
        timeframe = resolve_timeframe(loader._mt5, timeframe_name)
        for requested_symbol in symbols:
            data = loader.copy_rates_range(
                requested_symbol,
                timeframe,
                datetime.combine(pd.Timestamp(OUT_OF_SAMPLE_START).date(), time.min, tzinfo=timezone.utc),
                datetime.combine(pd.Timestamp(OUT_OF_SAMPLE_END).date(), time.max, tzinfo=timezone.utc),
            )
            actual_symbol = loader.last_symbol or requested_symbol
            data = data.loc[
                (data.index >= pd.Timestamp(OUT_OF_SAMPLE_START))
                & (data.index <= pd.Timestamp(OUT_OF_SAMPLE_END))
            ]
            spread_assessment = _assess_historical_spread(data)
            if spread_assessment["valid"]:
                spread_source = "mt5_historical_spread"
                spread_used = "MT5 historical spread_price"
                assumed_spread = None
            else:
                assumed_spread = _assumed_spread_for_symbol(requested_symbol, actual_symbol, assumed_spreads)
                if assumed_spread is None:
                    raise SystemExit(
                        f"MT5 historical spread for {requested_symbol} ({actual_symbol}) is not usable "
                        f"({spread_assessment['reason']}). Provide --assumed-spread {requested_symbol}=<price_units>."
                    )
                data = data.copy()
                data["mt5_spread_raw"] = data["spread"] if "spread" in data.columns else pd.NA
                data["mt5_spread_price_raw"] = data["spread_price"] if "spread_price" in data.columns else pd.NA
                data["spread_price"] = float(assumed_spread)
                spread_source = "configured_conservative_assumption"
                spread_used = f"{assumed_spread} price units per spread model input"
            symbol_data[actual_symbol] = data
            coverage.append(
                {
                    "requested_symbol": requested_symbol,
                    "actual_symbol": actual_symbol,
                    "bars": int(len(data)),
                    "first_bar": str(data.index.min()),
                    "last_bar": str(data.index.max()),
                    "mt5_historical_spread_valid": spread_assessment["valid"],
                    "mt5_historical_spread_reason": spread_assessment["reason"],
                    "mt5_average_spread_price_raw": spread_assessment["average_spread_price"],
                    "mt5_average_spread_raw": spread_assessment["average_spread_raw"],
                    "spread_source_used": spread_source,
                    "spread_used": spread_used,
                    "assumed_spread_price": assumed_spread,
                }
            )
    finally:
        loader.shutdown()
    return symbol_data, coverage


def load_input_data(args: argparse.Namespace):
    if args.source == "csv":
        if not args.csv:
            raise SystemExit("--csv is required when --source csv")
        return load_csv_ohlc(args.csv)

    loader = MT5HistoricalLoader()
    try:
        loader.initialize()
        timeframe = resolve_timeframe(loader._mt5, args.timeframe)
        date_to = parse_date(args.date_to) if args.date_to else datetime.now(timezone.utc)
        if args.date_from:
            return loader.copy_rates_range(args.symbol, timeframe, parse_date(args.date_from), date_to)
        return loader.copy_rates_from(args.symbol, timeframe, date_to, args.bars)
    finally:
        loader.shutdown()


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def resolve_timeframe(mt5, timeframe_name: str) -> int:
    attr = TIMEFRAMES[timeframe_name]
    try:
        return getattr(mt5, attr)
    except AttributeError as exc:
        raise SystemExit(f"MT5 module does not expose {attr}") from exc


def _safe_records(frame: pd.DataFrame) -> list[dict]:
    clean = frame.replace({np.inf: "Infinity", -np.inf: "-Infinity"})
    clean = clean.astype(object).where(pd.notna(clean), None)
    return clean.to_dict(orient="records")


def _safe_json(value):
    if isinstance(value, dict):
        return {str(k): _safe_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_safe_json(v) for v in value]
    if isinstance(value, tuple):
        return [_safe_json(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, pd.Timestamp):
        return str(value)
    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
        return None
    return value


def _parse_assumed_spreads(values: list[str]) -> dict[str, float]:
    spreads: dict[str, float] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"Invalid --assumed-spread value '{value}'. Use SYMBOL=PRICE, e.g. XAUUSD=0.50")
        symbol, raw_spread = value.split("=", 1)
        try:
            spread = float(raw_spread)
        except ValueError as exc:
            raise SystemExit(f"Invalid spread for {symbol}: {raw_spread}") from exc
        if spread < 0:
            raise SystemExit(f"Spread assumption for {symbol} must be non-negative")
        spreads[symbol.upper()] = spread
    return spreads


def _assumed_spread_for_symbol(
    requested_symbol: str,
    actual_symbol: str,
    assumed_spreads: dict[str, float],
) -> float | None:
    candidates = [
        requested_symbol.upper(),
        actual_symbol.upper(),
        actual_symbol.split(".")[0].upper(),
    ]
    for candidate in candidates:
        if candidate in assumed_spreads:
            return assumed_spreads[candidate]
    return None


def _assess_historical_spread(data: pd.DataFrame) -> dict:
    if "spread_price" not in data.columns:
        return {
            "valid": False,
            "reason": "MT5 rates did not include spread_price",
            "average_spread_price": None,
            "average_spread_raw": float(data["spread"].mean()) if "spread" in data.columns else None,
        }
    spread = data["spread_price"]
    average_spread_price = float(spread.mean()) if len(spread) else None
    average_spread_raw = float(data["spread"].mean()) if "spread" in data.columns else None
    if spread.isna().any():
        return {
            "valid": False,
            "reason": "MT5 spread_price contains missing values",
            "average_spread_price": average_spread_price,
            "average_spread_raw": average_spread_raw,
        }
    if (spread <= 0).any():
        return {
            "valid": False,
            "reason": "MT5 spread_price contains zero or negative values",
            "average_spread_price": average_spread_price,
            "average_spread_raw": average_spread_raw,
        }
    return {
        "valid": True,
        "reason": "Every in-sample bar has positive MT5 spread_price",
        "average_spread_price": average_spread_price,
        "average_spread_raw": average_spread_raw,
    }


if __name__ == "__main__":
    main()
