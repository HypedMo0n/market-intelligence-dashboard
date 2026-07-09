from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InstrumentConfig:
    """Instrument economics for backtesting CFD-style positions."""

    symbol: str = "XAUUSD"
    contract_size: float = 100.0
    dollar_per_point_per_lot: float = 100.0
    min_lot: float = 0.01
    lot_step: float = 0.01
    max_lot: float = 10.0
    spread_points: float = 0.0


@dataclass(frozen=True)
class TurtleRulesConfig:
    entry_window: int = 20
    exit_window: int = 10
    atr_period: int = 20
    stop_atr_multiplier: float = 2.0
    risk_per_unit_pct: float = 0.01
    pyramid_atr_interval: float = 0.5
    max_pyramid_units: int = 4
    allow_short: bool = True


@dataclass(frozen=True)
class FeeConfig:
    commission_per_001_lot: float = 0.05
    charge_exit_commission: bool = True
    swap_per_day: float = 0.0


@dataclass(frozen=True)
class BacktestConfig:
    initial_equity: float = 10_000.0
    max_total_lots: float = 10.0
    max_account_leverage: float = 5.0
    min_expectancy: float = 0.0
    max_drawdown_pct: float = 0.25
    max_open_risk_pct: float | None = None
    symbol_drawdown_pause_pct: float | None = None


@dataclass(frozen=True)
class TurtleOSConfig:
    instrument: InstrumentConfig = InstrumentConfig()
    rules: TurtleRulesConfig = TurtleRulesConfig()
    fees: FeeConfig = FeeConfig()
    backtest: BacktestConfig = BacktestConfig()
