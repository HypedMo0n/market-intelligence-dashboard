type FredFrequency = "daily" | "monthly";
type FredUnit = "percent" | "index";
type FredDirection = "rising" | "falling" | "flat" | "unknown";
type FredFreshness = "current" | "delayed" | "stale" | "unknown";
type Backdrop = "supportive" | "restrictive" | "mixed" | "unknown";
type RiskMood = "risk-on" | "risk-off" | "mixed" | "unknown";
type VixBand = "low" | "moderate" | "elevated" | "high" | "unknown";

export type FredMetric = {
  key: string;
  seriesId: string;
  label: string;
  value: number | null;
  previousValue: number | null;
  observationDate: string | null;
  previousObservationDate: string | null;
  direction: FredDirection;
  change: number | null;
  frequency: FredFrequency;
  unit: FredUnit;
  freshness: FredFreshness;
  explanation: string;
  tradingImpact: string;
  diagnostics?: {
    indexLevel?: number | null;
    monthOverMonthPct?: number | null;
    yearOverYearPct?: number | null;
    previousYearOverYearPct?: number | null;
    vixBand?: VixBand;
    flatTolerancePctPoints?: number;
  };
};

export type FredObservation = {
  date: string;
  value: number | null;
};

export type FredMacroSnapshot = {
  asOf: string;
  provider: "FRED";
  metrics: Record<FredSeriesKey, FredMetric>;
  summary: {
    usdBackdrop: Backdrop;
    goldBackdrop: Backdrop;
    riskMood: RiskMood;
    plainEnglish: string;
    positiveFactors: string[];
    cautionFactors: string[];
    conflictingFactors: string[];
    supportiveFactors: string[];
    restrictiveFactors: string[];
    ambiguousFactors: string[];
    delayedFactors: string[];
    xauusd: {
      usdBackdrop: Backdrop;
      nominalYieldDirection: FredDirection;
      realYieldDirection: FredDirection;
      inflationExpectationDirection: FredDirection;
      riskMood: RiskMood;
      positiveFactors: string[];
      cautionFactors: string[];
      conflictingFactors: string[];
      supportiveFactors: string[];
      restrictiveFactors: string[];
      ambiguousFactors: string[];
      delayedFactors: string[];
      beginnerExplanation: string;
    };
  };
  limitations: string[];
};

type FredSeriesConfig = {
  id: string;
  label: string;
  frequency: FredFrequency;
  unit: FredUnit;
};

