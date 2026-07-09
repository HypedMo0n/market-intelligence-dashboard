import { Gauge } from "lucide-react";
import { C } from "@/lib/theme";
import { Explain } from "@/components/common/MetricChip";

export default function UsdStrengthMeter({
  usdStrength,
}: {
  usdStrength?: { level?: "strong" | "weak" | "neutral"; detail?: string };
}) {
  const level = usdStrength?.level;
  const pct = level === "strong" ? 82 : level === "weak" ? 18 : 50;
  const color = level === "strong" ? C.rise : level === "weak" ? C.fall : C.neutral;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={16} style={{ color: C.gold }} />
        <h3 style={{ color: C.text }} className="font-serif text-lg">
          USD Strength Meter
        </h3>
        <Explain id="usdStrength" />
      </div>
      <div className="flex justify-between text-xs mb-1" style={{ color: C.textDim }}>
        <span>Weak</span>
        <span>Neutral</span>
        <span>Strong</span>
      </div>
      <div className="relative h-2 rounded-full" style={{ background: C.line }}>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all duration-700"
          style={{ left: `calc(${pct}% - 6px)`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
      <p style={{ color: C.textDim }} className="text-sm mt-3">
        {usdStrength?.detail || "Run a macro scan to refresh the current USD read."}
      </p>
    </div>
  );
}
