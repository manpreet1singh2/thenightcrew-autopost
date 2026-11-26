// Builds REPORT.md, report.json and latest.json from one run.
import { REFERENCE, RADIUS_KM, MAX_RENT } from "./config.mjs";

const NP = "Not provided";
const RECENT_DAYS = 7;
const MAX_UNVERIFIED_IN_MD = 100;

export function freshness(l) {
  const t = Date.parse(l.updatedDate || l.listingDate || "");
  return Number.isFinite(t) ? t : 0;
}

/** Sort: verified distance first (nearest first), unverified after; then rent; then newest. */
export function sortListings(list) {
  return [...list].sort((a, b) => {
    const da = typeof a.distanceKm === "number" ? a.distanceKm : Infinity;
    const db = typeof b.distanceKm === "number" ? b.distanceKm : Infinity;
    if (da !== db) return da - db;
    if ((a.rent ?? Infinity) !== (b.rent ?? Infinity)) return (a.rent ?? Infinity) - (b.rent ?? Infinity);
    return freshness(b) - freshness(a);
  });
}

export function verificationLevel(l, now = Date.now()) {
  const upd = Date.parse(l.updatedDate || "");
  if (Number.isFinite(upd) && now - upd <= RECENT_DAYS * 864e5) return "Listing recently updated";
  return "Listing found";
}

/** Public record for one listing: every field present, "Not provided" when the source did not give it. */
export function toRecord(l, { isNew = false, priceChange = null, duplicateGroup = null, groupSources = [], firstSeen = null } = {}) {
  return {
    title: l.title || NP,
    monthlyRentINR: l.rent ?? null,
    rentNote: l.rentNote || null,
    location: l.address || l.locality || NP,
    locality: l.locality || NP,
    distanceKm: typeof l.distanceKm === "number" ? l.distanceKm : null,
    distanceLabel: typeof l.distanceKm === "number" ? `${l.distanceKm} km (from coordinates published by ${l.source})` : "Distance unverified",
    roomType: l.roomType || NP,
    furnishing: l.furnishing || NP,
    occupancy: l.occupancy || NP,
    securityDeposit: l.deposit || NP,
    brokerage: l.brokerage || NP,
    amenities: l.amenities?.length ? l.amenities : NP,
    food: l.food || NP,
    tenantRestrictions: l.tenantNotes || NP,
    listedBy: l.listedBy || NP,
    contact: "Not provided publicly — open the listing on the source site",
    url: l.url,
    source: l.source,
    sourceListingId: l.sourceId || null,
    listingDate: l.listingDate || NP,
    updatedDate: l.updatedDate || NP,
    lastChecked: l.lastChecked,
    firstSeen,
    status: verificationLevel(l),
    availabilityConfirmedByOwner: false,
    personallyVerified: false,
    isNew,
    priceChange,
    possibleDuplicateGroup: duplicateGroup,
    alsoListedOn: groupSources,
  };
}

export function buildReport({ now, results, excluded, sources, newKeys, priceChanges, notSeen, stateNote, extendedSweep }) {
  const byLocality = {};
  for (const r of results) (byLocality[r.locality] ||= []).push(r);
  return {
    checkedAt: now,
    search: {
      location: REFERENCE.name,
      referenceCoordinates: { lat: REFERENCE.lat, lng: REFERENCE.lng },
      intendedRadiusKm: RADIUS_KM,
      maxMonthlyRentINR: MAX_RENT,
      propertyTypes: ["Single room", "Shared room", "PG", "Room set", "Independent room"],
      sweep: extendedSweep ? "full (core + extended localities, all sources)" : "core localities only (extended sweep runs every 30 min)",
    },
    totals: {
      listingsMatched: results.length,
      verifiedWithinRadius: results.filter((r) => r.distanceKm !== null).length,
      distanceUnverified: results.filter((r) => r.distanceKm === null).length,
      newListings: results.filter((r) => r.isNew).length,
      priceChanges: priceChanges.length,
      notSeenRecently: notSeen.length,
      excluded,
    },
    sources,
    state: stateNote,
    listings: results,
    newListings: results.filter((r) => r.isNew),
    priceChanges,
    byLocality: Object.fromEntries(Object.entries(byLocality).map(([k, v]) => [k, v.length])),
    disclaimer: [
      "Every listing is a lead, not a verified rental offer. Availability has NOT been confirmed with any owner.",
      "Coverage is limited to the sources marked 'ok' or 'partial' below; this is not a complete survey of the 5 km radius.",
      "Distances are straight-line from CP67 Mall using coordinates published by the source; 'Distance unverified' means the source gave none.",
      "This tool never contacts owners, books visits or pays anything.",
    ],
  };
}

