import { NextRequest, NextResponse } from "next/server";
import { getPrimaryDataProvider, normalizeSymbol } from "@/lib/market-analysis/providerRouting";
import { fetchTwelveDataQuote } from "@/lib/providers/twelveData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawSymbol = request.nextUrl.searchParams.get("symbol") || "";
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return NextResponse.json({ error: "Missing symbol." }, { status: 400 });

  const provider = getPrimaryDataProvider(symbol);
  if (provider === "MT5") {
    return NextResponse.json({
      symbol,
      provider: "MT5",
      status: "mt5_required",
      message: "XAUUSD and XAGUSD use MT5 as the primary market-data source. Use /api/mt5-latest for the latest snapshot.",
    });
  }

  const quote = await fetchTwelveDataQuote(rawSymbol.includes("/") ? rawSymbol : symbol);
  return NextResponse.json({ symbol, provider, quote });
}
