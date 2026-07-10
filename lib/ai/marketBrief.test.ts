import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateMarketBrief,
  validateMarketBriefOutput,
  validateMarketBriefRequest,
  type MarketBrief,
  type MarketBriefRequest,
} from "./marketBrief.ts";

describe("market brief request validation", () => {
  it("rejects malformed client request bodies before OpenAI", () => {
    const result = validateMarketBriefRequest({ instrument: "EURUSD" });
    assert.equal(result.ok, false);
  });
});

describe("market brief fallback and validation", () => {
  it("returns fallback when the OpenAI key is missing", async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const response = await generateMarketBrief(sampleInput(), { skipCache: true });
      assert.equal(response.fallback, true);
      assert(response.brief.headline.includes("AI explanation unavailable"));
    } finally {
      if (oldKey) process.env.OPENAI_API_KEY = oldKey;
    }
  });

  it("rejects OpenAI attempting to override deterministic status", () => {
    const input = sampleInput({ status: "avoid" });
    const result = validateMarketBriefOutput(
      sampleBrief({ headline: "Market status is favorable even though rules say avoid." }),
      input,
    );
    assert.equal(result.ok, false);
  });

  it("requires delayed FRED data to be acknowledged", () => {
    const input = sampleInput({ delayedFactors: ["Stale data: broad USD index is falling."] });
    const result = validateMarketBriefOutput(sampleBrief({ limitations: ["Macro context only."] }), input);
    assert.equal(result.ok, false);
  });

  it("catches forbidden certainty and probability language", () => {
    const result = validateMarketBriefOutput(sampleBrief({ riskSummary: "There is an 80% chance this move is guaranteed." }), sampleInput());
    assert.equal(result.ok, false);
  });

  it("rejects key level values not present in the input payload", () => {
    const result = validateMarketBriefOutput(
      sampleBrief({
        keyLevels: {
          nearestSupport: "Support is 2400.",
          nearestResistance: "Resistance is 2500.",
          invalidationContext: "Invalidation near 2300.",
        },
      }),
      sampleInput(),
    );
    assert.equal(result.ok, false);
  });

  it("retries once after invalid JSON-shaped output", async () => {
    let calls = 0;
    const response = await generateMarketBrief(sampleInput(), {
      skipCache: true,
      callModel: async () => {
        calls += 1;
        return calls === 1 ? { headline: "missing schema" } : sampleBrief();
      },
    });
    assert.equal(response.ok, true);
    assert.equal(calls, 2);
  });

  it("falls back after retry fails", async () => {
    const response = await generateMarketBrief(sampleInput(), {
      skipCache: true,
      callModel: async () => ({ headline: "missing schema" }),
    });
    assert.equal(response.fallback, true);
  });

  it("uses the cache for identical inputs", async () => {
    let calls = 0;
    const input = sampleInput({ price: 2366.1 });
    await generateMarketBrief(input, {
      cacheTtlMs: 60_000,
      callModel: async () => {
        calls += 1;
        return sampleBrief();
      },
    });
    const second = await generateMarketBrief(input, {
      cacheTtlMs: 60_000,
      callModel: async () => {
        calls += 1;
        return sampleBrief();
      },
    });
    assert.equal(calls, 1);
    assert.equal(second.cached, true);
  });
});

function sampleInput(overrides: { status?: MarketBriefRequest["marketStatus"]["status"]; delayedFactors?: string[]; price?: number } = {}): MarketBriefRequest {
  return {
    instrument: "XAUUSD",
    mt5: {
      price: overrides.price ?? 2365.4,
      trend: "up",
      structure: "higher highs and higher lows",
      volatility: "normal",
      support: 2352.1,
      resistance: 2378.6,
      recentHigh: 2378.6,
      recentLow: 2346.8,
      atr: 12.4,
      timestamp: "2026-07-09T12:30:00Z",
      createdAt: "2026-07-09T12:31:00Z",
    },
    fred: {
      usdBackdrop: "mixed",
      goldBackdrop: "mixed",
      nominalYieldDirection: "rising",
      realYieldDirection: "rising",
      inflationExpectationDirection: "flat",
      riskMood: "mixed",
      supportiveFactors: ["The broad USD index is falling."],
      restrictiveFactors: ["Real yields are rising."],
      ambiguousFactors: ["Signals conflict."],
      delayedFactors: overrides.delayedFactors ?? [],
    },
    marketStatus: {
      status: overrides.status ?? "caution",
      positiveFactors: ["Market snapshot is fresh."],
      cautionFactors: ["Macro and chart direction disagree."],
      blockingRisks: [],
      plainEnglish: "Conditions are mixed.",
    },
  };
}

function sampleBrief(overrides: Partial<MarketBrief> = {}): MarketBrief {
  return {
    headline: "Gold backdrop is mixed.",
    whatIsHappening: "Real yields are rising while the dollar evidence is mixed.",
    whyItMatters: "The deterministic status remains caution.",
    supportiveEvidence: ["The broad USD index is falling."],
    restrictiveEvidence: ["Real yields are rising."],
    conflictingEvidence: ["Macro signals conflict."],
    keyLevels: {
      nearestSupport: "Nearest support is 2352.1.",
      nearestResistance: "Nearest resistance is 2378.6.",
      invalidationContext: "Recent low is 2346.8.",
    },
    riskSummary: "Risk is mixed.",
    beginnerExplanation: "This explains supplied facts only.",
    whatToWatchNext: ["Watch 2352.1 support.", "Watch 2378.6 resistance."],
    limitations: ["FRED can be delayed."],
    ...overrides,
  };
}
