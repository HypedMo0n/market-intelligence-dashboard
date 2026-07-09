import pandas as pd

from turtleos.rules import breakout_levels


def test_breakout_levels_use_prior_bars_only():
    data = pd.DataFrame(
        {
            "high": [10.0, 11.0, 12.0, 20.0],
            "low": [8.0, 7.0, 9.0, 10.0],
            "close": [9.0, 10.0, 11.0, 19.0],
        }
    )

    levels = breakout_levels(data, window=3)

    assert pd.isna(levels["long_entry"].iloc[2])
    assert levels["long_entry"].iloc[3] == 12.0
    assert levels["short_entry"].iloc[3] == 7.0
