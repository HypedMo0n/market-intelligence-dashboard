import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCalendarUnavailablePayload, buildNewsUnavailablePayload } from "../market-analysis/unavailableFeeds.ts";
import { buildProviderStatusPayload } from "./providerStatus.ts";

describe("provider status and unavailable feeds", () => {
  it("returns a clear calendar unavailable state without fake events", () => {
    const body = buildCalendarUnavailablePayload("2026-07-10T12:00:00.000Z");
    assert.equal(body.status, "unavailable");
    assert.deepEqual(body.events, []);
    assert.match(body.message, /not fabricated/i);
  });

  it("returns a clear news unavailable state without fake headlines", () => {
    const body = buildNewsUnavailablePayload("2026-07-10T12:00:00.000Z");
    assert.equal(body.status, "unavailable");
    assert.deepEqual(body.items, []);
    assert.match(body.message, /not fabricated/i);
  });

  it("does not expose secrets in provider status responses", () => {
    const env = saveEnv();
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.GROQ_API_KEY = "groq-secret";
    process.env.TWELVE_DATA_API_KEY = "twelve-secret";
    try {
      const text = JSON.stringify(buildProviderStatusPayload("2026-07-10T12:00:00.000Z"));
      assert(!text.includes("gemini-secret"));
      assert(!text.includes("groq-secret"));
      assert(!text.includes("twelve-secret"));
      assert.match(text, /Gemini/);
      assert.match(text, /Groq/);
      assert.match(text, /Twelve Data/);
    } finally {
      restoreEnv(env);
    }
  });
});

function saveEnv() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
  };
}

function restoreEnv(env: ReturnType<typeof saveEnv>) {
  for (const [key, value] of Object.entries(env)) {
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
}
