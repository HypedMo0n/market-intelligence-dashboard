import { NextRequest, NextResponse } from "next/server";
import { normalizeCandles } from "@/lib/market-analysis/candles";
import { getPrimaryDataProvider, normalizeSymbol } from "@/lib/market-analysis/providerRouting";
import { getSupabaseAdmin } from "@/lib/providers/supabaseAdmin";
import { fetchTwelveDataCandles } from "@/lib/providers/twelveData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") || "");
  const interval = request.nextUrl.searchParams.get("interval") || "1h";
  const lookback = clampLookback(request.nextUrl.searchParams.get("lookback"));
  if (!symbol) return NextResponse.json({ error: "Missing symbol." }, { status: 400 });

  const provider = getPrimaryDataProvider(symbol);
  if (provider === "MT5") {
    return NextResponse.json(await fetchMt5Candles(symbol, interval, lookback));
  }

  const result = await fetchTwelveDataCandles(symbol, interval, lookback);
  return NextResponse.json({
    symbol,
    provider,
    interval,
    lookback,
    status: result.status,
    candles: result.candles,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
}

async function fetchMt5Candles(symbol: string, interval: string, lookback: number) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      symbol,
      provider: "MT5",
      interval,
      lookback,
      status: "mt5_disconnected",
      candles: [],
      error: "MT5 candle history is unavailable because Supabase is not configured locally.",
      fetchedAt: new Date().toISOString(),
    };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mt5_snapshots")
    .select("instrument, raw_json, created_at")
    .eq("instrument", symbol)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const rawJson = data?.[0]?.raw_json && typeof data[0].raw_json === "object" ? data[0].raw_json as Record<string, unknown> : {};
  const candles = normalizeCandles(rawJson.candles ?? rawJson.ohlc, lookback);
  if (!data?.length) {
    return {
      symbol,
      provider: "MT5",
      interval,
      lookback,
      status: "mt5_disconnected",
      candles,
      error: "No MT5 snapshot has been received for this instrument yet.",
      fetchedAt: new Date().toISOString(),
    };
  }
  if (!candles.length) {
    return {
      symbol,
      provider: "MT5",
      interval,
      lookback,
      status: "unavailable",
      candles,
      error: "MT5 is connected, but the latest snapshot does not include candle history yet. Restart the updated MT5 bridge.",
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    symbol,
    provider: "MT5",
    interval,
    lookback,
    status: "live",
    candles,
    fetchedAt: new Date().toISOString(),
  };
}

function clampLookback(value: string | null) {
  const parsed = value ? Number(value) : 120;
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(20, Math.min(500, Math.round(parsed)));
}
