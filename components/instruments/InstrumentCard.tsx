"use client";

import { AlertCircle } from "lucide-react";
import { Explain } from "@/components/common/MetricChip";
import type { InstrumentMeta } from "@/lib/market-analysis/instruments";
import { STATIC_DRIVERS } from "@/lib/market-analysis/instruments";
import type { ChartRead, MacroInstrument } from "@/lib/market-analysis/types";
import { getMarketStatus } from "@/lib/scoring/marketStatus";
import { C } from "@/lib/theme";

type InstrumentCardProps = {
  instMeta: InstrumentMeta;
  macro?: MacroInstrument;
  mt5?: ChartRead;
};

export default function InstrumentCard({ instMeta, macro, mt5 }: InstrumentCardProps) {
  const macroBias = macro?.macroBias || macro?.bias || "neutral";
  const chartBias = mt5?.trend === "up" ? "bullish" : mt5?.trend === "down" ? "bearish" : "neutral";
  const marketStatus = getMarketStatus(macro, mt5);
  const freshness = getFreshness(mt5?.createdAt);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 style={{ color: C.text }} className="font-serif text-xl">
            {instMeta.label}
          </h3>
          <p style={{ color: C.textDim }} className="text-xs">
            {instMeta.name}
          </p>
        </div>
        <span
          style={{ color: statusColor(marketStatus.color), borderColor: statusColor(marketStatus.color) }}
          className="text-xs uppercase tracking-wide border rounded px-2 py-1 font-semibold"
        >
          {statusLabel(marketStatus.status)}
        </span>
        <p style={{ color: C.textDim }} className="basis-full text-xs leading-relaxed">
          {marketStatus.plainEnglish}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Current price" value={formatLevel(mt5?.price)} />
        <Field label="MT5 candle" value={formatTimestamp(mt5?.timestamp)} />
        <Field label="Received" value={formatTimestamp(mt5?.createdAt)} />
        <Field label="Freshness" value={freshness.label} color={freshness.color} />
        <Field label="Macro bias" value={macroBias} color={biasColor(macroBias)} />
        <Field label="Chart bias" value={chartBias} color={biasColor(chartBias)} />
      </div>

      <p style={{ color: C.textDim }} className="text-sm">
        <span style={{ color: C.text }}>Main driver: </span>
        {macro?.driver || STATIC_DRIVERS[instMeta.key]}
      </p>

      {macro?.newsRisk?.level && macro.newsRisk.level !== "none" && (
        <div
          style={{
            background: macro.newsRisk.level === "imminent" ? "#2A1620" : "#2A2216",
            border: `1px solid ${macro.newsRisk.level === "imminent" ? C.fall : C.amber}`,
            color: macro.newsRisk.level === "imminent" ? C.fall : C.amber,
          }}
          className="text-xs rounded px-3 py-2 flex items-center gap-2"
        >
          <AlertCircle size={13} />
          {macro.newsRisk.level === "imminent" ? "Danger zone: " : "Upcoming: "}
          {macro.newsRisk.detail}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3">
        <span style={{ color: C.gold }} className="text-xs uppercase tracking-wide font-mono flex items-center mb-2">
          MT5 market snapshot <Explain id="marketStructure" />
        </span>

        {!mt5 ? (
          <div style={{ color: C.textDim, border: `1px dashed ${C.line}` }} className="rounded p-4 text-xs text-center">
            No MT5 snapshot yet. Start the bridge, fetch latest MT5, or paste fallback JSON.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: C.textDim }}>
            <Field label="Trend" value={mt5.trend || "-"} />
            <Field label="Volatility" value={formatVolatility(mt5)} />
            <Field label="Nearest swing support" value={formatLevel(mt5.support)} />
            <Field label="Nearest swing resistance" value={formatLevel(mt5.resistance)} />
            <Field label="Recent high" value={formatLevel(mt5.recentHigh)} />
            <Field label="Recent low" value={formatLevel(mt5.recentLow)} />
            {mt5.candleMayBeForming && (
              <div className="col-span-2">
                <Field label="Candle note" value="Current H1 candle may still be forming." />
              </div>
            )}
            <div className="col-span-2">
              <Field label="Market structure" value={mt5.structure || "-"} />
            </div>
            <div className="col-span-2">
              <Field label="Liquidity zones" value={mt5.liquidityZones || "-"} />
            </div>
            <div className="col-span-2">
              <Field label="Plain English summary" value={mt5.notes || "Snapshot imported from MT5."} />
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3">
        <div className="flex items-center justify-between mb-2">
          <span style={{ color: C.gold }} className="text-xs uppercase tracking-wide font-mono flex items-center">
            Overall status <Explain id="tradeReadiness" />
          </span>
          <span
            style={{ color: statusColor(marketStatus.color), borderColor: statusColor(marketStatus.color) }}
            className="text-xs border rounded px-2 py-0.5 uppercase"
            title={`Internal score: ${marketStatus.score}/100`}
          >
            {statusLabel(marketStatus.status)}
          </span>
        </div>
        <div style={{ color: C.textDim }} className="text-sm leading-relaxed flex flex-col gap-2">
          <p>{marketStatus.plainEnglish}</p>
          <details style={{ borderColor: C.line }} className="rounded border px-3 py-2">
            <summary style={{ color: C.gold }} className="cursor-pointer text-xs uppercase tracking-wide font-mono">
              Why?
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <FactorList title="Positive factors" items={marketStatus.positiveFactors} />
              <FactorList title="Caution factors" items={marketStatus.cautionFactors} />
              <FactorList title="Blocking risks" items={marketStatus.blockingRisks} />
            </div>
          </details>
          <p>{macro?.likelyScenario || "Use the MT5 snapshot to understand current structure. This app does not issue trade instructions."}</p>
          {macro?.alternativeScenario && (
            <p>
              <span style={{ color: C.text }}>Alternative scenario: </span>
              {macro.alternativeScenario}
            </p>
          )}
          <Evidence title="Bullish evidence" items={macro?.bullishEvidence} />
          <Evidence title="Bearish evidence" items={macro?.bearishEvidence} />
          <Evidence title="Conflicting evidence" items={macro?.conflictingEvidence} />
          <p>
            <span style={{ color: C.text }}>Beginner explanation: </span>
            {macro?.beginnerExplanation || mt5?.beginnerExplanation || "MT5 data shows what price is doing; macro context explains why it may matter."}
            {" "}
            This is market-structure context, not a buy/sell recommendation.
          </p>
          <p>
            <span style={{ color: C.text }}>Invalidation level: </span>
            {macro?.invalidationLevel || mt5?.invalidationLevel || "Use nearest support/resistance and structure change."}
          </p>
        </div>
      </div>
    </div>
  );
}

function FactorList({ title, items }: { title: string; items: string[] }) {
  return (
    <p>
      <span style={{ color: C.text }}>{title}: </span>
      {items.length ? items.join("; ") : "None."}
    </p>
  );
}

function Evidence({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <p>
      <span style={{ color: C.text }}>{title}: </span>
      {items.join("; ")}
    </p>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded p-2">
      <div style={{ color: C.gold }} className="uppercase font-mono text-[10px] mb-1">
        {label}
      </div>
      <div style={{ color: color || C.textDim }}>{value || "-"}</div>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "favorable") return "FAVORABLE";
  if (status === "caution") return "CAUTION";
  if (status === "avoid") return "AVOID";
  return "NO DATA";
}

function statusColor(color: string) {
  if (color === "green") return C.rise;
  if (color === "orange") return C.amber;
  if (color === "red") return C.fall;
  return C.neutral;
}

function biasColor(bias: string) {
  if (bias === "bullish") return C.rise;
  if (bias === "bearish") return C.fall;
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

function getFreshness(createdAt: string | undefined) {
  if (!createdAt) {
    return { label: "NO DATA", color: C.neutral };
  }
  const receivedAt = new Date(createdAt).getTime();
  if (Number.isNaN(receivedAt)) {
    return { label: "NO DATA", color: C.neutral };
  }
  const ageMinutes = (Date.now() - receivedAt) / 60_000;
  if (ageMinutes <= 15) {
    return { label: "LIVE", color: C.rise };
  }
  return { label: "STALE", color: C.amber };
}

function formatVolatility(mt5: ChartRead) {
  const value = mt5.volatilityDetail || mt5.volatility || "-";
  if (value === "-") return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
