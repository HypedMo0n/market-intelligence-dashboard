import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callAiJsonWithFallback, redactAiSecrets } from "./aiProviders.ts";

describe("AI provider routing", () => {
  it("uses Gemini successfully when configured", async () => {
    const env = saveEnv();
    process.env.GEMINI_API_KEY = "gemini-secret";
    delete process.env.GROQ_API_KEY;
    try {
      const result = await callAiJsonWithFallback<{ ok: boolean }>({
        system: "system",
        userContent: "user",
        fetchImpl: async (url) => {
          assert(String(url).includes("generativelanguage.googleapis.com"));
          return jsonResponse({ candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }] });
        },
      });
      assert.equal(result.provider, "gemini");
      assert.equal(result.value.ok, true);
    } finally {
      restoreEnv(env);
    }
  });

  it("falls back from Gemini failure to Groq success", async () => {
    const env = saveEnv();
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.GROQ_API_KEY = "groq-secret";
    let calls = 0;
    try {
      const result = await callAiJsonWithFallback<{ ok: boolean }>({
        system: "system",
        userContent: "user",
        fetchImpl: async (url) => {
          calls += 1;
          if (String(url).includes("generativelanguage")) return jsonResponse({ error: "bad" }, 500);
          assert(String(url).includes("api.groq.com"));
          return jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] });
        },
      });
      assert.equal(calls, 2);
      assert.equal(result.provider, "groq");
    } finally {
      restoreEnv(env);
    }
  });

  it("redacts API keys from errors", () => {
    assert(!redactAiSecrets("authorization: Bearer groq-secret&key=gemini-secret", ["groq-secret", "gemini-secret"]).includes("secret"));
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function saveEnv() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  };
}

function restoreEnv(env: ReturnType<typeof saveEnv>) {
  if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  else delete process.env.GEMINI_API_KEY;
  if (env.GROQ_API_KEY) process.env.GROQ_API_KEY = env.GROQ_API_KEY;
  else delete process.env.GROQ_API_KEY;
}
