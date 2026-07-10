import { parseJsonLoose, stripUnsafeTradingLanguage } from "../ai/parseJsonLoose.ts";

type AiOptions = {
  system: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  stripUnsafe?: boolean;
};

type AiResult<T> = {
  model: string;
  provider: "gemini" | "groq";
  value: T;
};

const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

export function hasGeminiConfig() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function hasGroqConfig() {
  return Boolean(process.env.GROQ_API_KEY);
}

export function hasAiConfig() {
  return hasGeminiConfig() || hasGroqConfig();
}

export function getPrimaryAiModel() {
  if (hasGeminiConfig()) return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (hasGroqConfig()) return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  return "deterministic-fallback";
}

export async function callAiJsonWithFallback<T>(options: AiOptions): Promise<AiResult<T>> {
  if (hasGeminiConfig()) {
    try {
      return {
        provider: "gemini",
        model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        value: await callGeminiJson<T>(options),
      };
    } catch {
      if (!hasGroqConfig()) throw new Error("Gemini request failed and Groq is not configured.");
    }
  }

  if (hasGroqConfig()) {
    return {
      provider: "groq",
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      value: await callGroqJson<T>(options),
    };
  }

  throw new Error("No AI provider is configured. Set GEMINI_API_KEY or GROQ_API_KEY.");
}

export async function callGeminiJson<T>(options: AiOptions): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured. Set GEMINI_API_KEY.");

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const data = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [{ role: "user", parts: [{ text: options.userContent }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 900,
          responseMimeType: "application/json",
        },
      }),
    },
    options,
    apiKey,
    "Gemini",
  );

  const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("\n") || "{}";
  return normalizeAiJson<T>(text, options);
}

export async function callGroqJson<T>(options: AiOptions): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq is not configured. Set GROQ_API_KEY.");

  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const data = await requestJson(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 900,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.userContent },
        ],
        response_format: { type: "json_object" },
      }),
    },
    options,
    apiKey,
    "Groq",
  );

  return normalizeAiJson<T>(data.choices?.[0]?.message?.content || "{}", options);
}

export function redactAiSecrets(message: string, keys = [process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY]) {
  let redacted = message
    .replace(/(authorization:\s*bearer\s+)[^\s,}]+/gi, "$1[REDACTED]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/([?&]api_key=)[^&\s]+/gi, "$1[REDACTED]");
  for (const key of keys) {
    if (key) redacted = redacted.split(key).join("[REDACTED]");
  }
  return redacted;
}

async function requestJson(url: string, init: RequestInit, options: AiOptions, apiKey: string, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(redactAiSecrets(`${label} request failed (${response.status}): ${text.slice(0, 500)}`, [apiKey]));
    }
    return response.json();
  } catch (error) {
    throw new Error(redactAiSecrets(error instanceof Error ? error.message : `${label} request failed.`, [apiKey]));
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAiJson<T>(text: string, options: AiOptions) {
  const parsed = parseJsonLoose<T>(text);
  return (options.stripUnsafe === false ? parsed : stripUnsafeTradingLanguage(parsed)) as T;
}
