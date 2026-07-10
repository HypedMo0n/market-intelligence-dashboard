import type { InstrumentKey } from "./instruments";

export type MacroBias = "bullish" | "bearish" | "neutral" | "mixed";
export type ChartTrend = "up" | "down" | "sideways";
export type Volatility = "calm" | "normal" | "aggressive";
export type NewsRiskLevel = "none" | "soon" | "imminent";

export type NewsRisk = {
  level: NewsRiskLevel;
  detail?: string;
};

export type MacroInstrument = {
  key: InstrumentKey;
  driver?: string;
  macroBias?: MacroBias;
  bias?: MacroBias;
  chartBias?: MacroBias;
  bullishEvidence?: string[];
  bearishEvidence?: string[];
  conflictingEvidence?: string[];
  likelyScenario?: string;
  alternativeScenario?: string;
  invalidationLevel?: string;
  beginnerExplanation?: string;
  explanation?: string;
  confidence?: number;
  newsRisk?: NewsRisk;
};

export type MacroScan = {
  asOf?: string;
  fetchedAt?: string;
  narrative?: string;
  usdStrength?: { level?: "strong" | "weak" | "neutral"; detail?: string };
  rateExpectations?: { detail?: string };
  yields?: { level?: "rising" | "falling" | "flat"; detail?: string };
  inflationEmployment?: { detail?: string };
  centralBank?: { detail?: string };
  riskMood?: { level?: "risk-on" | "risk-off" | "mixed"; detail?: string };
  newsRisk?: NewsRisk;
  instruments?: MacroInstrument[];
  sources?: string[];
};

export type ChartRead = {
  instrument?: InstrumentKey;
  trend?: ChartTrend;
  structure?: string;
  volatility?: Volatility;
  volatilityDetail?: string | null;
  atr?: number | null;
  support?: number | string | null;
  resistance?: number | string | null;
  recentHigh?: number | string | null;
  recentLow?: number | string | null;
  liquidityZones?: string | null;
  invalidationLevel?: string | null;
  beginnerExplanation?: string | null;
  confidence?: number;
  notes?: string | null;
  source?: string;
  timestamp?: string;
  createdAt?: string;
  candleMayBeForming?: boolean;
  price?: number | null;
};
