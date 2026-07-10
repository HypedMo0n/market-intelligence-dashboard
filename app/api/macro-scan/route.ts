import { NextResponse } from "next/server";
import { buildFallbackMacroScan } from "@/lib/macro/fallbackMacroScan";
import { INSTRUMENT_KEYS } from "@/lib/market-analysis/instruments";
import { MACRO_SYSTEM } from "@/lib/prompts/macroPrompt";
import { callAiJsonWithFallback, hasAiConfig } from "@/lib/providers/aiProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    if (!hasAiConfig()) {
      return NextResponse.json(buildFallbackMacroScan());
    }

    const scan = await callAiJsonWithFallback<Record<string, unknown>>({
      system: MACRO_SYSTEM,
      userContent: `Give the current macro briefing and per-instrument impact for ${INSTRUMENT_KEYS.join(", ")}. Use only educational, decision-support language.`,
      maxTokens: 1600,
    });

    return NextResponse.json({ ...scan.value, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Macro scan failed." },
      { status: 500 },
    );
  }
}
