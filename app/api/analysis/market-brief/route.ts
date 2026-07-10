import { NextRequest, NextResponse } from "next/server";
import { generateMarketBrief, validateMarketBriefRequest } from "@/lib/ai/marketBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON request body." }, { status: 400 });
  }

  const validated = validateMarketBriefRequest(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const response = await generateMarketBrief(validated.input);
  return NextResponse.json(response);
}
