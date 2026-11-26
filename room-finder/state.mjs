// Persistent state between runs: listing history, price history, source health.
// The workflow restores/saves this file with actions/cache. History is never deleted automatically.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { MISSING_RUNS_THRESHOLD, PRICE_CHANGE_MIN_INR } from "./config.mjs";

export const STATE_VERSION = 2;

export function emptyState() {
  return { version: STATE_VERSION, createdAt: new Date().toISOString(), lastRun: null, lastSuccessfulCheck: null, lastExtendedSweep: null, listings: {}, sourceHealth: {}, groups: {} };
}

export function validateState(s) {
  return !!s && typeof s === "object" && s.version === STATE_VERSION && s.listings && typeof s.listings === "object" && s.sourceHealth && typeof s.sourceHealth === "object";
}

export async function loadState(file) {
  try {
    const s = JSON.parse(await readFile(file, "utf8"));
    if (validateState(s)) return { state: s, loaded: true };
    return { state: emptyState(), loaded: false, warning: "State file had an unexpected format; starting fresh (old file kept as .bad)" };
  } catch (e) {
    return { state: emptyState(), loaded: false, warning: e.code === "ENOENT" ? "No previous state (first run or cache expired)" : `Could not read state: ${e.message}` };
  }
}

export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 1));
  await rename(tmp, file); // atomic replace: a crash never leaves a half-written state
}

const DETAIL_FIELDS = ["title", "url", "source", "sourceId", "locality", "address", "lat", "lng", "distanceKm", "roomType", "furnishing", "occupancy", "deposit", "brokerage", "amenities", "food", "tenantNotes", "listedBy", "listingDate", "updatedDate", "sourceAvailability", "detailsFetchedAt", "rentNote", "listPrice", "detailRent"];

/**
 * Merge this run's listings into state.
 * okPages: Set of list-page URLs fetched and parsed successfully this run (used for "not seen" tracking).
 * Returns { newKeys, priceChanges, reappeared, notSeen }.
 */
export function mergeRun(state, listings, okPages, now = new Date().toISOString()) {
  const seen = new Set();
  const newKeys = [], priceChanges = [], reappeared = [];
  for (const it of listings) {
    seen.add(it.key);
    const prev = state.listings[it.key];
    if (!prev) {
      state.listings[it.key] = {
        key: it.key, firstSeen: now, lastSeen: now, missingRuns: 0, status: it.inaccessible ? "inaccessible" : "active",
        rent: it.rent, rentHistory: [{ rent: it.rent, at: now }], pages: [it.foundOnPage].filter(Boolean),
        ...pick(it),
      };
      newKeys.push(it.key);
      continue;
    }
    if (prev.status === "not_seen_recently") reappeared.push(it.key);
    // Compare like with like: listing-page rent with listing-page rent, list-page price with list-page price.
    // A first listing-page read that corrects a list-page price is a correction, not a price change.
    const pair = it.detailRent ? (prev.detailRent ? [prev.detailRent, it.detailRent] : null)
      : it.listPrice !== undefined || prev.listPrice !== undefined ? (it.listPrice && prev.listPrice ? [prev.listPrice, it.listPrice] : null)
      : [prev.rent, it.rent];
    const keepDetailRent = !it.detailRent && prev.detailRent && it.listPrice && it.listPrice === prev.listPrice;
    const newRent = keepDetailRent ? prev.detailRent : it.rent ?? prev.rent;
    if (pair && pair[0] && pair[1] && pair[0] !== pair[1]) {
      priceChanges.push({ key: it.key, from: pair[0], to: pair[1], at: now, meaningful: Math.abs(pair[1] - pair[0]) >= PRICE_CHANGE_MIN_INR });
    }
    if (newRent && newRent !== prev.rent) {
      prev.rentHistory = [...(prev.rentHistory || []), { rent: newRent, at: now, ...(pair ? {} : { note: "corrected from listing page" }) }].slice(-20);
    }
    Object.assign(prev, pick(it), {
      rent: newRent,
      lastSeen: now,
      missingRuns: 0,
      status: it.inaccessible ? "inaccessible" : "active",
      pages: [...new Set([...(prev.pages || []), it.foundOnPage].filter(Boolean))].slice(-5),
    });
  }
  // Listings whose list page was re-checked successfully but which were not on it.
  const notSeen = [];
  for (const [key, rec] of Object.entries(state.listings)) {
    if (seen.has(key) || rec.status === "inaccessible") continue;
    const recheckedAll = (rec.pages || []).length > 0 && rec.pages.every((p) => okPages.has(p));
    if (!recheckedAll) continue;
    rec.missingRuns = (rec.missingRuns || 0) + 1;
    if (rec.missingRuns >= MISSING_RUNS_THRESHOLD && rec.status !== "not_seen_recently") {
      rec.status = "not_seen_recently";
      rec.notSeenSince = now;
      notSeen.push(key);
    }
  }
  return { newKeys, priceChanges, reappeared, notSeen };
}

function pick(it) {
  const out = {};
  for (const f of DETAIL_FIELDS) if (it[f] !== undefined && it[f] !== null && it[f] !== "") out[f] = it[f];
  return out;
}

export function updateSourceHealth(state, sourceId, result, now = new Date().toISOString()) {
  const h = state.sourceHealth[sourceId] || { consecutiveFailures: 0, history: [] };
  h.lastStatus = result.status;
  h.lastRun = now;
  if (result.status === "ok" || result.status === "partial") { h.lastSuccess = now; h.consecutiveFailures = 0; }
  else if (result.status !== "skipped") { h.consecutiveFailures = (h.consecutiveFailures || 0) + 1; h.lastError = result.error || null; h.lastErrorAt = now; }
  h.history = [...(h.history || []), { at: now, status: result.status, listings: result.listingCount ?? 0 }].slice(-30);
  state.sourceHealth[sourceId] = h;
  return h;
}
