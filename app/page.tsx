"use client";

import { AlertCircle, CalendarDays, Database, Newspaper, RefreshCw, Settings, SlidersHorizontal, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MetricChip from "@/components/common/MetricChip";
import InstrumentCard from "@/components/instruments/InstrumentCard";
import UsMacroContext from "@/components/macro/UsMacroContext";
import { INSTRUMENTS, isInstrumentKey, STATIC_DRIVERS, type InstrumentKey, type InstrumentMeta } from "@/lib/market-analysis/instruments";
import type { MarketBriefRequest, MarketBriefResponse } from "@/lib/ai/marketBrief";
import type { ChartRead, MacroInstrument, MacroScan } from "@/lib/market-analysis/types";
import type { FredMacroSnapshot } from "@/lib/providers/fred";
import { getMarketStatus, type MarketStatus } from "@/lib/scoring/marketStatus";
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
  "liquidity_zones": "Potential stop areas may sit near the recent high and low.",
  "notes": "XAUUSD is holding above recent support with a clear upward H1 structure."
}`;

type View = "dashboard" | "assets" | "calendar" | "news" | "watchlist" | "settings";
type DetailTab = "overview" | "technicals" | "macro" | "news" | "calendar" | "flows" | "notes";
type DataStatus = "Live" | "Delayed" | "Partial" | "No Data" | "Unavailable";
type SourceCardModel = {
  id: string;
  name: string;
  status: DataStatus;
  reason: string;
  lastUpdate: string;
  feeds: string[];
  helpText: string;
};

type InstrumentSummary = {
  meta: InstrumentMeta;
  macro?: MacroInstrument;
  mt5?: ChartRead;
  marketStatus: MarketStatus;
  dataStatus: { status: DataStatus; reason: string };
  bias: string;
  signalClarity: "High" | "Medium" | "Low" | "No Signal";
  riskMode: string;
};

const NAV_ITEMS: Array<{ id: View; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "assets", label: "Assets" },
  { id: "calendar", label: "Calendar" },
  { id: "news", label: "News" },
  { id: "watchlist", label: "Watchlist" },
  { id: "settings", label: "Settings" },
];

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "technicals", label: "Technicals" },
  { id: "macro", label: "Macro" },
  { id: "news", label: "News" },
  { id: "calendar", label: "Calendar" },
  { id: "flows", label: "Flows" },
  { id: "notes", label: "Notes" },
];

export default function TradingIntelligenceDashboard() {
  const [scan, setScan] = useState<MacroScan | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mt5Snapshots, setMt5Snapshots] = useState<Record<string, ChartRead>>({});
  const [mt5Text, setMt5Text] = useState("");
  const [mt5Status, setMt5Status] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mt5Loading, setMt5Loading] = useState(false);
  const [fredSnapshot, setFredSnapshot] = useState<FredMacroSnapshot | null>(null);
  const [fredLoading, setFredLoading] = useState(false);
  const [fredError, setFredError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentKey>("XAUUSD");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [marketBriefs, setMarketBriefs] = useState<Record<string, MarketBriefResponse | null>>({});
  const [briefLoading, setBriefLoading] = useState<Record<string, boolean>>({});
  const briefInFlight = useRef<Set<string>>(new Set());
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scan: next.scan || null, mt5Snapshots: next.mt5Snapshots || {} }));
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
          if (nextSnapshots === current) return current;
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
      } catch {
        if (showStatus) {
          setMt5Status({ ok: false, msg: "Could not fetch latest MT5 data. Check MT5 settings or try again." });
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

  useEffect(() => {
    let cancelled = false;
    async function fetchFredMacro() {
      setFredLoading(true);
      setFredError(null);
      try {
        const response = await fetch("/api/macro/fred", { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        setFredSnapshot(data);
        if (!response.ok) setFredError(data.error || "Could not fetch macro data from FRED. Check Data Settings or try again.");
      } catch {
        if (!cancelled) setFredError("Could not fetch macro data from FRED. Check Data Settings or try again.");
      } finally {
        if (!cancelled) setFredLoading(false);
      }
    }
    fetchFredMacro();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const summaries = useMemo(
    () =>
      INSTRUMENTS.map((meta) => {
        const macro = scan?.instruments?.find((instrument) => instrument.key === meta.key);
        const mt5 = mt5Snapshots[meta.key];
        const marketStatus = getMarketStatus(macro, mt5);
        return {
          meta,
          macro,
          mt5,
          marketStatus,
          dataStatus: getInstrumentDataStatus(mt5, fredSnapshot, fredError),
          bias: getBiasLabel(macro, mt5),
          signalClarity: getSignalClarity(marketStatus),
          riskMode: getRiskMode(scan, fredSnapshot),
        };
      }),
    [fredError, fredSnapshot, mt5Snapshots, scan],
  );

  const selectedSummary = summaries.find((summary) => summary.meta.key === selectedInstrument) || summaries[0];
  const topWatch = summaries.find((summary) => summary.signalClarity === "High") || summaries.find((summary) => summary.mt5) || summaries[0];
  const sourceCards = buildSourceCards(mt5Snapshots, fredSnapshot, fredError, fredLoading);

  const explainXauusd = useCallback(async () => {
    const summary = summaries.find((item) => item.meta.key === "XAUUSD");
    if (!summary) return;
    const payload = buildMarketBriefPayload(summary, fredSnapshot);
    if (!payload) {
      setMarketBriefs((current) => ({
        ...current,
        XAUUSD: buildClientFallbackBrief("AI explanation unavailable. Rule-based market context is still available."),
      }));
      return;
    }
    const key = JSON.stringify(payload);
    if (briefInFlight.current.has(key)) return;
    briefInFlight.current.add(key);
    setBriefLoading((current) => ({ ...current, XAUUSD: true }));
    try {
      const response = await fetch("/api/analysis/market-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI explanation unavailable.");
      setMarketBriefs((current) => ({ ...current, XAUUSD: data }));
    } catch {
      setMarketBriefs((current) => ({
        ...current,
        XAUUSD: buildClientFallbackBrief("AI explanation unavailable. Rule-based market context is still available."),
      }));
    } finally {
      briefInFlight.current.delete(key);
      setBriefLoading((current) => ({ ...current, XAUUSD: false }));
    }
  }, [fredSnapshot, summaries]);

  return (
    <main style={{ background: C.bg, minHeight: "100vh" }} className="w-full font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-5 sm:py-8">
        <header className="mb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h1 style={{ color: C.text }} className="font-serif text-2xl sm:text-3xl tracking-tight">
                AI Trading Intelligence Platform
              </h1>
              <p style={{ color: C.textDim }} className="text-sm mt-1">
                A beginner-friendly market scanner using MT5 data, macro context, and plain-English education. No auto-trading.
              </p>
            </div>
          </div>
          <nav style={{ background: C.surface, border: `1px solid ${C.line}` }} className="sticky top-0 z-10 rounded-lg p-1 flex gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                style={{
                  background: activeView === item.id ? C.surfaceRaised : "transparent",
                  color: activeView === item.id ? C.gold : C.textDim,
                }}
                className="px-3 py-2 rounded-md text-sm whitespace-nowrap"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        {error && (
          <div style={{ background: "#2A1620", border: `1px solid ${C.fall}`, color: C.fall }} className="rounded-md px-4 py-3 mb-5 flex items-center gap-2 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {activeView === "dashboard" && (
          <DashboardView
            scan={scan}
            summaries={summaries}
            topWatch={topWatch}
            sourceCards={sourceCards}
            mt5Loading={mt5Loading}
            macroLoading={macroLoading}
            mt5Status={mt5Status}
            marketBriefs={marketBriefs}
            briefLoading={briefLoading}
            onFetchMt5={() => fetchLatestMt5(true)}
            onRunScan={runScan}
            onExplainXauusd={explainXauusd}
            onOpenInstrument={(key) => {
              setSelectedInstrument(key);
              setDetailTab("overview");
              setActiveView("assets");
            }}
          />
        )}

        {activeView === "assets" && selectedSummary && (
          <AssetsView
            summaries={summaries}
            selected={selectedSummary}
            detailTab={detailTab}
            fredSnapshot={fredSnapshot}
            fredLoading={fredLoading}
            fredError={fredError}
            marketBrief={selectedSummary.meta.key === "XAUUSD" ? marketBriefs.XAUUSD : undefined}
            briefLoading={Boolean(briefLoading[selectedSummary.meta.key])}
            onExplainXauusd={explainXauusd}
            onSelect={(key) => {
              setSelectedInstrument(key);
              setDetailTab("overview");
            }}
            onChangeTab={setDetailTab}
          />
        )}

        {activeView === "calendar" && <CalendarView summaries={summaries} onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView)} />}
        {activeView === "news" && <NewsView summaries={summaries} onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView)} />}
        {activeView === "watchlist" && <WatchlistView summaries={summaries} onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView)} />}
        {activeView === "settings" && (
          <SettingsView
            sourceCards={sourceCards}
            mt5Text={mt5Text}
            setMt5Text={setMt5Text}
            importMt5Data={importMt5Data}
            mt5Status={mt5Status}
            summaries={summaries}
          />
        )}

        <p style={{ color: C.textDim }} className="text-xs mt-8 text-center opacity-70">
          Educational decision support only. This dashboard explains evidence; it does not execute trades or issue guaranteed signals.
        </p>
      </div>
    </main>
  );
}

function DashboardView({
  scan,
  summaries,
  topWatch,
  sourceCards,
  mt5Loading,
  macroLoading,
  mt5Status,
  marketBriefs,
  briefLoading,
  onFetchMt5,
  onRunScan,
  onExplainXauusd,
  onOpenInstrument,
}: {
  scan: MacroScan | null;
  summaries: InstrumentSummary[];
  topWatch: InstrumentSummary;
  sourceCards: SourceCardModel[];
  mt5Loading: boolean;
  macroLoading: boolean;
  mt5Status: { ok: boolean; msg: string } | null;
  marketBriefs: Record<string, MarketBriefResponse | null>;
  briefLoading: Record<string, boolean>;
  onFetchMt5: () => void;
  onRunScan: () => void;
  onExplainXauusd: () => void;
  onOpenInstrument: (key: InstrumentKey) => void;
}) {
  const dataStatus = getOverallSourceStatus(sourceCards);

  return (
    <div className="flex flex-col gap-6">
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <CommandField label="Market Mode" value={getMarketMode(scan)} helper={scan?.usdStrength?.detail || "Load macro context for the current USD read."} />
          <CommandField label="Best Setup" value={topWatch?.meta.label || "-"} helper={topWatch ? `${topWatch.bias} · ${topWatch.signalClarity} clarity` : "No setup ranked yet."} />
          <CommandField label="Main Driver" value={topWatch?.macro?.driver || STATIC_DRIVERS[topWatch?.meta.key || "XAUUSD"]} />
          <CommandField label="Next Event" value={getNextEvent(summaries)} />
          <CommandField label="Data Status" value={formatSourceStatus(dataStatus.status, dataStatus.reason)} color={statusColor(dataStatus.status)} />
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button type="button" onClick={onFetchMt5} disabled={mt5Loading} style={{ background: C.gold, color: C.bg }} className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50">
            <Database size={15} />
            {mt5Loading ? "Fetching..." : "Fetch Latest MT5 Data"}
          </button>
          <button type="button" onClick={onRunScan} disabled={macroLoading} style={{ color: C.gold, borderColor: C.gold }} className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm disabled:opacity-50">
            <RefreshCw size={15} className={macroLoading ? "animate-spin" : ""} />
            {macroLoading ? "Refreshing..." : "Load macro context"}
          </button>
          <span style={{ color: C.textDim }} className="text-xs">
            Signal Clarity is not trade certainty. It reflects how aligned or contradictory the available evidence appears.
          </span>
        </div>
        {mt5Status && (
          <p style={{ color: mt5Status.ok ? C.rise : C.fall }} className="text-xs mt-3">
            {mt5Status.msg}
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 style={{ color: C.text }} className="font-serif text-xl">
            Market Scanner
          </h2>
          <span style={{ color: C.textDim }} className="text-xs">
            What should I pay attention to?
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {summaries.map((summary) => (
            <AssetSummaryCard
              key={summary.meta.key}
              summary={summary}
              marketBrief={summary.meta.key === "XAUUSD" ? marketBriefs.XAUUSD : undefined}
              briefLoading={Boolean(briefLoading[summary.meta.key])}
              onExplain={summary.meta.key === "XAUUSD" ? onExplainXauusd : undefined}
              onOpen={() => onOpenInstrument(summary.meta.key)}
            />
          ))}
        </div>
      </section>

      <details className="md:hidden rounded-lg p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <summary style={{ color: C.gold }} className="cursor-pointer text-sm uppercase font-mono">
          Secondary context
        </summary>
        <p style={{ color: C.textDim }} className="text-sm mt-3">
          Open an instrument for news, calendar, flows, full status reasons, and beginner explanations.
        </p>
      </details>
    </div>
  );
}

function AssetsView({
  summaries,
  selected,
  detailTab,
  fredSnapshot,
  fredLoading,
  fredError,
  marketBrief,
  briefLoading,
  onExplainXauusd,
  onSelect,
  onChangeTab,
}: {
  summaries: InstrumentSummary[];
  selected: InstrumentSummary;
  detailTab: DetailTab;
  fredSnapshot: FredMacroSnapshot | null;
  fredLoading: boolean;
  fredError: string | null;
  marketBrief?: MarketBriefResponse | null;
  briefLoading: boolean;
  onExplainXauusd: () => void;
  onSelect: (key: InstrumentKey) => void;
  onChangeTab: (tab: DetailTab) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      <aside style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-3 h-fit">
        <h2 style={{ color: C.text }} className="font-serif text-lg mb-3">
          Assets
        </h2>
        <div className="flex lg:flex-col gap-2 overflow-x-auto">
          {summaries.map((summary) => (
            <button
              key={summary.meta.key}
              type="button"
              onClick={() => onSelect(summary.meta.key)}
              style={{ background: selected.meta.key === summary.meta.key ? C.surfaceRaised : "transparent", borderColor: selected.meta.key === summary.meta.key ? C.gold : C.line }}
              className="border rounded-md p-3 text-left min-w-[180px] lg:min-w-0"
            >
              <div style={{ color: C.text }} className="font-medium">
                {summary.meta.label}
              </div>
              <div style={{ color: C.textDim }} className="text-xs">
                {summary.bias} · {summary.signalClarity}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <InstrumentDetail
        summary={selected}
        detailTab={detailTab}
        onChangeTab={onChangeTab}
        fredSnapshot={fredSnapshot}
        fredLoading={fredLoading}
        fredError={fredError}
        marketBrief={marketBrief}
        briefLoading={briefLoading}
        onExplainXauusd={onExplainXauusd}
      />
    </div>
  );
}

function InstrumentDetail({
  summary,
  detailTab,
  onChangeTab,
  fredSnapshot,
  fredLoading,
  fredError,
  marketBrief,
  briefLoading,
  onExplainXauusd,
}: {
  summary: InstrumentSummary;
  detailTab: DetailTab;
  onChangeTab: (tab: DetailTab) => void;
  fredSnapshot: FredMacroSnapshot | null;
  fredLoading: boolean;
  fredError: string | null;
  marketBrief?: MarketBriefResponse | null;
  briefLoading: boolean;
  onExplainXauusd: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 style={{ color: C.text }} className="font-serif text-2xl">
              {summary.meta.label}
            </h2>
            <p style={{ color: C.textDim }} className="text-sm">
              {summary.meta.name}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge label={summary.bias} color={biasColor(summary.bias)} />
            <Badge label={`${summary.signalClarity} clarity`} color={clarityColor(summary.signalClarity)} />
            <Badge label={summary.riskMode} color={riskColor(summary.riskMode)} />
            <Badge label={formatSourceStatus(summary.dataStatus.status, summary.dataStatus.reason)} color={statusColor(summary.dataStatus.status)} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Field label="Current price" value={formatLevel(summary.mt5?.price)} />
          <Field label="Last updated" value={formatTimestamp(summary.mt5?.createdAt)} />
          <Field label="Macro bias" value={summary.macro?.macroBias || summary.macro?.bias || "neutral"} />
          <Field label="Chart bias" value={summary.mt5?.trend === "up" ? "bullish" : summary.mt5?.trend === "down" ? "bearish" : "neutral"} />
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-1 flex gap-1 overflow-x-auto">
        {DETAIL_TABS.map((tab) => (
          <button key={tab.id} type="button" onClick={() => onChangeTab(tab.id)} style={{ background: detailTab === tab.id ? C.surfaceRaised : "transparent", color: detailTab === tab.id ? C.gold : C.textDim }} className="px-3 py-2 rounded-md text-sm whitespace-nowrap">
            {tab.label}
          </button>
        ))}
      </div>

      {detailTab === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <InstrumentCard instMeta={summary.meta} macro={summary.macro} mt5={summary.mt5} />
          <div className="flex flex-col gap-4">
            <InfoPanel title="Current Read" text={summary.marketStatus.plainEnglish} />
            <InfoPanel title="Why It Matters" text={summary.macro?.driver || STATIC_DRIVERS[summary.meta.key]} />
            <InfoPanel title="What To Watch" text={summary.macro?.likelyScenario || "Use the MT5 snapshot to understand current structure. This app does not issue trade instructions."} />
            <InfoPanel title="Data Quality" text={formatSourceStatus(summary.dataStatus.status, summary.dataStatus.reason)} />
            {summary.meta.key === "XAUUSD" && <AiMarketExplanation brief={marketBrief} loading={briefLoading} disabled={!summary.mt5?.price} onExplain={onExplainXauusd} />}
          </div>
        </div>
      )}

      {detailTab === "technicals" && <TechnicalsPanel summary={summary} />}
      {detailTab === "macro" && <MacroPanel summary={summary} fredSnapshot={fredSnapshot} fredLoading={fredLoading} fredError={fredError} />}
      {detailTab === "news" && <EmptyPanel icon={<Newspaper size={16} />} title="News" text={summary.macro?.newsRisk?.detail || "No relevant news found. No market-moving headlines detected for this instrument yet."} />}
      {detailTab === "calendar" && <EmptyPanel icon={<CalendarDays size={16} />} title="Calendar" text={summary.macro?.newsRisk?.detail || "No major events today. There are no high-impact events currently scheduled for this instrument."} />}
      {detailTab === "flows" && <EmptyPanel icon={<SlidersHorizontal size={16} />} title="Flows" text="Capital flow data unavailable. Flow data may be delayed or unsupported for this asset." />}
      {detailTab === "notes" && <EmptyPanel icon={<Star size={16} />} title="Notes" text="Analysis unavailable. There is not enough reliable data to generate a useful interpretation beyond the current MT5 and macro context." />}
    </section>
  );
}

function TechnicalsPanel({ summary }: { summary: InstrumentSummary }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
      <h3 style={{ color: C.text }} className="font-serif text-xl mb-4">
        Technicals
      </h3>
      {!summary.mt5 ? (
        <EmptyState text="No price data yet. Waiting for live candles for this instrument." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="Trend state" value={summary.mt5.trend || "-"} />
          <Field label="Momentum / structure" value={summary.mt5.structure || "-"} />
          <Field label="Nearest swing support" value={formatLevel(summary.mt5.support)} />
          <Field label="Nearest swing resistance" value={formatLevel(summary.mt5.resistance)} />
          <Field label="Recent high" value={formatLevel(summary.mt5.recentHigh)} />
          <Field label="Recent low" value={formatLevel(summary.mt5.recentLow)} />
          <div className="md:col-span-2">
            <Field label="MT5 market snapshot" value={summary.mt5.notes || "Snapshot imported from MT5."} />
          </div>
        </div>
      )}
    </section>
  );
}

function MacroPanel({ summary, fredSnapshot, fredLoading, fredError }: { summary: InstrumentSummary; fredSnapshot: FredMacroSnapshot | null; fredLoading: boolean; fredError: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <UsMacroContext snapshot={fredSnapshot} loading={fredLoading} error={fredError} />
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-3">
          Relevant Macro Drivers
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricChip label="USD strength" value="Shown through macro scan and FRED context when available." explainId="usdStrength" />
          <MetricChip label="Rates expectations" value="Shown through FRED rates/yields and macro scan context." explainId="rateExpectations" />
          <MetricChip label="Risk mood" value={summary.riskMode} explainId="newsRisk" />
          <MetricChip label="Safe-haven demand" value={summary.meta.group === "metal" ? "Relevant for metals. Read with USD and real yields." : "Secondary for this instrument."} explainId="marketStructure" />
        </div>
        <p style={{ color: C.textDim }} className="text-xs mt-3">
          Macro figures shown here are via FRED and the existing macro scan. They are context, not execution instructions.
        </p>
      </section>
    </div>
  );
}

function CalendarView({ summaries, onOpen }: { summaries: InstrumentSummary[]; onOpen: (key: InstrumentKey) => void }) {
  return (
    <RollupPage
      icon={<CalendarDays size={18} />}
      title="Calendar"
      subtitle="What can move the market?"
      summaries={summaries}
      emptyText="Calendar events are shown per instrument for now. Open an instrument to see upcoming events and why they matter."
      getText={(summary) => summary.macro?.newsRisk?.detail || "No major events today. There are no high-impact events currently scheduled for this instrument."}
      onOpen={onOpen}
    />
  );
}

function NewsView({ summaries, onOpen }: { summaries: InstrumentSummary[]; onOpen: (key: InstrumentKey) => void }) {
  return (
    <RollupPage
      icon={<Newspaper size={18} />}
      title="News"
      subtitle="What changed?"
      summaries={summaries}
      emptyText="News is shown per instrument for now. Open full analysis to see the current plain-English interpretation."
      getText={(summary) => summary.macro?.newsRisk?.detail || "No relevant news found. No market-moving headlines detected for this instrument yet."}
      onOpen={onOpen}
    />
  );
}

function WatchlistView({ summaries, onOpen }: { summaries: InstrumentSummary[]; onOpen: (key: InstrumentKey) => void }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 style={{ color: C.text }} className="font-serif text-2xl">
            Watchlist
          </h2>
          <p style={{ color: C.textDim }} className="text-sm">
            Your current tracked instruments. Add/remove controls live in Settings → Watchlist Manager.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {summaries.map((summary) => (
          <AssetSummaryCard key={summary.meta.key} summary={summary} onOpen={() => onOpen(summary.meta.key)} />
        ))}
      </div>
    </section>
  );
}

function SettingsView({
  sourceCards,
  mt5Text,
  setMt5Text,
  importMt5Data,
  mt5Status,
  summaries,
}: {
  sourceCards: SourceCardModel[];
  mt5Text: string;
  setMt5Text: (value: string) => void;
  importMt5Data: () => void;
  mt5Status: { ok: boolean; msg: string } | null;
  summaries: InstrumentSummary[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <PageHeading icon={<Settings size={18} />} title="Settings" subtitle="What do I control?" />
      </section>
      <section>
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-3">
          Data Settings
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {sourceCards.map((source) => (
            <SourceCard key={source.id} source={source}>
              {source.id === "mt5" && (
                <div className="mt-3 flex flex-col gap-2">
                  <label style={{ color: C.gold }} className="text-xs uppercase font-mono">
                    Paste MT5 JSON
                  </label>
                  <textarea value={mt5Text} onChange={(event) => setMt5Text(event.target.value)} placeholder={MT5_EXAMPLE} rows={8} style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} className="w-full rounded-md p-3 text-xs font-mono" />
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={importMt5Data} style={{ background: C.gold, color: C.bg }} className="text-sm rounded-md px-4 py-2 font-medium">
                      Validate JSON and Save/Import
                    </button>
                  </div>
                  {mt5Status && (
                    <p style={{ color: mt5Status.ok ? C.rise : C.fall }} className="text-xs">
                      {mt5Status.msg}
                    </p>
                  )}
                </div>
              )}
            </SourceCard>
          ))}
        </div>
      </section>
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-2">
          Prompt Settings
        </h3>
        <p style={{ color: C.textDim }} className="text-sm">
          Prompt settings are unchanged in this UX pass. Macro context can be refreshed from the Market Command Bar.
        </p>
      </section>
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-2">
          Watchlist Manager
        </h3>
        <p style={{ color: C.textDim }} className="text-sm mb-3">
          These five instruments are currently tracked. Add/remove and reorder controls belong here when new instruments are wired.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {summaries.map((summary, index) => (
            <Field key={summary.meta.key} label={`Slot ${index + 1}`} value={`${summary.meta.label} · ${summary.meta.name}`} />
          ))}
        </div>
      </section>
    </div>
  );
}

function AssetSummaryCard({
  summary,
  marketBrief,
  briefLoading,
  onExplain,
  onOpen,
}: {
  summary: InstrumentSummary;
  marketBrief?: MarketBriefResponse | null;
  briefLoading?: boolean;
  onExplain?: () => void;
  onOpen: () => void;
}) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4 text-left flex flex-col gap-3 hover:border-[#C9A227] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="text-left">
          <h3 style={{ color: C.text }} className="font-serif text-xl">
            {summary.meta.label}
          </h3>
          <p style={{ color: C.textDim }} className="text-xs">
            {summary.meta.name}
          </p>
        </button>
        <Badge label={summary.bias} color={biasColor(summary.bias)} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Price" value={formatLevel(summary.mt5?.price)} />
        <Field label="Signal Clarity" value={summary.signalClarity} color={clarityColor(summary.signalClarity)} />
        <Field label="Main Driver" value={summary.macro?.driver || STATIC_DRIVERS[summary.meta.key]} />
        <Field label="Next Risk/Event" value={summary.macro?.newsRisk?.detail || "No major events today."} />
      </div>
      <Badge label={formatSourceStatus(summary.dataStatus.status, summary.dataStatus.reason)} color={statusColor(summary.dataStatus.status)} />
      <p style={{ color: C.textDim }} className="text-sm leading-relaxed">
        {summary.marketStatus.status === "no_data" ? "No data available yet. This section will update when market data is received. Other sections may still be available." : summary.marketStatus.plainEnglish}
      </p>
      {summary.meta.key === "XAUUSD" && <AiMarketExplanation brief={marketBrief} loading={Boolean(briefLoading)} compact disabled={!summary.mt5?.price} onExplain={onExplain} />}
      <button type="button" onClick={onOpen} style={{ color: C.gold }} className="text-sm font-medium self-start">
        Open Full Analysis
      </button>
    </div>
  );
}

function AiMarketExplanation({
  brief,
  loading,
  compact,
  disabled,
  onExplain,
}: {
  brief?: MarketBriefResponse | null;
  loading: boolean;
  compact?: boolean;
  disabled?: boolean;
  onExplain?: () => void;
}) {
  return (
    <section style={{ background: compact ? C.bg : C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 style={{ color: C.text }} className="font-serif text-base">
          AI Market Explanation
        </h4>
        <button
          type="button"
          onClick={onExplain}
          disabled={loading || disabled || !onExplain}
          style={{ color: disabled ? C.neutral : C.gold, borderColor: disabled ? C.neutral : C.gold }}
          className="text-xs border rounded px-2 py-1 disabled:opacity-60"
        >
          {loading ? "Explaining..." : "Explain current conditions"}
        </button>
      </div>
      {disabled && (
        <p style={{ color: C.textDim }} className="text-xs">
          Waiting for MT5 facts before requesting an AI explanation.
        </p>
      )}
      {brief?.brief ? (
        <div style={{ color: C.textDim }} className="text-sm leading-relaxed flex flex-col gap-2">
          <p>
            <span style={{ color: C.text }}>{brief.brief.headline}</span>
          </p>
          <p>{brief.brief.whatIsHappening}</p>
          {!compact && <p>{brief.brief.whyItMatters}</p>}
          <FactorList title="Supportive evidence" items={brief.brief.supportiveEvidence} color={C.rise} />
          <FactorList title="Restrictive evidence" items={brief.brief.restrictiveEvidence} color={C.fall} />
          <FactorList title="Conflicting evidence" items={brief.brief.conflictingEvidence} color={C.neutral} />
          {!compact && (
            <>
              <p>
                <span style={{ color: C.text }}>What to watch next: </span>
                {brief.brief.whatToWatchNext.length ? brief.brief.whatToWatchNext.join("; ") : "No additional watch items."}
              </p>
              <p>
                <span style={{ color: C.text }}>Beginner explanation: </span>
                {brief.brief.beginnerExplanation}
              </p>
            </>
          )}
        </div>
      ) : (
        <p style={{ color: C.textDim }} className="text-xs">
          AI explanation unavailable. Rule-based market context is still available.
        </p>
      )}
    </section>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <p>
      <span style={{ color }}>{title}: </span>
      {items.join("; ")}
    </p>
  );
}

function RollupPage({ icon, title, subtitle, summaries, emptyText, getText, onOpen }: { icon: React.ReactNode; title: string; subtitle: string; summaries: InstrumentSummary[]; emptyText: string; getText: (summary: InstrumentSummary) => string; onOpen: (key: InstrumentKey) => void }) {
  return (
    <section>
      <PageHeading icon={icon} title={title} subtitle={subtitle} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {summaries.map((summary) => (
          <div key={summary.meta.key} style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h3 style={{ color: C.text }} className="font-serif text-lg">
                  {summary.meta.label}
                </h3>
                <p style={{ color: C.textDim }} className="text-xs">
                  {summary.meta.name}
                </p>
              </div>
              <Badge label={summary.macro?.newsRisk?.level ? `${summary.macro.newsRisk.level} risk` : "Low Impact"} color={summary.macro?.newsRisk?.level === "imminent" ? C.fall : summary.macro?.newsRisk?.level === "soon" ? C.amber : C.neutral} />
            </div>
            <p style={{ color: C.textDim }} className="text-sm mb-3">
              {getText(summary) || emptyText}
            </p>
            <button type="button" onClick={() => onOpen(summary.meta.key)} style={{ color: C.gold }} className="text-sm font-medium">
              Open Full Analysis
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceCard({ source, children }: { source: SourceCardModel; children?: React.ReactNode }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 style={{ color: C.text }} className="font-serif text-lg">
            {source.name}
          </h4>
          <p style={{ color: C.textDim }} className="text-xs">
            {source.helpText}
          </p>
        </div>
        <Badge label={formatSourceStatus(source.status, source.reason)} color={statusColor(source.status)} />
      </div>
      <div className="flex flex-col gap-2 text-xs">
        <Field label="Last successful update" value={source.lastUpdate} />
        <Field label="Feeds" value={source.feeds.join(", ")} />
      </div>
      {children}
    </section>
  );
}

function CommandField({ label, value, helper, color }: { label: string; value: string; helper?: string; color?: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded-md p-3 min-h-[94px]">
      <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
        {label}
      </div>
      <div style={{ color: color || C.text }} className="text-sm font-medium leading-snug line-clamp-3">
        {value || "-"}
      </div>
      {helper && (
        <div style={{ color: C.textDim }} className="text-xs mt-1 line-clamp-2">
          {helper}
        </div>
      )}
    </div>
  );
}

function InfoPanel({ title, text }: { title: string; text: string }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4">
      <h3 style={{ color: C.gold }} className="uppercase font-mono text-xs mb-2">
        {title}
      </h3>
      <p style={{ color: C.textDim }} className="text-sm leading-relaxed">
        {text}
      </p>
    </section>
  );
}

function EmptyPanel({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
      <div className="flex items-center gap-2 mb-2" style={{ color: C.gold }}>
        {icon}
        <h3 className="font-serif text-xl" style={{ color: C.text }}>
          {title}
        </h3>
      </div>
      <EmptyState text={text} />
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ color: C.textDim, border: `1px dashed ${C.line}` }} className="rounded p-4 text-sm">
      {text}
    </div>
  );
}

function PageHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span style={{ color: C.gold }}>{icon}</span>
      <div>
        <h2 style={{ color: C.text }} className="font-serif text-2xl">
          {title}
        </h2>
        <p style={{ color: C.textDim }} className="text-sm">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-2">
      <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
        {label}
      </div>
      <div style={{ color: color || C.textDim }} className="line-clamp-3">
        {value || "-"}
      </div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ color, borderColor: color }} className="text-xs uppercase tracking-wide border rounded px-2 py-1 font-semibold self-start">
      {label}
    </span>
  );
}

function openInstrument(key: InstrumentKey, setSelectedInstrument: (key: InstrumentKey) => void, setDetailTab: (tab: DetailTab) => void, setActiveView: (view: View) => void) {
  setSelectedInstrument(key);
  setDetailTab("overview");
  setActiveView("assets");
}

function buildMarketBriefPayload(summary: InstrumentSummary, fredSnapshot: FredMacroSnapshot | null): MarketBriefRequest | null {
  if (summary.meta.key !== "XAUUSD" || !summary.mt5 || typeof summary.mt5.price !== "number") return null;
  const xauFred = fredSnapshot?.summary.xauusd;
  return {
    instrument: "XAUUSD",
    mt5: {
      price: summary.mt5.price,
      trend: summary.mt5.trend || "sideways",
      structure: summary.mt5.structure || "range or choppy",
      volatility: summary.mt5.volatility || "normal",
      support: numberOrNull(summary.mt5.support),
      resistance: numberOrNull(summary.mt5.resistance),
      recentHigh: numberOrNull(summary.mt5.recentHigh),
      recentLow: numberOrNull(summary.mt5.recentLow),
      atr: summary.mt5.atr ?? null,
      timestamp: summary.mt5.timestamp || "",
      createdAt: summary.mt5.createdAt || "",
    },
    fred: {
      usdBackdrop: xauFred?.usdBackdrop || "unknown",
      goldBackdrop: fredSnapshot?.summary.goldBackdrop || "unknown",
      nominalYieldDirection: xauFred?.nominalYieldDirection || "unknown",
      realYieldDirection: xauFred?.realYieldDirection || "unknown",
      inflationExpectationDirection: xauFred?.inflationExpectationDirection || "unknown",
      riskMood: xauFred?.riskMood || "unknown",
      supportiveFactors: xauFred?.supportiveFactors || [],
      restrictiveFactors: xauFred?.restrictiveFactors || [],
      ambiguousFactors: xauFred?.ambiguousFactors || [],
      delayedFactors: xauFred?.delayedFactors || [],
    },
    marketStatus: {
      status: summary.marketStatus.status,
      positiveFactors: summary.marketStatus.positiveFactors,
      cautionFactors: summary.marketStatus.cautionFactors,
      blockingRisks: summary.marketStatus.blockingRisks,
      plainEnglish: summary.marketStatus.plainEnglish,
    },
  };
}

function buildClientFallbackBrief(message: string): MarketBriefResponse {
  return {
    ok: false,
    fallback: true,
    cached: false,
    model: "fallback",
    brief: {
      headline: message,
      whatIsHappening: message,
      whyItMatters: "The deterministic MT5, FRED, and market-status context remains available.",
      supportiveEvidence: [],
      restrictiveEvidence: [],
      conflictingEvidence: [],
      keyLevels: {
        nearestSupport: "Unavailable in AI fallback.",
        nearestResistance: "Unavailable in AI fallback.",
        invalidationContext: "Use the rule-based key levels and market-status context.",
      },
      riskSummary: "Rule-based market context is still available.",
      beginnerExplanation: message,
      whatToWatchNext: ["Review MT5 structure.", "Review FRED macro context.", "Refresh the explanation later."],
      limitations: [message],
    },
  };
}

function buildSourceCards(mt5Snapshots: Record<string, ChartRead>, fredSnapshot: FredMacroSnapshot | null, fredError: string | null, fredLoading: boolean): SourceCardModel[] {
  const mt5Symbols = Object.keys(mt5Snapshots);
  const latestMt5 = latestDate(mt5Symbols.map((key) => mt5Snapshots[key]?.createdAt));
  const fredFreshness = Object.values(fredSnapshot?.metrics || {}).map((metric) => metric.freshness);
  const fredStatus = fredError ? "Unavailable" : fredLoading ? "Delayed" : fredFreshness.includes("stale") ? "Delayed" : fredFreshness.includes("delayed") ? "Partial" : fredSnapshot ? "Live" : "No Data";

  return [
    {
      id: "mt5",
      name: "MT5",
      status: mt5Symbols.length ? getFreshnessStatus(latestMt5) : "No Data",
      reason: mt5Symbols.length ? (getFreshnessStatus(latestMt5) === "Live" ? "MT5 active" : "MT5 delayed") : "Waiting for MT5 or price provider",
      lastUpdate: formatTimestamp(latestMt5),
      feeds: mt5Symbols.length ? mt5Symbols : ["Manual JSON fallback", "MT5 bridge"],
      helpText: mt5Symbols.length ? "MT5 bridge and manual JSON source for chart structure." : "MT5 data source not configured. Add or validate the MT5 JSON source here.",
    },
    {
      id: "fred",
      name: "FRED Macro",
      status: fredStatus,
      reason: fredError ? "FRED unavailable" : fredStatus === "Live" ? "FRED active" : fredStatus === "Partial" ? "FRED delayed" : "FRED loading",
      lastUpdate: fredSnapshot?.asOf ? formatTimestamp(fredSnapshot.asOf) : "-",
      feeds: ["USD strength", "rates", "yields", "risk mood", "inflation", "labor"],
      helpText: fredError || "Macro context from FRED. This is not a real-time news source.",
    },
    {
      id: "price-provider",
      name: "Price Provider",
      status: "Unavailable",
      reason: "Price provider not connected",
      lastUpdate: "-",
      feeds: ["Live prices", "future forex/crypto support"],
      helpText: "Could not fetch live price data. Check Data Settings or try again.",
    },
  ];
}

function getInstrumentDataStatus(mt5: ChartRead | undefined, fredSnapshot: FredMacroSnapshot | null, fredError: string | null): { status: DataStatus; reason: string } {
  if (!mt5) return { status: "No Data", reason: "Waiting for MT5 or price provider" };
  const mt5Freshness = getFreshnessStatus(mt5.createdAt);
  if (mt5Freshness !== "Live") return { status: "Delayed", reason: "MT5 delayed" };
  if (fredError) return { status: "Partial", reason: "FRED unavailable" };
  const fredFreshness = Object.values(fredSnapshot?.metrics || {}).map((metric) => metric.freshness);
  if (fredFreshness.includes("stale") || fredFreshness.includes("delayed")) return { status: "Partial", reason: "FRED delayed" };
  return { status: "Live", reason: "MT5 active" };
}

function getOverallSourceStatus(sources: SourceCardModel[]): { status: DataStatus; reason: string } {
  const blocker = sources.find((source) => source.status === "No Data" || source.status === "Unavailable");
  if (blocker) return { status: "Partial", reason: `${blocker.name} ${blocker.status.toLowerCase()}` };
  const delayed = sources.find((source) => source.status === "Delayed" || source.status === "Partial");
  if (delayed) return { status: delayed.status, reason: delayed.reason };
  return { status: "Live", reason: "all sources active" };
}

function getBiasLabel(macro: MacroInstrument | undefined, mt5: ChartRead | undefined) {
  const macroBias = macro?.macroBias || macro?.bias || "neutral";
  const chartBias = mt5?.trend === "up" ? "bullish" : mt5?.trend === "down" ? "bearish" : "neutral";
  if (!mt5 && macroBias === "neutral") return "Unclear";
  if (macroBias !== "neutral" && chartBias !== "neutral" && macroBias !== chartBias) return "Mixed";
  if (chartBias === "bullish" && mt5?.structure?.includes("range")) return "Bullish Pullback";
  if (chartBias === "bearish" && mt5?.structure?.includes("range")) return "Bearish Pullback";
  if (chartBias === "bullish" || macroBias === "bullish") return "Bullish";
  if (chartBias === "bearish" || macroBias === "bearish") return "Bearish";
  if (macroBias === "mixed") return "Mixed";
  return "Neutral";
}

function getSignalClarity(status: MarketStatus): InstrumentSummary["signalClarity"] {
  if (status.status === "no_data") return "No Signal";
  if (status.blockingRisks.length > 0 || status.score < 45) return "Low";
  if (status.score >= 70 && status.cautionFactors.length === 0) return "High";
  return "Medium";
}

function getRiskMode(scan: MacroScan | null, fredSnapshot: FredMacroSnapshot | null) {
  const riskMood = fredSnapshot?.summary.riskMood || scan?.riskMood?.level || "unknown";
  if (riskMood === "risk-on") return "Risk-On";
  if (riskMood === "risk-off") return "Risk-Off";
  if (riskMood === "mixed") return "Defensive";
  return "Unclear";
}

function getMarketMode(scan: MacroScan | null) {
  const usd = scan?.usdStrength?.level || "neutral";
  const risk = scan?.riskMood?.level || "mixed";
  if (risk === "risk-off") return "Defensive";
  if (risk === "risk-on" && usd === "weak") return "Risk-On";
  if (usd === "strong") return "USD-led";
  return "Mixed";
}

function getNextEvent(summaries: InstrumentSummary[]) {
  return summaries.find((summary) => summary.macro?.newsRisk?.detail)?.macro?.newsRisk?.detail || "No major events today. There are no high-impact events currently scheduled.";
}

function getFreshnessStatus(createdAt: string | undefined): DataStatus {
  if (!createdAt) return "No Data";
  const receivedAt = new Date(createdAt).getTime();
  if (Number.isNaN(receivedAt)) return "No Data";
  const ageMinutes = (Date.now() - receivedAt) / 60_000;
  return ageMinutes <= 15 ? "Live" : "Delayed";
}

function latestDate(values: Array<string | undefined>) {
  return values.filter(Boolean).sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0];
}

function formatSourceStatus(status: DataStatus, reason: string) {
  return `${status} · ${reason}`;
}

function statusColor(status: DataStatus) {
  if (status === "Live") return C.rise;
  if (status === "Delayed" || status === "Partial") return C.amber;
  if (status === "Unavailable") return C.fall;
  return C.neutral;
}

function biasColor(bias: string) {
  if (bias.startsWith("Bullish")) return C.rise;
  if (bias.startsWith("Bearish")) return C.fall;
  if (bias === "Mixed") return C.amber;
  return C.neutral;
}

function clarityColor(clarity: string) {
  if (clarity === "High") return C.rise;
  if (clarity === "Medium") return C.amber;
  if (clarity === "Low") return C.fall;
  return C.neutral;
}

function riskColor(risk: string) {
  if (risk === "Risk-On") return C.rise;
  if (risk === "Risk-Off") return C.fall;
  if (risk === "Defensive") return C.amber;
  return C.neutral;
}

function formatLevel(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "number" ? value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "") : value;
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
    atr: numberOrNull(item.atr ?? item.current_atr ?? item.currentAtr),
    support: numberOrString(item.support),
    resistance: numberOrString(item.resistance),
    recentHigh: numberOrString(item.recentHigh ?? item.recent_high),
    recentLow: numberOrString(item.recentLow ?? item.recent_low),
    liquidityZones: typeof item.liquidityZones === "string" ? item.liquidityZones : typeof item.liquidity_zones === "string" ? item.liquidity_zones : "",
    notes: typeof item.notes === "string" ? item.notes : "Imported from MT5.",
    price: typeof item.price === "number" ? item.price : null,
    timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : typeof item.created_at === "string" ? item.created_at : undefined,
    candleMayBeForming:
      typeof item.candleMayBeForming === "boolean"
        ? item.candleMayBeForming
        : typeof item.candle_may_be_forming === "boolean"
          ? item.candle_may_be_forming
          : undefined,
    volatilityDetail: typeof item.volatilityDetail === "string" ? item.volatilityDetail : typeof item.volatility_detail === "string" ? item.volatility_detail : undefined,
    source: "MT5",
    confidence: 3,
  };
}

function mergeMt5Snapshots(current: Record<string, ChartRead>, imported: Record<string, ChartRead>): Record<string, ChartRead> {
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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
