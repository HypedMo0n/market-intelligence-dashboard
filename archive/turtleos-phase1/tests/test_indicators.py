import pandas as pd

from turtleos.indicators import atr_wilder, true_range


def test_true_range_uses_gap_against_previous_close():
    data = pd.DataFrame(
        {
            "high": [10.0, 15.0],
            "low": [8.0, 14.0],
            "close": [9.0, 14.5],
        }
    )

    tr = true_range(data)

    assert tr.iloc[0] == 2.0
    assert tr.iloc[1] == 6.0


def test_atr_wilder_uses_initial_average_then_wilder_smoothing():
    data = pd.DataFrame(
        {
            "high": [10.0, 12.0, 13.0, 14.0],
            "low": [9.0, 10.0, 11.0, 12.0],
            "close": [9.5, 11.0, 12.0, 13.0],
        }
    )

    atr = atr_wilder(data, period=3)

    assert pd.isna(atr.iloc[0])
    assert pd.isna(atr.iloc[1])
    initial_atr = (1.0 + 2.5 + 2.0) / 3
    assert atr.iloc[2] == initial_atr
    assert round(atr.iloc[3], 6) == round(((initial_atr * 2) + 2.0) / 3, 6)
