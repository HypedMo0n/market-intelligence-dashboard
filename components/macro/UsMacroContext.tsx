"use client";

import { Activity, AlertCircle } from "lucide-react";
import type { FredMacroSnapshot, FredMetric } from "@/lib/providers/fred";
import { C } from "@/lib/theme";

type Props = {
  snapshot?: FredMacroSnapshot | null;
  loading?: boolean;
  error?: string | null;
};

const METRIC_KEYS: Array<keyof FredMacroSnapshot["metrics"]> = [
  "fedFundsRate",
  "treasury10Y",
  "realYield10Y",
  "broadUsdIndex",
  "inflationBreakeven10Y",
  "vix",
  "cpi",
  "unemployment",
];

export default function UsMacroContext({ snapshot, loading, error }: Props) {
  const metrics = snapshot?.metrics;

  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color: C.gold }} />
          <h3 style={{ color: C.text }} className="font-serif text-lg">
            US Macro Context
          </h3>
        </div>
        <span style={{ color: C.textDim }} className="text-xs font-mono">
          {snapshot?.asOf ? new Date(snapshot.asOf).toLocaleString() : loading ? "Loading FRED..." : "FRED macro data unavailable"}
        </span>
      </div>

      {error && (
        <div style={{ color: C.amber, border: `1px solid ${C.amber}`, background: "#2A2216" }} className="rounded px-3 py-2 text-xs mb-4 flex gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <p style={{ color: C.textDim }} className="text-sm leading-relaxed mb-4">
        {snapshot?.summary.plainEnglish || "FRED macro data unavailable. The dashboard remains usable with MT5 market structure."}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {METRIC_KEYS.map((key) => (
          <MacroMetricCard key={key} metric={metrics?.[key]} />
        ))}
      </div>

      {snapshot?.summary.xauusd && (
        <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3 text-xs">
            <Field label="XAUUSD USD backdrop" value={snapshot.summary.xauusd.usdBackdrop} color={backdropColor(snapshot.summary.xauusd.usdBackdrop)} />
            <Field label="Nominal yields" value={snapshot.summary.xauusd.nominalYieldDirection} />
            <Field label="Real yields" value={snapshot.summary.xauusd.realYieldDirection} />
            <Field label="Risk mood" value={snapshot.summary.xauusd.riskMood} color={riskMoodColor(snapshot.summary.xauusd.riskMood)} />
          </div>
          <p style={{ color: C.textDim }} className="text-sm leading-relaxed">
            <span style={{ color: C.text }}>XAUUSD context: </span>
            {snapshot.summary.xauusd.beginnerExplanation}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3 text-xs">
            <FactorList title="Supportive factors" items={snapshot.summary.xauusd.supportiveFactors} color={C.rise} />
            <FactorList title="Restrictive factors" items={snapshot.summary.xauusd.restrictiveFactors} color={C.fall} />
            <FactorList title="Ambiguous factors" items={snapshot.summary.xauusd.ambiguousFactors} color={C.neutral} />
            <FactorList title="Delayed factors" items={snapshot.summary.xauusd.delayedFactors} color={C.amber} />
          </div>
        </div>
      )}
    </section>
  );
}

function MacroMetricCard({ metric }: { metric?: FredMetric }) {
  if (!metric) {
    return (
      <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-3 text-xs">
        <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
          FRED metric
        </div>
        <div style={{ color: C.neutral }}>Unavailable</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-3 text-xs flex flex-col gap-2">
      <div>
        <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
          {metric.label}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span style={{ color: C.text }} className="font-medium">
            {formatValue(metric)}
          </span>
          <span style={{ color: directionColor(metric), borderColor: directionColor(metric) }} className="border rounded px-1.5 py-0.5 uppercase">
            {metric.direction}
          </span>
        </div>
      </div>
      <div style={{ color: C.textDim }}>Obs: {metric.observationDate || "-"}</div>
      {metric.freshness !== "current" && (
        <span style={{ color: freshnessColor(metric.freshness), borderColor: freshnessColor(metric.freshness) }} className="border rounded px-2 py-0.5 uppercase self-start">
          {metric.freshness}
        </span>
      )}
      <p style={{ color: C.textDim }} className="leading-relaxed">
        {metric.explanation}
      </p>
      {metric.key === "cpi" && metric.diagnostics?.indexLevel !== undefined && metric.diagnostics.indexLevel !== null && (
        <p style={{ color: C.textDim }} className="leading-relaxed">
          CPI index level: {metric.diagnostics.indexLevel.toFixed(3)}
        </p>
      )}
      <p style={{ color: C.textDim }} className="leading-relaxed">
        {metric.tradingImpact}
      </p>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-2">
      <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
        {label}
      </div>
      <div style={{ color: color || C.textDim }}>{value}</div>
    </div>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-3">
      <div style={{ color }} className="uppercase font-mono text-[10px] mb-1">
        {title}
      </div>
      <p style={{ color: C.textDim }}>{items.length ? items.join("; ") : "None."}</p>
    </div>
  );
}

function formatValue(metric: FredMetric) {
  if (metric.value === null) return "No data";
  const value = metric.unit === "percent" ? `${metric.value.toFixed(2)}%` : metric.value.toFixed(2);
  return value.replace(/\.00(?=%?$)/, "");
}

function directionColor(metric: FredMetric) {
  if (metric.direction === "unknown") return C.neutral;
  if (metric.freshness === "delayed") return C.amber;
  if (metric.freshness === "stale") return C.fall;
  if (metric.direction === "flat") return C.neutral;
  if (metric.key === "realYield10Y" || metric.key === "treasury10Y" || metric.key === "broadUsdIndex") {
    return metric.direction === "falling" ? C.rise : C.fall;
  }
  if (metric.key === "vix") return metric.direction === "rising" ? C.amber : C.rise;
  return C.neutral;
}

function freshnessColor(freshness: FredMetric["freshness"]) {
  if (freshness === "stale") return C.fall;
  if (freshness === "delayed") return C.amber;
  return C.neutral;
}

function backdropColor(backdrop: string) {
  if (backdrop === "supportive") return C.rise;
  if (backdrop === "restrictive") return C.fall;
  if (backdrop === "mixed") return C.amber;
  return C.neutral;
}

function riskMoodColor(riskMood: string) {
  if (riskMood === "risk-on") return C.rise;
  if (riskMood === "risk-off") return C.amber;
  return C.neutral;
}
