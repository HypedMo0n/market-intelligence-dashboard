import { parseJsonLoose, stripUnsafeTradingLanguage } from "./parseJsonLoose";

type AnthropicContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;

type AnthropicOptions = {
  system: string;
  userContent: AnthropicContent;
  useSearch?: boolean;
  maxTokens?: number;
};

export async function callAnthropicJson<T>(options: AnthropicOptions): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: options.maxTokens ?? 1200,
      system: options.system,
      messages: [{ role: "user", content: options.userContent }],
      ...(options.useSearch
        ? { tools: [{ type: "web_search_20250305", name: "web_search" }] }
        : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = extractText(data);
  const parsed = parseJsonLoose<T>(text);
  return stripUnsafeTradingLanguage(parsed) as T;
}

function extractText(data: { content?: Array<{ type: string; text?: string }> }): string {
  return (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
}