type FredFetch = (input: string | URL, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

export const FRED_SERIES = {
  fedFundsRate: { id: "DFF", label: "Federal funds rate", frequency: "daily", unit: "percent" },
  treasury10Y: { id: "DGS10", label: "US 10-year Treasury yield", frequency: "daily", unit: "percent" },
  realYield10Y: { id: "DFII10", label: "US 10-year real yield", frequency: "daily", unit: "percent" },
  inflationBreakeven10Y: { id: "T10YIE", label: "10-year inflation expectation", frequency: "daily", unit: "percent" },
  broadUsdIndex: { id: "DTWEXBGS", label: "Broad US dollar index", frequency: "daily", unit: "index" },
  vix: { id: "VIXCLS", label: "Market fear index", frequency: "daily", unit: "index" },
  cpi: { id: "CPIAUCSL", label: "US consumer price index", frequency: "monthly", unit: "index" },
  unemployment: { id: "UNRATE", label: "US unemployment rate", frequency: "monthly", unit: "percent" },
} as const satisfies Record<string, FredSeriesConfig>;

export type FredSeriesKey = keyof typeof FRED_SERIES;

export const FRED_LIMITATIONS = [
  "FRED data may update with a delay.",
  "Monthly data is macro context, not an intraday signal.",
  "FRED does not provide economic-calendar surprises in this endpoint.",
  "CPI and unemployment figures reflect the latest revision, not the originally published value.",
];

const FRED_ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const DAILY_REVALIDATE_SECONDS = 60 * 60 * 6;
const MONTHLY_REVALIDATE_SECONDS = 60 * 60 * 24;
const MIN_DIRECTION_LIMIT = 10;
const MONTHLY_CALCULATION_LIMIT = 18;
const REQUEST_TIMEOUT_MS = 8_000;
const FED_FUNDS_DAILY_FLAT_TOLERANCE = 0.05;
const CPI_RATE_FLAT_TOLERANCE = 0.05;

export class FredConfigurationError extends Error {
  constructor(message = "FRED_API_KEY is not configured.") {
    super(message);
    this.name = "FredConfigurationError";
  }
}

export async function fetchFredSeries(
  seriesId: string,
  options: {
    limit?: number;
    apiKey?: string;
    fetchImpl?: FredFetch;
    revalidateSeconds?: number;
    timeoutMs?: number;
  } = {},
): Promise<FredObservation[]> {
  const apiKey = options.apiKey ?? process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new FredConfigurationError();
  }

  const limit = Math.max(options.limit ?? MIN_DIRECTION_LIMIT, MIN_DIRECTION_LIMIT);
  const url = new URL(FRED_ENDPOINT);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "force-cache",
      next: { revalidate: options.revalidateSeconds ?? revalidateForSeries(seriesId) },
    });

    if (!response.ok) {
      throw new Error(`FRED request failed for ${seriesId}: HTTP ${response.status}`);
    }

    const json = await response.json().catch(() => {
      throw new Error(`FRED returned malformed JSON for ${seriesId}.`);
    });

    if (!json || !Array.isArray(json.observations)) {
      throw new Error(`FRED response for ${seriesId} did not include observations.`);
    }

    return normalizeFredObservations(json.observations);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FRED request failed.";
    throw new Error(redactFredApiKey(message, apiKey));
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLatestFredObservation(seriesId: string): Promise<FredObservation | null> {
  const observations = await fetchFredSeries(seriesId, { limit: MIN_DIRECTION_LIMIT });
  return observations.find((observation) => observation.value !== null) ?? null;
}

export async function fetchRecentFredObservations(seriesId: string, limit: number): Promise<FredObservation[]> {
  return fetchFredSeries(seriesId, { limit: Math.max(limit, MIN_DIRECTION_LIMIT) });
}

export async function getFredMacroSnapshot(
  options: {
    apiKey?: string;
    fetchImpl?: FredFetch;
    now?: Date;
  } = {},
): Promise<FredMacroSnapshot> {
  const apiKey = options.apiKey ?? process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new FredConfigurationError();
  }

  const now = options.now ?? new Date();
  const entries = await Promise.all(
    Object.entries(FRED_SERIES).map(async ([key, config]) => {
      try {
        const observations = await fetchFredSeries(config.id, {
          apiKey,
          fetchImpl: options.fetchImpl,
          limit: limitForSeries(key as FredSeriesKey, config),
          revalidateSeconds: revalidateForFrequency(config.frequency),
        });
        return [key, buildMetric(key as FredSeriesKey, config, observations, now)] as const;
      } catch {
        return [key, emptyMetric(key as FredSeriesKey, config)] as const;
      }
    }),
  );

  const metrics = Object.fromEntries(entries) as Record<FredSeriesKey, FredMetric>;
  const summary = buildSummary(metrics);

  return {
    asOf: now.toISOString(),
    provider: "FRED",
    metrics,
    summary,
    limitations: FRED_LIMITATIONS,
  };
}

export function buildUnavailableFredSnapshot(message: string): FredMacroSnapshot & { error: string } {
  const metrics = Object.fromEntries(
    Object.entries(FRED_SERIES).map(([key, config]) => [key, emptyMetric(key as FredSeriesKey, config)]),
  ) as Record<FredSeriesKey, FredMetric>;

  return {
    asOf: new Date().toISOString(),
    provider: "FRED",
    metrics,
    summary: {
      usdBackdrop: "unknown",
      goldBackdrop: "unknown",
      riskMood: "unknown",
      plainEnglish: "FRED macro data unavailable.",
      positiveFactors: [],
      cautionFactors: [message],
      conflictingFactors: [],
      supportiveFactors: [],
      restrictiveFactors: [],
      ambiguousFactors: [],
      delayedFactors: [message],
      xauusd: {
        usdBackdrop: "unknown",
        nominalYieldDirection: "unknown",
        realYieldDirection: "unknown",
        inflationExpectationDirection: "unknown",
        riskMood: "unknown",
        positiveFactors: [],
        cautionFactors: [message],
        conflictingFactors: [],
        supportiveFactors: [],
        restrictiveFactors: [],
        ambiguousFactors: [],
        delayedFactors: [message],
        beginnerExplanation: "FRED macro context is unavailable, so use MT5 market structure as the current live read.",
      },
    },
    limitations: FRED_LIMITATIONS,
    error: message,
  };
}

