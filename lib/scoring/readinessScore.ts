export type Bias = "bullish" | "bearish" | "neutral" | "mixed";
export type NewsRiskLevel = "none" | "soon" | "imminent";
export type VolatilityLevel = "calm" | "normal" | "aggressive";

export type ReadinessInput = {
  macroBias?: Bias;
  chartBias?: Bias;
  confidence?: number;
  newsRisk?: NewsRiskLevel;
  volatility?: VolatilityLevel;
  hasClearLevels?: boolean;
  conflictingEvidence?: number;
};

export type ReadinessResult = {
  score: number;
  label: "Favorable" | "Mixed" | "Risky / Avoid";
};

export function calculateReadinessScore(input: ReadinessInput): ReadinessResult {
  let score = 50;

  if (input.macroBias && input.chartBias && input.macroBias !== "neutral" && input.chartBias !== "neutral") {
    score += input.macroBias === input.chartBias ? 20 : -20;
  }

  const confidence = clamp(input.confidence ?? 3, 1, 5);
  score += (confidence - 3) * 5;

  if (input.newsRisk === "imminent") score -= 25;
  if (input.newsRisk === "soon") score -= 10;

  if (input.volatility === "aggressive") score -= 10;
  if (input.volatility === "calm") score += 5;

  score += input.hasClearLevels ? 8 : -8;
  score -= clamp(input.conflictingEvidence ?? 0, 0, 5) * 5;

  const finalScore = clamp(Math.round(score), 0, 100);
  return {
    score: finalScore,
    label: finalScore >= 70 ? "Favorable" : finalScore >= 40 ? "Mixed" : "Risky / Avoid",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
