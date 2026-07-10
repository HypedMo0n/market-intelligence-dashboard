"use client";

import { CandlestickSeries, createChart, createSeriesMarkers, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { C } from "@/lib/theme";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BiasMarker {
  time: string;
  text: string;
  color: string;
}

export function InstrumentChart({
  candles,
  biasMarkers,
  loading,
  error,
  disconnected,
  compact,
}: {
  candles: Candle[];
  biasMarkers?: BiasMarker[];
  loading?: boolean;
  error?: string | null;
  disconnected?: boolean;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const height = compact ? 150 : 320;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading || error || disconnected || candles.length === 0) return;

    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      layout: {
        background: { color: "transparent" },
        textColor: C.textDim,
      },
      grid: {
        vertLines: { color: C.line },
        horzLines: { color: C.line },
      },
      rightPriceScale: {
        borderColor: C.line,
      },
      timeScale: {
        borderColor: C.line,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: C.neutral },
        horzLine: { color: C.neutral },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.rise,
      downColor: C.fall,
      borderUpColor: C.rise,
      borderDownColor: C.fall,
      wickUpColor: C.rise,
      wickDownColor: C.fall,
    });

    series.setData(candles.map((candle) => ({ ...candle, time: toChartTime(candle.time) })));
    createSeriesMarkers(
      series,
      (biasMarkers || [])
        .map((marker): SeriesMarker<UTCTimestamp> | null => {
          const time = toChartTime(marker.time);
          if (!time) return null;
          return {
            time,
            position: "aboveBar",
            color: marker.color,
            shape: "circle",
            text: marker.text,
          };
        })
        .filter((marker): marker is SeriesMarker<UTCTimestamp> => Boolean(marker)),
    );
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [biasMarkers, candles, compact, disconnected, error, height, loading]);

  if (loading) {
    return (
      <div style={{ height, background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="flex items-center justify-center">
        <span style={{ color: C.textDim, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.08em]">
          Loading candle history...
        </span>
      </div>
    );
  }

  if (disconnected) {
    return <ChartMessage height={height} tone="warning" text="MT5 bridge candle history is not connected yet." />;
  }

  if (error) {
    return <ChartMessage height={height} tone="error" text={error} />;
  }

  if (candles.length === 0) {
    return <ChartMessage height={height} tone="muted" text="No candle history available yet." />;
  }

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

function ChartMessage({ height, tone, text }: { height: number; tone: "warning" | "error" | "muted"; text: string }) {
  const color = tone === "error" ? C.fall : tone === "warning" ? C.amber : C.textDim;
  return (
    <div style={{ height, background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="flex items-center justify-center p-4 text-center">
      <span style={{ color, fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-[0.08em] leading-5">
        {text}
      </span>
    </div>
  );
}

function toChartTime(value: string): UTCTimestamp {
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.floor(timestamp / 1000) as UTCTimestamp;
  return Math.floor(Date.now() / 1000) as UTCTimestamp;
}
