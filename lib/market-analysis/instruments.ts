export type InstrumentKey = string;

export type InstrumentMeta = {
  key: InstrumentKey;
  label: string;
  name: string;
  group: "metal" | "fx" | "stock" | "etf" | "index" | "commodity" | "crypto" | "market";
  provider?: "MT5" | "Twelve Data" | "cached data" | "unavailable";
};

export const INSTRUMENTS: InstrumentMeta[] = [
  { key: "XAUUSD", label: "XAU/USD", name: "Gold", group: "metal", provider: "MT5" },
  { key: "XAGUSD", label: "XAG/USD", name: "Silver", group: "metal", provider: "MT5" },
];

export const INSTRUMENT_KEYS = INSTRUMENTS.map((instrument) => instrument.key);

export function isInstrumentKey(value: string): value is InstrumentKey {
  return Boolean(value && typeof value === "string" && /^[A-Z0-9/._-]{2,20}$/i.test(value));
}

export const STATIC_DRIVERS: Record<string, string> = {
  XAUUSD:
    "USD strength + real yields. A strong dollar and rising yields usually pressure gold; a weaker dollar or falling yields usually support it.",
  XAGUSD:
    "USD + risk mood, plus industrial demand. Silver often tracks gold but with more volatility, since it is part monetary metal, part industrial input.",
  EURUSD:
    "USD story vs. euro story. Falls when the Fed sounds more hawkish than the ECB, rises on the reverse.",
  AUDUSD:
    "China demand, commodities, and broad risk appetite. Tends to fall in risk-off moves and rise when commodity demand is strong.",
  GBPJPY:
    "UK rate expectations vs. yen weakness and risk mood. Known for sharp moves; yen weakness alone can push this pair higher even without a UK story.",
};

export function getStaticDriver(key: string) {
  return STATIC_DRIVERS[key] || "Use provider data, macro context, relevant events, and recent price structure before forming a view.";
}
