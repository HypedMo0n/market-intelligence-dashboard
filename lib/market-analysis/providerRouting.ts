export type DataProvider = "MT5" | "Twelve Data";

const MT5_PRIMARY_SYMBOLS = new Set(["XAUUSD", "XAGUSD"]);

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\s+/g, "").replace("/", "");
}

export function getPrimaryDataProvider(symbol: string): DataProvider {
  return MT5_PRIMARY_SYMBOLS.has(normalizeSymbol(symbol)) ? "MT5" : "Twelve Data";
}

export function isMt5PrimarySymbol(symbol: string) {
  return getPrimaryDataProvider(symbol) === "MT5";
}