export function normalizeFredObservations(rawObservations: Array<{ date?: unknown; value?: unknown }>): FredObservation[] {
  return rawObservations
    .map((observation) => {
      const date = typeof observation.date === "string" ? observation.date : null;
      if (!date) return null;
      return {
        date,
        value: parseFredValue(observation.value),
      };
    })
    .filter((observation): observation is FredObservation => Boolean(observation));
}

export function getDirectionFromObservations(observations: FredObservation[], flatTolerance = 0) {
  const nonMissing = observations.filter((observation) => observation.value !== null);
  const latest = nonMissing[0];
  const previous = nonMissing[1];

  if (!latest || !previous) {
    return {
      latest: latest ?? null,
      previous: previous ?? null,
      direction: "unknown" as FredDirection,
      change: null,
    };
  }

  const change = roundMetric((latest.value as number) - (previous.value as number));
  const direction: FredDirection = Math.abs(change) < flatTolerance ? "flat" : change > 0 ? "rising" : change < 0 ? "falling" : "flat";
  return { latest, previous, direction, change };
}

export function calculateFreshness(
  frequency: FredFrequency,
  observationDate: string | null,
  now: Date,
  key?: FredSeriesKey,
): FredFreshness {
  if (!observationDate) return "unknown";
  const observed = parseDateOnly(observationDate);
  if (!observed) return "unknown";

  if (frequency === "daily") {
    const expected = mostRecentUsBusinessDay(now);
    const lag = businessDaysBetween(observed, expected);
    if (lag <= 1) return "current";
    if (lag <= 5) return "delayed";
    return "stale";
  }

  const expected = expectedMonthlyObservationDate(now, key === "unemployment" ? 10 : 21);
  const lagMonths = monthDifference(observed, expected);
  if (lagMonths <= 0) return "current";
  if (lagMonths === 1) return "delayed";
  return "stale";
}

export function redactFredApiKey(message: string, apiKey?: string) {
  let redacted = message.replace(/([?&]api_key=)[^&\s]+/gi, "$1[REDACTED]");
  if (apiKey) {
    redacted = redacted.split(apiKey).join("[REDACTED]");
  }
  return redacted;
}

function buildMetric(key: FredSeriesKey, config: FredSeriesConfig, observations: FredObservation[], now: Date): FredMetric {
  if (key === "cpi") {
    return buildCpiMetric(config, observations, now);
  }

  const tolerance = key === "fedFundsRate" ? FED_FUNDS_DAILY_FLAT_TOLERANCE : 0;
  const { latest, previous, direction, change } = getDirectionFromObservations(observations, tolerance);
  const diagnostics =
    key === "fedFundsRate"
      ? { flatTolerancePctPoints: FED_FUNDS_DAILY_FLAT_TOLERANCE }
      : key === "vix"
        ? { vixBand: getVixBand(latest?.value ?? null) }
        : undefined;

  return {
    key,
    seriesId: config.id,
    label: config.label,
    value: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    observationDate: latest?.date ?? null,
    previousObservationDate: previous?.date ?? null,
    direction,
    change,
    frequency: config.frequency,
    unit: config.unit,
    freshness: calculateFreshness(config.frequency, latest?.date ?? null, now, key),
    explanation: explainMetric(key, direction, latest?.value ?? null, diagnostics),
    tradingImpact: tradingImpact(key, direction, diagnostics),
    diagnostics,
  };
}

