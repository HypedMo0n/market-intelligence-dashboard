import { NextResponse } from "next/server";
import { INSTRUMENT_KEYS } from "@/lib/market-analysis/instruments";
import { getSupabaseAdmin } from "@/lib/providers/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SUPABASE_TIMEOUT_MS = 4_000;

export async function GET() {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({
        snapshots: {},
        fetchedAt: new Date().toISOString(),
        warning: "Supabase is not configured yet. Use manual MT5 JSON fallback or set Supabase env vars.",
      });
    }

    const supabase = getSupabaseAdmin();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    const { data, error } = await supabase
      .from("mt5_snapshots")
      .select("*")
      .in("instrument", INSTRUMENT_KEYS)
      .order("created_at", { ascending: false })
      .limit(100)
      .abortSignal(controller.signal);
    clearTimeout(timeout);

    if (error) {
      throw new Error(error.message);
    }

    const latest: Record<string, unknown> = {};
    for (const row of data || []) {
      if (!latest[row.instrument]) {
        const rawJson = row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {};
        latest[row.instrument] = {
          instrument: row.instrument,
          timestamp: row.timestamp,
          price: row.price === null ? null : Number(row.price),
          atr: numberFromRaw(rawJson.atr ?? rawJson.current_atr ?? rawJson.currentAtr),
          trend: row.trend,
          structure: row.structure,
          volatility: row.volatility,
          volatilityDetail:
            typeof rawJson.volatility_detail === "string"
              ? rawJson.volatility_detail
              : typeof rawJson.volatilityDetail === "string"
                ? rawJson.volatilityDetail
                : row.volatility,
          support: row.support === null ? null : Number(row.support),
          resistance: row.resistance === null ? null : Number(row.resistance),
          recentHigh: row.recent_high === null ? null : Number(row.recent_high),
          recentLow: row.recent_low === null ? null : Number(row.recent_low),
          liquidityZones: normalizeLiquidityZones(row.liquidity_zones),
          notes: row.notes,
          source: row.source,
          createdAt: row.created_at,
          candleMayBeForming:
            typeof rawJson.candle_may_be_forming === "boolean"
              ? rawJson.candle_may_be_forming
              : typeof rawJson.candleMayBeForming === "boolean"
                ? rawJson.candleMayBeForming
                : true,
        };
      }
    }

    return NextResponse.json({ snapshots: latest, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))) {
      return NextResponse.json({
        snapshots: {},
        fetchedAt: new Date().toISOString(),
        warning: "MT5 latest data is temporarily unavailable because Supabase did not respond in time.",
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Latest MT5 fetch failed." },
      { status: 500 },
    );
  }
}

function normalizeLiquidityZones(value: unknown) {
  if (typeof value !== "string") return value;
  if (value.toLowerCase().startsWith("stops may cluster")) {
    return "Potential stop areas may sit near the recent high and low.";
  }
  return value;
}

function numberFromRaw(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
