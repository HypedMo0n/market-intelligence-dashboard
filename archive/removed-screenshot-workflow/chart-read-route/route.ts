import { NextRequest, NextResponse } from "next/server";
import { callAnthropicJson } from "@/lib/anthropic";
import { isInstrumentKey } from "@/lib/instruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHART_SYSTEM = `You are reading one trading chart screenshot for a beginner trader.
Output ONLY raw JSON, no markdown fences, no preamble, matching:
{
  "trend": "up|down|sideways",
  "structure": "higher highs and higher lows|lower highs and lower lows|range or choppy",
  "volatility": "calm|normal|aggressive",
  "support": "number or description",
  "resistance": "number or description",
  "recentHigh": "number or description",
  "recentLow": "number or description",
  "liquidityZones": "one short sentence",
  "invalidationLevel": "number or description",
  "beginnerExplanation": "one plain-English sentence",
  "confidence": 1-5,
  "notes": "one sentence"
}
Read only what is visible on the chart. If a level is not clearly readable, say "not clearly visible".
Do not give trade instructions. Never say guaranteed profit, buy now, sell now, or this will happen.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const instrument = String(formData.get("instrument") || "");
    const file = formData.get("image");

    if (!isInstrumentKey(instrument)) {
      return NextResponse.json({ error: "Invalid instrument." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing chart screenshot." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const data = bytes.toString("base64");
    const mediaType = file.type || "image/png";

    const chart = await callAnthropicJson<Record<string, unknown>>({
      system: CHART_SYSTEM,
      userContent: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        { type: "text", text: `This is a price chart for ${instrument}. Read it per the schema.` },
      ],
      maxTokens: 1000,
    });

    return NextResponse.json({ ...chart, instrument, readAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chart reading failed." },
      { status: 500 },
    );
  }
}