function buildCpiMetric(config: FredSeriesConfig, observations: FredObservation[], now: Date): FredMetric {
  const nonMissing = observations.filter((observation) => observation.value !== null);
  const latest = nonMissing[0];
  const previous = nonMissing[1];
  const yearAgo = nonMissing[12];
  const previousYearAgo = nonMissing[13];

  const monthOverMonthPct =
    latest?.value !== null && latest?.value !== undefined && previous?.value ? roundMetric(((latest.value - previous.value) / previous.value) * 100) : null;
  const yearOverYearPct =
    latest?.value !== null && latest?.value !== undefined && yearAgo?.value ? roundMetric(((latest.value - yearAgo.value) / yearAgo.value) * 100) : null;
  const previousYearOverYearPct =
    previous?.value !== null && previous?.value !== undefined && previousYearAgo?.value
      ? roundMetric(((previous.value - previousYearAgo.value) / previousYearAgo.value) * 100)
      : null;

  const change = yearOverYearPct !== null && previousYearOverYearPct !== null ? roundMetric(yearOverYearPct - previousYearOverYearPct) : null;
  const direction: FredDirection =
    change === null ? "unknown" : Math.abs(change) < CPI_RATE_FLAT_TOLERANCE ? "flat" : change > 0 ? "rising" : "falling";
  const diagnostics = {
    indexLevel: latest?.value ?? null,
    monthOverMonthPct,
    yearOverYearPct,
    previousYearOverYearPct,
    flatTolerancePctPoints: CPI_RATE_FLAT_TOLERANCE,
  };

  return {
    key: "cpi",
    seriesId: config.id,
    label: config.label,
    value: yearOverYearPct,
    previousValue: previousYearOverYearPct,
    observationDate: latest?.date ?? null,
    previousObservationDate: previous?.date ?? null,
    direction,
    change,
    frequency: config.frequency,
    unit: "percent",
    freshness: calculateFreshness(config.frequency, latest?.date ?? null, now, "cpi"),
    explanation: explainMetric("cpi", direction, yearOverYearPct, diagnostics),
    tradingImpact: tradingImpact("cpi", direction, diagnostics),
    diagnostics,
  };
}

function emptyMetric(key: FredSeriesKey, config: FredSeriesConfig): FredMetric {
  return {
    key,
    seriesId: config.id,
    label: config.label,
    value: null,
    previousValue: null,
    observationDate: null,
    previousObservationDate: null,
    direction: "unknown",
    change: null,
    frequency: config.frequency,
    unit: config.unit,
    freshness: "unknown",
    explanation: "FRED data is unavailable for this metric.",
    tradingImpact: "No macro conclusion is drawn from this missing metric.",
  };
}

