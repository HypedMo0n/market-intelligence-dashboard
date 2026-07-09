import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENT_KEYS, isInstrumentKey } from "@/lib/market-analysis/instruments";
import { getSupabaseAdmin } from "@/lib/providers/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingSnapshot = {
  instrument?: string;
  timestamp?: string;
  price?: number;
  trend?: string;
  structure?: string;
  volatility?: string;
  support?: number | null;
  resistance?: number | null;
  recent_high?: number | null;
  recent_low?: number | null;
  recentHigh?: number | null;
  recentLow?: number | null;
  liquidity_zones?: string | null;
  liquidityZones?: string | null;
  notes?: string | null;
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.MT5_INGEST_SECRET;
  const suppliedSecret =
    request.headers.get("x-mt5-ingest-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!configuredSecret || !suppliedSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized MT5 ingest request." }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const snapshots = normalizePayload(payload);
    if (snapshots.length === 0) {
      return NextResponse.json({ error: "No valid MT5 snapshots found." }, { status: 400 });
    }

    const rows = snapshots.map((snapshot) => ({
      instrument: snapshot.instrument,
      source: "MT5",
      timestamp: snapshot.timestamp || new Date().toISOString(),
      price: snapshot.price ?? null,
      trend: snapshot.trend || "sideways",
      structure: snapshot.structure || "range or choppy",
      volatility: snapshot.volatility || "normal",
      support: snapshot.support ?? null,
      resistance: snapshot.resistance ?? null,
      recent_high: snapshot.recent_high ?? snapshot.recentHigh ?? null,
      recent_low: snapshot.recent_low ?? snapshot.recentLow ?? null,
      liquidity_zones: snapshot.liquidity_zones ?? snapshot.liquidityZones ?? null,
      notes: snapshot.notes ?? null,
      raw_json: snapshot,
    }));

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("mt5_snapshots").insert(rows);
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MT5 ingest failed." },
      { status: 500 },
    );
  }
}

function normalizePayload(payload: unknown): IncomingSnapshot[] {
  if (!payload || typeof payload !== "object") return [];

  if (!Array.isArray(payload) && isValidSnapshot(payload as IncomingSnapshot)) {
    return [payload as IncomingSnapshot];
  }

  if (Array.isArray((payload as { snapshots?: unknown }).snapshots)) {
    return ((payload as { snapshots: IncomingSnapshot[] }).snapshots || []).filter(isValidSnapshot);
  }

  if (Array.isArray(payload)) {
    return payload.filter(isValidSnapshot);
  }

  return Object.entries(payload as Record<string, unknown>)
    .map(([instrument, value]) =>
      value && typeof value === "object" ? ({ ...(value as IncomingSnapshot), instrument } as IncomingSnapshot) : null,
    )
    .filter((snapshot): snapshot is IncomingSnapshot => Boolean(snapshot && isValidSnapshot(snapshot)));
}

function isValidSnapshot(snapshot: IncomingSnapshot): boolean {
  return Boolean(snapshot.instrument && isInstrumentKey(snapshot.instrument) && INSTRUMENT_KEYS.includes(snapshot.instrument));
}
