export type InstrumentKey = "XAUUSD" | "XAGUSD" | "EURUSD" | "AUDUSD" | "GBPJPY";

export type InstrumentMeta = {
  key: InstrumentKey;
  label: string;
  name: string;
  group: "metal" | "fx";
};

export const INSTRUMENTS: InstrumentMeta[] = [
  { key: "XAUUSD", label: "XAU/USD", name: "Gold", group: "metal" },
  { key: "XAGUSD", label: "XAG/USD", name: "Silver", group: "metal" },
  { key: "EURUSD", label: "EUR/USD", name: "Euro / Dollar", group: "fx" },
  { key: "AUDUSD", label: "AUD/USD", name: "Aussie / Dollar", group: "fx" },
  { key: "GBPJPY", label: "GBP/JPY", name: "Sterling / Yen", group: "fx" },
];

export const INSTRUMENT_KEYS = INSTRUMENTS.map((instrument) => instrument.key);

export function isInstrumentKey(value: string): value is InstrumentKey {
  return INSTRUMENT_KEYS.includes(value as InstrumentKey);
}

export const STATIC_DRIVERS: Record<InstrumentKey, string> = {
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
