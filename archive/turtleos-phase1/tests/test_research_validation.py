import pandas as pd
import pytest

from turtleos.research.validation import (
    IN_SAMPLE_END,
    OUT_OF_SAMPLE_START,
    assert_no_out_of_sample,
    default_phase1_candidates,
)


def test_default_phase1_candidate_grid_matches_locked_prd_scope():
    candidates = default_phase1_candidates()

    assert len(candidates) == 72
    assert sorted({candidate.entry_window for candidate in candidates}) == [15, 20, 25, 40, 55, 70]
    assert sorted({candidate.stop_atr_multiplier for candidate in candidates}) == [1.5, 2.0, 2.5, 3.0]
    assert sorted({candidate.pyramid_atr_interval for candidate in candidates}) == [0.25, 0.5, 0.75]


def test_out_of_sample_guard_rejects_held_out_dates():
    data = pd.DataFrame(
        {"close": [1.0, 2.0]},
        index=[pd.Timestamp(IN_SAMPLE_END), pd.Timestamp(OUT_OF_SAMPLE_START)],
    )

    with pytest.raises(ValueError, match="Out-of-sample data begins"):
        assert_no_out_of_sample(data)
