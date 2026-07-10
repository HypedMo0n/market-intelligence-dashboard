import { NextRequest, NextResponse } from "next/server";
import { isMt5PrimarySymbol, normalizeSymbol } from "@/lib/market-analysis/providerRouting";
import { searchTwelveDataAssets } from "@/lib/providers/twelveData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const normalized = normalizeSymbol(query);
  if (!normalized) return NextResponse.json({ results: [] });

  const mt5Matches = ["XAUUSD", "XAGUSD"]
    .filter((symbol) => symbol.includes(normalized) || (symbol === "XAUUSD" && "GOLD".includes(normalized)) || (symbol === "XAGUSD" && "SILVER".includes(normalized)))
    .map((symbol) => ({
      symbol,
      name: symbol === "XAUUSD" ? "Gold" : "Silver",
      assetClass: "metal",
      provider: "MT5",
    }));

  const twelveDataResults = isMt5PrimarySymbol(normalized) ? [] : await searchTwelveDataAssets(query);
  return NextResponse.json({ results: [...mt5Matches, ...twelveDataResults].slice(0, 12) });
}
