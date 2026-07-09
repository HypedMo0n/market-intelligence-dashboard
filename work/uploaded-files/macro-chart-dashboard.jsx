import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  Clock,
  AlertCircle,
  Info,
  Upload,
  Image as ImageIcon,
  Gauge,
  X,
} from "lucide-react";

// ---- design tokens ----
const C = {
  bg: "#0B1220",
  surface: "#111B2E",
  surfaceRaised: "#16223A",
  line: "#243352",
  text: "#EDE7D9",
  textDim: "#8C97AE",
  gold: "#C9A227",
  rise: "#4FAE7A",
  fall: "#C2564B",
  neutral: "#5A6C8C",
  amber: "#D9A441",
};

const INSTRUMENTS = [
  { key: "XAUUSD", label: "XAU/USD", name: "Gold", group: "metal" },
  { key: "XAGUSD", label: "XAG/USD", name: "Silver", group: "metal" },
  { key: "EURUSD", label: "EUR/USD", name: "Euro / Dollar", group: "fx" },
  { key: "AUDUSD", label: "AUD/USD", name: "Aussie / Dollar", group: "fx" },
  { key: "GBPJPY", label: "GBP/JPY", name: "Sterling / Yen", group: "fx" },
];

const STATIC_DRIVERS = {
  XAUUSD: "USD strength + real yields. A strong dollar and rising yields usually pressure gold; a weaker dollar or falling yields usually support it.",
  XAGUSD: "USD + risk mood, plus industrial demand. Silver often tracks gold but with more volatility, since it's part monetary metal, part industrial input.",
  EURUSD: "USD story vs. euro story. Falls when the Fed sounds more hawkish than the ECB, rises on the reverse.",
  AUDUSD: "China demand, commodities, and broad risk appetite. Tends to fall in risk-off moves and rise when commodity demand is strong.",
  GBPJPY: "UK rate expectations vs. yen weakness and risk mood. Known for violent moves — yen weakness alone can push this pair higher even without a UK story.",
};

const EXPLAIN_MAP = {
  usdStrength: "The dollar's strength versus a basket of major currencies (proxied by the DXY index). A stronger dollar is a headwind for gold, silver, EUR/USD, and AUD/USD, since those are all effectively 'short USD' positions.",
  rateExpectations: "What the market currently expects the Fed to do next, based on Fed funds futures pricing. Rising hike odds = hawkish = generally USD-supportive. This is a market-implied probability, not a forecast.",
  yields: "The US 10-year Treasury yield. Rising yields raise the opportunity cost of holding non-yielding assets like gold, and typically attract capital into USD.",
  inflationEmployment: "The latest CPI, PCE, or jobs data versus what was expected. Markets move on the surprise relative to forecast, not the headline number in isolation.",
  centralBank: "Recent Fed (or other central bank) language. Watch for words like 'easing bias' being added or removed, and where officials' rate projections are clustering.",
  riskMood: "Whether capital is flowing toward risk assets (stocks, AUD) or safe havens (USD, JPY, CHF, gold). Often summarized by equity moves and the VIX.",
  marketStructure: "Whether price is making higher highs and higher lows (uptrend), lower highs and lower lows (downtrend), or neither (range/chop). This is read directly off the chart, not a prediction.",
  liquidityZones: "Areas just beyond an obvious high or low where stop-losses tend to cluster. Price sometimes runs these zones before reversing — worth knowing where they sit even if you're not trading them directly.",
  newsRisk: "Scheduled high-impact releases (CPI, NFP, central bank decisions) create a volatility window. Spreads widen and price can whip in both directions right at release — many systematic traders sit out this window entirely.",
  tradeReadiness: "A composite of: does the macro story agree with the chart trend, is confidence in that story high, is volatility manageable, and is there a news landmine nearby. High readiness means the pieces line up; low readiness means they conflict or there's a release about to hit.",
};

function callClaude(system, userContent, useSearch) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userContent }],
      ...(useSearch ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}),
    }),
  }).then((r) => r.json());
}

