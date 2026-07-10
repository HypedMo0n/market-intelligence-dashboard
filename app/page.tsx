"use client";

import { AlertCircle, CalendarDays, Database, Heart, Newspaper, RefreshCw, Search, Settings, SlidersHorizontal, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MetricChip from "@/components/common/MetricChip";
import type { BiasMarker, Candle } from "@/components/InstrumentChart";
import InstrumentCard from "@/components/instruments/InstrumentCard";
import UsMacroContext from "@/components/macro/UsMacroContext";
import { getStaticDriver, INSTRUMENTS, isInstrumentKey, type InstrumentKey, type InstrumentMeta } from "@/lib/market-analysis/instruments";
import { buildMacroRefreshFailure, buildMacroRefreshStatus, type MacroRefreshStatus } from "@/lib/market-analysis/macroRefreshStatus";
import { getPrimaryDataProvider, normalizeSymbol } from "@/lib/market-analysis/providerRouting";
import type { MarketBriefRequest, MarketBriefResponse } from "@/lib/ai/marketBrief";
import type { ChartRead, MacroInstrument, MacroScan } from "@/lib/market-analysis/types";
import type { FredMacroSnapshot } from "@/lib/providers/fred";
import { getMarketStatus, type MarketStatus } from "@/lib/scoring/marketStatus";
import { C } from "@/lib/theme";
import { addWatchlistItem, removeWatchlistItem, toggleFavoriteItem } from "@/lib/watchlist/localWatchlist";

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

type View = "dashboard" | "assets" | "calendar" | "news" | "watchlist" | "data-status" | "settings";
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

type AssetSearchResult = {
  symbol: string;
  name: string;
  assetClass: InstrumentMeta["group"];
  provider: "MT5" | "Twelve Data";
};

type StoredState = {
  scan?: MacroScan;
  mt5Snapshots?: Record<string, ChartRead>;
  assetSnapshots?: Record<string, ChartRead>;
  dynamicMetas?: Record<string, InstrumentMeta>;
  watchlist?: string[];
  favorites?: string[];
};

type CandleState = {
  loading: boolean;
  candles: Candle[];
  error: string | null;
  disconnected: boolean;
  status?: string;
};

const NAV_ITEMS: Array<{ id: View; label: string }> = [
  { id: "dashboard", label: "Market Scanner" },
  { id: "assets", label: "Assets" },
  { id: "calendar", label: "Calendar" },
  { id: "news", label: "News" },
  { id: "watchlist", label: "Watchlist" },
  { id: "data-status", label: "Data Status" },
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
  const [assetSnapshots, setAssetSnapshots] = useState<Record<string, ChartRead>>({});
  const [dynamicMetas, setDynamicMetas] = useState<Record<string, InstrumentMeta>>({});
  const [watchlist, setWatchlist] = useState<string[]>(() => INSTRUMENTS.map((instrument) => instrument.key));
  const [favorites, setFavorites] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetSearchResults, setAssetSearchResults] = useState<AssetSearchResult[]>([]);
  const [assetSearchStatus, setAssetSearchStatus] = useState<{ state: "idle" | "loading" | "updated" | "failed"; message: string }>({ state: "idle", message: "Search for a symbol to add it." });
  const [providerStatuses, setProviderStatuses] = useState<Array<Record<string, string | boolean>>>([]);
  const [macroRefreshStatus, setMacroRefreshStatus] = useState<MacroRefreshStatus>({
    state: "idle",
    source: "Gemini/Groq or deterministic fallback",
    message: "Macro context has not been refreshed in this session.",
  });
  const [mt5Text, setMt5Text] = useState("");
  const [mt5Status, setMt5Status] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mt5Loading, setMt5Loading] = useState(false);
  const [fredSnapshot, setFredSnapshot] = useState<FredMacroSnapshot | null>(null);
  const [fredLoading, setFredLoading] = useState(false);
  const [fredError, setFredError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentKey>("XAUUSD");
  const [assetSelectionTouched, setAssetSelectionTouched] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [marketBriefs, setMarketBriefs] = useState<Record<string, MarketBriefResponse | null>>({});
  const [briefLoading, setBriefLoading] = useState<Record<string, boolean>>({});
  const [candleSeries, setCandleSeries] = useState<Record<string, CandleState>>({});
  const [clock, setClock] = useState(() => new Date());
  const briefInFlight = useRef<Set<string>>(new Set());
  const scanRef = useRef<MacroScan | null>(null);

  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as StoredState;
      setScan(parsed.scan || null);
      setMt5Snapshots(parsed.mt5Snapshots || {});
      setAssetSnapshots(parsed.assetSnapshots || {});
      setDynamicMetas(parsed.dynamicMetas || {});
      setWatchlist(parsed.watchlist?.length ? parsed.watchlist : INSTRUMENTS.map((instrument) => instrument.key));
      setFavorites(parsed.favorites || []);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const persist = useCallback((next: Partial<StoredState> & { scan?: MacroScan | null }) => {
    const payload: StoredState = {
      scan: next.scan === undefined ? scanRef.current || undefined : next.scan || undefined,
      mt5Snapshots: next.mt5Snapshots || mt5Snapshots,
      assetSnapshots: next.assetSnapshots || assetSnapshots,
      dynamicMetas: next.dynamicMetas || dynamicMetas,
      watchlist: next.watchlist || watchlist,
      favorites: next.favorites || favorites,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [assetSnapshots, dynamicMetas, favorites, mt5Snapshots, watchlist]);

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
          persist({ scan: scanRef.current || undefined, mt5Snapshots: nextSnapshots });
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

  useEffect(() => {
    let cancelled = false;
    async function fetchProviderStatus() {
      try {
        const response = await fetch("/api/data-status", { cache: "no-store" });
        const data = await response.json();
        if (!cancelled) setProviderStatuses(Array.isArray(data.providers) ? data.providers : []);
      } catch {
        if (!cancelled) setProviderStatuses([]);
      }
    }
    fetchProviderStatus();
    const interval = window.setInterval(fetchProviderStatus, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchCandlesForWatchlist() {
      await Promise.all(
        watchlist.map(async (symbol) => {
          setCandleSeries((current) => ({
            ...current,
            [symbol]: {
              loading: true,
              candles: current[symbol]?.candles || [],
              error: null,
              disconnected: false,
              status: current[symbol]?.status,
            },
          }));
          try {
            const response = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=1h&lookback=120`, { cache: "no-store" });
            const data = await response.json();
            if (cancelled) return;
            if (!response.ok) throw new Error(data.error || "Could not fetch candle history.");
            setCandleSeries((current) => ({
              ...current,
              [symbol]: {
                loading: false,
                candles: Array.isArray(data.candles) ? data.candles : [],
                error: data.error || null,
                disconnected: data.status === "mt5_disconnected",
                status: data.status,
              },
            }));
          } catch (event) {
            if (cancelled) return;
            setCandleSeries((current) => ({
              ...current,
              [symbol]: {
                loading: false,
                candles: current[symbol]?.candles || [],
                error: event instanceof Error ? event.message : "Could not fetch candle history.",
                disconnected: false,
                status: "unavailable",
              },
            }));
          }
        }),
      );
    }
    fetchCandlesForWatchlist();
    const interval = window.setInterval(fetchCandlesForWatchlist, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [watchlist]);

  const runScan = useCallback(async () => {
    setMacroLoading(true);
    setError(null);
    setMacroRefreshStatus((current) => ({ ...current, state: "loading", message: "Refreshing macro context..." }));
    try {
      const response = await fetch("/api/macro-scan", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Macro scan failed.");
      setScan(data);
      persist({ scan: data, mt5Snapshots });
      setMacroRefreshStatus(buildMacroRefreshStatus(data));
    } catch (event) {
      setError(event instanceof Error ? event.message : "Macro scan failed.");
      setMacroRefreshStatus(buildMacroRefreshFailure(event));
    } finally {
      setMacroLoading(false);
    }
  }, [mt5Snapshots, persist]);

  const searchAssets = useCallback(async () => {
    const query = assetSearch.trim();
    if (!query) return;
    setAssetSearchStatus({ state: "loading", message: "Searching available providers..." });
    try {
      const response = await fetch(`/api/assets/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Asset search failed.");
      const results = (Array.isArray(data.results) ? data.results : []) as AssetSearchResult[];
      setAssetSearchResults(results);
      setAssetSearchStatus({
        state: "updated",
        message: results.length ? `Found ${results.length} matching asset${results.length === 1 ? "" : "s"}.` : "No supported symbol found.",
      });
    } catch (event) {
      setAssetSearchStatus({ state: "failed", message: event instanceof Error ? event.message : "Asset search failed." });
    }
  }, [assetSearch]);

  const selectAsset = useCallback(
    async (asset: AssetSearchResult) => {
      const key = normalizeSymbol(asset.symbol);
      const meta: InstrumentMeta = {
        key,
        label: asset.symbol.toUpperCase(),
        name: asset.name,
        group: asset.assetClass || "market",
        provider: asset.provider,
      };
      const nextMetas = { ...dynamicMetas, [key]: meta };
      const nextWatchlist = addWatchlistItem(watchlist, key);
      setDynamicMetas(nextMetas);
      setWatchlist(nextWatchlist);
      setSelectedInstrument(key);
      setAssetSelectionTouched(true);
      setActiveView("assets");
      setDetailTab("overview");

      if (getPrimaryDataProvider(key) === "Twelve Data") {
        try {
          const response = await fetch(`/api/assets/market-data?symbol=${encodeURIComponent(asset.symbol)}`, { cache: "no-store" });
          const data = await response.json();
          const quote = data.quote;
          const nextSnapshots = {
            ...assetSnapshots,
            [key]: twelveQuoteToChartRead(key, quote),
          };
          setAssetSnapshots(nextSnapshots);
          persist({ dynamicMetas: nextMetas, watchlist: nextWatchlist, assetSnapshots: nextSnapshots });
        } catch {
          persist({ dynamicMetas: nextMetas, watchlist: nextWatchlist });
        }
      } else {
        persist({ dynamicMetas: nextMetas, watchlist: nextWatchlist });
      }
    },
    [assetSnapshots, dynamicMetas, persist, watchlist],
  );

  const removeFromWatchlist = useCallback(
    (key: string) => {
      const nextState = removeWatchlistItem(watchlist, favorites, key);
      const nextWatchlist = nextState.watchlist;
      const nextFavorites = nextState.favorites;
      setWatchlist(nextWatchlist);
      setFavorites(nextFavorites);
      if (selectedInstrument === key) setSelectedInstrument(nextWatchlist[0] || "XAUUSD");
      persist({ watchlist: nextWatchlist, favorites: nextFavorites });
    },
    [favorites, persist, selectedInstrument, watchlist],
  );

  const toggleFavorite = useCallback(
    (key: string) => {
      const nextFavorites = toggleFavoriteItem(favorites, key);
      setFavorites(nextFavorites);
      persist({ favorites: nextFavorites });
    },
    [favorites, persist],
  );

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
      persist({ scan: scan || undefined, mt5Snapshots: nextSnapshots });
      setMt5Status({ ok: true, msg: `Imported MT5 fallback data for ${Object.keys(imported).join(", ")}.` });
    } catch {
      setMt5Status({ ok: false, msg: "That is not valid JSON. Check for missing quotes or trailing commas." });
    }
  }, [mt5Snapshots, mt5Text, persist, scan]);

  const summaries = useMemo(
    () =>
      watchlist.map((key) => {
        const meta = getInstrumentMeta(key, dynamicMetas);
        const macro = scan?.instruments?.find((instrument) => instrument.key === meta.key);
        const mt5 = mt5Snapshots[meta.key] || assetSnapshots[meta.key];
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
    [assetSnapshots, dynamicMetas, fredError, fredSnapshot, mt5Snapshots, scan, watchlist],
  );

  const selectedSummary = summaries.find((summary) => summary.meta.key === selectedInstrument) || summaries[0];
  const topWatch = summaries.find((summary) => summary.signalClarity === "High") || summaries.find((summary) => summary.mt5) || summaries[0];
  const sourceCards = buildSourceCards(mt5Snapshots, assetSnapshots, fredSnapshot, fredError, fredLoading);

  const explainXauusd = useCallback(async () => {
    const summary = summaries.find((item) => item.meta.key === selectedInstrument) || summaries[0];
    if (!summary) return;
    const payload = buildMarketBriefPayload(summary, fredSnapshot);
    if (!payload) {
      setMarketBriefs((current) => ({
        ...current,
        [summary.meta.key]: buildClientFallbackBrief("AI explanation unavailable. Rule-based market context is still available."),
      }));
      return;
    }
    const key = JSON.stringify(payload);
    if (briefInFlight.current.has(key)) return;
    briefInFlight.current.add(key);
    setBriefLoading((current) => ({ ...current, [summary.meta.key]: true }));
    try {
      const response = await fetch("/api/analysis/market-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI explanation unavailable.");
      setMarketBriefs((current) => ({ ...current, [summary.meta.key]: data }));
    } catch {
      setMarketBriefs((current) => ({
        ...current,
        [summary.meta.key]: buildClientFallbackBrief("AI explanation unavailable. Rule-based market context is still available."),
      }));
    } finally {
      briefInFlight.current.delete(key);
      setBriefLoading((current) => ({ ...current, [summary.meta.key]: false }));
    }
  }, [fredSnapshot, selectedInstrument, summaries]);

  const overallStatus = getOverallSourceStatus(sourceCards);

  return (
    <main style={{ background: C.bg, minHeight: "100vh" }} className="w-full">
      <header style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }} className="sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 pt-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div style={{ background: C.gold, color: C.bg }} className="w-7 h-7 flex items-center justify-center shrink-0">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <polyline points="1,10 4,6 7,8 10,3 14,5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="square" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="font-black text-[15px] tracking-[0.12em] leading-none uppercase">
                  Your Trading Intelligence
                </h1>
                <p style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] tracking-[0.08em] mt-1 uppercase">
                  Market intelligence - Educational only - No auto-trading
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <HeaderStatus status={overallStatus.status} reason={overallStatus.reason} />
              <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px]">
                {clock.toUTCString().slice(0, 22)} UTC
              </div>
            </div>
          </div>
          <nav className="mt-3 flex overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                style={{
                  color: activeView === item.id ? C.gold : C.textDim,
                  borderBottom: activeView === item.id ? `1px solid ${C.gold}` : "1px solid transparent",
                  fontFamily: "var(--font-mono)",
                }}
                className="px-3 sm:px-4 py-3 text-[10px] tracking-[0.1em] whitespace-nowrap uppercase"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-16">

        {error && (
          <div style={{ background: "#221010", border: `1px solid ${C.fall}`, color: C.fall }} className="px-4 py-3 my-5 flex items-center gap-2 text-sm">
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
            macroRefreshStatus={macroRefreshStatus}
            onFetchMt5={() => fetchLatestMt5(true)}
            onRunScan={runScan}
            onOpenInstrument={(key) => {
              setSelectedInstrument(key);
              setAssetSelectionTouched(true);
              setDetailTab("overview");
              setActiveView("assets");
            }}
          />
        )}

        {activeView === "assets" && selectedSummary && (
          <AssetsView
            summaries={summaries}
            selected={selectedSummary}
            hasSelection={assetSelectionTouched}
            detailTab={detailTab}
            fredSnapshot={fredSnapshot}
            fredLoading={fredLoading}
            fredError={fredError}
            marketBrief={marketBriefs[selectedSummary.meta.key]}
            briefLoading={Boolean(briefLoading[selectedSummary.meta.key])}
            onExplainXauusd={explainXauusd}
            assetSearch={assetSearch}
            setAssetSearch={setAssetSearch}
            assetSearchResults={assetSearchResults}
            assetSearchStatus={assetSearchStatus}
            onSearchAssets={searchAssets}
            onSelectAsset={selectAsset}
            watchlist={watchlist}
            favorites={favorites}
            onRemoveFromWatchlist={removeFromWatchlist}
            onToggleFavorite={toggleFavorite}
            candleSeries={candleSeries}
            onSelect={(key) => {
              setSelectedInstrument(key);
              setAssetSelectionTouched(true);
              setDetailTab("overview");
            }}
            onChangeTab={setDetailTab}
          />
        )}

        {activeView === "calendar" && <CalendarView summaries={summaries} onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView, setAssetSelectionTouched)} />}
        {activeView === "news" && <NewsView summaries={summaries} onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView, setAssetSelectionTouched)} />}
        {activeView === "watchlist" && (
          <WatchlistView
            summaries={summaries}
            favorites={favorites}
            onOpen={(key) => openInstrument(key, setSelectedInstrument, setDetailTab, setActiveView, setAssetSelectionTouched)}
            onRemove={removeFromWatchlist}
            onToggleFavorite={toggleFavorite}
          />
        )}
        {activeView === "data-status" && <DataStatusView sourceCards={sourceCards} providerStatuses={providerStatuses} macroRefreshStatus={macroRefreshStatus} />}
        {activeView === "settings" && (
          <SettingsView
            sourceCards={sourceCards}
            mt5Text={mt5Text}
            setMt5Text={setMt5Text}
            importMt5Data={importMt5Data}
            mt5Status={mt5Status}
            summaries={summaries}
            favorites={favorites}
            macroRefreshStatus={macroRefreshStatus}
          />
        )}

        <p style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] mt-8 text-center opacity-70 tracking-[0.05em]">
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
  macroRefreshStatus,
  onFetchMt5,
  onRunScan,
  onOpenInstrument,
}: {
  scan: MacroScan | null;
  summaries: InstrumentSummary[];
  topWatch: InstrumentSummary;
  sourceCards: SourceCardModel[];
  mt5Loading: boolean;
  macroLoading: boolean;
  mt5Status: { ok: boolean; msg: string } | null;
  macroRefreshStatus: { state: "idle" | "loading" | "updated" | "cached" | "stale" | "failed"; lastRefreshed?: string; source: string; message: string };
  onFetchMt5: () => void;
  onRunScan: () => void;
  onOpenInstrument: (key: InstrumentKey) => void;
}) {
  const dataStatus = getOverallSourceStatus(sourceCards);

  return (
    <div className="pt-8 flex flex-col gap-8" style={{ animation: "fadeInTerminal 0.3s ease" }}>
      <section>
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <Kicker text={`OVERVIEW / ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase()}`} />
            <h2 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="font-black text-4xl tracking-[0.04em] uppercase leading-none">
              Market Intelligence
            </h2>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={onFetchMt5} disabled={mt5Loading} style={{ background: C.gold, color: C.bg, fontFamily: "var(--font-mono)" }} className="flex items-center gap-2 px-4 py-2 text-[10px] tracking-[0.08em] uppercase disabled:opacity-50">
              <Database size={15} />
              {mt5Loading ? "Fetching..." : "Fetch MT5 data"}
            </button>
            <button type="button" onClick={onRunScan} disabled={macroLoading} style={{ color: macroRefreshStatus.state === "updated" || macroRefreshStatus.state === "cached" ? C.gold : C.textDim, borderColor: macroRefreshStatus.state === "updated" || macroRefreshStatus.state === "cached" ? C.gold : "#2e2e2e", fontFamily: "var(--font-mono)" }} className="flex items-center gap-2 px-4 py-2 border text-[10px] tracking-[0.08em] uppercase disabled:opacity-50">
              <RefreshCw size={15} className={macroLoading ? "animate-spin" : ""} />
              {macroLoading ? "Refreshing..." : "Refresh market context"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-px" style={{ background: C.line }}>
          <CommandField label="Market Mode" value={getMarketMode(scan)} helper={scan?.usdStrength?.detail || "Load macro context for the current USD read."} />
          <CommandField label="Best Setup" value={topWatch?.meta.label || "-"} helper={topWatch ? `${topWatch.bias} - ${topWatch.signalClarity} clarity` : "No setup ranked yet."} />
          <CommandField label="Main Driver" value={topWatch?.macro?.driver || getStaticDriver(topWatch?.meta.key || "XAUUSD")} />
          <CommandField label="Next Event" value={getNextEvent(summaries)} />
          <CommandField label="Data Status" value={formatSourceStatus(dataStatus.status, dataStatus.reason)} color={statusColor(dataStatus.status)} />
        </div>
        <p style={{ color: macroRefreshStatus.state === "failed" ? C.fall : C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] mt-3 uppercase tracking-[0.05em]">
          Macro: {macroRefreshStatus.state.toUpperCase()} - {macroRefreshStatus.message}
          {macroRefreshStatus.lastRefreshed ? ` - Last refreshed ${formatTimestamp(macroRefreshStatus.lastRefreshed)}` : ""} - Source: {macroRefreshStatus.source}
        </p>
        {mt5Status && (
          <p style={{ color: mt5Status.ok ? C.rise : C.fall, fontFamily: "var(--font-mono)" }} className="text-[10px] mt-2 uppercase">
            {mt5Status.msg}
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center gap-4 mb-5">
          <h3 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="font-bold text-lg tracking-[0.08em] uppercase">
            Market Scanner
          </h3>
          <div style={{ background: C.line }} className="h-px flex-1" />
          <span style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] uppercase tracking-[0.1em]">
            What should I pay attention to?
          </span>
        </div>
        <div className="flex flex-col gap-px" style={{ background: C.line }}>
          {summaries.map((summary) => (
            <AssetSummaryCard key={summary.meta.key} summary={summary} onOpen={() => onOpenInstrument(summary.meta.key)} />
          ))}
        </div>
      </section>

      <section style={{ background: C.surface, borderLeft: `2px solid ${C.line}` }} className="px-5 py-4">
        <p style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] leading-7 tracking-[0.05em] uppercase">
          <span style={{ color: C.amber }}>Disclaimer</span> - Signal Clarity reflects evidence alignment, not trade certainty. No trades are executed automatically. Open an asset for full analysis, news, calendar context, and limitations.
        </p>
      </section>
    </div>
  );
}

function AssetsView({
  summaries,
  selected,
  hasSelection,
  detailTab,
  fredSnapshot,
  fredLoading,
  fredError,
  marketBrief,
  briefLoading,
  onExplainXauusd,
  assetSearch,
  setAssetSearch,
  assetSearchResults,
  assetSearchStatus,
  onSearchAssets,
  onSelectAsset,
  watchlist,
  favorites,
  onRemoveFromWatchlist,
  onToggleFavorite,
  candleSeries,
  onSelect,
  onChangeTab,
}: {
  summaries: InstrumentSummary[];
  selected: InstrumentSummary;
  hasSelection: boolean;
  detailTab: DetailTab;
  fredSnapshot: FredMacroSnapshot | null;
  fredLoading: boolean;
  fredError: string | null;
  marketBrief?: MarketBriefResponse | null;
  briefLoading: boolean;
  onExplainXauusd: () => void;
  assetSearch: string;
  setAssetSearch: (value: string) => void;
  assetSearchResults: AssetSearchResult[];
  assetSearchStatus: { state: "idle" | "loading" | "updated" | "failed"; message: string };
  onSearchAssets: () => void;
  onSelectAsset: (asset: AssetSearchResult) => void;
  watchlist: string[];
  favorites: string[];
  onRemoveFromWatchlist: (key: string) => void;
  onToggleFavorite: (key: string) => void;
  candleSeries: Record<string, CandleState>;
  onSelect: (key: InstrumentKey) => void;
  onChangeTab: (tab: DetailTab) => void;
}) {
  return (
    <div className="pt-8 flex flex-col gap-5" style={{ animation: "fadeInTerminal 0.3s ease" }}>
      <section>
        <Kicker text="ASSET LOOKUP / MT5 FOR METALS / TWELVE DATA FOR SEARCHED MARKETS" />
        <h2 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="font-black text-4xl tracking-[0.04em] uppercase mb-5">
          Assets
        </h2>
        <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <div className="flex gap-2">
              <label htmlFor="asset-search" className="sr-only">
                Search asset symbol
              </label>
              <input
                id="asset-search"
                value={assetSearch}
                onChange={(event) => setAssetSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSearchAssets();
                }}
                placeholder="Search XAUUSD, XAGUSD, EURUSD, AAPL, BTC/USD"
                style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, fontFamily: "var(--font-mono)" }}
                className="min-w-0 flex-1 px-3 py-3 text-xs"
              />
              <button type="button" aria-label="Search assets" onClick={onSearchAssets} style={{ color: C.bg, background: C.gold, fontFamily: "var(--font-mono)" }} className="px-4 text-[10px] tracking-[0.08em] uppercase">
                <Search size={15} />
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              {favorites.map((symbol) => (
                <button key={symbol} type="button" onClick={() => onSelect(symbol)} style={{ color: C.gold, borderColor: C.gold, fontFamily: "var(--font-mono)" }} className="border px-2 py-2 text-[9px] uppercase whitespace-nowrap">
                  {symbol}
                </button>
              ))}
              {!favorites.length && <span style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] whitespace-nowrap">NO FAVORITES YET</span>}
            </div>
          </div>
          <p style={{ color: assetSearchStatus.state === "failed" ? C.fall : C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] mt-3 uppercase tracking-[0.04em]">
            {assetSearchStatus.message}
          </p>
        </div>
      </section>

      {assetSearchResults.length > 0 && (
        <section style={{ border: `1px solid ${C.line}` }}>
          <TerminalHeader columns={["SYMBOL", "NAME", "PROVIDER", "WATCHLIST"]} />
          {assetSearchResults.map((asset) => {
            const key = normalizeSymbol(asset.symbol);
            const watched = watchlist.includes(key);
            return (
              <button key={`${asset.provider}-${asset.symbol}`} type="button" onClick={() => onSelectAsset(asset)} className="w-full grid grid-cols-1 md:grid-cols-[140px_1fr_140px_120px] gap-3 px-5 py-4 text-left hover:bg-[#161616]" style={{ background: C.surfaceRaised, borderTop: `1px solid ${C.line}` }}>
                <span style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="text-xl font-bold tracking-[0.06em]">{asset.symbol}</span>
                <span style={{ color: C.textDim }} className="text-sm">{asset.name}</span>
                <span style={{ color: asset.provider === "MT5" ? C.gold : C.cyan, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase">{asset.provider}</span>
                <span style={{ color: watched ? C.gold : C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase">{watched ? "WATCHED" : "ADD"}</span>
              </button>
            );
          })}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <aside style={{ background: C.surface, border: `1px solid ${C.line}` }} className="p-3 h-fit">
          <Kicker text="WATCHLIST" />
          <div className="flex lg:flex-col gap-1 overflow-x-auto mt-3">
            {summaries.map((summary) => (
              <button
                key={summary.meta.key}
                type="button"
                onClick={() => onSelect(summary.meta.key)}
                style={{ background: selected.meta.key === summary.meta.key && hasSelection ? C.surfaceRaised : "transparent", borderLeft: selected.meta.key === summary.meta.key && hasSelection ? `2px solid ${C.gold}` : "2px solid transparent" }}
                className="p-3 text-left min-w-[190px] lg:min-w-0 hover:bg-[#161616]"
              >
                <div style={{ color: C.text, fontFamily: "var(--font-display)" }} className="font-bold text-lg tracking-[0.06em]">
                  {summary.meta.label}
                </div>
                <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] uppercase mt-1">
                  {summary.bias} - {summary.signalClarity}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {!hasSelection ? (
          <section style={{ background: C.surface, border: `1px dashed ${C.line}` }} className="min-h-[420px] flex flex-col items-center justify-center text-center p-8">
            <Kicker text="NO ASSET SELECTED" />
            <h3 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="text-3xl font-black uppercase tracking-[0.04em] mt-2">
              Search or choose an asset
            </h3>
            <p style={{ color: C.textDim }} className="text-sm max-w-xl mt-3">
              Full analysis appears here only after an asset is selected. The dashboard will use MT5 for XAUUSD/XAGUSD and Twelve Data for other searched symbols when configured.
            </p>
          </section>
        ) : (
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
            isFavorite={favorites.includes(selected.meta.key)}
            isWatched={watchlist.includes(selected.meta.key)}
            onRemoveFromWatchlist={() => onRemoveFromWatchlist(selected.meta.key)}
            onToggleFavorite={() => onToggleFavorite(selected.meta.key)}
            candleState={candleSeries[selected.meta.key]}
            biasMarkers={buildBiasMarkers(selected)}
          />
        )}
      </div>
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
  isFavorite,
  isWatched,
  onRemoveFromWatchlist,
  onToggleFavorite,
  candleState,
  biasMarkers,
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
  isFavorite: boolean;
  isWatched: boolean;
  onRemoveFromWatchlist: () => void;
  onToggleFavorite: () => void;
  candleState?: CandleState;
  biasMarkers: BiasMarker[];
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
              {summary.meta.name} · {summary.meta.group} · {summary.mt5?.source || summary.meta.provider || getPrimaryDataProvider(summary.meta.key)}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={onToggleFavorite} style={{ color: isFavorite ? C.gold : C.textDim, borderColor: isFavorite ? C.gold : C.line }} className="border rounded px-2 py-1 text-xs flex items-center gap-1">
              <Heart size={13} />
              {isFavorite ? "Favorite" : "Mark favorite"}
            </button>
            {isWatched && (
              <button type="button" onClick={onRemoveFromWatchlist} style={{ color: C.textDim, borderColor: C.line }} className="border rounded px-2 py-1 text-xs flex items-center gap-1">
                <X size={13} />
                Remove
              </button>
            )}
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
          <InstrumentCard
            instMeta={summary.meta}
            macro={summary.macro}
            mt5={summary.mt5}
            candles={candleState?.candles || []}
            chartLoading={Boolean(candleState?.loading)}
            chartError={candleState?.error || null}
            chartDisconnected={Boolean(candleState?.disconnected)}
            biasMarkers={biasMarkers}
          />
          <div className="flex flex-col gap-4">
            <InfoPanel title="Current Read" text={summary.marketStatus.plainEnglish} />
            <InfoPanel title="Why It Matters" text={summary.macro?.driver || getStaticDriver(summary.meta.key)} />
            <InfoPanel title="What To Watch" text={summary.macro?.likelyScenario || "Use the MT5 snapshot to understand current structure. This app does not issue trade instructions."} />
            <InfoPanel title="Data Quality" text={formatSourceStatus(summary.dataStatus.status, summary.dataStatus.reason)} />
            <AiMarketExplanation brief={marketBrief} loading={briefLoading} disabled={!summary.mt5?.price} onExplain={onExplainXauusd} />
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
  const currencies = Array.from(new Set(summaries.map((summary) => summary.meta.key.slice(0, 3)).filter(Boolean)));
  return (
    <section className="flex flex-col gap-4">
      <PageHeading icon={<CalendarDays size={18} />} title="Calendar" subtitle="Compact chronological economic-event feed" />
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <p style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.04em] mb-4">
          Filters unavailable until a real calendar provider is connected. Watchlist currencies: {currencies.join(", ") || "watchlist"}.
        </p>
        <p style={{ color: C.text }} className="text-sm font-medium">Economic-calendar provider unavailable.</p>
        <p style={{ color: C.textDim }} className="text-sm mt-1">
          No real calendar integration is connected yet, so no events are fabricated. When connected, events will appear as chronological lines with time, currency, impact, actual, forecast, previous, explanation, and affected watchlist symbols.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {summaries.map((summary) => (
            <button key={summary.meta.key} type="button" onClick={() => onOpen(summary.meta.key)} style={{ color: C.textDim, borderColor: C.line }} className="text-left border-t pt-2 text-sm">
              Watchlist relevance placeholder - {summary.meta.label}: no calendar events available from a real provider.
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

function NewsView({ summaries, onOpen }: { summaries: InstrumentSummary[]; onOpen: (key: InstrumentKey) => void }) {
  return (
    <section className="flex flex-col gap-4">
      <PageHeading icon={<Newspaper size={18} />} title="News" subtitle="Impactful news for watched symbols" />
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <p style={{ color: C.text }} className="text-sm font-medium">Market-news provider unavailable.</p>
        <p style={{ color: C.textDim }} className="text-sm mt-1">
          No real news integration is connected yet, so no headlines are fabricated. When connected, this feed will prioritize real market-moving items tied to the watchlist, asset class, rates, inflation, central banks, earnings, commodities, and regulation.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {summaries.map((summary) => (
            <button key={summary.meta.key} type="button" onClick={() => onOpen(summary.meta.key)} style={{ color: C.textDim, borderColor: C.line }} className="text-left border-t pt-2 text-sm">
              {summary.meta.label}: no verified news items available from a connected provider.
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

function WatchlistView({ summaries, favorites, onOpen, onRemove, onToggleFavorite }: { summaries: InstrumentSummary[]; favorites: string[]; onOpen: (key: InstrumentKey) => void; onRemove: (key: string) => void; onToggleFavorite: (key: string) => void }) {
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
      <div className="flex flex-col gap-2">
        {summaries.map((summary) => (
          <div key={summary.meta.key} style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-3 flex items-center justify-between gap-3">
            <button type="button" onClick={() => onOpen(summary.meta.key)} className="text-left">
              <span style={{ color: C.text }} className="block font-medium">
                {summary.meta.label}
              </span>
              <span style={{ color: C.textDim }} className="block text-xs">
                {summary.meta.name} · {summary.mt5?.source || summary.meta.provider || getPrimaryDataProvider(summary.meta.key)}
              </span>
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => onOpen(summary.meta.key)} style={{ color: C.gold, borderColor: C.line }} className="border rounded px-2 py-1 text-xs">
                View chart
              </button>
              <button type="button" onClick={() => onToggleFavorite(summary.meta.key)} style={{ color: favorites.includes(summary.meta.key) ? C.gold : C.textDim, borderColor: C.line }} className="border rounded px-2 py-1 text-xs">
                {favorites.includes(summary.meta.key) ? "Favorite" : "Favorite?"}
              </button>
              <button type="button" onClick={() => onRemove(summary.meta.key)} style={{ color: C.textDim, borderColor: C.line }} className="border rounded px-2 py-1 text-xs">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataStatusView({ sourceCards, providerStatuses, macroRefreshStatus }: { sourceCards: SourceCardModel[]; providerStatuses: Array<Record<string, string | boolean>>; macroRefreshStatus: { state: string; lastRefreshed?: string; source: string; message: string } }) {
  const rows = providerStatuses.length
    ? providerStatuses
    : sourceCards.map((source) => ({
        id: source.id,
        name: source.name,
        configured: source.status !== "Unavailable" && source.status !== "No Data",
        status: source.status.toLowerCase(),
        fallback: source.helpText,
      }));
  return (
    <section className="flex flex-col gap-4">
      <PageHeading icon={<Database size={18} />} title="Data Status" subtitle="Provider health and fallback visibility" />
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg overflow-hidden">
        {rows.map((row) => (
          <div key={String(row.id || row.name)} style={{ borderBottom: `1px solid ${C.line}` }} className="grid grid-cols-1 md:grid-cols-[180px_140px_1fr] gap-2 px-4 py-3 text-sm">
            <div style={{ color: C.text }} className="font-medium">{String(row.name)}</div>
            <Badge label={String(row.status || "unknown")} color={statusColorFromProvider(String(row.status || ""))} />
            <div style={{ color: C.textDim }}>
              Configured: {String(Boolean(row.configured))} · Fallback: {String(row.fallback || "none")} · No keys or sensitive payloads are exposed.
            </div>
          </div>
        ))}
      </section>
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4">
        <h3 style={{ color: C.text }} className="font-serif text-lg">Macro refresh</h3>
        <p style={{ color: C.textDim }} className="text-sm">
          {macroRefreshStatus.state.toUpperCase()} · {macroRefreshStatus.message} · Source: {macroRefreshStatus.source}
          {macroRefreshStatus.lastRefreshed ? ` · Last refreshed ${formatTimestamp(macroRefreshStatus.lastRefreshed)}` : ""}
        </p>
      </section>
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
  favorites,
  macroRefreshStatus,
}: {
  sourceCards: SourceCardModel[];
  mt5Text: string;
  setMt5Text: (value: string) => void;
  importMt5Data: () => void;
  mt5Status: { ok: boolean; msg: string } | null;
  summaries: InstrumentSummary[];
  favorites: string[];
  macroRefreshStatus: { state: string; lastRefreshed?: string; source: string; message: string };
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <PageHeading icon={<Settings size={18} />} title="Settings" subtitle="What do I control?" />
      </section>
      <section>
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-3">
          Data Sources
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {sourceCards.map((source) => (
            <SourceCard key={source.id} source={source}>
              {source.id === "mt5" && (
                <div className="mt-3 flex flex-col gap-2">
                  <label htmlFor="mt5-json-input" style={{ color: C.gold }} className="text-xs uppercase font-mono">
                    Paste MT5 JSON
                  </label>
                  <textarea id="mt5-json-input" value={mt5Text} onChange={(event) => setMt5Text(event.target.value)} placeholder={MT5_EXAMPLE} rows={8} style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} className="w-full rounded-md p-3 text-xs font-mono" />
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
          Preferences
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="Default asset" value={summaries[0]?.meta.label || "XAU/USD"} />
          <Field label="AI provider order" value="Gemini, then Groq, then deterministic fallback" />
          <Field label="Macro refresh" value={`${macroRefreshStatus.state.toUpperCase()} - ${macroRefreshStatus.message}`} />
          <Field label="Scanner filters" value="Watchlist relevance, stale data, volatility, and conflicting evidence" />
          <Field label="Calendar filters" value="Date, impact level, currency, and watchlist relevance" />
          <Field label="News filters" value="Watchlist relevance, asset class, rates, inflation, central banks, earnings, commodities, and regulation" />
        </div>
      </section>
      <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
        <h3 style={{ color: C.text }} className="font-serif text-xl mb-2">
          Watchlist Manager
        </h3>
        <p style={{ color: C.textDim }} className="text-sm mb-3">
          Watchlist and favorites are saved locally in this browser. API keys remain server-side and are not shown here.
        </p>
        <p style={{ color: C.textDim }} className="text-xs mb-3">
          Favorites: {favorites.length ? favorites.join(", ") : "None selected."}
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
  onOpen,
}: {
  summary: InstrumentSummary;
  onOpen: () => void;
}) {
  const statusColorValue = statusColor(summary.dataStatus.status);
  return (
    <button type="button" onClick={onOpen} style={{ background: C.surfaceRaised, borderLeft: `2px solid ${clarityColor(summary.signalClarity)}` }} className="w-full text-left hover:bg-[#161616] transition-colors">
      <div className="grid grid-cols-1 lg:grid-cols-[190px_150px_110px_150px_1fr_auto] gap-4 px-5 py-4 items-center">
        <div>
          <div style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="font-bold text-xl tracking-[0.06em] leading-none uppercase">
            {summary.meta.label}
          </div>
          <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] tracking-[0.06em] mt-1 uppercase">
            {summary.meta.name}
          </div>
        </div>
        <div>
          <div style={{ color: summary.mt5?.price ? "#fff" : C.textDim, fontFamily: "var(--font-mono)" }} className="text-base tracking-[0.04em]">
            {formatLevel(summary.mt5?.price)}
          </div>
          <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] uppercase mt-1">
            {summary.mt5?.source || summary.meta.provider || getPrimaryDataProvider(summary.meta.key)}
          </div>
        </div>
        <SignalBars clarity={summary.signalClarity} />
        <div>
          <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[8px] tracking-[0.1em] uppercase mb-1">Signal clarity</div>
          <span style={{ color: clarityColor(summary.signalClarity), background: `${clarityColor(summary.signalClarity)}20`, fontFamily: "var(--font-mono)" }} className="text-[10px] px-2 py-1 uppercase">
            {summary.signalClarity}
          </span>
        </div>
        <div>
          <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[8px] tracking-[0.1em] uppercase mb-1">Main driver</div>
          <div style={{ color: C.text }} className="text-xs leading-5 line-clamp-2">
            {summary.macro?.driver || getStaticDriver(summary.meta.key)}
          </div>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2">
          <Badge label={summary.bias} color={biasColor(summary.bias)} />
          <span style={{ color: statusColorValue, fontFamily: "var(--font-mono)" }} className="text-[9px] uppercase whitespace-nowrap">
            {summary.dataStatus.status}
          </span>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${C.line}` }} className="px-5 py-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
        <p style={{ color: C.textDim }} className="text-xs leading-5">
          {summary.marketStatus.status === "no_data" ? "No current market data yet. This row will update when a real provider supplies a snapshot." : summary.marketStatus.plainEnglish}
        </p>
        <span style={{ color: C.gold, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.08em]">
          View chart + full analysis -&gt;
        </span>
      </div>
    </button>
  );
}

function SignalBars({ clarity }: { clarity: InstrumentSummary["signalClarity"] }) {
  const active = clarity === "High" ? 5 : clarity === "Medium" ? 3 : clarity === "Low" ? 2 : 0;
  const color = clarityColor(clarity);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          style={{ background: index < active ? color : "#2e2e2e", opacity: index < active ? 1 : 0.5, height: `${12 + index * 3}px` }}
          className="w-1"
        />
      ))}
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
    <div style={{ background: C.surfaceRaised, borderLeft: `2px solid ${color || C.textDim}` }} className="p-4 min-h-[118px]">
      <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="uppercase text-[8px] tracking-[0.12em] mb-3">
        {label}
      </div>
      <div style={{ color: color || C.text, fontFamily: "var(--font-display)" }} className="text-[22px] font-bold uppercase tracking-[0.06em] leading-tight line-clamp-2">
        {value || "-"}
      </div>
      {helper && (
        <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] mt-3 leading-4 line-clamp-2">
          {helper}
        </div>
      )}
    </div>
  );
}

function InfoPanel({ title, text }: { title: string; text: string }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="p-4">
      <h3 style={{ color: C.gold, fontFamily: "var(--font-mono)" }} className="uppercase text-[9px] tracking-[0.12em] mb-2">
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
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="p-5">
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
    <div style={{ color: C.textDim, border: `1px dashed ${C.line}` }} className="p-4 text-sm">
      {text}
    </div>
  );
}

function PageHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 pt-8">
      <span style={{ color: C.gold }}>{icon}</span>
      <div>
        <h2 style={{ color: "#fff", fontFamily: "var(--font-display)" }} className="text-4xl font-black tracking-[0.04em] uppercase">
          {title}
        </h2>
        <p style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.08em] mt-1">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="p-3">
      <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="uppercase text-[8px] tracking-[0.1em] mb-2">
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
    <span style={{ color, borderColor: color, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.08em] border px-2 py-1 font-medium self-start">
      {label}
    </span>
  );
}

function HeaderStatus({ status, reason }: { status: DataStatus; reason: string }) {
  const color = statusColor(status);
  return (
    <div style={{ border: `1px solid ${color}`, background: status === "Live" ? "#00e67620" : status === "Unavailable" ? "#ff4d4d18" : "#f59e0b18" }} className="flex items-center gap-2 px-3 py-1">
      <span style={{ background: color, animation: "terminalPulse 2s infinite" }} className="w-1.5 h-1.5 rounded-full" />
      <span style={{ color, fontFamily: "var(--font-mono)" }} className="text-[9px] tracking-[0.1em] uppercase">
        {status} - {reason}
      </span>
    </div>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[9px] tracking-[0.15em] uppercase mb-2">
      {text}
    </div>
  );
}

function TerminalHeader({ columns }: { columns: string[] }) {
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }} className="hidden md:grid md:grid-cols-[140px_1fr_140px_120px] gap-3 px-5 py-3">
      {columns.map((column) => (
        <div key={column} style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[8px] tracking-[0.1em] uppercase">
          {column}
        </div>
      ))}
    </div>
  );
}

function openInstrument(key: InstrumentKey, setSelectedInstrument: (key: InstrumentKey) => void, setDetailTab: (tab: DetailTab) => void, setActiveView: (view: View) => void, setAssetSelectionTouched?: (value: boolean) => void) {
  setSelectedInstrument(key);
  setAssetSelectionTouched?.(true);
  setDetailTab("overview");
  setActiveView("assets");
}

function getInstrumentMeta(key: string, dynamicMetas: Record<string, InstrumentMeta>): InstrumentMeta {
  return dynamicMetas[key] || INSTRUMENTS.find((instrument) => instrument.key === key) || {
    key,
    label: key,
    name: key,
    group: "market",
    provider: getPrimaryDataProvider(key),
  };
}

function twelveQuoteToChartRead(key: string, quote: Record<string, unknown> | undefined): ChartRead {
  const price = typeof quote?.price === "number" ? quote.price : null;
  const change = typeof quote?.change === "number" ? quote.change : null;
  const percentChange = typeof quote?.percentChange === "number" ? quote.percentChange : null;
  const status = typeof quote?.status === "string" ? quote.status : "unavailable";
  const provider = status === "cached" ? "cached data" : status === "unavailable" ? "unavailable" : "Twelve Data";
  const movement = change === null ? "No recent movement available." : `${change >= 0 ? "Up" : "Down"} ${formatLevel(change)}${percentChange === null ? "" : ` (${formatLevel(percentChange)}%)`}.`;
  return {
    instrument: key,
    price,
    trend: change === null ? "sideways" : change > 0 ? "up" : change < 0 ? "down" : "sideways",
    structure: status === "unavailable" ? "unavailable" : "quote-based context only",
    volatility: "normal",
    support: null,
    resistance: null,
    recentHigh: null,
    recentLow: null,
    notes: status === "unavailable" ? String(quote?.error || "Twelve Data unavailable. No values fabricated.") : `Twelve Data quote. ${movement}`,
    source: provider,
    timestamp: typeof quote?.timestamp === "string" ? quote.timestamp : new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function buildMarketBriefPayload(summary: InstrumentSummary, fredSnapshot: FredMacroSnapshot | null): MarketBriefRequest | null {
  if (!summary.mt5 || typeof summary.mt5.price !== "number") return null;
  const xauFred = fredSnapshot?.summary.xauusd;
  return {
    instrument: summary.meta.key,
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
      goldBackdrop: summary.meta.key === "XAUUSD" ? fredSnapshot?.summary.goldBackdrop || "unknown" : "not directly applicable",
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

function buildSourceCards(mt5Snapshots: Record<string, ChartRead>, assetSnapshots: Record<string, ChartRead>, fredSnapshot: FredMacroSnapshot | null, fredError: string | null, fredLoading: boolean): SourceCardModel[] {
  const mt5Symbols = Object.keys(mt5Snapshots);
  const twelveSymbols = Object.keys(assetSnapshots).filter((key) => assetSnapshots[key]?.source === "Twelve Data" || assetSnapshots[key]?.source === "cached data");
  const latestMt5 = latestDate(mt5Symbols.map((key) => mt5Snapshots[key]?.createdAt));
  const latestTwelve = latestDate(twelveSymbols.map((key) => assetSnapshots[key]?.createdAt));
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
      id: "twelve-data",
      name: "Twelve Data",
      status: twelveSymbols.length ? getFreshnessStatus(latestTwelve) : "No Data",
      reason: twelveSymbols.length ? "Twelve Data used for searched non-MT5 assets" : "Used when a non-MT5 asset is searched",
      lastUpdate: formatTimestamp(latestTwelve),
      feeds: twelveSymbols.length ? twelveSymbols : ["Symbol search", "forex", "stocks", "ETFs", "indices", "crypto where supported"],
      helpText: "Server-side Twelve Data provider for assets outside XAUUSD/XAGUSD.",
    },
    {
      id: "ai",
      name: "AI Explanation",
      status: "Partial",
      reason: "Gemini primary, Groq fallback, deterministic local fallback",
      lastUpdate: "-",
      feeds: ["Gemini", "Groq", "deterministic fallback"],
      helpText: "API keys stay server-side. The UI only receives structured explanations or fallback text.",
    },
    {
      id: "calendar",
      name: "Economic Calendar",
      status: "Unavailable",
      reason: "Calendar provider not connected",
      lastUpdate: "-",
      feeds: ["No fabricated events"],
      helpText: "Calendar UI is available, but no real event provider is connected yet.",
    },
    {
      id: "news",
      name: "News",
      status: "Unavailable",
      reason: "News provider not connected",
      lastUpdate: "-",
      feeds: ["No AI-generated headlines"],
      helpText: "News UI is available, but no real market-news provider is connected yet.",
    },
    {
      id: "cache",
      name: "Cache",
      status: "Live",
      reason: "Short-lived provider caches active",
      lastUpdate: "-",
      feeds: ["Twelve Data search", "Twelve Data quotes", "AI market brief"],
      helpText: "Caching reduces provider quota usage without changing response contracts.",
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

function statusColorFromProvider(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "operational" || normalized === "live") return C.rise;
  if (normalized === "degraded" || normalized === "cached" || normalized === "rate limited" || normalized === "stale" || normalized === "partial" || normalized === "delayed") return C.amber;
  if (normalized === "unavailable") return C.fall;
  return C.neutral;
}

function biasColor(bias: string) {
  if (bias.startsWith("Bullish")) return C.rise;
  if (bias.startsWith("Bearish")) return C.fall;
  if (bias === "Mixed") return C.amber;
  return C.neutral;
}

function buildBiasMarkers(summary: InstrumentSummary): BiasMarker[] {
  const time = summary.mt5?.timestamp || summary.mt5?.createdAt;
  if (!time || summary.bias === "Unclear") return [];
  return [{ time, text: summary.bias, color: biasColor(summary.bias) }];
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
