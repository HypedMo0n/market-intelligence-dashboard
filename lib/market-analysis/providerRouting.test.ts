import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPrimaryDataProvider, normalizeSymbol } from "./providerRouting.ts";

describe("market-data provider routing", () => {
  it("uses MT5 for XAUUSD", () => {
    assert.equal(getPrimaryDataProvider("XAUUSD"), "MT5");
  });

  it("uses MT5 for XAGUSD", () => {
    assert.equal(getPrimaryDataProvider("XAG/USD"), "MT5");
  });

  it("uses Twelve Data for other supported symbols", () => {
    assert.equal(getPrimaryDataProvider("EURUSD"), "Twelve Data");
    assert.equal(getPrimaryDataProvider("AAPL"), "Twelve Data");
    assert.equal(getPrimaryDataProvider("BTC/USD"), "Twelve Data");
  });

  it("normalizes symbol search text", () => {
    assert.equal(normalizeSymbol(" btc/usd "), "BTCUSD");
  });
});