function extractText(data) {
  if (!data || !data.content) return "";
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const MACRO_SYSTEM = `You are a macro markets analyst producing a concise personal briefing for a retail trader. Search the web for current data before answering (DXY, US 10Y yield, Fed funds futures / rate-hike odds, VIX, recent CPI/NFP surprise, recent Fed commentary). Output ONLY raw JSON, no markdown fences, no preamble, matching exactly:
{
  "asOf": "human readable date/time context",
  "narrative": "2-3 sentence plain-English story of what's driving markets right now, written like: 'The dollar is stronger today because markets expect rates to stay higher. That can pressure gold, silver, EUR/USD and AUD/USD.'",
  "usdStrength": {"level":"strong|weak|neutral","detail":"one clause"},
  "rateExpectations": {"detail":"one clause on current Fed-hike/cut odds"},
  "yields": {"level":"rising|falling|flat","detail":"one clause, include current US10Y level if found"},
  "inflationEmployment": {"detail":"one clause on the most recent notable release vs expectations"},
  "centralBank": {"detail":"one clause on recent Fed or other major central bank tone"},
  "riskMood": {"level":"risk-on|risk-off|mixed","detail":"one clause, include VIX level if found"},
  "instruments": [
    {
      "key":"XAUUSD|XAGUSD|EURUSD|AUDUSD|GBPJPY",
      "driver":"short phrase naming the dominant driver right now",
      "explanation":"one plain-English sentence connecting the driver to this instrument specifically",
      "bias":"bullish|bearish|neutral",
      "confidence":1-5,
      "newsRisk":{"level":"none|soon|imminent","detail":"name the event and rough timing if any major release is within 24h, else empty string"}
    }
  ],
  "sources": ["short source name 1","short source name 2","short source name 3"]
}
Cover all five instruments: XAUUSD, XAGUSD, EURUSD, AUDUSD, GBPJPY. Never state bias as certain — frame as current conditions, not a prediction. Keep every string short; this is a glanceable dashboard.`;

const CHART_SYSTEM = `You are reading one trading chart screenshot for a beginner trader. Output ONLY raw JSON, no markdown fences, no preamble, matching exactly:
{
  "trend": "up|down|sideways",
  "structure": "higher highs and higher lows|lower highs and lower lows|range or choppy",
  "volatility": "calm|normal|aggressive",
  "keyLevels": {"recentHigh":"value or description","recentLow":"value or description","support":"value or description","resistance":"value or description"},
  "liquidityZones": "one short sentence on where stops likely cluster (just beyond the obvious high/low)",
  "notes": "one sentence summarizing what the chart shows, in plain English"
}
Read only what is visible on the chart. If a level isn't clearly readable, say "not clearly visible" rather than guessing a number. Do not give a trade recommendation — only describe what the chart shows.`;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Could not read image"));
    r.readAsDataURL(file);
  });
}

function biasColor(bias) {
  if (bias === "bullish") return C.rise;
  if (bias === "bearish") return C.fall;
  return C.neutral;
}

function readinessScore(inst, chart) {
  let score = 50;
  const chartDir = chart ? (chart.trend === "up" ? "bullish" : chart.trend === "down" ? "bearish" : "neutral") : null;
  if (chartDir && inst.bias !== "neutral" && chartDir !== "neutral") {
    score += chartDir === inst.bias ? 20 : -20;
  }
  if (inst.confidence >= 4) score += 10;
  if (inst.confidence <= 2) score -= 10;
  if (inst.newsRisk?.level === "imminent") score -= 25;
  if (inst.newsRisk?.level === "soon") score -= 10;
  if (chart?.volatility === "aggressive") score -= 10;
  if (chart?.volatility === "calm") score += 5;
  return Math.max(0, Math.min(100, score));
}

function readinessLabel(score) {
  if (score >= 70) return { label: "High", color: C.rise };
  if (score >= 40) return { label: "Medium", color: C.amber };
  return { label: "Low", color: C.fall };
}

