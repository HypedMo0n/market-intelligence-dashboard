import { parseJsonLoose, stripUnsafeTradingLanguage } from "@/lib/ai/parseJsonLoose";

type OpenAiOptions = {
  system: string;
  userContent: string;
  maxTokens?: number;
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: options.maxTokens ?? 1400,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return stripUnsafeTradingLanguage(parseJsonLoose<T>(text)) as T;
}