function buildSummary(metrics: Record<FredSeriesKey, FredMetric>): FredMacroSnapshot["summary"] {
  const supportiveFactors: string[] = [];
  const restrictiveFactors: string[] = [];
  const ambiguousFactors: string[] = [];
  const delayedFactors: string[] = [];

  const realYield = metrics.realYield10Y.direction;
  const broadUsd = metrics.broadUsdIndex.direction;
  const treasury = metrics.treasury10Y.direction;
  const fedFunds = metrics.fedFundsRate.direction;
  const inflation = metrics.inflationBreakeven10Y.direction;
  const vix = metrics.vix;

  addGoldFactor({
    metric: metrics.realYield10Y,
    supportiveFactors,
    restrictiveFactors,
    delayedFactors,
    risingText: "Real yields are rising, which is a gold headwind.",
    fallingText: "Real yields are falling, which can support gold.",
    risingGroup: "restrictive",
    fallingGroup: "supportive",
  });
  addGoldFactor({
    metric: metrics.treasury10Y,
    supportiveFactors,
    restrictiveFactors,
    delayedFactors,
    risingText: "Nominal Treasury yields are rising, which can pressure gold.",
    fallingText: "Nominal Treasury yields are falling, which can support gold.",
    risingGroup: "restrictive",
    fallingGroup: "supportive",
  });
  addGoldFactor({
    metric: metrics.broadUsdIndex,
    supportiveFactors,
    restrictiveFactors,
    delayedFactors,
    risingText: "The broad USD index is rising, which can pressure dollar-priced gold.",
    fallingText: "The latest broad-dollar reading is falling, which is supportive for gold.",
    risingGroup: "restrictive",
    fallingGroup: "supportive",
  });
  addGoldFactor({
    metric: metrics.inflationBreakeven10Y,
    supportiveFactors,
    restrictiveFactors,
    delayedFactors,
    risingText: "Inflation expectations are rising, which can support gold as macro context.",
    fallingText: "Inflation expectations are falling, which is less supportive for gold.",
    risingGroup: "supportive",
    fallingGroup: "restrictive",
  });

  const vixBand = vix.diagnostics?.vixBand ?? "unknown";
  if (vix.freshness !== "current" && vix.direction !== "unknown") {
    delayedFactors.push(`${freshnessPrefix(vix)} VIX is ${vix.direction} in the ${vixBand} band; treat this risk read as context, not confirmation.`);
  } else if (vixBand === "moderate" && vix.direction === "rising") {
    ambiguousFactors.push("VIX is rising inside the moderate band, so caution is increasing without a clear risk-off signal.");
  } else if (vixBand === "elevated" || vixBand === "high") {
    ambiguousFactors.push(`VIX is ${vixBand}, which may support safe-haven demand but can also increase USD/liquidation volatility.`);
  } else if (vix.direction === "falling" && vixBand !== "unknown") {
    supportiveFactors.push(`VIX is falling in the ${vixBand} band, suggesting calmer risk conditions.`);
  }

  if ((realYield === "rising" && broadUsd === "falling") || (realYield === "falling" && broadUsd === "rising")) {
    ambiguousFactors.push("Real-yield and broad-dollar signals conflict for gold.");
  }

  const usdBackdrop = getUsdBackdrop(treasury, fedFunds, broadUsd);
  const goldBackdrop = getGoldBackdrop(supportiveFactors.length, restrictiveFactors.length, ambiguousFactors.length);
  const riskMood = getRiskMood(vix);
  const positiveFactors = unique(supportiveFactors);
  const cautionFactors = unique([...restrictiveFactors, ...delayedFactors]);
  const conflictingFactors = unique(ambiguousFactors);

  return {
    usdBackdrop,
    goldBackdrop,
    riskMood,
    plainEnglish: buildSummaryText(goldBackdrop, supportiveFactors, restrictiveFactors, ambiguousFactors, delayedFactors),
    positiveFactors,
    cautionFactors,
    conflictingFactors,
    supportiveFactors: positiveFactors,
    restrictiveFactors: unique(restrictiveFactors),
    ambiguousFactors: conflictingFactors,
    delayedFactors: unique(delayedFactors),
    xauusd: {
      usdBackdrop,
      nominalYieldDirection: treasury,
      realYieldDirection: realYield,
      inflationExpectationDirection: inflation,
      riskMood,
      positiveFactors,
      cautionFactors,
      conflictingFactors,
      supportiveFactors: positiveFactors,
      restrictiveFactors: unique(restrictiveFactors),
      ambiguousFactors: conflictingFactors,
      delayedFactors: unique(delayedFactors),
      beginnerExplanation: buildXauusdExplanation(metrics, conflictingFactors, delayedFactors),
    },
  };
}

function addGoldFactor({
  metric,
  supportiveFactors,
  restrictiveFactors,
  delayedFactors,
  risingText,
  fallingText,
  risingGroup,
  fallingGroup,
}: {
  metric: FredMetric;
  supportiveFactors: string[];
  restrictiveFactors: string[];
  delayedFactors: string[];
  risingText: string;
  fallingText: string;
  risingGroup: "supportive" | "restrictive";
  fallingGroup: "supportive" | "restrictive";
}) {
  const text = metric.direction === "rising" ? risingText : metric.direction === "falling" ? fallingText : null;
  if (!text) return;
  if (metric.freshness !== "current") {
    delayedFactors.push(`${freshnessPrefix(metric)} ${text}`);
    return;
  }
  const group = metric.direction === "rising" ? risingGroup : fallingGroup;
  if (group === "supportive") supportiveFactors.push(text);
  if (group === "restrictive") restrictiveFactors.push(text);
}

function getUsdBackdrop(treasury: FredDirection, fedFunds: FredDirection, broadUsd: FredDirection): Backdrop {
  if (treasury === "unknown" && fedFunds === "unknown" && broadUsd === "unknown") return "unknown";
  const supportive = (treasury === "rising" || fedFunds === "rising") && broadUsd !== "falling";
  const restrictive = treasury === "falling" && broadUsd !== "rising";
  if (supportive && broadUsd === "rising") return "supportive";
  if (restrictive && broadUsd === "falling") return "restrictive";
  return "mixed";
}

