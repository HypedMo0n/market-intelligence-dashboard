# TurtleOS Phase 1 Candidate Comparison

Scope: in-sample only, 2013-12-24 through 2022-12-31. The locked out-of-sample period from 2023-01-01 onward was not loaded or evaluated.

Spread policy: historical spread was used only if MT5 supplied valid positive spread for every D1 bar; otherwise the configured conservative spread assumptions are used and labeled in the CLI summary.

## Recommendation: Recommend frozen candidate for final out-of-sample validation

lower_risk ranks highest across statistical robustness, drawdown control, symbol stability, regime stability, and simplicity without unlocking the out-of-sample period.

Frozen candidate: lower_risk

## Ranking

| candidate_id | label | statistical_robustness_score | drawdown_control_score | symbol_stability_score | regime_stability_score | simplicity_score | total_score | rank_reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lower_risk | Lower-risk | 99.9830 | 100.0000 | 80.8880 | 30.0455 | 95.0000 | 85.1785 | Bootstrap P(expectancy>0)=100.0%; observed max DD=4.9%; MC 95th percentile DD=1.5%; both symbols positive=True; degraded rolling windows=35. |
| wider_pyramid | Wider pyramid | 89.6588 | 92.7812 | 92.6581 | 21.9457 | 80.0000 | 79.7603 | Bootstrap P(expectancy>0)=95.2%; observed max DD=7.4%; MC 95th percentile DD=4.2%; both symbols positive=True; degraded rolling windows=58. |
| lower_stop | Lower stop | 91.2420 | 91.8596 | 89.2920 | 22.0118 | 75.0000 | 78.9668 | Bootstrap P(expectancy>0)=96.4%; observed max DD=7.7%; MC 95th percentile DD=4.1%; both symbols positive=True; degraded rolling windows=90. |
| base | Base | 81.2053 | 90.6213 | 89.0383 | 21.8989 | 100.0000 | 77.6386 | Bootstrap P(expectancy>0)=88.0%; observed max DD=8.1%; MC 95th percentile DD=5.1%; both symbols positive=True; degraded rolling windows=75. |

## Combined Portfolio Metrics

| candidate_id | label | entry_window | exit_window | atr_period | stop_atr_multiplier | pyramid_atr_interval | risk_per_unit_pct | max_total_lots | max_account_leverage | max_open_risk_pct | symbol_drawdown_pause_pct | expectancy | profit_factor | win_rate | max_drawdown_pct | net_profit | trade_count | max_exposure_pct | drawdown_gate_passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | Base | 15 | 8 | 20 | 2.0000 | 0.7500 | 0.0025 | 10.0000 | 5.0000 | 0.0100 | None | 6.2288 | 1.2870 | 0.3137 | 0.0813 | 1270.6765 | 204 | 0.7115 | True |
| lower_risk | Lower-risk | 15 | 8 | 20 | 2.0000 | 0.7500 | 0.0013 | 10.0000 | 5.0000 | 0.0100 | None | 14.3261 | 2.2213 | 0.4397 | 0.0487 | 2019.9790 | 141 | 0.5948 | True |
| wider_pyramid | Wider pyramid | 15 | 8 | 20 | 2.0000 | 1.0000 | 0.0025 | 10.0000 | 5.0000 | 0.0100 | None | 9.3862 | 1.4414 | 0.3459 | 0.0741 | 1736.4457 | 185 | 0.7018 | True |
| lower_stop | Lower stop | 15 | 8 | 20 | 1.7500 | 0.7500 | 0.0025 | 10.0000 | 5.0000 | 0.0100 | None | 8.4341 | 1.4398 | 0.3439 | 0.0771 | 1863.9320 | 221 | 0.7703 | True |

## Per-Symbol Metrics

| candidate_id | label | symbol | expectancy | profit_factor | win_rate | max_drawdown_pct | net_profit | trade_count | max_exposure_pct | positive_expectancy | drawdown_gate_passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | Base | XAUUSD.var | 7.1966 | 1.3658 | 0.3082 | 0.0779 | 1144.2571 | 159 | 0.5913 | True | True |
| base | Base | XAGUSD.var | 2.8093 | 1.0974 | 0.3333 | 0.1155 | 126.4194 | 45 | 0.2429 | True | True |
| lower_risk | Lower-risk | XAUUSD.var | 25.1418 | 3.6737 | 0.5493 | 0.0480 | 1785.0667 | 71 | 0.5423 | True | True |
| lower_risk | Lower-risk | XAGUSD.var | 3.3559 | 1.2382 | 0.3286 | 0.1000 | 234.9123 | 70 | 0.2242 | True | True |
| wider_pyramid | Wider pyramid | XAUUSD.var | 10.4363 | 1.5391 | 0.3472 | 0.0719 | 1502.8264 | 144 | 0.5816 | True | True |
| wider_pyramid | Wider pyramid | XAGUSD.var | 5.6980 | 1.2038 | 0.3415 | 0.1065 | 233.6194 | 41 | 0.2350 | True | True |
| lower_stop | Lower stop | XAUUSD.var | 9.6073 | 1.5662 | 0.3466 | 0.0734 | 1690.8932 | 176 | 0.6814 | True | True |
| lower_stop | Lower stop | XAGUSD.var | 3.8453 | 1.1382 | 0.3333 | 0.1113 | 173.0388 | 45 | 0.2424 | True | True |

