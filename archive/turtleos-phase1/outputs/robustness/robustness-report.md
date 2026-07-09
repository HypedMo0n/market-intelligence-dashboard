# TurtleOS Phase 1 Robustness Report

Scope: in-sample only, 2013-12-24 through 2022-12-31. The held-out 2023-01-01 onward period was not loaded or evaluated.

## Verdict: Promising but Needs Further Research

Verdict uses in-sample evidence only: survivor stability, immediate-neighbor retention, Monte Carlo drawdown risk, bootstrap edge confidence, and rolling degradation.

## Strongest Candidate

- Entry window: 15
- Exit window: 8
- ATR stop: 2.0N
- Pyramid spacing: 0.75N
- Risk per unit: 0.25%
- Max open risk cap: 1.00%
- Max drawdown: 8.13%
- Profit factor: 1.29
- Expectancy: 6.23

## Stability

| entry_window | stop_atr_multiplier | pyramid_atr_interval | risk_per_unit_pct | classification | classification_reason |
| --- | --- | --- | --- | --- | --- |
| 15 | 2.0000 | 0.7500 | 0.0050 | Acceptable | Positive but thinner edge or less consistent symbol-level behavior. |
| 15 | 1.5000 | 0.5000 | 0.0050 | Acceptable | Positive but thinner edge or less consistent symbol-level behavior. |
| 15 | 1.5000 | 0.7500 | 0.0050 | Acceptable | Positive but thinner edge or less consistent symbol-level behavior. |
| 15 | 2.0000 | 0.7500 | 0.0100 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 1.5000 | 0.7500 | 0.0100 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 1.5000 | 0.7500 | 0.0075 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 2.0000 | 0.7500 | 0.0075 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 1.5000 | 0.5000 | 0.0100 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 1.5000 | 0.5000 | 0.0075 | Overfit | Gate passes mainly via throttles, but edge is weak or not positive on both symbols often enough. |
| 15 | 1.5000 | 0.7500 | 0.0025 | Robust | Positive expectancy, PF >= 1.25, drawdown <= 15%, and positive on both symbols across most risk variants. |
| 15 | 2.0000 | 0.7500 | 0.0025 | Robust | Positive expectancy, PF >= 1.25, drawdown <= 15%, and positive on both symbols across most risk variants. |
| 15 | 1.5000 | 0.5000 | 0.0025 | Robust | Positive expectancy, PF >= 1.25, drawdown <= 15%, and positive on both symbols across most risk variants. |

## Neighborhood

| dimension | value | expectancy | profit_factor | max_drawdown_pct | expectancy_retention_vs_base | all_symbols_positive_expectancy |
| --- | --- | --- | --- | --- | --- | --- |
| base | none | 6.2288 | 1.2870 | 0.0813 | 1.0000 | True |
| breakout | 14 | 3.7961 | 1.1753 | 0.0933 | 0.6094 | False |
| breakout | 16 | 6.1220 | 1.2833 | 0.0776 | 0.9829 | True |
| stop | 1.75 | 8.4341 | 1.4398 | 0.0771 | 1.3540 | True |
| stop | 2.25 | 7.0099 | 1.3355 | 0.0534 | 1.1254 | True |
| pyramid | 0.5 | 4.3490 | 1.1991 | 0.0827 | 0.6982 | True |
| pyramid | 1.0 | 9.3862 | 1.4414 | 0.0741 | 1.5069 | True |
| risk | 0.00125 | 14.3261 | 2.2213 | 0.0487 | 2.3000 | True |
| risk | 0.005 | 9.0808 | 1.1917 | 0.0921 | 1.4579 | True |

## Monte Carlo

{
  "median_return": 0.06353382434156592,
  "mean_return": 0.06353382434156599,
  "worst_5pct_drawdown": 0.050557403504997045,
  "worst_drawdown_observed": 0.07466450900283497,
  "best_drawdown_observed": 0.0136099840969606,
  "return_95pct_ci": [
    0.06353382434156574,
    0.06353382434156629
  ],
  "prob_drawdown_gt_10pct": 0.0,
  "prob_drawdown_gt_15pct": 0.0,
  "prob_drawdown_gt_20pct": 0.0,
  "prob_drawdown_gt_25pct": 0.0,
  "note": "Trade-order randomization keeps total return fixed; drawdown distribution changes with order."
}

## Bootstrap

{
  "expectancy_ci": [
    -3.8094740451826334,
    17.09734257085182
  ],
  "profit_factor_ci": [
    0.839868538914842,
    1.8650389115222483
  ],
  "win_rate_ci": [
    0.25,
    0.37745098039215685
  ],
  "expectancy_median": 6.032247097474277,
  "profit_factor_median": 1.278661673369451,
  "win_rate_median": 0.3137254901960784,
  "prob_expectancy_positive": 0.884,
  "prob_profit_factor_gt_1": 0.884
}

## Distribution Notes

- Largest win: 395.83
- Largest loss: -58.91
- Degraded rolling windows: 0

Charts and CSVs are referenced in `robustness-summary.json`.