import { INSTRUMENT_KEYS } from "@/lib/market-analysis/instruments";
import type { MacroScan } from "@/lib/market-analysis/types";

export function buildFallbackMacroScan(): MacroScan {
  return {
    asOf: new Date().toLocaleString(),
    fetchedAt: new Date().toISOString(),
    narrative:
      "Live AI macro scanning is not configured, so this is a neutral educational baseline. Use MT5 snapshots as the primary live market read, then treat macro fields as context placeholders until a provider is connected.",
    usdStrength: { level: "neutral", detail: "No live macro provider configured." },
    rateExpectations: { detail: "No live rate-expectations feed configured." },
    yields: { level: "flat", detail: "No live yield feed configured." },
    inflationEmployment: { detail: "No live economic-calendar feed configured." },
    centralBank: { detail: "No live central-bank news feed configured." },
    riskMood: { level: "mixed", detail: "No live risk-mood feed configured." },
    newsRisk: { level: "none", detail: "No scheduled-event feed connected." },
    instruments: INSTRUMENT_KEYS.map((key) => ({
      key,
      driver: "MT5 chart structure is the primary live input until macro data is connected.",
      macroBias: "neutral",
      chartBias: "neutral",
      bullishEvidence: [],
      bearishEvidence: [],
      conflictingEvidence: ["Macro provider is not configured."],
      likelyScenario: "Use current MT5 trend, structure, volatility, and levels as the live read.",
      alternativeScenario: "If macro/news context is later connected, it may change the interpretation.",
      invalidationLevel: "Use MT5 support/resistance and structure invalidation.",
      beginnerExplanation:
        "This neutral macro card is a placeholder; the dashboard is still useful for reading MT5 market structure.",
      confidence: 1,
      newsRisk: { level: "none", detail: "" },
    })),
    sources: ["Local fallback"],
  };
}
