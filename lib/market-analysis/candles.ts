export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type CandleResponseStatus = "live" | "cached" | "unavailable" | "mt5_disconnected";

export function normalizeCandles(value: unknown, lookback: number): Candle[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeCandle)
    .filter((candle): candle is Candle => Boolean(candle))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .slice(-Math.max(1, lookback));
}

function normalizeCandle(value: unknown): Candle | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const time = typeof item.time === "string" ? item.time : typeof item.datetime === "string" ? item.datetime : typeof item.timestamp === "string" ? item.timestamp : "";
  const open = numberOrNull(item.open);
  const high = numberOrNull(item.high);
  const low = numberOrNull(item.low);
  const close = numberOrNull(item.close);
  if (!time || open === null || high === null || low === null || close === null) return null;
  return { time, open, high, low, close };
}

export function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
