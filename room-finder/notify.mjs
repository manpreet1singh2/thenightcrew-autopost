// Notification hook for later Telegram / email support.
// Only genuinely new listings and meaningful price changes become events. No channel is enabled yet:
// events are written to room-finder-output/notifications.json so a future channel can send them.
// This module must never message property owners — it only notifies YOU.

export function buildEvents(records, priceChanges) {
  const events = [];
  for (const r of records) if (r.isNew) events.push({ type: "new_listing", title: r.title, rent: r.monthlyRentINR, distance: r.distanceLabel, url: r.url, source: r.source });
  for (const p of priceChanges) if (p.meaningful) events.push({ type: "price_change", title: p.title, from: p.from, to: p.to, url: p.url, source: p.source });
  return events;
}

// Future channels implement: { name, isConfigured(env) -> bool, send(events) -> Promise }.
export const CHANNELS = [];

export async function dispatch(events, env = process.env, log = () => {}) {
  const sent = [];
  for (const ch of CHANNELS) {
    if (!events.length || !ch.isConfigured(env)) continue;
    try { await ch.send(events); sent.push(ch.name); } catch (e) { log("warn", "notification channel failed", { channel: ch.name, error: e.message }); }
  }
  return sent;
}
