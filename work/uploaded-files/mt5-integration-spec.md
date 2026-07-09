# MT5 → Dashboard integration spec

Give this to Codex as the spec for the local script. The dashboard has an **"Import MT5 data"** panel with a paste box that expects exactly this JSON shape.

## Required output shape

A single JSON object, keyed by instrument. Include only the instruments you have data for — you don't need all five every run.

```json
{
  "XAUUSD": {
    "trend": "up | down | sideways",
    "structure": "higher highs and higher lows | lower highs and lower lows | range or choppy",
    "volatility": "calm | normal | aggressive",
    "keyLevels": {
      "recentHigh": "2378.40",
      "recentLow": "2361.10",
      "support": "2360.00",
      "resistance": "2378.00"
    },
    "liquidityZones": "Stops likely cluster just below 2361.10 and just above 2378.40.",
    "notes": "Price broke below yesterday's low on the H1 chart and has not reclaimed it."
  },
  "XAGUSD": { "...same shape...": true }
}
```

Valid instrument keys: `XAUUSD`, `XAGUSD`, `EURUSD`, `AUDUSD`, `GBPJPY` — must match exactly (case-sensitive).

## Suggested computation logic (Python + `MetaTrader5` package)

For each instrument, pull recent OHLC bars (e.g. H1 for the last 3–5 days, or whatever timeframe you trade) via `mt5.copy_rates_from_pos()`, then:

- **trend**: compare the last N swing highs/lows, or simpler — compare current close to an EMA (e.g. 50-period): above + rising = up, below + falling = down, else sideways.
- **structure**: identify the last 2–3 swing highs and swing lows (local maxima/minima over a small window). If each swing high is higher than the last and each swing low is higher than the last → "higher highs and higher lows". Mirror for downtrend. Otherwise → "range or choppy".
- **volatility**: compute ATR(14) on the working timeframe, then compare it to its own rolling average (e.g. last 20 periods). Meaningfully above average → "aggressive"; near average → "normal"; meaningfully below → "calm".
- **keyLevels**: `recentHigh`/`recentLow` = today's or the last session's high/low. `support`/`resistance` = nearest untested swing low/high below/above current price, or a simple pivot calculation.
- **liquidityZones**: a plain-English sentence naming the level just beyond `recentHigh`/`recentLow` — no calculation needed beyond referencing those two levels.
- **notes**: one plain sentence summarizing the above — this can be templated (`f"Price is {trend} on {timeframe}, currently {'above' if ... else 'below'} recentHigh/recentLow."`) rather than requiring any LLM call.

None of this needs an LLM — it's all standard technical computation. Keep it deterministic so the dashboard's readiness score stays trustworthy.

## Output delivery

Simplest path: the script prints the JSON to stdout, or writes it to a `.json` file — you copy/paste the contents into the dashboard's import box. No API, no server needed for v1.

If you want it more automated later, the script could write to a location a small local web server serves, and the dashboard could fetch it — but paste-in is the right MVP since the dashboard runs in the browser and can't reach your local machine directly.
