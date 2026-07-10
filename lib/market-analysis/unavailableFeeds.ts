export function buildCalendarUnavailablePayload(now = new Date().toISOString()) {
  return {
    events: [],
    provider: "unavailable",
    status: "unavailable",
    message: "No economic-calendar provider is connected yet. Events are not fabricated.",
    fetchedAt: now,
  };
}

export function buildNewsUnavailablePayload(now = new Date().toISOString()) {
  return {
    items: [],
    provider: "unavailable",
    status: "unavailable",
    message: "No market-news provider is connected yet. Headlines are not fabricated.",
    fetchedAt: now,
  };
}
