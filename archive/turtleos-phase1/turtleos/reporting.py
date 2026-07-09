from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from turtleos.backtester import BacktestResult


def summarize_result(result: BacktestResult) -> dict[str, Any]:
    net_pl = np.array([trade.net_pl for trade in result.trades], dtype=float)
    wins = net_pl[net_pl > 0]
    losses = net_pl[net_pl < 0]
    trade_count = int(len(net_pl))

    gross_profit = float(wins.sum()) if len(wins) else 0.0
    gross_loss = float(abs(losses.sum())) if len(losses) else 0.0
    profit_factor_is_infinite = gross_loss == 0 and gross_profit > 0
    profit_factor = None if profit_factor_is_infinite else (gross_profit / gross_loss if gross_loss else 0.0)

    equity_curve = result.equity_curve.copy()
    if equity_curve.empty:
        max_drawdown = 0.0
        max_drawdown_pct = 0.0
        ending_equity = result.config.backtest.initial_equity
    else:
        running_max = equity_curve["equity"].cummax()
        drawdown = equity_curve["equity"] - running_max
        drawdown_pct = drawdown / running_max.replace(0, pd.NA)
        equity_curve["drawdown"] = drawdown
        equity_curve["drawdown_pct"] = drawdown_pct.fillna(0.0)
        max_drawdown = float(abs(drawdown.min()))
        max_drawdown_pct = float(abs(equity_curve["drawdown_pct"].min()))
        ending_equity = float(equity_curve["equity"].iloc[-1])

    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss = float(losses.mean()) if len(losses) else 0.0
    average_win_loss_ratio_is_infinite = avg_loss == 0 and avg_win > 0
    average_win_loss_ratio = None if average_win_loss_ratio_is_infinite else (avg_win / abs(avg_loss) if avg_loss else 0.0)
    expectancy = float(net_pl.mean()) if trade_count else 0.0

    gate = evaluate_phase_1_gate(expectancy, max_drawdown_pct, result)

    return {
        "symbol": result.config.instrument.symbol,
        "trade_count": trade_count,
        "win_rate": float(len(wins) / trade_count) if trade_count else 0.0,
        "profit_factor": profit_factor,
        "profit_factor_is_infinite": profit_factor_is_infinite,
        "max_drawdown": max_drawdown,
        "max_drawdown_pct": max_drawdown_pct,
        "expectancy": expectancy,
        "average_win": avg_win,
        "average_loss": avg_loss,
        "average_win_loss_ratio": average_win_loss_ratio,
        "average_win_loss_ratio_is_infinite": average_win_loss_ratio_is_infinite,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "initial_equity": result.config.backtest.initial_equity,
        "ending_equity": ending_equity,
        "net_profit": ending_equity - result.config.backtest.initial_equity,
        "phase_1_gate": gate,
        "ranges": result.ranges,
        "config": {
            "instrument": asdict(result.config.instrument),
            "rules": asdict(result.config.rules),
            "fees": asdict(result.config.fees),
            "backtest": asdict(result.config.backtest),
        },
    }


def evaluate_phase_1_gate(expectancy: float, max_drawdown_pct: float, result: BacktestResult) -> dict[str, Any]:
    min_expectancy = result.config.backtest.min_expectancy
    max_allowed_dd = result.config.backtest.max_drawdown_pct
    reasons: list[str] = []

    if expectancy < min_expectancy:
        reasons.append(f"expectancy {expectancy:.2f} is below required {min_expectancy:.2f}")
    if max_drawdown_pct > max_allowed_dd:
        reasons.append(f"max drawdown {max_drawdown_pct:.2%} exceeds allowed {max_allowed_dd:.2%}")
    if not result.trades:
        reasons.append("no closed trades were produced")

    return {
        "passed": not reasons,
        "criteria": {
            "min_expectancy": min_expectancy,
            "max_drawdown_pct": max_allowed_dd,
        },
        "reasons": reasons or ["Phase 1 gate criteria satisfied; manual review still required before Phase 2."],
    }


def equity_curve_records(result: BacktestResult) -> list[dict[str, Any]]:
    if result.equity_curve.empty:
        return []
    frame = result.equity_curve.copy()
    running_max = frame["equity"].cummax()
    frame["drawdown"] = frame["equity"] - running_max
    frame["drawdown_pct"] = (frame["drawdown"] / running_max).fillna(0.0)
    frame = frame.reset_index()
    frame["time"] = frame["time"].astype(str)
    return frame.to_dict(orient="records")


def build_report(result: BacktestResult) -> dict[str, Any]:
    return {
        "summary": summarize_result(result),
        "trades": result.trades_as_dicts(),
        "events": result.events_as_dicts(),
        "equity_curve": equity_curve_records(result),
    }


def write_json_report(result: BacktestResult, path: str | Path) -> None:
    report = build_report(result)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
