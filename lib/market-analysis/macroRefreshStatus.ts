import type { MacroScan } from "./types.ts";

export type MacroRefreshStatus = {
  state: "idle" | "loading" | "updated" | "cached" | "stale" | "failed";
  lastRefreshed?: string;
  source: string;
  message: string;
};

export function buildMacroRefreshStatus(scan: MacroScan, refreshedAt = new Date().toISOString()): MacroRefreshStatus {
  const sources = scan.sources || [];
  const usedFallback = sources.includes("local fallback");
  return {
    state: usedFallback ? "cached" : "updated",
    lastRefreshed: refreshedAt,
    source: sources.join(", ") || "Gemini/Groq or deterministic fallback",
    message: usedFallback ? "Macro context used the deterministic fallback." : "Macro context refreshed.",
  };
}

export function buildMacroRefreshFailure(error: unknown, refreshedAt = new Date().toISOString()): MacroRefreshStatus {
  return {
    state: "failed",
    lastRefreshed: refreshedAt,
    source: "Gemini/Groq or deterministic fallback",
    message: error instanceof Error ? error.message : "Macro scan failed.",
  };
}
