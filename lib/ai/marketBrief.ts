import { createHash } from "node:crypto";
import { callAiJsonWithFallback, getPrimaryAiModel, hasAiConfig } from "../providers/aiProviders.ts";

export type MarketBriefRequest = {
  instrument: string;
  mt5: {
    price: number;
    trend: string;
    structure: string;
    volatility: string;
    support: number | null;
    resistance: number | null;
    recentHigh: number | null;
    recentLow: number | null;
    atr: number | null;
    timestamp: string;
    createdAt: string;
  };
  fred: {
    usdBackdrop: string;
    goldBackdrop: string;
    nominalYieldDirection: string;
    realYieldDirection: string;
    inflationExpectationDirection: string;
    riskMood: string;
    supportiveFactors: string[];
    restrictiveFactors: string[];
    ambiguousFactors: string[];
    delayedFactors: string[];
  };
  marketStatus: {
    status: "favorable" | "caution" | "avoid" | "no_data";
    positiveFactors: string[];
    cautionFactors: string[];
    blockingRisks: string[];
    plainEnglish: string;
  };
};

export type MarketBrief = {
  headline: string;
  whatIsHappening: string;
  whyItMatters: string;
  supportiveEvidence: string[];
  restrictiveEvidence: string[];
  conflictingEvidence: string[];
  keyLevels: {
    nearestSupport: string;
    nearestResistance: string;
    invalidationContext: string;
  };
  riskSummary: string;
  beginnerExplanation: string;
  whatToWatchNext: string[];
  limitations: string[];
};

export type MarketBriefResponse = {
  ok: boolean;
  fallback: boolean;
  cached: boolean;
  model: string;
  brief: MarketBrief;
};

type GenerateOptions = {
  callModel?: (system: string, userContent: string, strictRetry: boolean) => Promise<unknown>;
  cacheTtlMs?: number;
  skipCache?: boolean;
};

const CACHE_TTL_MS = 7 * 60 * 1000;
const MARKET_BRIEF_MAX_TOKENS = 900;
const MARKET_BRIEF_TEMPERATURE = 0.2;
const FORBIDDEN_LANGUAGE =
  /\b(buy now|sell now|guaranteed|certain|confidence)\b|\b\d{1,3}(?:\.\d+)?%\s*(chance|probability|odds|likely|probable)\b|\b(chance|probability|odds)\s+of\s+\d{1,3}(?:\.\d+)?%/i;

const cache = new Map<string, { expiresAt: number; response: MarketBriefResponse }>();

export function validateMarketBriefRequest(value: unknown): { ok: true; input: MarketBriefRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "Request body must be an object." };
  if (typeof value.instrument !== "string" || !value.instrument.trim()) return { ok: false, error: "instrument must be a non-empty string." };
  if (!isRecord(value.mt5)) return { ok: false, error: "Missing mt5 facts." };
  if (!isRecord(value.fred)) return { ok: false, error: "Missing FRED facts." };
  if (!isRecord(value.marketStatus)) return { ok: false, error: "Missing deterministic market status." };

  const mt5 = value.mt5;
  const fred = value.fred;
  const marketStatus = value.marketStatus;
  const status = marketStatus.status;

  if (!isFiniteNumber(mt5.price)) return { ok: false, error: "mt5.price must be a number." };
  for (const key of ["trend", "structure", "volatility", "timestamp", "createdAt"] as const) {
    if (typeof mt5[key] !== "string") return { ok: false, error: `mt5.${key} must be a string.` };
  }
  for (const key of ["support", "resistance", "recentHigh", "recentLow", "atr"] as const) {
    if (!isNullableNumber(mt5[key])) return { ok: false, error: `mt5.${key} must be a number or null.` };
  }
  for (const key of ["usdBackdrop", "goldBackdrop", "nominalYieldDirection", "realYieldDirection", "inflationExpectationDirection", "riskMood"] as const) {
    if (typeof fred[key] !== "string") return { ok: false, error: `fred.${key} must be a string.` };
  }
  for (const key of ["supportiveFactors", "restrictiveFactors", "ambiguousFactors", "delayedFactors"] as const) {
    if (!isStringArray(fred[key])) return { ok: false, error: `fred.${key} must be a string array.` };
  }
  if (status !== "favorable" && status !== "caution" && status !== "avoid" && status !== "no_data") {
    return { ok: false, error: "marketStatus.status is invalid." };
  }
  if (typeof marketStatus.plainEnglish !== "string") return { ok: false, error: "marketStatus.plainEnglish must be a string." };
  for (const key of ["positiveFactors", "cautionFactors", "blockingRisks"] as const) {
    if (!isStringArray(marketStatus[key])) return { ok: false, error: `marketStatus.${key} must be a string array.` };
  }

  return { ok: true, input: value as MarketBriefRequest };
}

