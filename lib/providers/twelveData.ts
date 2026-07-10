import { createHash } from "node:crypto";
import type { Candle } from "../market-analysis/candles.ts";
import { normalizeSymbol } from "../market-analysis/providerRouting.ts";

export type TwelveDataAsset = {
  symbol: string;
  name: string;
  assetClass: string;
  exchange?: string;
  currency?: string;
  provider: "Twelve Data";
};

export type TwelveDataQuote = {
  symbol: string;
  name: string;
  assetClass: string;
  price: number | null;
  change: number | null;
  percentChange: number | null;
  timestamp: string;
  provider: "Twelve Data";
  status: "live" | "cached" | "unavailable";
  error?: string;
};

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 60 * 1000;
const CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; value: TwelveDataAsset[] }>();
const quoteCache = new Map<string, { expiresAt: number; value: TwelveDataQuote }>();
const candleCache = new Map<string, { expiresAt: number; value: Candle[] }>();

const LOCAL_ALIASES: TwelveDataAsset[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", assetClass: "forex", provider: "Twelve Data" },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "forex", provider: "Twelve Data" },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "forex", provider: "Twelve Data" },
  { symbol: "GBPJPY", name: "British Pound / Japanese Yen", assetClass: "forex", provider: "Twelve Data" },
  { symbol: "AAPL", name: "Apple Inc.", assetClass: "stock", provider: "Twelve Data" },
  { symbol: "TSLA", name: "Tesla Inc.", assetClass: "stock", provider: "Twelve Data" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "etf", provider: "Twelve Data" },
  { symbol: "BTC/USD", name: "Bitcoin / US Dollar", assetClass: "crypto", provider: "Twelve Data" },
];

export function hasTwelveDataConfig() {
  return Boolean(process.env.TWELVE_DATA_API_KEY);
}

export async function searchTwelveDataAssets(query: string, fetchImpl: typeof fetch = fetch): Promise<TwelveDataAsset[]> {
  const normalized = normalizeSymbol(query);
  if (!normalized) return [];

  const local = LOCAL_ALIASES.filter((asset) => normalizeSymbol(asset.symbol).includes(normalized) || asset.name.toUpperCase().includes(query.trim().toUpperCase()));
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return local;

  const cacheKey = normalized;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return mergeAssets(local, cached.value);

  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) return local;
  const data = await response.json();
  const remote = Array.isArray(data.data)
    ? data.data.map(normalizeSearchResult).filter((asset: TwelveDataAsset | null): asset is TwelveDataAsset => Boolean(asset))
    : [];
  searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value: remote });
  return mergeAssets(local, remote);
}

export async function fetchTwelveDataQuote(symbol: string, fetchImpl: typeof fetch = fetch): Promise<TwelveDataQuote> {
  const normalized = normalizeSymbol(symbol);
  const cached = quoteCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, status: "cached" };

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const alias = LOCAL_ALIASES.find((asset) => normalizeSymbol(asset.symbol) === normalized);
  if (!apiKey) {
    return unavailableQuote(symbol, alias, "Twelve Data is not configured. Set TWELVE_DATA_API_KEY server-side.");
  }

  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) return unavailableQuote(symbol, alias, "Twelve Data quote request failed.");
  const data = await response.json();
  if (data.status === "error") return unavailableQuote(symbol, alias, data.message || "Twelve Data returned an error.");

  const quote: TwelveDataQuote = {
    symbol: String(data.symbol || alias?.symbol || symbol).toUpperCase(),
    name: String(data.name || alias?.name || symbol),
    assetClass: String(data.type || alias?.assetClass || "market"),
    price: numberOrNull(data.close),
    change: numberOrNull(data.change),
    percentChange: numberOrNull(data.percent_change),
    timestamp: new Date().toISOString(),
    provider: "Twelve Data",
    status: "live",
  };
  quoteCache.set(normalized, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, value: quote });
  return quote;
}