const rupee = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "price not provided");

export function renderMarkdown(rep) {
  const L = [];
  L.push("# Mohali Room Finder — search report", "");
  L.push(`**Checked:** ${rep.checkedAt}  `);
  L.push(`**Search location:** ${rep.search.location}  `);
  L.push(`**Budget:** up to ${rupee(rep.search.maxMonthlyRentINR)}/month · **Intended radius:** ${rep.search.intendedRadiusKm} km  `);
  L.push(`**Sweep:** ${rep.search.sweep}`, "");
  const t = rep.totals;
  L.push(`**Listings matched:** ${t.listingsMatched} (${t.verifiedWithinRadius} with verified distance, ${t.distanceUnverified} distance unverified) · **New:** ${t.newListings} · **Price changes:** ${t.priceChanges} · **Not seen recently:** ${t.notSeenRecently}`, "");

  L.push("## Source status", "", "| Source | Status | Pages ok / not found / checked | Listings | Notes |", "|---|---|---|---|---|");
  for (const s of rep.sources) {
    L.push(`| ${s.name} | ${s.status} | ${s.pagesOk ?? "–"} / ${s.pagesNotFound ?? "–"} / ${s.pagesChecked ?? "–"} | ${s.listingCount ?? 0} | ${(s.error || s.reason || "").replace(/\|/g, "/")} |`);
  }
  L.push("");

  if (rep.newListings.length) {
    L.push("## 🆕 New listings", "");
    for (const r of rep.newListings.slice(0, 50)) L.push(line(r));
    if (rep.newListings.length > 50) L.push(`- …and ${rep.newListings.length - 50} more (see report.json)`);
    L.push("");
  }
  if (rep.priceChanges.length) {
    L.push("## Price changes", "");
    for (const p of rep.priceChanges) L.push(`- ${p.title || p.key}: ${rupee(p.from)} → ${rupee(p.to)} — ${p.url || ""}`);
    L.push("");
  }

  L.push("## Listings by locality", "");
  const groups = {};
  for (const r of rep.listings) (groups[r.locality] ||= []).push(r);
  const order = Object.entries(groups).sort((a, b) => minDist(a[1]) - minDist(b[1]));
  if (!order.length) L.push("_No matching listings from the sources that were searched successfully._", "");
  // Keep the readable report short: every verified listing, but at most MAX_UNVERIFIED_IN_MD unverified ones.
  let unverifiedShown = 0;
  for (const [loc, rs] of order) {
    const shown = rs.filter((r) => r.distanceKm !== null || unverifiedShown++ < MAX_UNVERIFIED_IN_MD);
    if (!shown.length) continue;
    L.push(`### ${loc} (${rs.length})`, "");
    for (const r of shown) L.push(line(r));
    if (shown.length < rs.length) L.push(`- …and ${rs.length - shown.length} more with unverified distance (see latest.json)`);
    L.push("");
  }

  const failed = rep.sources.filter((s) => !["ok", "disabled", "skipped"].includes(s.status));
  L.push("## Failed or limited sources", "");
  if (!failed.length) L.push("- None this run.");
  for (const s of failed) {
    L.push(`- **${s.name}** — ${s.status}: ${s.error || "see page errors"}`);
    for (const p of (s.pageErrors || []).slice(0, 8)) L.push(`  - ${p.url}: ${p.error}`);
  }
  L.push("", "## Before you visit or pay anything, confirm with the owner:", "");
  L.push("Actual availability · exact address · security deposit · brokerage · electricity and maintenance charges · tenant restrictions · owner identity · property condition.", "");
  L.push(...rep.disclaimer.map((d) => `> ${d}`));
  return L.join("\n");
}

function minDist(rs) { return Math.min(...rs.map((r) => (r.distanceKm ?? 99))); }

function line(r) {
  const bits = [
    `**${rupee(r.monthlyRentINR)}/month**`,
    r.distanceLabel,
    r.roomType !== NP ? r.roomType : null,
    r.furnishing !== NP ? r.furnishing : null,
    r.isNew ? "🆕 new" : null,
    r.priceChange ? `price ${rupee(r.priceChange.from)} → ${rupee(r.priceChange.to)}` : null,
    r.alsoListedOn?.length ? `possible duplicate also on: ${r.alsoListedOn.join(", ")}` : null,
  ].filter(Boolean);
  return `- ${bits.join(" · ")}\n  ${r.title}\n  ${r.source} · ${r.status} · availability not confirmed · ${r.url}`;
}
