import { NextResponse } from "next/server";
import {
  buildUnavailableFredSnapshot,
  FredConfigurationError,
  getFredMacroSnapshot,
  redactFredApiKey,
} from "@/lib/providers/fred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getFredMacroSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof FredConfigurationError) {
      return NextResponse.json(buildUnavailableFredSnapshot("FRED_API_KEY is not configured."), { status: 503 });
    }

    const message = redactFredApiKey(error instanceof Error ? error.message : "FRED macro data unavailable.");
    return NextResponse.json(buildUnavailableFredSnapshot(message), { status: 500 });
  }
}