function buildVerdict(instMeta, inst, chart) {
  const name = instMeta.label;
  const dirWord = inst.bias === "bullish" ? "bullish" : inst.bias === "bearish" ? "bearish" : "mixed";
  let sentence = `${name} conditions are ${dirWord} right now because ${inst.explanation || inst.driver}.`;
  if (chart) {
    sentence += ` The chart shows a ${chart.trend} trend with ${chart.structure}, and volatility looks ${chart.volatility}.`;
  } else {
    sentence += ` Upload a chart screenshot below to add trend and level context.`;
  }
  let idea;
  if (inst.bias === "bullish" && (!chart || chart.trend !== "down")) idea = "A long idea makes more sense than a short idea here";
  else if (inst.bias === "bearish" && (!chart || chart.trend !== "up")) idea = "A short idea makes more sense than a long idea here";
  else idea = "The macro and chart pictures don't clearly agree, so a directional edge is weak right now";
  sentence += ` ${idea}, but this is context, not an instruction.`;
  return sentence;
}

function Explain({ id }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="align-middle ml-1">
        <Info size={13} style={{ color: C.textDim }} />
      </button>
      {open && (
        <span
          style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, color: C.textDim }}
          className="absolute z-10 left-0 top-5 w-64 text-xs leading-relaxed rounded-md p-3 shadow-xl"
        >
          {EXPLAIN_MAP[id]}
          <button onClick={() => setOpen(false)} className="block mt-2" style={{ color: C.gold }}>
            close
          </button>
        </span>
      )}
    </span>
  );
}

