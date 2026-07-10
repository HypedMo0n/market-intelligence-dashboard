import { NextResponse } from "next/server";
import { buildProviderStatusPayload } from "../../../lib/providers/providerStatus.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildProviderStatusPayload());
}
