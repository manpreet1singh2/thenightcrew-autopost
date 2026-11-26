// Duplicate detection. Same-source duplicates are merged by source ID / normalised URL.
// Cross-source look-alikes are only GROUPED as "possible duplicates" — every source URL is kept, nothing deleted.
import { normalizeUrl, normalizeTitle, tokenSimilarity, haversineKm } from "./lib.mjs";

/** Merge exact duplicates within one run (same key or same normalised URL). */
export function mergeExact(listings) {
  const byKey = new Map();
  const urlToKey = new Map();
  for (const it of listings) {
    const nu = normalizeUrl(it.url);
    const k = byKey.has(it.key) ? it.key : urlToKey.get(nu) || it.key;
    if (byKey.has(k)) {
      const cur = byKey.get(k);
      for (const [f, v] of Object.entries(it)) if (cur[f] === undefined || cur[f] === null) cur[f] = v;
    } else {
      byKey.set(k, { ...it });
      urlToKey.set(nu, k);
    }
  }
  return [...byKey.values()];
}

/** Are two listings (from different sources) probably the same room? */
export function possibleDuplicate(a, b) {
  if (a.key === b.key || a.source === b.source) return false;
  if (!a.rent || !b.rent || a.rent !== b.rent) return false;
  if (a.lat && b.lat && a.lng && b.lng) {
    if (haversineKm(a.lat, a.lng, b.lat, b.lng) <= 0.15 && tokenSimilarity(a.title, b.title) >= 0.3) return true;
  }
  const sameLocality = a.locality && b.locality && a.locality === b.locality && a.locality !== "Not provided";
  return sameLocality && (normalizeTitle(a.title) === normalizeTitle(b.title) || tokenSimilarity(a.title, b.title) >= 0.6);
}

/**
 * Assign duplicate groups. Returns Map key -> groupId (groupId = smallest key in the group).
 * Uses union-find so chains of look-alikes end up in one group.
 */
export function groupDuplicates(listings) {
  const parent = new Map(listings.map((l) => [l.key, l.key]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  for (let i = 0; i < listings.length; i++)
    for (let j = i + 1; j < listings.length; j++)
      if (possibleDuplicate(listings[i], listings[j])) union(listings[i].key, listings[j].key);
  const groups = new Map();
  for (const l of listings) {
    const root = find(l.key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(l.key);
  }
  const out = new Map();
  for (const [root, keys] of groups) if (keys.length > 1) for (const k of keys) out.set(k, root);
  return out;
}
