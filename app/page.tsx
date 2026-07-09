"use client";

import { AlertCircle, Clock, Database, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MetricChip, { Explain } from "@/components/common/MetricChip";
import InstrumentCard from "@/components/instruments/InstrumentCard";
import UsdStrengthMeter from "@/components/macro/UsdStrengthMeter";
import { INSTRUMENTS, isInstrumentKey } from "@/lib/market-analysis/instruments";
import type { ChartRead, MacroScan } from "@/lib/market-analysis/types";
import { C } from "@/lib/theme";

const STORAGE_KEY = "ai-trading-intelligence-state";

const MT5_EXAMPLE = `{
  "instrument": "XAUUSD",
  "timestamp": "2026-07-09T12:30:00Z",
  "price": 2365.4,
  "trend": "up",
  "structure": "higher highs and higher lows",
  "volatility": "normal",
  "support": 2352.1,
  "resistance": 2378.6,
  "recent_high": 2378.6,
  "recent_low": 2346.8,
  "liquidity_zones": "Stops may cluster just below 2346.80 and just above 2378.60.",
  "notes": "XAUUSD is holding above recent support with a clear upward H1 structure."
}`;

export default function TradingIntelligenceDashboard() {
  const [scan, setScan] = useState<MacroScan | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mt5Snapshots, setMt5Snapshots] = useState<Record<string, ChartRead>>({});
  const [mt5Text, setMt5Text] = useState("");
  const [mt5Open, setMt5Open] = useState(true);
  const [mt5Status, setMt5Status] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mt5Loading, setMt5Loading] = useState(false);
  const scanRef = useRef<MacroScan | null>(null);

  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { scan?: MacroScan; mt5Snapshots?: Record<string, ChartRead> };
      setScan(parsed.scan || null);
      setMt5Snapshots(parsed.mt5Snapshots || {});
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const persist = useCallback((next: { scan?: MacroScan | null; mt5Snapshots?: Record<string, ChartRead> }) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ scan: next.scan || null, mt5Snapshots: next.mt5Snapshots || {} }),
    );
  }, []);

  const fetchLatestMt5 = useCallback(
    async (showStatus = true) => {
      setMt5Loading(true);
      if (showStatus) setMt5Status(null);
      try {
        const response = await fetch("/api/mt5-latest", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not fetch latest MT5 snapshots.");
        const imported = normalizeMt5Charts(data.snapshots || {});
        setMt5Snapshots((current) => {
          const nextSnapshots = mergeMt5Snapshots(current, imported);
          if (nextSnapshots === current) {
            return current;
          }
          persist({ scan: scanRef.current, mt5Snapshots: nextSnapshots });
          return nextSnapshots;
        });
        if (showStatus) {
          const count = Object.keys(imported).length;
          setMt5Status({
            ok: true,
            msg: count ? `Loaded latest MT5 snapshots for ${Object.keys(imported).join(", ")}.` : "No MT5 snapshots stored yet.",
          });
        }
      } catch (event) {
        if (showStatus) {
          setMt5Status({
            ok: false,
            msg: event instanceof Error ? event.message : "Could not fetch latest MT5 snapshots.",
          });
        }
      } finally {
        setMt5Loading(false);
      }
    },
    [persist],
  );

  useEffect(() => {
    fetchLatestMt5(false);
    const interval = window.setInterval(() => fetchLatestMt5(false), 60_000);
    return () => window.clearInterval(interval);
  }, [fetchLatestMt5]);

  const runScan = useCallback(async () => {
    setMacroLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/macro-scan", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Macro scan failed.");
      setScan(data);
      persist({ scan: data, mt5Snapshots });
    } catch (event) {
      setError(event instanceof Error ? event.message : "Macro scan failed.");
    } finally {
      setMacroLoading(false);
    }
  }, [mt5Snapshots, persist]);

  const importMt5Data = useCallback(() => {
    setMt5Status(null);
    try {
      const parsed = JSON.parse(mt5Text) as Record<string, unknown>;
      const imported = normalizeMt5Charts(parsed);
      if (Object.keys(imported).length === 0) {
        setMt5Status({ ok: false, msg: "No recognized instrument keys found." });
        return;
      }
      const nextSnapshots = { ...mt5Snapshots, ...imported };
      setMt5Snapshots(nextSnapshots);
      persist({ scan, mt5Snapshots: nextSnapshots });
      setMt5Status({ ok: true, msg: `Imported MT5 fallback data for ${Object.keys(imported).join(", ")}.` });
    } catch {
      setMt5Status({ ok: false, msg: "That is not valid JSON. Check for missing quotes or trailing commas." });
    }
  }, [mt5Snapshots, mt5Text, persist, scan]);

  const newsWarnings = useMemo(
    () => (scan?.instruments || []).filter((instrument) => instrument.newsRisk?.level && instrument.newsRisk.level !== "none"),
    [scan],
  );

  return (
    <main style={{ background: C.bg, minHeight: "100vh" }} className="w-full font-sans">
      <div className="max-w-5xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 style={{ color: C.text }} className="font-serif text-3xl tracking-tight">
              AI Trading Intelligence Platform
            </h1>
            <p style={{ color: C.textDim }} className="text-sm mt-1">
              Explains market context using MT5 data, macro context, and education. No auto-trading.
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={macroLoading}
            style={{ background: C.gold, color: C.bg }}
            className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={macroLoading ? "animate-spin" : ""} />
            {macroLoading ? "Scanning context..." : scan ? "Refresh macro" : "Load macro context"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#2A1620", border: `1px solid ${C.fall}`, color: C.fall }} className="rounded-md px-4 py-3 mb-6 flex items-center gap-2 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {scan ? (
          <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-6 mb-6">
            <div className="flex items-center gap-2 mb-2" style={{ color: C.textDim }}>
              <Clock size={14} />
              <span className="text-xs font-mono">{scan.asOf || (scan.fetchedAt ? new Date(scan.fetchedAt).toLocaleString() : "latest context")}</span>
            </div>
            <p style={{ color: C.text }} className="font-serif text-xl leading-relaxed mb-4">
              {scan.narrative}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <MetricChip label="USD strength" value={scan.usdStrength?.detail} explainId="usdStrength" />
              <MetricChip label="Rate expectations" value={scan.rateExpectations?.detail} explainId="rateExpectations" />
              <MetricChip label="Yields" value={scan.yields?.detail} explainId="yields" />
              <MetricChip label="Inflation / employment" value={scan.inflationEmployment?.detail} explainId="inflationEmployment" />
              <MetricChip label="Central bank tone" value={scan.centralBank?.detail} explainId="centralBank" />
              <MetricChip label="Risk mood" value={scan.riskMood?.detail} explainId="riskMood" />
            </div>
            {scan.sources && scan.sources.length > 0 && (
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {scan.sources.map((source) => (
                  <span key={source} style={{ color: C.textDim, borderColor: C.line }} className="text-xs border rounded px-2 py-0.5">
                    {source}
                  </span>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section style={{ background: C.surface, border: `1px dashed ${C.line}`, color: C.textDim }} className="rounded-lg p-8 mb-6 text-center text-sm">
            Load macro context for USD strength, rates, yields, risk mood, and per-instrument explanations. The MT5 bridge remains the primary live chart source.
          </section>
        )}

        <div className="mb-6">
          <UsdStrengthMeter usdStrength={scan?.usdStrength} />
        </div>

        {newsWarnings.length > 0 && (
          <section style={{ background: "#2A1620", border: `1px solid ${C.fall}` }} className="rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2" style={{ color: C.fall }}>
              <AlertCircle size={16} />
              <span className="font-serif text-lg">News risk</span>
              <Explain id="newsRisk" />
            </div>
            <ul className="flex flex-col gap-1">
              {newsWarnings.map((warning) => (
                <li key={warning.key} style={{ color: C.textDim }} className="text-sm">
                  <span style={{ color: C.text }}>{warning.key}: </span>
                  {warning.newsRisk?.detail}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button type="button" onClick={() => setMt5Open((value) => !value)} className="flex flex-col text-left">
              <span style={{ color: C.text }} className="font-serif text-lg">
                MT5 data source
              </span>
              <span style={{ color: C.textDim }} className="text-xs">
                Dashboard auto-refreshes `/api/mt5-latest`; paste JSON only as a backup.
              </span>
            </button>
            <button
              type="button"
              onClick={() => fetchLatestMt5(true)}
              disabled={mt5Loading}
              style={{ color: C.gold, borderColor: C.gold }}
              className="text-xs border rounded px-3 py-2 flex items-center gap-2 disabled:opacity-50"
            >
              <Database size={14} />
              {mt5Loading ? "Fetching..." : "Fetch latest MT5"}
            </button>
          </div>
          {mt5Status && (
            <p style={{ color: mt5Status.ok ? C.rise : C.fall }} className="text-xs mt-3">
              {mt5Status.msg}
            </p>
          )}
          {mt5Open && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={mt5Text}
                onChange={(event) => setMt5Text(event.target.value)}
                placeholder={MT5_EXAMPLE}
                rows={8}
                style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, color: C.text }}
                className="w-full rounded-md p-3 text-xs font-mono"
              />
              <button type="button" onClick={importMt5Data} style={{ background: C.gold, color: C.bg }} className="text-sm rounded-md px-4 py-2 font-medium self-start">
                Import pasted JSON
              </button>
            </div>
          )}
        </section>

        <h2 style={{ color: C.text }} className="font-serif text-xl mb-3">
          Instrument Intelligence
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {INSTRUMENTS.map((instMeta) => (
            <InstrumentCard
              key={instMeta.key}
              instMeta={instMeta}
              macro={scan?.instruments?.find((instrument) => instrument.key === instMeta.key)}
              mt5={mt5Snapshots[instMeta.key]}
            />
          ))}
        </div>

        <p style={{ color: C.textDim }} className="text-xs mt-4 text-center opacity-70">
          Educational decision support only. This dashboard explains evidence; it does not execute trades or issue guaranteed signals.
        </p>
      </div>
    </main>
  );
}

function normalizeMt5Charts(input: Record<string, unknown>): Record<string, ChartRead> {
  const next: Record<string, ChartRead> = {};

  if (typeof input.instrument === "string" && isInstrumentKey(input.instrument)) {
    const key = input.instrument;
    next[key] = normalizeMt5Snapshot(key, input);
    return next;
  }

  for (const [key, value] of Object.entries(input)) {
    if (!isInstrumentKey(key) || !value || typeof value !== "object") continue;
    next[key] = normalizeMt5Snapshot(key, value as Record<string, unknown>);
  }
  return next;
}

function normalizeMt5Snapshot(key: ChartRead["instrument"], item: Record<string, unknown>): ChartRead {
  return {
    instrument: key,
    trend: normalizeTrend(item.trend),
    structure: String(item.structure || "range or choppy"),
    volatility: normalizeVolatility(item.volatility),
    support: numberOrString(item.support),
    resistance: numberOrString(item.resistance),
    recentHigh: numberOrString(item.recentHigh ?? item.recent_high),
    recentLow: numberOrString(item.recentLow ?? item.recent_low),
    liquidityZones: typeof item.liquidityZones === "string" ? item.liquidityZones : typeof item.liquidity_zones === "string" ? item.liquidity_zones : "",
    notes: typeof item.notes === "string" ? item.notes : "Imported from MT5.",
    price: typeof item.price === "number" ? item.price : null,
    timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined,
    source: "MT5",
    confidence: 3,
  };
}

function mergeMt5Snapshots(
  current: Record<string, ChartRead>,
  imported: Record<string, ChartRead>,
): Record<string, ChartRead> {
  let changed = false;
  const next = { ...current };
  for (const [key, snapshot] of Object.entries(imported)) {
    if (!sameSnapshot(current[key], snapshot)) {
      next[key] = snapshot;
      changed = true;
    }
  }
  return changed ? next : current;
}

function sameSnapshot(left: ChartRead | undefined, right: ChartRead) {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function normalizeTrend(value: unknown): ChartRead["trend"] {
  return value === "up" || value === "down" || value === "sideways" ? value : "sideways";
}

function normalizeVolatility(value: unknown): ChartRead["volatility"] {
  return value === "calm" || value === "normal" || value === "aggressive" ? value : "normal";
}

function numberOrString(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}
