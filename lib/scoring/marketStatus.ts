import type { ChartRead, MacroBias, MacroInstrument } from "@/lib/market-analysis/types";

export type MarketStatus = {
  status: "favorable" | "caution" | "avoid" | "no_data";
  color: "green" | "orange" | "red" | "gray";
  score: number;
  reasons: string[];
  positiveFactors: string[];
  cautionFactors: string[];
  blockingRisks: string[];
  plainEnglish: string;
  diagnostics: string[];
};

type SignalStrength = "strong" | "weak";
type KeyLevelDistanceMode = "atr" | "price_ratio_fallback" | "unavailable";

const MIN_MEANINGFUL_DISTANCE_ATR_MULTIPLIER = 0.25;
const MIN_MEANINGFUL_DISTANCE_PRICE_RATIO_FALLBACK = 0.0005;
const STALE_MINUTES = 15;
const CRITICAL_STALE_MINUTES = 60;

export function getMarketStatus(macro?: MacroInstrument, mt5?: ChartRead): MarketStatus {
  if (!mt5) {
    const blockingRisks = ["No MT5 snapshot is available yet."];
    return {
      status: "no_data",
      color: "gray",
      score: 0,
      reasons: blockingRisks,
      positiveFactors: [],
      cautionFactors: [],
      blockingRisks,
      plainEnglish: buildPlainEnglish("no_data", {
        positiveFactors: [],
        cautionFactors: [],
        blockingRisks,
        macroBias: "neutral",
        chartBias: "neutral",
      }),
      diagnostics: ["Market status could not be scored because no MT5 snapshot was available."],
    };
  }

  const positiveFactors: string[] = [];
  const cautionFactors: string[] = [];
  const blockingRisks: string[] = [];
  let score = 50;

  const macroBias = macro?.macroBias || macro?.bias || "neutral";
  const chartBias = mt5.trend === "up" ? "bullish" : mt5.trend === "down" ? "bearish" : "neutral";
  const newsRisk = macro?.newsRisk?.level || "none";
  const hasAggressiveVolatility = mt5.volatility === "aggressive";
  const hasImminentNews = newsRisk === "imminent";
  const hasPoorStructure = !isClearStructure(mt5.structure);
  const macroSignalStrength = getMacroSignalStrength(macroBias, macro);
  const chartSignalStrength = getChartSignalStrength(chartBias, mt5);
  const strongConflict = isStrongConflict({
    macroBias,
    chartBias,
    macroSignalStrength,
    chartSignalStrength,
    hasAggressiveVolatility,
    hasImminentNews,
    hasPoorStructure,
  });
  const staleState = getStaleState(mt5.createdAt);
  const keyLevels = getKeyLevelState(mt5);
  const diagnostics = [getKeyLevelDiagnostic(keyLevels.distanceMode)];

  if (macroBias !== "neutral" && chartBias !== "neutral") {
    if (macroBias === chartBias) {
      score += 22;
      positiveFactors.push(`Macro and chart direction agree (${chartBias}).`);
    } else {
      score -= strongConflict ? 28 : 12;
      const factor = "Macro and chart direction disagree.";
      if (strongConflict) {
        blockingRisks.push(factor);
      } else {
        cautionFactors.push(factor);
      }
    }
  } else {
    score -= 4;
    cautionFactors.push("Macro or chart direction is neutral.");
  }

  if (isClearStructure(mt5.structure)) {
    score += 12;
    positiveFactors.push("Market structure is clear.");
  } else {
    score -= 10;
    cautionFactors.push("Market structure is range or choppy.");
  }

  if (hasAggressiveVolatility) {
    score -= 20;
    blockingRisks.push("Volatility is aggressive.");
  } else if (mt5.volatility === "calm" && chartBias !== "neutral") {
    score += 4;
    positiveFactors.push("Volatility is calm.");
  } else if (mt5.volatility === "calm") {
    cautionFactors.push("Volatility is calm, but chart direction is neutral.");
  } else {
    positiveFactors.push("Volatility is manageable.");
  }

  if (hasImminentNews) {
    score -= 35;
    blockingRisks.push("High-impact news risk is imminent.");
  } else if (newsRisk === "soon") {
    score -= 15;
    cautionFactors.push("Important news risk is upcoming.");
  } else {
    positiveFactors.push("No major event risk is flagged nearby.");
  }

  if ((macro?.conflictingEvidence?.length || 0) > 0) {
    score -= Math.min(15, (macro?.conflictingEvidence?.length || 0) * 5);
    cautionFactors.push("There is conflicting evidence.");
  }

  if (keyLevels.levelsAreMeaningful) {
    score += 7;
    positiveFactors.push("Nearest swing levels are meaningfully away from price.");
  } else if (keyLevels.exist) {
    cautionFactors.push("Nearest swing levels are close to current price.");
  } else {
    score -= 8;
    cautionFactors.push("Key levels are not clear.");
  }

  if (staleState === "critical") {
    score -= 20;
    blockingRisks.push("Market snapshot is critically stale.");
  } else if (staleState === "stale") {
    score -= 5;
    cautionFactors.push("Market snapshot is older than 15 minutes.");
  } else if (staleState === "unknown") {
    cautionFactors.push("Snapshot received time is unavailable.");
  } else {
    positiveFactors.push("Market snapshot is fresh.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const uniquePositiveFactors = uniqueFactors(positiveFactors);
  const uniqueCautionFactors = uniqueFactors(cautionFactors);
  const uniqueBlockingRisks = uniqueFactors(blockingRisks);

  let status: MarketStatus["status"] = "caution";
  if (uniqueBlockingRisks.length > 0) {
    status = "avoid";
  } else if (
    macroBias === chartBias &&
    chartBias !== "neutral" &&
    uniqueBlockingRisks.length === 0 &&
    (mt5.volatility === "calm" || mt5.volatility === "normal") &&
    evidenceIsComplete(uniqueCautionFactors)
  ) {
    status = "favorable";
  }

  const color = status === "avoid" ? "red" : status === "favorable" ? "green" : "orange";
  const reasons = uniqueFactors([...uniquePositiveFactors, ...uniqueCautionFactors, ...uniqueBlockingRisks]);

  return {
    status,
    color,
    score,
    reasons,
    positiveFactors: uniquePositiveFactors,
    cautionFactors: uniqueCautionFactors,
    blockingRisks: uniqueBlockingRisks,
    plainEnglish: buildPlainEnglish(status, {
      positiveFactors: uniquePositiveFactors,
      cautionFactors: uniqueCautionFactors,
      blockingRisks: uniqueBlockingRisks,
      macroBias,
      chartBias,
    }),
    diagnostics,
  };
}

function isClearStructure(structure: string | undefined) {
  return structure === "higher highs and higher lows" || structure === "lower highs and lower lows";
}

function getMacroSignalStrength(macroBias: MacroBias, macro: MacroInstrument | undefined): SignalStrength {
  if (macroBias === "neutral" || macroBias === "mixed") return "weak";
  const alignedEvidence =
    macroBias === "bullish" ? macro?.bullishEvidence?.length || 0 : macroBias === "bearish" ? macro?.bearishEvidence?.length || 0 : 0;
  const conflicts = macro?.conflictingEvidence?.length || 0;
  return alignedEvidence > 0 && conflicts === 0 ? "strong" : "weak";
}

function getChartSignalStrength(chartBias: MacroBias, mt5: ChartRead): SignalStrength {
  if (chartBias === "neutral" || chartBias === "mixed") return "weak";
  return mt5.trend === "up" || mt5.trend === "down" ? "strong" : "weak";
}

function isStrongConflict({
  macroBias,
  chartBias,
  macroSignalStrength,
  chartSignalStrength,
  hasAggressiveVolatility,
  hasImminentNews,
  hasPoorStructure,
}: {
  macroBias: MacroBias;
  chartBias: MacroBias;
  macroSignalStrength: SignalStrength;
  chartSignalStrength: SignalStrength;
  hasAggressiveVolatility: boolean;
  hasImminentNews: boolean;
  hasPoorStructure: boolean;
}) {
  const opposite = macroBias !== chartBias && macroBias !== "neutral" && chartBias !== "neutral";
  const bothStrong = macroSignalStrength === "strong" && chartSignalStrength === "strong";
  const additionalRisk = hasAggressiveVolatility || hasImminentNews || hasPoorStructure;
  return opposite && bothStrong && additionalRisk;
}

function getKeyLevelState(mt5: ChartRead): {
  exist: boolean;
  levelsAreMeaningful: boolean;
  distanceMode: KeyLevelDistanceMode;
} {
  const atr = getAtrValue(mt5);
  const price = typeof mt5.price === "number" ? mt5.price : null;
  const support = numberValue(mt5.support);
  const resistance = numberValue(mt5.resistance);
  const levels = [support, resistance]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (levels.length === 0) {
    return { exist: false, levelsAreMeaningful: false, distanceMode: "unavailable" };
  }
  if (!price || price <= 0) {
    return { exist: true, levelsAreMeaningful: false, distanceMode: "unavailable" };
  }

  const distances = [support === null ? null : Math.abs(price - support), resistance === null ? null : Math.abs(resistance - price)]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const nearestLevelDistance = Math.min(...distances);
  if (atr !== null) {
    if (atr <= 0) {
      return { exist: true, levelsAreMeaningful: false, distanceMode: "unavailable" };
    }
    return {
      exist: true,
      levelsAreMeaningful: nearestLevelDistance >= atr * MIN_MEANINGFUL_DISTANCE_ATR_MULTIPLIER,
      distanceMode: "atr",
    };
  }

  return {
    exist: true,
    levelsAreMeaningful: nearestLevelDistance / price >= MIN_MEANINGFUL_DISTANCE_PRICE_RATIO_FALLBACK,
    distanceMode: "price_ratio_fallback",
  };
}

function numberValue(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getAtrValue(mt5: ChartRead) {
  const mt5WithAtr = mt5 as ChartRead & { currentAtr?: number | string | null };
  return numberValue(mt5.atr ?? mt5WithAtr.currentAtr);
}

function getKeyLevelDiagnostic(distanceMode: KeyLevelDistanceMode) {
  if (distanceMode === "atr") {
    return "Key-level distance used ATR-normalized scoring.";
  }
  if (distanceMode === "price_ratio_fallback") {
    return "Key-level distance used the price-ratio fallback because ATR was unavailable.";
  }
  return "Key-level distance scoring was unavailable.";
}

function uniqueFactors(items: string[]) {
  return Array.from(new Set(items));
}

function getStaleState(createdAt: string | undefined) {
  if (!createdAt) return "unknown";
  const receivedAt = new Date(createdAt).getTime();
  if (Number.isNaN(receivedAt)) return "unknown";
  const ageMinutes = (Date.now() - receivedAt) / 60_000;
  if (ageMinutes > CRITICAL_STALE_MINUTES) return "critical";
  if (ageMinutes > STALE_MINUTES) return "stale";
  return "fresh";
}

function evidenceIsComplete(cautionFactors: string[]) {
  return cautionFactors.length === 0;
}

function buildPlainEnglish(
  status: MarketStatus["status"],
  factors: {
    positiveFactors: string[];
    cautionFactors: string[];
    blockingRisks: string[];
    macroBias: string;
    chartBias: string;
  },
) {
  if (status === "no_data") {
    return "Not enough current market data is available to assess conditions.";
  }
  if (status === "avoid") {
    return `High risk: ${joinFactors(factors.blockingRisks)}.`;
  }
  if (status === "favorable") {
    return `Favorable conditions: ${joinFactors(factors.positiveFactors)}.`;
  }
  if (factors.cautionFactors.length > 0) {
    return `Mixed conditions: ${joinFactors(factors.cautionFactors)}.`;
  }
  return "Conditions are mixed.";
}

function joinFactors(factors: string[]) {
  return factors.map((factor) => factor.replace(/\.$/, "")).join(", ");
}