function getGoldBackdrop(supports: number, headwinds: number, conflicts: number): Backdrop {
  if (supports === 0 && headwinds === 0) return "unknown";
  if (conflicts > 0 || (supports > 0 && headwinds > 0)) return "mixed";
  if (supports > 0) return "supportive";
  return "restrictive";
}

function getRiskMood(vix: FredMetric): RiskMood {
  const band = vix.diagnostics?.vixBand;
  if (vix.direction === "falling" && (band === "low" || band === "moderate")) return "risk-on";
  if (vix.direction === "rising" && (band === "elevated" || band === "high")) return "risk-off";
  if (vix.direction === "rising" && band === "moderate") return "mixed";
  if (vix.direction === "flat") return "mixed";
  return "unknown";
}

function buildSummaryText(
  goldBackdrop: Backdrop,
  supportiveFactors: string[],
  restrictiveFactors: string[],
  ambiguousFactors: string[],
  delayedFactors: string[],
) {
  const parts = [`Gold's macro backdrop is ${goldBackdrop}.`];
  if (restrictiveFactors.length) parts.push(sentenceFromFactors(restrictiveFactors));
  if (supportiveFactors.length) parts.push(sentenceFromFactors(supportiveFactors));
  if (delayedFactors.length) parts.push(sentenceFromFactors(delayedFactors));
  if (ambiguousFactors.length) parts.push(sentenceFromFactors(ambiguousFactors));
  parts.push("FRED is macro context, not a real-time buy/sell signal.");
  return parts.join(" ");
}

function explainMetric(key: FredSeriesKey, direction: FredDirection, value: number | null, diagnostics?: FredMetric["diagnostics"]) {
  if (direction === "unknown") return "No recent non-missing FRED observations are available.";
  const directionText = direction === "flat" ? "unchanged" : direction;
  const labels: Record<FredSeriesKey, string> = {
    fedFundsRate:
      direction === "flat" && value !== null
        ? `The effective federal funds rate is broadly stable near ${value.toFixed(2)}%.`
        : `The effective federal funds rate is ${directionText}.`,
    treasury10Y: `Nominal US yields are ${directionText}.`,
    realYield10Y: `Inflation-adjusted US yields are ${directionText}.`,
    inflationBreakeven10Y: `Market inflation expectations are ${directionText}.`,
    broadUsdIndex: `The broad US dollar index is ${directionText}.`,
    vix: `VIX is ${value === null ? "unavailable" : value.toFixed(2)}, a ${diagnostics?.vixBand ?? "unknown"} volatility regime, and direction is ${directionText}.`,
    cpi:
      diagnostics?.yearOverYearPct !== null && diagnostics?.yearOverYearPct !== undefined
        ? `CPI is running at ${diagnostics.yearOverYearPct.toFixed(2)}% year over year and ${formatNullablePercent(diagnostics.monthOverMonthPct)} month over month.`
        : "CPI rate calculations are unavailable.",
    unemployment: `The unemployment rate is ${directionText} versus the prior monthly reading.`,
  };
  return labels[key];
}

