import { parseJsonLoose, stripUnsafeTradingLanguage } from "../ai/parseJsonLoose.ts";

type OpenAiOptions = {
  system: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  stripUnsafe?: boolean;
};

export function hasOpenAiConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function callOpenAiJson<T>(options: OpenAiOptions): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    throw new Error("OpenAI is not configured. Set OPENAI_API_KEY, or use the local fallback.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1400,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    throw new Error(redactOpenAiSecrets(error instanceof Error ? error.message : "OpenAI request failed.", apiKey));
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(redactOpenAiSecrets(`OpenAI request failed (${response.status}): ${text.slice(0, 500)}`, apiKey));
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonLoose<T>(text);
  return (options.stripUnsafe === false ? parsed : stripUnsafeTradingLanguage(parsed)) as T;
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export function redactOpenAiSecrets(message: string, apiKey = process.env.OPENAI_API_KEY) {
  let redacted = message.replace(/(authorization:\s*bearer\s+)[^\s,}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/([?&]api_key=)[^&\s]+/gi, "$1[REDACTED]");
  if (apiKey) {
    redacted = redacted.split(apiKey).join("[REDACTED]");
  }
  return redacted;
}