export async function generateMarketBrief(input: MarketBriefRequest, options: GenerateOptions = {}): Promise<MarketBriefResponse> {
  const cacheKey = hashMarketBriefInput(input);
  const ttl = options.cacheTtlMs ?? CACHE_TTL_MS;
  const cached = cache.get(cacheKey);
  if (!options.skipCache && cached && cached.expiresAt > Date.now()) {
    return { ...cached.response, cached: true };
  }

  if (!hasAiConfig() && !options.callModel) {
    return buildFallbackResponse("AI explanation unavailable. Rule-based market context is still available.", false);
  }

  try {
    const response = await callModelWithRetry(input, options);
    const wrapped: MarketBriefResponse = {
      ok: true,
      fallback: false,
      cached: false,
      model: getPrimaryAiModel(),
      brief: response,
    };
    cache.set(cacheKey, { expiresAt: Date.now() + ttl, response: wrapped });
    return wrapped;
  } catch {
    return buildFallbackResponse("AI explanation unavailable. Rule-based market context is still available.", false);
  }
}

export async function callModelWithRetry(input: MarketBriefRequest, options: GenerateOptions = {}) {
  const system = buildMarketBriefSystemPrompt(false);
  const strictSystem = buildMarketBriefSystemPrompt(true);
  const userContent = JSON.stringify(input);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const strictRetry = attempt === 1;
    let raw: unknown;
    try {
      raw = options.callModel
        ? await options.callModel(strictRetry ? strictSystem : system, userContent, strictRetry)
        : (await callAiJsonWithFallback<unknown>({
            system: strictRetry ? strictSystem : system,
            userContent,
            maxTokens: MARKET_BRIEF_MAX_TOKENS,
            temperature: MARKET_BRIEF_TEMPERATURE,
            timeoutMs: 15_000,
            stripUnsafe: false,
          })).value;
    } catch {
      if (!strictRetry) continue;
      throw new Error("AI market brief failed validation after retry.");
    }
    const parsed = validateMarketBriefOutput(raw, input);
    if (parsed.ok) return parsed.brief;
  }

  throw new Error("AI market brief failed validation after retry.");
}

export function validateMarketBriefOutput(value: unknown, input: MarketBriefRequest): { ok: true; brief: MarketBrief } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "Brief output must be an object." };
  const strings = ["headline", "whatIsHappening", "whyItMatters", "riskSummary", "beginnerExplanation"] as const;
  for (const key of strings) {
    if (typeof value[key] !== "string" || !value[key]) return { ok: false, error: `${key} must be a non-empty string.` };
  }
  for (const key of ["supportiveEvidence", "restrictiveEvidence", "conflictingEvidence", "whatToWatchNext", "limitations"] as const) {
    if (!isStringArray(value[key])) return { ok: false, error: `${key} must be a string array.` };
  }
  if (!isRecord(value.keyLevels)) return { ok: false, error: "keyLevels must be an object." };
  for (const key of ["nearestSupport", "nearestResistance", "invalidationContext"] as const) {
    if (typeof value.keyLevels[key] !== "string") return { ok: false, error: `keyLevels.${key} must be a string.` };
  }

  const brief = value as MarketBrief;
  if (containsForbiddenLanguage(brief)) return { ok: false, error: "Brief output contains forbidden certainty or trade-instruction language." };
  if (containsStatusOverrideLanguage(brief, input.marketStatus.status)) {
    return { ok: false, error: "Brief output attempts to override deterministic market status." };
  }
  if (input.fred.delayedFactors.length > 0 && !acknowledgesDelayedData(brief)) {
    return { ok: false, error: "Brief output failed to acknowledge delayed FRED data." };
  }
  if (!keyLevelsUseOnlyInputLevels(brief, input)) return { ok: false, error: "Brief output introduced unsupported key-level values." };

  return { ok: true, brief };
}

