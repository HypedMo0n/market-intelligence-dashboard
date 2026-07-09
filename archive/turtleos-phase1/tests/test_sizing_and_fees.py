from turtleos.config import BacktestConfig, FeeConfig, InstrumentConfig, TurtleRulesConfig
from turtleos.fees import commission_for_lots
from turtleos.sizing import volatility_adjusted_lots


def test_commission_calculation_confirmed_fee_profile():
    assert commission_for_lots(0.01, FeeConfig()) == 0.05
    assert commission_for_lots(0.10, FeeConfig()) == 0.50
    assert commission_for_lots(1.00, FeeConfig()) == 5.00


def test_volatility_adjusted_position_sizing_with_lot_step():
    lots = volatility_adjusted_lots(
        equity=10_000,
        atr=10,
        price=2_000,
        instrument=InstrumentConfig(contract_size=100, dollar_per_point_per_lot=100, lot_step=0.01),
        rules=TurtleRulesConfig(risk_per_unit_pct=0.01),
        backtest=BacktestConfig(max_account_leverage=100),
    )

    assert lots == 0.1


def test_position_sizing_applies_leverage_cap_after_formula():
    lots = volatility_adjusted_lots(
        equity=10_000,
        atr=1,
        price=2_000,
        instrument=InstrumentConfig(contract_size=100, dollar_per_point_per_lot=100, lot_step=0.01),
        rules=TurtleRulesConfig(risk_per_unit_pct=0.10),
        backtest=BacktestConfig(max_account_leverage=1),
    )

    assert lots == 0.05
