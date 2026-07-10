import { hasAiConfig, hasGeminiConfig, hasGroqConfig } from "./aiProviders.ts";
import { getTwelveDataStatus } from "./twelveData.ts";

export function buildProviderStatusPayload(now = new Date().toISOString()) {
  const twelve = getTwelveDataStatus();
  return {
    providers: [
      { id: "mt5", name: "MT5", configured: Boolean(process.env.MT5_INGEST_SECRET), status: "operational", fallback: "manual JSON when unavailable" },
      { id: "twelve-data", name: "Twelve Data", configured: twelve.configured, status: twelve.configured ? "operational" : "not configured", fallback: "unavailable state" },
      { id: "gemini", name: "Gemini", configured: hasGeminiConfig(), status: hasGeminiConfig() ? "operational" : "not configured", fallback: hasGroqConfig() ? "Groq" : "deterministic local explanation" },
      { id: "groq", name: "Groq", configured: hasGroqConfig(), status: hasGroqConfig() ? "operational" : "not configured", fallback: "deterministic local explanation" },
      { id: "ai", name: "AI explanation", configured: hasAiConfig(), status: hasAiConfig() ? "operational" : "not configured", fallback: "deterministic local explanation" },
      { id: "fred", name: "FRED macro", configured: Boolean(process.env.FRED_API_KEY), status: process.env.FRED_API_KEY ? "operational" : "not configured", fallback: "macro unavailable state" },
      { id: "calendar", name: "Economic calendar", configured: false, status: "unavailable", fallback: "clear unavailable state" },
      { id: "news", name: "Market news", configured: false, status: "unavailable", fallback: "clear unavailable state" },
      { id: "cache", name: "Server cache", configured: true, status: "operational", fallback: "short-lived provider caches" },
    ],
    generatedAt: now,
  };
}