function MetricChip({ label, value, explainId }) {
  return (
    <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}` }} className="rounded-md p-3">
      <div className="flex items-center text-xs uppercase tracking-wide font-mono mb-1" style={{ color: C.gold }}>
        {label}
        <Explain id={explainId} />
      </div>
      <p style={{ color: C.textDim }} className="text-sm leading-snug">{value || "—"}</p>
    </div>
  );
}

function UsdStrengthMeter({ usdStrength }) {
  const level = usdStrength?.level;
  const pct = level === "strong" ? 82 : level === "weak" ? 18 : 50;
  const color = level === "strong" ? C.rise : level === "weak" ? C.fall : C.neutral;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={16} style={{ color: C.gold }} />
        <h3 style={{ color: C.text }} className="font-serif text-lg">USD Strength Meter</h3>
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
      <p style={{ color: C.textDim }} className="text-sm mt-3">{usdStrength?.detail}</p>
    </div>
  );
}

function InstrumentCard({ instMeta, inst, chart, chartLoading, onUpload, onRemoveChart }) {
  const fileRef = useRef(null);
  const score = inst ? readinessScore(inst, chart) : null;
  const readiness = score !== null ? readinessLabel(score) : null;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 style={{ color: C.text }} className="font-serif text-xl">{instMeta.label}</h3>
          <p style={{ color: C.textDim }} className="text-xs">{instMeta.name}</p>
        </div>
        {inst && (
          <span
            style={{ color: biasColor(inst.bias), borderColor: biasColor(inst.bias) }}
            className="text-xs uppercase tracking-wide border rounded px-2 py-0.5"
          >
            {inst.bias} · conf {inst.confidence}/5
          </span>
        )}
      </div>

      <p style={{ color: C.textDim }} className="text-sm">
        <span style={{ color: C.text }}>Main driver: </span>
        {inst ? inst.driver : STATIC_DRIVERS[instMeta.key]}
      </p>

      {inst?.newsRisk?.level && inst.newsRisk.level !== "none" && (
        <div
          style={{
            background: inst.newsRisk.level === "imminent" ? "#2A1620" : "#2A2216",
            border: `1px solid ${inst.newsRisk.level === "imminent" ? C.fall : C.amber}`,
            color: inst.newsRisk.level === "imminent" ? C.fall : C.amber,
          }}
          className="text-xs rounded px-3 py-2 flex items-center gap-2"
        >
          <AlertCircle size={13} />
          {inst.newsRisk.level === "imminent" ? "Danger zone: " : "Upcoming: "}
          {inst.newsRisk.detail}
        </div>
      )}

      {/* chart section */}
      <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3">
        <div className="flex items-center justify-between mb-2">
          <span style={{ color: C.gold }} className="text-xs uppercase tracking-wide font-mono flex items-center">
            Chart reading <Explain id="marketStructure" />
          </span>
          <div className="flex items-center gap-2">
            {chart && (
              <button onClick={() => onRemoveChart(instMeta.key)} style={{ color: C.textDim }} className="text-xs flex items-center gap-1">
                <X size={12} /> clear
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={chartLoading}
              style={{ color: C.gold, borderColor: C.gold }}
              className="text-xs border rounded px-2 py-1 flex items-center gap-1 disabled:opacity-50"
            >
              <Upload size={12} />
              {chartLoading ? "Reading chart..." : chart ? "Replace screenshot" : "Upload screenshot"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(instMeta.key, f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {!chart ? (
          <div style={{ color: C.textDim, border: `1px dashed ${C.line}` }} className="rounded p-4 text-xs text-center flex flex-col items-center gap-1">
            <ImageIcon size={16} />
            No chart yet — upload a screenshot for trend, structure, and key levels.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p style={{ color: C.textDim }} className="text-sm">{chart.notes}</p>
            <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: C.textDim }}>
              <div><span style={{ color: C.text }}>Trend: </span>{chart.trend}</div>
              <div><span style={{ color: C.text }}>Volatility: </span>{chart.volatility}</div>
              <div className="col-span-2"><span style={{ color: C.text }}>Structure: </span>{chart.structure}</div>
              <div><span style={{ color: C.text }}>Recent high: </span>{chart.keyLevels?.recentHigh}</div>
              <div><span style={{ color: C.text }}>Recent low: </span>{chart.keyLevels?.recentLow}</div>
              <div><span style={{ color: C.text }}>Support: </span>{chart.keyLevels?.support}</div>
              <div><span style={{ color: C.text }}>Resistance: </span>{chart.keyLevels?.resistance}</div>
              <div className="col-span-2 flex items-start">
                <span style={{ color: C.text }}>Liquidity: </span>&nbsp;{chart.liquidityZones}
                <Explain id="liquidityZones" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* readiness + verdict */}
      {inst && (
        <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3">
          <div className="flex items-center justify-between mb-2">
            <span style={{ color: C.gold }} className="text-xs uppercase tracking-wide font-mono flex items-center">
              Trade readiness <Explain id="tradeReadiness" />
            </span>
            <span style={{ color: readiness.color, borderColor: readiness.color }} className="text-xs border rounded px-2 py-0.5">
              {readiness.label} · {score}/100
            </span>
          </div>
          <p style={{ color: C.textDim }} className="text-sm leading-relaxed">
            {buildVerdict(instMeta, inst, chart)}
          </p>
        </div>
      )}
    </div>
  );
}

const MT5_EXAMPLE = `{
  "XAUUSD": {
    "trend": "down",
    "structure": "lower highs and lower lows",
    "volatility": "normal",
    "keyLevels": {"recentHigh": "2378.40", "recentLow": "2361.10", "support": "2360.00", "resistance": "2378.00"},
    "liquidityZones": "Stops likely cluster just below 2361.10 and just above 2378.40.",
    "notes": "Price broke below yesterday's low on the H1 chart and has not reclaimed it."
  }
}`;

export default function MacroChartDashboard() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [charts, setCharts] = useState({});
  const [chartLoading, setChartLoading] = useState({});
  const [mt5Text, setMt5Text] = useState("");
  const [mt5Open, setMt5Open] = useState(false);
  const [mt5Status, setMt5Status] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("macro-chart-dashboard-state");
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          setScan(parsed.scan || null);
          setCharts(parsed.charts || {});
        }
      } catch (e) {
        // no saved state yet
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    try {
      await window.storage.set("macro-chart-dashboard-state", JSON.stringify(next));
    } catch (e) {
      console.error("storage save failed", e);
    }
  }, []);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callClaude(
        MACRO_SYSTEM,
        "Give me the current macro briefing and per-instrument impact for XAUUSD, XAGUSD, EURUSD, AUDUSD, and GBPJPY, right now.",
        true
      );
      const text = extractText(data);
      const parsed = parseJsonLoose(text);
      const withTime = { ...parsed, fetchedAt: new Date().toISOString() };
      setScan(withTime);
      await persist({ scan: withTime, charts });
    } catch (e) {
      setError("Scan failed — " + (e.message || "unknown error") + ". Try again.");
    } finally {
      setLoading(false);
    }
  }, [charts, persist]);

  const uploadChart = useCallback(
    async (key, file) => {
      setChartLoading((p) => ({ ...p, [key]: true }));
      try {
        const base64 = await fileToBase64(file);
        const mediaType = file.type || "image/png";
        const data = await callClaude(
          CHART_SYSTEM,
          [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: `This is a price chart for ${key}. Read it per the schema.` },
          ],
          false
        );
        const text = extractText(data);
        const parsed = parseJsonLoose(text);
        const nextCharts = { ...charts, [key]: parsed };
        setCharts(nextCharts);
        await persist({ scan, charts: nextCharts });
      } catch (e) {
        setError(`Chart reading failed for ${key} — ${e.message || "unknown error"}.`);
      } finally {
        setChartLoading((p) => ({ ...p, [key]: false }));
      }
    },
    [charts, scan, persist]
  );

  const removeChart = useCallback(
    (key) => {
      const nextCharts = { ...charts };
      delete nextCharts[key];
      setCharts(nextCharts);
      persist({ scan, charts: nextCharts });
    },
    [charts, scan, persist]
  );

  const importMt5Data = useCallback(() => {
    setMt5Status(null);
    let parsed;
    try {
      parsed = JSON.parse(mt5Text);
    } catch (e) {
      setMt5Status({ ok: false, msg: "That's not valid JSON — check for a trailing comma or missing quote." });
      return;
    }
    const validKeys = INSTRUMENTS.map((i) => i.key);
    const imported = Object.keys(parsed).filter((k) => validKeys.includes(k));
    if (imported.length === 0) {
      setMt5Status({ ok: false, msg: `No recognized instrument keys found. Expected one or more of: ${validKeys.join(", ")}.` });
      return;
    }
    const nextCharts = { ...charts };
    imported.forEach((k) => {
      const c = parsed[k];
      nextCharts[k] = {
        trend: c.trend || "sideways",
        structure: c.structure || "range or choppy",
        volatility: c.volatility || "normal",
        keyLevels: c.keyLevels || {},
        liquidityZones: c.liquidityZones || "",
        notes: c.notes || "Imported from MT5 — no notes provided.",
      };
    });
    setCharts(nextCharts);
    persist({ scan, charts: nextCharts });
    setMt5Status({ ok: true, msg: `Imported chart data for ${imported.join(", ")}.` });
  }, [mt5Text, charts, scan, persist]);

  const newsWarnings = (scan?.instruments || []).filter((i) => i.newsRisk?.level && i.newsRisk.level !== "none");

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }} className="w-full font-sans">
      <div className="max-w-5xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 style={{ color: C.text }} className="font-serif text-3xl tracking-tight">Macro + Chart Reader</h1>
            <p style={{ color: C.textDim }} className="text-sm mt-1">Explains the market. Doesn't trade it for you.</p>
          </div>
          <button
            onClick={runScan}
            disabled={loading}
            style={{ background: C.gold, color: C.bg }}
            className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            {loading ? "Scanning macro..." : scan ? "Run new scan" : "Run first scan"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#2A1620", border: `1px solid ${C.fall}`, color: C.fall }} className="rounded-md px-4 py-3 mb-6 flex items-center gap-2 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* 1. Global macro brief */}
        {scan ? (
          <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-6 mb-6">
            <div className="flex items-center gap-2 mb-2" style={{ color: C.textDim }}>
              <Clock size={14} />
              <span className="text-xs font-mono">{scan.asOf || new Date(scan.fetchedAt).toLocaleString()}</span>
            </div>
            <p style={{ color: C.text }} className="font-serif text-xl leading-relaxed mb-4">{scan.narrative}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <MetricChip label="USD strength" value={scan.usdStrength?.detail} explainId="usdStrength" />
              <MetricChip label="Rate expectations" value={scan.rateExpectations?.detail} explainId="rateExpectations" />
              <MetricChip label="Yields" value={scan.yields?.detail} explainId="yields" />
              <MetricChip label="Inflation / employment" value={scan.inflationEmployment?.detail} explainId="inflationEmployment" />
              <MetricChip label="Central bank tone" value={scan.centralBank?.detail} explainId="centralBank" />
              <MetricChip label="Risk mood" value={scan.riskMood?.detail} explainId="riskMood" />
            </div>
            {scan.sources?.length > 0 && (
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {scan.sources.map((s, i) => (
                  <span key={i} style={{ color: C.textDim, borderColor: C.line }} className="text-xs border rounded px-2 py-0.5">{s}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px dashed ${C.line}`, color: C.textDim }} className="rounded-lg p-8 mb-6 text-center text-sm">
            No scan yet. Run one to pull current USD strength, rate expectations, yields, and risk mood.
          </div>
        )}

        {/* 2. USD strength meter */}
        <div className="mb-6">
          <UsdStrengthMeter usdStrength={scan?.usdStrength} />
        </div>

        {/* 7. news risk warning banner */}
        {newsWarnings.length > 0 && (
          <div style={{ background: "#2A1620", border: `1px solid ${C.fall}` }} className="rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2" style={{ color: C.fall }}>
              <AlertCircle size={16} />
              <span className="font-serif text-lg">News risk</span>
              <Explain id="newsRisk" />
            </div>
            <ul className="flex flex-col gap-1">
              {newsWarnings.map((w) => (
                <li key={w.key} style={{ color: C.textDim }} className="text-sm">
                  <span style={{ color: C.text }}>{w.key}: </span>{w.newsRisk.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* MT5 import panel */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6">
          <button onClick={() => setMt5Open((o) => !o)} className="w-full flex items-center justify-between">
            <span style={{ color: C.text }} className="font-serif text-lg">Import MT5 data</span>
            <span style={{ color: C.textDim }} className="text-xs">{mt5Open ? "hide" : "paste JSON from your local script"}</span>
          </button>
          {mt5Open && (
            <div className="mt-3 flex flex-col gap-2">
              <p style={{ color: C.textDim }} className="text-xs leading-relaxed">
                Paste the JSON your local MT5 script outputs — one object keyed by instrument, each with trend / structure / volatility / keyLevels / liquidityZones / notes. This replaces the screenshot-upload step for that instrument with real price data.
              </p>
              <textarea
                value={mt5Text}
                onChange={(e) => setMt5Text(e.target.value)}
                placeholder={MT5_EXAMPLE}
                rows={8}
                style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, color: C.text }}
                className="w-full rounded-md p-3 text-xs font-mono"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={importMt5Data}
                  style={{ background: C.gold, color: C.bg }}
                  className="text-sm rounded-md px-4 py-2 font-medium"
                >
                  Import
                </button>
                {mt5Status && (
                  <span style={{ color: mt5Status.ok ? C.rise : C.fall }} className="text-xs">
                    {mt5Status.msg}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3 & 4. instrument impact + 5/6/8 chart + levels + readiness, combined per card */}
        <h2 style={{ color: C.text }} className="font-serif text-xl mb-3">Instrument Impact & Chart Reading</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {INSTRUMENTS.map((instMeta) => (
            <InstrumentCard
              key={instMeta.key}
              instMeta={instMeta}
              inst={scan?.instruments?.find((i) => i.key === instMeta.key)}
              chart={charts[instMeta.key]}
              chartLoading={!!chartLoading[instMeta.key]}
              onUpload={uploadChart}
              onRemoveChart={removeChart}
            />
          ))}
        </div>

        <p style={{ color: C.textDim }} className="text-xs mt-4 text-center opacity-60">
          Runs on demand — no background monitoring, no auto-trading. Everything above is context to help you decide, not an instruction to act.
        </p>
      </div>
    </div>
  );
}
