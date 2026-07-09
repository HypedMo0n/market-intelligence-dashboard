from __future__ import annotations

import math

from turtleos.config import BacktestConfig, InstrumentConfig, TurtleRulesConfig


def floor_to_lot_step(lots: float, step: float) -> float:
    if step <= 0:
        raise ValueError("lot step must be positive")
    return math.floor(lots / step) * step


def volatility_adjusted_lots(
    equity: float,
    atr: float,
    price: float,
    instrument: InstrumentConfig,
    rules: TurtleRulesConfig,
    backtest: BacktestConfig,
    existing_lots: float = 0.0,
) -> float:
    """Size one Turtle unit from current equity and ATR, then apply hard caps."""

    if equity <= 0 or atr <= 0 or price <= 0:
        return 0.0

    risk_dollars_per_n = equity * rules.risk_per_unit_pct
    raw_lots = risk_dollars_per_n / (atr * instrument.dollar_per_point_per_lot)

    max_by_position = min(instrument.max_lot, backtest.max_total_lots) - existing_lots
    max_notional = equity * backtest.max_account_leverage
    max_lots_by_leverage = (max_notional / (price * instrument.contract_size)) - existing_lots
    capped = min(raw_lots, max_by_position, max_lots_by_leverage)
    stepped = floor_to_lot_step(max(capped, 0.0), instrument.lot_step)

    if stepped < instrument.min_lot:
        return 0.0
    return round(stepped, 8)
