import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchTwelveDataQuote, searchTwelveDataAssets } from "./twelveData.ts";

describe("Twelve Data provider", () => {
  it("searches local aliases without an API key", async () => {
    const oldKey = process.env.TWELVE_DATA_API_KEY;
    delete process.env.TWELVE_DATA_API_KEY;
    try {
      const results = await searchTwelveDataAssets("AAPL");
      assert(results.some((asset) => asset.symbol === "AAPL"));
    } finally {
      if (oldKey) process.env.TWELVE_DATA_API_KEY = oldKey;
    }
  });

  it("returns an unavailable quote when the API key is missing", async () => {
    const oldKey = process.env.TWELVE_DATA_API_KEY;
    delete process.env.TWELVE_DATA_API_KEY;
    try {
      const quote = await fetchTwelveDataQuote("EURUSD");
      assert.equal(quote.provider, "Twelve Data");
      assert.equal(quote.status, "unavailable");
      assert.equal(quote.price, null);
    } finally {
      if (oldKey) process.env.TWELVE_DATA_API_KEY = oldKey;
    }
  });

  it("caches successful quote responses", async () => {
    const oldKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = "test-key";
    let calls = 0;
    try {
      await fetchTwelveDataQuote("CACHEME", async () => {
        calls += 1;
        return new Response(JSON.stringify({ symbol: "CACHEME", name: "Cache Test", type: "stock", close: "10.5", change: "0.5", percent_change: "5" }));
      });
      const second = await fetchTwelveDataQuote("CACHEME", async () => {
        calls += 1;
        return new Response("{}");
      });
      assert.equal(calls, 1);
      assert.equal(second.status, "cached");
    } finally {
      if (oldKey) process.env.TWELVE_DATA_API_KEY = oldKey;
      else delete process.env.TWELVE_DATA_API_KEY;
    }
  });
});
