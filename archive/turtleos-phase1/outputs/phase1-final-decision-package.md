# TurtleOS Phase 1 Final Decision Package

Date: 2026-07-08

Scope: Phase 1 final decision only. This package preserves the completed in-sample research and the single final out-of-sample validation result. No parameters were tuned from the out-of-sample result.

## Frozen Candidate

- Candidate status: conditional XAG-led candidate, not proven portfolio system
- Candidate ID: `lower_risk`
- Entry window: `15`
- Exit window: `8`
- ATR period: `20`
- ATR stop multiplier: `2.0`
- Pyramid interval: `0.75N`
- Risk per unit: `0.125%`
- Max total lots: `10`
- Max account leverage: `5`
- Max open risk cap: `1%`
- Symbol drawdown pause: none
- Portfolio drawdown pause: none
- Symbols tested in final OOS: `XAUUSD.var`, `XAGUSD.var`
- Spread assumptions: `XAUUSD = 0.50`, `XAGUSD = 0.05` price units

## Final Recommendation

- Proceed to Phase 2: Yes
- Proceed to live/demo execution: No
- Recommended next state: journal + paper-tracking only
- Candidate status: conditional XAG-led candidate, not proven portfolio system

Phase 2 should be limited to journal and paper-tracking infrastructure. It should not include demo execution, live execution, alerts, automation, or order placement.

## Phase 1 Verdict

Classification: Conditional Pass

The frozen candidate passed core portfolio-level OOS gates but failed clean portfolio generalization. The result supports careful paper tracking, not execution.

## What Passed

- Portfolio-level OOS expectancy was positive: `3.47`.
- Portfolio-level OOS profit factor was above 1: `1.27`.
- OOS max drawdown stayed well below the 25% gate: `4.50%`.
- OOS net profit was positive: `$325.84`.
- OOS trade count was usable at the portfolio level: `94`.
- OOS max exposure was contained: `31.56%`.
- XAGUSD.var was positive OOS:
  - Expectancy: `3.47`
  - Profit factor: `1.27`
  - Max drawdown: `8.93%`
  - Net profit: `$325.84`
  - Trade count: `94`
- Drawdown did not expand relative to in-sample:
  - In-sample max drawdown: `4.87%`
  - OOS max drawdown: `4.50%`
  - Drawdown expansion ratio: `0.93x`

## What Failed

- XAUUSD.var produced `0` closed trades in OOS.
- XAUUSD.var did not confirm positive OOS expectancy.
- The portfolio result was carried entirely by XAGUSD.var.
- Edge generalized at the portfolio level only partially.
- OOS expectancy retention was weak:
  - In-sample expectancy: `14.33`
  - OOS expectancy: `3.47`
  - Retention: `24.20%`
- OOS profit factor retention was weak:
  - In-sample profit factor: `2.22`
  - OOS profit factor: `1.27`
  - Retention: `57.12%`
- The OOS validation did not prove a diversified metals portfolio system.

## What Remains Uncertain

- Whether XAUUSD.var has a real edge under the frozen rules. The OOS sample produced no closed trades, so it cannot confirm or reject profitability from trade outcomes.
- Whether XAUUSD.var inactivity is a structural issue with the frozen entry/exit rules, market regime, data characteristics, or simply a sparse-signal outcome.
- Whether the XAGUSD.var edge is durable enough for automation. It passed this OOS period, but the candidate is now XAG-led and needs live paper evidence before any execution discussion.
- Whether the portfolio construction has enough diversification benefit. The final OOS result behaved like a single-symbol XAGUSD.var system.
- Whether the conservative spread assumptions are sufficiently representative in future conditions. Historical MT5 D1 spread was not used because it was not reliable for every bar.

## XAUUSD Candidate Universe Decision

XAUUSD.var should remain in the research candidate universe, but it should not be counted as OOS-confirmed for this frozen candidate.

Rationale:

- Removing XAUUSD.var because it had zero OOS trades would be an OOS-driven selection decision.
- Keeping it in the universe preserves auditability and avoids tuning from the held-out result.
- For Phase 2 paper tracking, XAUUSD.var should be monitored separately and marked as unconfirmed/inactive under this candidate until real forward paper signals occur.

## XAGUSD Tracking Decision

XAGUSD.var should be tracked separately as the only OOS-confirmed symbol for this candidate.

Rationale:

- XAGUSD.var generated all OOS trades and all OOS profit.
- XAGUSD.var retained positive symbol-level expectancy.
- The final candidate should be described as XAG-led, not as a proven XAU/XAG portfolio.
- Phase 2 journal views should separate XAGUSD.var performance from combined portfolio performance.

## No OOS Tuning Warning

This OOS result must not be used to tune parameters.

Do not adjust:

- Entry window
- Exit window
- ATR period
- Stop multiplier
- Pyramid spacing
- Risk per unit
- Exposure caps
- Symbol inclusion
- Filters
- Spread assumptions
- Trade direction rules

Any future strategy change requires a new validation protocol with a fresh research plan, explicit train/test boundaries, and a new untouched validation set or forward-only paper protocol. The OOS result is evidence, not a tuning dataset.

## Proceed To Phase 2?

Yes, with strict limits.

Approved Phase 2 scope:

- Journal/paper-tracking only
- Read-only signal logging
- Trade intent records
- Rule-decision audit trail
- Symbol-separated performance tracking
- Manual review checkpoints
- No order placement
- No demo trading
- No live trading
- No alerts or automation that could imply execution readiness

Reasoning:

Phase 1 produced enough evidence to justify forward observation and journal infrastructure, but not enough evidence to justify execution. The system is conditionally viable as a research candidate. It is not yet an automation candidate.

## Proceed To Live Or Demo Execution?

No.

Reasons:

- OOS validation was conditional, not clean.
- XAUUSD.var did not generate OOS trades.
- Portfolio edge was not independently confirmed across both symbols.
- XAGUSD.var is the only OOS-confirmed source of returns.
- Forward paper tracking is required before any execution phase.

## Final State

Recommended next state: journal + paper-tracking only.

Candidate status: conditional XAG-led candidate, not proven portfolio system.

This preserves the Phase 1 result without overclaiming it and keeps the next phase focused on evidence collection rather than execution.

## Evidence Files

- OOS validation summary: `outputs/oos-validation/oos-validation-summary.json`
- OOS validation report: `outputs/oos-validation/oos-validation-report.md`
- OOS combined metrics: `outputs/oos-validation/combined-metrics.csv`
- OOS per-symbol metrics: `outputs/oos-validation/per-symbol-metrics.csv`
- OOS in-sample comparison: `outputs/oos-validation/in-sample-vs-oos.csv`
- OOS monthly returns: `outputs/oos-validation/monthly-returns.csv`
- OOS annual returns: `outputs/oos-validation/annual-returns.csv`
- OOS equity curve: `outputs/oos-validation/equity-curve.svg`
- OOS underwater drawdown: `outputs/oos-validation/underwater-drawdown.svg`
- In-sample candidate comparison: `outputs/candidate-comparison/candidate-comparison-summary.json`
