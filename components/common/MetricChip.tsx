"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { EXPLAIN_MAP } from "@/lib/prompts/explanations";
import { C } from "@/lib/theme";

export function Explain({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="align-middle ml-1"
        aria-label={`Explain ${id}`}
      >
        <Info size={13} style={{ color: C.textDim }} />
      </button>
      {open && (
        <span
          style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, color: C.textDim }}
          className="absolute z-20 left-0 top-5 w-64 text-xs leading-relaxed rounded-md p-3 shadow-xl"
        >
          {EXPLAIN_MAP[id] || "Context note unavailable."}
          <button type="button" onClick={() => setOpen(false)} className="block mt-2" style={{ color: C.gold }}>
            close
          </button>
        </span>
      )}
    </span>
  );
}

export default function MetricChip({
  label,
  value,
  explainId,
}: {
  label: string;
  value?: string;
  explainId: string;
}) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded-md p-3">
      <div className="flex items-center text-xs uppercase tracking-wide font-mono mb-1" style={{ color: C.gold }}>
        {label}
        <Explain id={explainId} />
      </div>
      <p style={{ color: C.textDim }} className="text-sm leading-snug">
        {value || "-"}
      </p>
    </div>
  );
}
