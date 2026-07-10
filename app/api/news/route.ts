import { NextResponse } from "next/server";
import { buildNewsUnavailablePayload } from "../../../lib/market-analysis/unavailableFeeds.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildNewsUnavailablePayload());
}
