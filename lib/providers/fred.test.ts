import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateFreshness,
  fetchFredSeries,
  FredConfigurationError,
  getDirectionFromObservations,
  getFredMacroSnapshot,
  normalizeFredObservations,
  redactFredApiKey,
} from "./fred.ts";

describe("FRED provider normalization", () => {
  it("treats dot observations as missing values", () => {
    const observations = normalizeFredObservations([
      { date: "2026-07-03", value: "." },
      { date: "2026-07-02", value: "4.25" },
    ]);

    assert.equal(observations[0].value, null);
    assert.equal(observations[1].value, 4.25);
  });

  it("classifies direction using recent non-missing observations", () => {
    const observations = normalizeFredObservations([
      { date: "2026-07-06", value: "." },
      { date: "2026-07-03", value: "." },
      { date: "2026-07-02", value: "105.2" },
      { date: "2026-07-01", value: "104.8" },
    ]);

    const direction = getDirectionFromObservations(observations);
    assert.equal(direction.direction, "rising");
    assert.equal(direction.latest?.date, "2026-07-02");
    assert.equal(direction.previous?.date, "2026-07-01");
  });

  it("classifies falling and flat moves", () => {
    assert.equal(
      getDirectionFromObservations([
        { date: "2026-07-02", value: 1 },
        { date: "2026-07-01", value: 2 },
      ]).direction,
      "falling",
    );
    assert.equal(
      getDirectionFromObservations([
        { date: "2026-07-02", value: 2 },
        { date: "2026-07-01", value: 2 },
      ]).direction,
      "flat",
    );
  });
});

describe("FRED provider freshness", () => {
  it("does not mark a Friday daily observation stale during the weekend", () => {
    const saturday = new Date("2026-07-11T16:00:00Z");
    assert.equal(calculateFreshness("daily", "2026-07-10", saturday), "current");
  });

  it("handles monthly delayed and stale boundaries", () => {
    const afterExpectedJulyUnemployment = new Date("2026-08-15T16:00:00Z");
    assert.equal(calculateFreshness("monthly", "2026-06-01", afterExpectedJulyUnemployment, "unemployment"), "delayed");
    assert.equal(calculateFreshness("monthly", "2026-05-01", afterExpectedJulyUnemployment, "unemployment"), "stale");
  });
});

describe("FRED provider resilience", () => {
  it("does not let one failed series break the whole macro snapshot", async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = new URL(String(input));
      const seriesId = url.searchParams.get("series_id");
      if (seriesId === "DGS10") {
        return new Response("{}", { status: 500 });
      }
      return Response.json({
        observations: [
          { date: "2026-07-10", value: "2.0" },
          { date: "2026-07-09", value: "1.5" },
        ],
      });
    };

    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl,
      now: new Date("2026-07-11T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.treasury10Y.value, null);
    assert.equal(snapshot.metrics.realYield10Y.value, 2);
  });

  it("throws a clear configuration error when FRED_API_KEY is missing", async () => {
    await assert.rejects(() => fetchFredSeries("DGS10", { apiKey: "" }), FredConfigurationError);
  });

  it("redacts raw api_key query params from error messages", async () => {
    const fetchImpl = async (input: string | URL) => {
      throw new Error(`Network failure for ${String(input)}`);
    };

    await assert.rejects(
      () => fetchFredSeries("DGS10", { apiKey: "secret-key", fetchImpl }),
      (error: unknown) => {
        assert(error instanceof Error);
        assert(!error.message.includes("secret-key"));
        assert(!/api_key=secret-key/.test(error.message));
        assert(error.message.includes("api_key=[REDACTED]"));
        return true;
      },
    );
  });
});

describe("FRED interpretation corrections", () => {
  it("classifies effective-rate changes within tolerance as flat", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({
        DFF: [
          ["2026-07-10", "4.34"],
          ["2026-07-09", "4.33"],
        ],
      }),
      now: new Date("2026-07-11T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.fedFundsRate.direction, "flat");
    assert(snapshot.metrics.fedFundsRate.explanation.includes("broadly stable near 4.34%"));
  });

  it("calculates CPI month-over-month percentage change", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({ CPIAUCSL: cpiObservations() }),
      now: new Date("2026-07-25T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.cpi.diagnostics?.monthOverMonthPct, 0.3279);
  });

  it("calculates CPI year-over-year percentage change", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({ CPIAUCSL: cpiObservations() }),
      now: new Date("2026-07-25T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.cpi.value, 2);
    assert.equal(snapshot.metrics.cpi.diagnostics?.indexLevel, 306);
  });

  it("treats moderate-but-rising VIX as increasing caution, not automatic risk-off", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({
        VIXCLS: [
          ["2026-07-10", "18"],
          ["2026-07-09", "17"],
        ],
      }),
      now: new Date("2026-07-11T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.vix.diagnostics?.vixBand, "moderate");
    assert.equal(snapshot.summary.riskMood, "mixed");
    assert(snapshot.summary.ambiguousFactors.some((factor) => factor.includes("moderate band")));
  });

  it("qualifies stale USD data instead of using it as full confirmation", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({
        DTWEXBGS: [
          ["2026-06-30", "100"],
          ["2026-06-27", "101"],
        ],
      }),
      now: new Date("2026-07-11T16:00:00Z"),
    });

    assert.equal(snapshot.metrics.broadUsdIndex.freshness, "stale");
    assert(snapshot.summary.delayedFactors.some((factor) => factor.includes("Stale data")));
    assert(!snapshot.summary.supportiveFactors.some((factor) => factor.includes("broad-dollar")));
  });

  it("matches XAUUSD explanation to current real-yield direction", async () => {
    const snapshot = await getFredMacroSnapshot({
      apiKey: "test-key",
      fetchImpl: buildSeriesFetch({
        DFII10: [
          ["2026-07-10", "2.1"],
          ["2026-07-09", "2.0"],
        ],
        DTWEXBGS: [
          ["2026-07-10", "100"],
          ["2026-07-09", "101"],
        ],
      }),
      now: new Date("2026-07-11T16:00:00Z"),
    });

    assert(snapshot.summary.xauusd.beginnerExplanation.includes("real yields are rising, which is a gold headwind"));
    assert(snapshot.summary.xauusd.beginnerExplanation.includes("broad US dollar index is falling"));
    assert(snapshot.summary.xauusd.beginnerExplanation.includes("signals conflict"));
  });
});

function buildSeriesFetch(series: Record<string, Array<[string, string]>>) {
  return async (input: string | URL) => {
    const url = new URL(String(input));
    const seriesId = url.searchParams.get("series_id") || "";
    const observations = series[seriesId] || [
      ["2026-07-10", "2.0"],
      ["2026-07-09", "1.9"],
    ];
    return Response.json({
      observations: observations.map(([date, value]) => ({ date, value })),
    });
  };
}

function cpiObservations(): Array<[string, string]> {
  return [
    ["2026-06-01", "306"],
    ["2026-05-01", "305"],
    ["2026-04-01", "304"],
    ["2026-03-01", "303"],
    ["2026-02-01", "302"],
    ["2026-01-01", "301"],
    ["2025-12-01", "300.8"],
    ["2025-11-01", "300.6"],
    ["2025-10-01", "300.5"],
    ["2025-09-01", "300.4"],
    ["2025-08-01", "300.3"],
    ["2025-07-01", "300.2"],
    ["2025-06-01", "300"],
    ["2025-05-01", "299"],
  ];
}