export function buildFallbackResponse(message: string, cached: boolean): MarketBriefResponse {
  return {
    ok: false,
    fallback: true,
    cached,
    model: getPrimaryAiModel(),
    brief: {
      headline: message,
      whatIsHappening: message,
      whyItMatters: "The deterministic MT5, FRED, and market-status context remains available.",
      supportiveEvidence: [],
      restrictiveEvidence: [],
      conflictingEvidence: [],
      keyLevels: {
        nearestSupport: "Unavailable in AI fallback.",
        nearestResistance: "Unavailable in AI fallback.",
        invalidationContext: "Use the rule-based key levels and market-status context.",
      },
      riskSummary: "Rule-based market context is still available.",
      beginnerExplanation: message,
      whatToWatchNext: ["Review MT5 structure.", "Review FRED macro context.", "Refresh the explanation later."],
      limitations: ["AI explanation unavailable. Rule-based market context is still available."],
    },
  };
}

export function hashMarketBriefInput(input: MarketBriefRequest) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function containsForbiddenLanguage(value: unknown): boolean {
  if (typeof value === "string") return FORBIDDEN_LANGUAGE.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenLanguage);
  if (isRecord(value)) return Object.values(value).some(containsForbiddenLanguage);
  return false;
}

export function containsStatusOverrideLanguage(value: unknown, authoritativeStatus: MarketBriefRequest["marketStatus"]["status"]): boolean {
  const text = collectStrings(value).join(" ").toLowerCase();
  const statusLabels: Array<MarketBriefRequest["marketStatus"]["status"]> = ["favorable", "caution", "avoid", "no_data"];
  return statusLabels
    .filter((status) => status !== authoritativeStatus)
    .some((status) => {
      const label = status === "no_data" ? "no data" : status;
      return new RegExp(`\\b(market\\s+)?status\\s+(is|=|:)\\s+${label}\\b`, "i").test(text);
    });
}

export function acknowledgesDelayedData(value: unknown) {
  return /\b(delayed|stale|not current|older)\b/i.test(collectStrings(value).join(" "));
}

function keyLevelsUseOnlyInputLevels(brief: MarketBrief, input: MarketBriefRequest) {
  const allowed = [input.mt5.support, input.mt5.resistance, input.mt5.recentHigh, input.mt5.recentLow]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => Number(value.toFixed(5)));
  const levelText = `${brief.keyLevels.nearestSupport} ${brief.keyLevels.nearestResistance} ${brief.keyLevels.invalidationContext}`;
  const numbers = levelText.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g) || [];
  return numbers.every((rawNumber) => {
    const value = Number(rawNumber.replace(/,/g, ""));
    return allowed.some((allowedValue) => Math.abs(value - allowedValue) <= 0.00001);
  });
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function buildMarketBriefSystemPrompt(strictRetry: boolean) {
  return `You explain deterministic trading-dashboard facts for beginners.

The deterministic marketStatus is authoritative. Do not change it, override it, create a new score, or imply a different status.
Use only the MT5, FRED, and marketStatus values supplied by the user. Do not invent news, releases, levels, price moves, live-market access, or unsupported facts.
If data is delayed or missing, say so plainly.
Do not use BUY NOW, SELL NOW, guaranteed, certain, probability language, or the word confidence.
Use "Signal Clarity" only when describing input agreement. Signal Clarity is not trade certainty.
Return JSON only with this schema:
{
  "headline": "short market summary",
  "whatIsHappening": "plain-English explanation",
  "whyItMatters": "how macro and chart factors interact",
  "supportiveEvidence": ["..."],
  "restrictiveEvidence": ["..."],
  "conflictingEvidence": ["..."],
  "keyLevels": {
    "nearestSupport": "...",
    "nearestResistance": "...",
    "invalidationContext": "..."
  },
  "riskSummary": "...",
  "beginnerExplanation": "...",
  "whatToWatchNext": ["..."],
  "limitations": ["..."]
}
${strictRetry ? "STRICT RETRY: return only valid JSON matching the schema. No prose before or after JSON. Do not include any unsupported level numbers." : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export const marketBriefRuntimeConfig = {
  defaultModel: "gemini-3.5-flash",
  temperature: MARKET_BRIEF_TEMPERATURE,
  maxTokens: MARKET_BRIEF_MAX_TOKENS,
  timeoutMs: 15_000,
  cacheTtlMs: CACHE_TTL_MS,
};