## Bootstrap Confidence

| candidate_id | expectancy_ci | profit_factor_ci | win_rate_ci | expectancy_median | profit_factor_median | win_rate_median | prob_expectancy_positive | prob_profit_factor_gt_1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | [-3.824543469245589, 16.956663726215528] | [0.8385387066774003, 1.8553655665372395] | [0.25, 0.37745098039215685] | 6.1176 | 1.2817 | 0.3137 | 0.8802 | 0.8802 |
| lower_risk | [5.8294977800794525, 23.464032764509156] | [1.4387466034400183, 3.2904747177311404] | [0.3546099290780142, 0.524822695035461] | 14.1474 | 2.2082 | 0.4397 | 0.9998 | 0.9998 |
| wider_pyramid | [-1.3133714356391004, 21.068835258260115] | [0.9447808745224591, 2.099309889711387] | [0.2756756756756757, 0.41621621621621624] | 9.1713 | 1.4313 | 0.3459 | 0.9517 | 0.9517 |
| lower_stop | [-0.684785244671639, 18.30400410093839] | [0.9676757986330843, 2.044468253951177] | [0.28054298642533937, 0.4072398190045249] | 8.3041 | 1.4331 | 0.3439 | 0.9642 | 0.9642 |

## Monte Carlo Drawdown

| candidate_id | median_return | mean_return | worst_5pct_drawdown | worst_drawdown_observed | best_drawdown_observed | return_95pct_ci | prob_drawdown_gt_10pct | prob_drawdown_gt_15pct | prob_drawdown_gt_20pct | prob_drawdown_gt_25pct | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | 0.0635 | 0.0635 | 0.0510 | 0.0823 | 0.0147 | [0.06353382434156574, 0.06353382434156629] | 0.0000 | 0.0000 | 0.0000 | 0.0000 | Trade-order randomization keeps total return fixed; drawdown distribution changes with order. |
| lower_risk | 0.1010 | 0.1010 | 0.0153 | 0.0260 | 0.0047 | [0.10099895126593456, 0.10099895126593474] | 0.0000 | 0.0000 | 0.0000 | 0.0000 | Trade-order randomization keeps total return fixed; drawdown distribution changes with order. |
| wider_pyramid | 0.0868 | 0.0868 | 0.0422 | 0.0836 | 0.0118 | [0.08682228570211736, 0.08682228570211792] | 0.0000 | 0.0000 | 0.0000 | 0.0000 | Trade-order randomization keeps total return fixed; drawdown distribution changes with order. |
| lower_stop | 0.0932 | 0.0932 | 0.0408 | 0.0682 | 0.0120 | [0.09319659943374844, 0.093196599433749] | 0.0000 | 0.0000 | 0.0000 | 0.0000 | Trade-order randomization keeps total return fixed; drawdown distribution changes with order. |

## Regime Summary

| candidate_id | worst_month | worst_month_return | best_month | best_month_return | worst_year | worst_year_return | best_year | best_year_return | worst_rolling_expectancy_time | worst_rolling_expectancy | best_rolling_expectancy_time | best_rolling_expectancy | worst_rolling_profit_factor_time | worst_rolling_profit_factor | best_rolling_profit_factor_time | best_rolling_profit_factor | degraded_rolling_windows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | 2022-01 | -0.0140 | 2019-09 | 0.0354 | 2021 | -0.0295 | 2020 | 0.0479 | 2022-01-27 00:00:00 | -30.9216 | 2020-09-21 00:00:00 | 66.3776 | 2022-01-27 00:00:00 | 0.0760 | 2020-09-21 00:00:00 | 4.4045 | 75 |
| lower_risk | 2022-01 | -0.0065 | 2019-09 | 0.0361 | 2021 | -0.0203 | 2019 | 0.0425 | 2021-11-02 00:00:00 | -15.0661 | 2020-09-21 00:00:00 | 53.1721 | 2021-11-02 00:00:00 | 0.1018 | 2020-09-21 00:00:00 | 8.0986 | 35 |
| wider_pyramid | 2022-01 | -0.0140 | 2020-09 | 0.0354 | 2021 | -0.0287 | 2020 | 0.0523 | 2022-01-27 00:00:00 | -30.2548 | 2020-09-21 00:00:00 | 64.8914 | 2022-01-27 00:00:00 | 0.0778 | 2020-09-21 00:00:00 | 4.3322 | 58 |
| lower_stop | 2022-01 | -0.0137 | 2019-09 | 0.0444 | 2021 | -0.0255 | 2020 | 0.0470 | 2022-01-27 00:00:00 | -29.0435 | 2020-09-21 00:00:00 | 73.7519 | 2022-01-27 00:00:00 | 0.0805 | 2020-09-21 00:00:00 | 5.3581 | 90 |

Monthly returns, annual returns, rolling diagnostics, trades, equity curves, and charts are saved in each candidate subfolder.