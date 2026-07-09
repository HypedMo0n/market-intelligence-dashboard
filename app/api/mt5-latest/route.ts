import { NextResponse } from "next/server";
import { INSTRUMENT_KEYS } from "@/lib/market-analysis/instruments";
import { getSupabaseAdmin } from "@/lib/providers/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const { data, error } = await supabase
      .from("mt5_snapshots")
      .select("*")
      .in("instrument", INSTRUMENT_KEYS)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(error.message);
    }

    const latest: Record<string, unknown> = {};
    for (const row of data || []) {
      if (!latest[row.instrument]) {
        latest[row.instrument] = {
          instrument: row.instrument,
          timestamp: row.timestamp,
          price: row.price === null ? null : Number(row.price),
          trend: row.trend,
          structure: row.structure,
          volatility: row.volatility,
          support: row.support === null ? null : Number(row.support),
          resistance: row.resistance === null ? null : Number(row.resistance),
          recentHigh: row.recent_high === null ? null : Number(row.recent_high),
          recentLow: row.recent_low === null ? null : Number(row.recent_low),
          liquidityZones: row.liquidity_zones,
          notes: row.notes,
          source: row.source,
          createdAt: row.created_at,
        };
      }
    }

    return NextResponse.json({ snapshots: latest, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Latest MT5 fetch failed." },
      { status: 500 },
    );
  }
}
