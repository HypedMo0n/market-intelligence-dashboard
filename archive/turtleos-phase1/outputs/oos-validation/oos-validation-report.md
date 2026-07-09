# TurtleOS Phase 1 Final Out-of-Sample Validation

Scope: frozen lower_risk candidate only, out-of-sample period 2023-01-01 through 2026-07-08.

No parameters were tuned, no filters were added, and no alternate candidate was selected from this result.

## Verdict: Conditional Pass

- Not all symbols have positive OOS expectancy.
- OOS portfolio passed core gates, but one or more confirmation checks failed.

## Combined Portfolio Metrics

| expectancy | profit_factor | win_rate | max_drawdown_pct | net_profit | trade_count | max_exposure_pct | drawdown_gate_passed | candidate_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3.4664 | 1.2688 | 0.2872 | 0.0450 | 325.8382 | 94 | 0.3156 | True | lower_risk |

## Per-Symbol Metrics

| candidate_id | symbol | expectancy | profit_factor | win_rate | max_drawdown_pct | net_profit | trade_count | max_exposure_pct | positive_expectancy | drawdown_gate_passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lower_risk | XAUUSD.var | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 | 0.0000 | False | True |
| lower_risk | XAGUSD.var | 3.4664 | 1.2688 | 0.2872 | 0.0893 | 325.8382 | 94 | 0.3156 | True | True |

## In-Sample vs Out-of-Sample

| in_sample_expectancy | out_of_sample_expectancy | expectancy_retention | in_sample_profit_factor | out_of_sample_profit_factor | profit_factor_retention | in_sample_max_drawdown_pct | out_of_sample_max_drawdown_pct | drawdown_expansion_ratio | drawdown_expansion_pct_points | in_sample_trades_per_year | out_of_sample_trades_per_year | trade_frequency_change_ratio | out_of_sample_trade_count | symbols_positive_expectancy | per_symbol_expectancy_retention | edge_generalized |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14.3261 | 3.4664 | 0.2420 | 2.2213 | 1.2688 | 0.5712 | 0.0487 | 0.0450 | 0.9253 | -0.0036 | 15.6346 | 26.7395 | 1.7103 | 94 | False | {'XAUUSD.var': 0.0, 'XAGUSD.var': 1.0329192552426818} | False |

## OOS Regime Summary

| worst_month | worst_month_return | best_month | best_month_return | worst_year | worst_year_return | best_year | best_year_return | worst_rolling_expectancy_time | worst_rolling_expectancy | worst_rolling_profit_factor_time | worst_rolling_profit_factor | degraded_rolling_windows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-04 | -0.0062 | 2026-01 | 0.0319 | 2023 | -0.0198 | 2026 | 0.0262 | 2025-04-09 00:00:00 | -16.6715 | 2025-04-09 00:00:00 | 0.0328 | 44 |

Charts and CSV evidence are saved alongside this report.