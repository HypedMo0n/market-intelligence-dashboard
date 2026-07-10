import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addWatchlistItem, removeWatchlistItem, toggleFavoriteItem } from "./localWatchlist.ts";

describe("local watchlist helpers", () => {
  it("adds a normalized symbol once", () => {
    assert.deepEqual(addWatchlistItem(["XAUUSD"], " eurusd "), ["XAUUSD", "EURUSD"]);
    assert.deepEqual(addWatchlistItem(["XAUUSD"], "XAUUSD"), ["XAUUSD"]);
  });

  it("removes symbols from watchlist and favorites together", () => {
    assert.deepEqual(removeWatchlistItem(["XAUUSD", "AAPL"], ["AAPL"], "AAPL"), {
      watchlist: ["XAUUSD"],
      favorites: [],
    });
  });

  it("toggles favorites", () => {
    assert.deepEqual(toggleFavoriteItem(["XAUUSD"], "AAPL"), ["XAUUSD", "AAPL"]);
    assert.deepEqual(toggleFavoriteItem(["XAUUSD", "AAPL"], "AAPL"), ["XAUUSD"]);
  });
});