function tradingImpact(key: FredSeriesKey, direction: FredDirection, diagnostics?: FredMetric["diagnostics"]) {
  if (direction === "unknown") return "Unavailable, so this metric should not influence the read.";
  const impacts: Record<FredSeriesKey, Partial<Record<FredDirection, string>>> = {
    fedFundsRate: {
      rising: "A meaningful rise in the effective rate can support USD, but this is not an FOMC policy-decision signal.",
      falling: "A meaningful fall in the effective rate can reduce USD support, but this is not an FOMC policy-decision signal.",
      flat: `Daily moves below ${FED_FUNDS_DAILY_FLAT_TOLERANCE.toFixed(2)} percentage points are treated as stable, not a policy change.`,
    },
    treasury10Y: {
      rising: "Rising nominal yields can support USD and pressure gold.",
      falling: "Falling nominal yields can reduce USD support and may help gold.",
      flat: "Flat nominal yields provide little fresh directional impulse.",
    },
    realYield10Y: {
      rising: "Rising real yields are usually restrictive for gold.",
      falling: "Falling real yields are usually supportive for gold.",
      flat: "Flat real yields are neutral macro context for gold.",
    },
    inflationBreakeven10Y: {
      rising: "Rising inflation expectations can be supportive context for gold.",
      falling: "Falling inflation expectations can be less supportive for gold.",
      flat: "Stable inflation expectations are neutral context.",
    },
    broadUsdIndex: {
      rising: "A stronger USD can pressure dollar-priced metals.",
      falling: "A softer USD can support dollar-priced metals.",
      flat: "A flat USD index gives limited directional confirmation.",
    },
    vix: {
      rising:
        diagnostics?.vixBand === "moderate"
          ? "VIX is rising inside a moderate band, so caution is increasing without a clear risk-off signal."
          : "Rising VIX can mean risk pressure, but gold impact is ambiguous because safe-haven demand and USD/liquidation volatility can conflict.",
      falling: "Falling VIX points to improving risk appetite.",
      flat: "Flat VIX suggests no clear risk-mood impulse.",
    },
    cpi: {
      rising: "CPI inflation is higher on the calculated rate basis, but this is monthly context rather than an intraday signal.",
      falling: "CPI inflation is lower on the calculated rate basis, but this is monthly context rather than an intraday signal.",
      flat: "CPI inflation is broadly stable on the calculated rate basis and remains monthly context.",
    },
    unemployment: {
      rising: "Labor-market weakness can influence rate expectations, but it is monthly context.",
      falling: "Labor-market strength can influence rate expectations, but it is monthly context.",
      flat: "Stable unemployment is monthly context, not an intraday signal.",
    },
  };
  return impacts[key][direction] ?? "Macro context only; do not treat this as a trade signal.";
}

function buildXauusdExplanation(
  metrics: Record<FredSeriesKey, FredMetric>,
  ambiguousFactors: string[],
  delayedFactors: string[],
) {
  const clauses: string[] = [];
  const realYield = metrics.realYield10Y;
  const broadUsd = metrics.broadUsdIndex;
  const treasury = metrics.treasury10Y;
  const vix = metrics.vix;

  if (realYield.direction === "rising") clauses.push("real yields are rising, which is a gold headwind");
  if (realYield.direction === "falling") clauses.push("real yields are falling, which is supportive for gold");
  if (treasury.direction === "rising") clauses.push("nominal yields are rising, which is another headwind");
  if (treasury.direction === "falling") clauses.push("nominal yields are falling, which can support gold");
  if (broadUsd.direction === "falling") {
    clauses.push(
      broadUsd.freshness === "current"
        ? "the broad US dollar index is falling, which is supportive"
        : "the latest available broad US dollar index is falling, which is supportive but delayed",
    );
  }
  if (broadUsd.direction === "rising") clauses.push("the broad US dollar index is rising, which is restrictive for gold");
  if (vix.diagnostics?.vixBand === "moderate" && vix.direction === "rising") {
    clauses.push("VIX is moderate but rising, so caution is increasing rather than giving a clear direction");
  }

  const conflictText =
    ambiguousFactors.length > 0
      ? " These signals conflict, so the macro backdrop is mixed."
      : delayedFactors.length > 0
        ? " Some inputs are delayed, so they should be treated as context rather than confirmation."
        : "";

  return `${clauses.length ? `For XAUUSD, ${joinReadable(clauses)}.` : "For XAUUSD, FRED does not provide enough current directional evidence."}${conflictText} This is macro context, not a buy/sell recommendation.`;
}

function getVixBand(value: number | null): VixBand {
  if (value === null) return "unknown";
  if (value < 15) return "low";
  if (value < 20) return "moderate";
  if (value <= 30) return "elevated";
  return "high";
}

function freshnessPrefix(metric: FredMetric) {
  if (metric.freshness === "delayed") return "Delayed data:";
  if (metric.freshness === "stale") return "Stale data:";
  return "Unavailable freshness:";
}

function sentenceFromFactors(factors: string[]) {
  return factors.map((factor) => factor.replace(/\.$/, "")).join("; ") + ".";
}

