import type { ChartRead, MacroInstrument } from "@/lib/market-analysis/types";

export type MarketStatus = {
  status: "favorable" | "caution" | "avoid" | "no_data";
  color: "green" | "orange" | "red" | "gray";
  score: number;
  reasons: string[];
  plainEnglish: string;
};

export function getMarketStatus(macro?: MacroInstrument, mt5?: ChartRead): MarketStatus {
  if (!mt5) {
    return {
      status: "no_data",
      color: "gray",
      score: 0,
      reasons: ["No MT5 snapshot is available yet."],
      plainEnglish: "Waiting for MT5 data from the bridge or manual JSON fallback.",
    };
  }

  const reasons: string[] = [];
  let score = 50;
  const macroBias = macro?.macroBias || macro?.bias || "neutral";
  const chartBias = mt5.trend === "up" ? "bullish" : mt5.trend === "down" ? "bearish" : "neutral";
  const newsRisk = macro?.newsRisk?.level || "none";

  if (macroBias !== "neutral" && chartBias !== "neutral") {
    if (macroBias === chartBias) {
      score += 22;
      reasons.push("Macro and MT5 trend point in the same direction.");
    } else {
      score -= 28;
      reasons.push("Macro and MT5 trend conflict.");
    }
  } else {
    score -= 4;
    reasons.push("Macro or chart bias is neutral.");
  }

  if (mt5.structure === "higher highs and higher lows" || mt5.structure === "lower highs and lower lows") {
    score += 12;
    reasons.push("Market structure is clear.");
  } else {
    score -= 10;
    reasons.push("Market structure is range or choppy.");
  }

  if (mt5.volatility === "aggressive") {
    score -= 20;
    reasons.push("Volatility is aggressive.");
  } else if (mt5.volatility === "calm") {
    score += 4;
    reasons.push("Volatility is calm.");
  }

  if (newsRisk === "imminent") {
    score -= 35;
    reasons.push("High-impact news risk is imminent.");
  } else if (newsRisk === "soon") {
    score -= 15;
    reasons.push("Important news risk is upcoming.");
  }

  if ((macro?.conflictingEvidence?.length || 0) > 0) {
    score -= Math.min(15, (macro?.conflictingEvidence?.length || 0) * 5);
    reasons.push("There is conflicting evidence.");
  }

  const hasLevels = Boolean(mt5.support || mt5.resistance || mt5.recentHigh || mt5.recentLow);
  if (hasLevels) {
    score += 7;
    reasons.push("Key levels are available.");
  } else {
    score -= 8;
    reasons.push("Key levels are not clear.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (newsRisk === "imminent" || mt5.volatility === "aggressive" || score < 40) {
    return {
      status: "avoid",
      color: "red",
      score,
      reasons,
      plainEnglish: "Conditions carry elevated risk or conflicting evidence. Waiting is the cleaner read.",
    };
  }

  if (score >= 70 && macroBias === chartBias && chartBias !== "neutral") {
    return {
      status: "favorable",
      color: "green",
      score,
      reasons,
      plainEnglish: "The macro read and MT5 structure are aligned, with no immediate risk flag dominating the setup.",
    };
  }

  return {
    status: "caution",
    color: "orange",
    score,
    reasons,
    plainEnglish: "There is useful information here, but the evidence is mixed or incomplete.",
  };
}