export async function fetchTwelveDataCandles(symbol: string, interval = "1h", lookback = 120, fetchImpl: typeof fetch = fetch): Promise<{ status: "live" | "cached" | "unavailable"; candles: Candle[]; error?: string }> {
  const normalized = normalizeSymbol(symbol);
  const cacheKey = hashCandleCacheKey({ symbol: normalized, interval, lookback });
  const cached = candleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { status: "cached", candles: cached.value };

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return { status: "unavailable", candles: [], error: "Twelve Data is not configured. Set TWELVE_DATA_API_KEY server-side." };
  }

  const providerSymbol = formatTwelveDataSymbol(symbol);
  const providerInterval = normalizeTwelveDataInterval(interval);
  const outputSize = Math.max(1, Math.min(5000, Math.round(lookback)));
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(providerSymbol)}&interval=${encodeURIComponent(providerInterval)}&outputsize=${outputSize}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) return { status: "unavailable", candles: [], error: "Twelve Data candle request failed." };
  const data = await response.json();
  if (data.status === "error") return { status: "unavailable", candles: [], error: data.message || "Twelve Data returned an error." };

  const candles = Array.isArray(data.values)
    ? data.values.map(normalizeTimeSeriesCandle).filter((candle: Candle | null): candle is Candle => Boolean(candle)).reverse()
    : [];
  candleCache.set(cacheKey, { expiresAt: Date.now() + CANDLE_CACHE_TTL_MS, value: candles });
  return { status: "live", candles };
}

export function getTwelveDataStatus() {
  return {
    configured: hasTwelveDataConfig(),
    provider: "Twelve Data",
    cacheEntries: searchCache.size + quoteCache.size + candleCache.size,
  };
}

function normalizeSearchResult(item: Record<string, unknown>): TwelveDataAsset | null {
  if (typeof item.symbol !== "string") return null;
  return {
    symbol: item.symbol,
    name: typeof item.instrument_name === "string" ? item.instrument_name : item.symbol,
    assetClass: typeof item.instrument_type === "string" ? item.instrument_type : "market",
    exchange: typeof item.exchange === "string" ? item.exchange : undefined,
    currency: typeof item.currency === "string" ? item.currency : undefined,
    provider: "Twelve Data",
  };
}

function mergeAssets(local: TwelveDataAsset[], remote: TwelveDataAsset[]) {
  const merged = new Map<string, TwelveDataAsset>();
  for (const asset of [...local, ...remote]) merged.set(normalizeSymbol(asset.symbol), asset);
  return Array.from(merged.values()).slice(0, 12);
}

async function fetchWithTimeout(url: string, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableQuote(symbol: string, alias: TwelveDataAsset | undefined, error: string): TwelveDataQuote {
  return {
    symbol: alias?.symbol || symbol.toUpperCase(),
    name: alias?.name || symbol.toUpperCase(),
    assetClass: alias?.assetClass || "market",
    price: null,
    change: null,
    percentChange: null,
    timestamp: new Date().toISOString(),
    provider: "Twelve Data",
    status: "unavailable",
    error,
  };
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimeSeriesCandle(item: Record<string, unknown>): Candle | null {
  const time = typeof item.datetime === "string" ? item.datetime : "";
  const open = numberOrNull(item.open);
  const high = numberOrNull(item.high);
  const low = numberOrNull(item.low);
  const close = numberOrNull(item.close);
  if (!time || open === null || high === null || low === null || close === null) return null;
  return { time: normalizeCandleTime(time), open, high, low, close };
}

function normalizeCandleTime(time: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) return `${time}T00:00:00Z`;
  if (time.endsWith("Z")) return time;
  return `${time.replace(" ", "T")}Z`;
}

function normalizeTwelveDataInterval(interval: string) {
  const normalized = interval.trim().toLowerCase();
  if (normalized === "h1" || normalized === "1hour") return "1h";
  if (normalized === "d1" || normalized === "1d") return "1day";
  return normalized || "1h";
}

function formatTwelveDataSymbol(symbol: string) {
  const raw = symbol.trim().toUpperCase();
  if (raw.includes("/")) return raw;
  const normalized = normalizeSymbol(symbol);
  if (/^[A-Z]{6}$/.test(normalized)) return `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
  return raw;
}

function hashCandleCacheKey(input: { symbol: string; interval: string; lookback: number }) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