function joinReadable(items: string[]) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatNullablePercent(value: number | null | undefined) {
  return value === null || value === undefined ? "unknown" : `${value.toFixed(2)}%`;
}

function parseFredValue(value: unknown) {
  if (value === "." || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value: number) {
  return Math.round(value * 10000) / 10000;
}

function revalidateForSeries(seriesId: string) {
  const config = Object.values(FRED_SERIES).find((series) => series.id === seriesId);
  return revalidateForFrequency(config?.frequency ?? "daily");
}

function limitForSeries(key: FredSeriesKey, config: FredSeriesConfig) {
  if (key === "cpi") return MONTHLY_CALCULATION_LIMIT;
  return config.frequency === "monthly" ? MONTHLY_CALCULATION_LIMIT : MIN_DIRECTION_LIMIT;
}

function revalidateForFrequency(frequency: FredFrequency) {
  return frequency === "monthly" ? MONTHLY_REVALIDATE_SECONDS : DAILY_REVALIDATE_SECONDS;
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mostRecentUsBusinessDay(now: Date) {
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (!isUsBusinessDay(cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor;
}

function businessDaysBetween(observationDate: Date, expectedDate: Date) {
  const cursor = new Date(Date.UTC(observationDate.getUTCFullYear(), observationDate.getUTCMonth(), observationDate.getUTCDate()));
  const expected = new Date(Date.UTC(expectedDate.getUTCFullYear(), expectedDate.getUTCMonth(), expectedDate.getUTCDate()));
  if (cursor >= expected) return 0;

  let count = 0;
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= expected) {
    if (isUsBusinessDay(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function isUsBusinessDay(date: Date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !getObservedUsFederalHolidays(date.getUTCFullYear()).has(toDateKey(date));
}

function getObservedUsFederalHolidays(year: number) {
  const holidays = new Set<string>();
  addObserved(holidays, new Date(Date.UTC(year, 0, 1)));
  holidays.add(toDateKey(nthWeekdayOfMonth(year, 0, 1, 3)));
  holidays.add(toDateKey(nthWeekdayOfMonth(year, 1, 1, 3)));
  holidays.add(toDateKey(lastWeekdayOfMonth(year, 4, 1)));
  addObserved(holidays, new Date(Date.UTC(year, 5, 19)));
  addObserved(holidays, new Date(Date.UTC(year, 6, 4)));
  holidays.add(toDateKey(nthWeekdayOfMonth(year, 8, 1, 1)));
  holidays.add(toDateKey(nthWeekdayOfMonth(year, 9, 1, 2)));
  addObserved(holidays, new Date(Date.UTC(year, 10, 11)));
  holidays.add(toDateKey(nthWeekdayOfMonth(year, 10, 4, 4)));
  addObserved(holidays, new Date(Date.UTC(year, 11, 25)));
  return holidays;
}

function addObserved(holidays: Set<string>, date: Date) {
  const day = date.getUTCDay();
  const observed = new Date(date);
  if (day === 0) observed.setUTCDate(date.getUTCDate() + 1);
  if (day === 6) observed.setUTCDate(date.getUTCDate() - 1);
  holidays.add(toDateKey(observed));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number) {
  const date = new Date(Date.UTC(year, month, 1));
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCDate(date.getUTCDate() + (n - 1) * 7);
  return date;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

function expectedMonthlyObservationDate(now: Date, releaseLagDays: number) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let offset = 0; offset < 24; offset += 1) {
    const candidate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - offset, 1));
    const monthEnd = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0));
    const releaseDate = new Date(monthEnd);
    releaseDate.setUTCDate(releaseDate.getUTCDate() + releaseLagDays);
    if (releaseDate <= now) return candidate;
  }
  return monthStart;
}

function monthDifference(observed: Date, expected: Date) {
  return (expected.getUTCFullYear() - observed.getUTCFullYear()) * 12 + (expected.getUTCMonth() - observed.getUTCMonth());
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function unique(items: string[]) {
  return Array.from(new Set(items));
}

// CPIAUCSL and UNRATE can be revised. If these series are ever used for
// backtesting, use ALFRED vintage data or realtime_start/realtime_end to avoid
// lookahead bias from revised observations.
