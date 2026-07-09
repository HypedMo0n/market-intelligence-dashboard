import pandas as pd

from turtleos.backtester import TurtleBacktester
from turtleos.config import BacktestConfig, InstrumentConfig, TurtleOSConfig, TurtleRulesConfig
from turtleos.reporting import build_report


def make_trending_data() -> pd.DataFrame:
    rows = []
    closes = [
        100,
        101,
        102,
        103,
        104,
        107,
        110,
        113,
        116,
        119,
        122,
        121,
        118,
        114,
        110,
        106,
    ]
    for idx, close in enumerate(closes):
        rows.append(
            {
                "time": pd.Timestamp("2024-01-01") + pd.Timedelta(days=idx),
                "open": close - 0.5,
                "high": close + 1.0,
                "low": close - 1.0,
                "close": close,
            }
        )
    return pd.DataFrame(rows).set_index("time")


def test_backtest_execution_outputs_trade_report_and_gate():
    config = TurtleOSConfig(
        instrument=InstrumentConfig(
            symbol="XAUUSD",
            contract_size=100,
            dollar_per_point_per_lot=100,
            spread_points=0,
            max_lot=10,
        ),
        rules=TurtleRulesConfig(
            entry_window=3,
            exit_window=3,
            atr_period=3,
            risk_per_unit_pct=0.01,
            pyramid_atr_interval=0.5,
            max_pyramid_units=4,
            allow_short=False,
        ),
        backtest=BacktestConfig(initial_equity=10_000, max_account_leverage=100, max_drawdown_pct=1.0),
    )

    result = TurtleBacktester(config).run(make_trending_data())
    report = build_report(result)

    assert report["summary"]["trade_count"] >= 1
    assert len(report["events"]) >= 2
    assert any(event["event_type"] == "pyramid" for event in report["events"])
    assert "phase_1_gate" in report["summary"]
    assert len(report["equity_curve"]) > 0


def test_backtester_accepts_multiple_date_ranges():
    config = TurtleOSConfig(
        rules=TurtleRulesConfig(entry_window=3, exit_window=3, atr_period=3, allow_short=False),
        backtest=BacktestConfig(initial_equity=10_000, max_account_leverage=100, max_drawdown_pct=1.0),
    )
    data = make_trending_data()

    result = TurtleBacktester(config).run(
        data,
        ranges=[
            ("2024-01-01", "2024-01-08"),
            ("2024-01-09", "2024-01-16"),
        ],
    )

    assert result.ranges is not None
    assert len(result.ranges) == 2
