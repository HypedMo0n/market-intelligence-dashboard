# TurtleOS Implementation Plan

## Current phase: Phase 1 only

The current codebase is restricted to strategy research and backtesting.

## Phase 1 deliverables

1. Rule engine
   - Wilder ATR.
   - N-day long/short breakout levels using prior bars only.
   - Channel exits using prior bars only.
   - 2N stop calculation by default.
   - Pyramiding at 0.5N by default, capped by configured max units.

2. Data ingestion
   - CSV loader for development and testing.
   - MT5 historical loader using `copy_rates_range` and `copy_rates_from`.
   - No credentials in code.

3. Backtester
   - Supports multiple date ranges by slicing the same OHLC dataset.
   - Tracks unit entries, exits, stops, pyramids, net P/L, realized equity, equity curve, and drawdown.
   - Applies no swap.
   - Applies configurable spread.
   - Applies `$0.05 per 0.01 lot` commission by order side.

4. Research validation
   - Constrained parameter sweep.
   - Walk-forward helper.
   - In-sample/out-of-sample split helper.

5. Reporting and gate
   - Win rate.
   - Profit factor.
   - Max drawdown.
   - Expectancy.
   - Average win/loss ratio.
   - Trade count.
   - Equity curve data.
   - Pass/fail gate with reasons.

## Phase gate rule

Do not implement Phase 2 or beyond until Phase 1 produces a reviewed report with positive expectancy and acceptable max drawdown over a meaningful historical sample.

## Future phase stubs

MT5 order placement, journal automation, alerts, dashboard, AI coach, paper trading, demo execution, and live automation are intentionally absent. Any future execution code must include manual review comments and hard risk controls before it can be used.
