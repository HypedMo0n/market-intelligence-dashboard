# XAUUSD.var OOS Forensic Audit

Scope: audit only. No strategy parameters, code, filters, or optimization were changed.

## Conclusion

Zero closed XAUUSD.var OOS trades is explained by volatility-adjusted sizing at 0.125% risk producing less than the 0.01 minimum lot on every breakout signal; no evidence of a software/data issue suppressing valid-sized XAU entries was found.

## Backtester Result

- Closed trades: 0
- Events: 0
- Entry events: 0
- Pyramid events: 0
- Exit events: 0
- Still open at OOS end: False

## Breakout Audit

- potential_breakout_rows: 160
- long_breakouts: 117
- short_breakouts: 43
- warmup_rejections: 1
- sizing_rejections_below_min_lot: 159
- would_enter_by_audit: 0
- max_raw_lots_on_breakout: 0.008132304221341584
- min_raw_lots_on_breakout: 0.0007090325836587639
- min_required_lot: 0.01

Every actionable breakout was rejected before entry because the frozen volatility sizing produced a lot size below `0.01`. The largest raw lot size observed on any breakout was below the configured minimum lot.

Sizing mechanics:

- Risk dollars per Turtle unit: `$10,000 * 0.00125 = $12.50`
- XAU contract economics used by the backtester: `$100 per price unit per 1.00 lot`
- Raw lots formula: `$12.50 / (ATR * 100)`
- Minimum tradable lot: `0.01`
- To reach `0.01` lot, ATR would need to be `<= 12.50`
- Highest raw lot observed on any actionable breakout: `0.008132304221341584`
- Therefore every actionable XAU breakout floored to `0.00` lots and was rejected before order simulation.

## Lifecycle Verification

- No entry events occurred, so there were no trade lifecycles to close.
- No position remained open at the end of OOS.
- Stop, channel exit, and pyramiding logic were reachable in code but had no open unit to act on.
- The audit independently recomputed the sizing rejection for each breakout and matched the backtester outcome: zero entries, zero exits, zero trades.

## Data Integrity

- requested_symbol: XAUUSD.var
- actual_symbol: XAUUSD.var
- bars: 908
- first_bar: 2023-01-03 00:00:00
- last_bar: 2026-07-08 00:00:00
- monotonic_index: True
- duplicate_timestamps: 0
- ohlc_missing_values: 0
- high_low_violations: 0
- non_positive_prices: 0
- timestamps_all_midnight: True
- timezone_naive_mt5_bars: None
- mt5_spread_price_valid_all_bars: False
- mt5_spread_price_zero_or_negative_bars: 162
- assumed_spread_used: 0.5
- business_days_in_range: 917
- missing_business_days_count: 9
- calendar_gaps_gt_3_days_count: 5

Missing business days and multi-day gaps were saved in `xauusd-oos-data-integrity.json`. They are consistent with non-weekend market holidays / trading-calendar gaps in D1 data, not duplicate or corrupt bars.

The unusable MT5 historical spread field did not suppress XAU trades. Spread affects modeled fill prices after a position is opened; the XAU rejection occurred earlier at volatility-adjusted position sizing.

## Symbol / Contract Notes

- name: XAUUSD.var
- path: Liquid Markets\Var\Commodities\Metals\XAUUSD.var
- description: Gold vs US Dollar
- currency_base: USD
- currency_profit: USD
- currency_margin: USD
- trade_mode: 4
- trade_calc_mode: 2
- trade_contract_size: 100.0
- point: 0.01
- digits: 2
- volume_min: 0.01
- volume_step: 0.01
- volume_max: 20.0
- start_time: 0
- expiration_time: 0

No equity-style corporate actions apply to spot/CFD XAUUSD. No contract-roll or expiration marker was identified in the selected MT5 symbol metadata subset.

## Implementation Bug Review

- Symbol mapping was exact: requested `XAUUSD.var`, resolved `XAUUSD.var`.
- MT5 contract metadata was compatible with the local instrument model: contract size `100`, minimum lot `0.01`, lot step `0.01`.
- Backtester output matched the independent audit recomputation: zero entry events and zero closed trades.
- No evidence was found that ATR, breakout, stop, channel-exit, pyramiding, date alignment, or spread handling incorrectly suppressed a valid-sized XAU entry.

## Artifacts

- `xauusd-oos-breakout-audit.csv`: every OOS Turtle breakout signal and rejection reason
- `xauusd-oos-daily-rule-audit.csv`: every OOS D1 bar with rule levels, ATR, signals, and sizing audit
- `xauusd-oos-trades.csv`: backtester trades, empty by design
- `xauusd-oos-events.csv`: backtester events, empty by design
- `xauusd-oos-data-integrity.json`: MT5 data checks
- `xauusd-oos-forensic-summary.json`: machine-readable audit summary
