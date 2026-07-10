import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMacroRefreshFailure, buildMacroRefreshStatus } from "./macroRefreshStatus.ts";

describe("macro refresh status", () => {
  it("marks provider-backed refreshes as updated", () => {
    assert.deepEqual(buildMacroRefreshStatus({ sources: ["Gemini"] }, "2026-07-10T12:00:00.000Z"), {
      state: "updated",
      lastRefreshed: "2026-07-10T12:00:00.000Z",
      source: "Gemini",
      message: "Macro context refreshed.",
    });
  });

  it("marks deterministic fallback refreshes as cached", () => {
    assert.equal(buildMacroRefreshStatus({ sources: ["local fallback"] }).state, "cached");
  });

  it("marks failed refreshes with the error message", () => {
    const status = buildMacroRefreshFailure(new Error("FRED unavailable"), "2026-07-10T12:00:00.000Z");
    assert.equal(status.state, "failed");
    assert.equal(status.message, "FRED unavailable");
  });
});
