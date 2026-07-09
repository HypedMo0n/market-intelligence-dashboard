export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export function stripUnsafeTradingLanguage(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/guaranteed profit/gi, "uncertain outcome")
      .replace(/buy now/gi, "bullish evidence is present")
      .replace(/sell now/gi, "bearish evidence is present")
      .replace(/this will happen/gi, "this is one possible scenario");
  }
  if (Array.isArray(value)) {
    return value.map(stripUnsafeTradingLanguage);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stripUnsafeTradingLanguage(item)]),
    );
  }
  return value;
}
