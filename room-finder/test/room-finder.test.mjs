// Run: node --test room-finder/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ROOM_FINDER_GAP_MS = "0";
process.env.ROOM_FINDER_BACKOFF_MS = "1";

const lib = await import("../lib.mjs");
const h4e = await import("../sources/house4ever.mjs");
const acres = await import("../sources/acres99.mjs");
const { mergeRun, emptyState, validateState } = await import("../state.mjs");
const { mergeExact, groupDuplicates } = await import("../dedupe.mjs");
const { sortListings, toRecord } = await import("../report.mjs");
const F = await import("./fixtures.mjs");

const CP67 = { lat: 30.677784, lng: 76.723076 };

// ---------------- extraction ----------------
test("House4Ever list page: extracts offers from JSON-LD", () => {
  const html = F.h4eListPage([
    { url: "https://house4ever.com/single-bed-with-kitchen-for-rent-in-sector-67-mohali-12502/", name: "Fully Furnished Single Bed with Sharing kitchen for rent in Sector 67, Mohali. Available for Girls.", price: 5500 },
    { url: "https://house4ever.com/2-room-set-for-family-77/", name: "2 room set for family", price: 9000, address: "Sector 68, Mohali" },
  ], 14);
  const { items, total } = h4e.parseListPage(html, "https://house4ever.com/mohali/sector-67/rooms-for-rent/");
  assert.equal(total, 14);
  assert.equal(items.length, 2);
  assert.equal(items[0].key, "house4ever:12502");
  assert.equal(items[0].rent, 5500);
  assert.equal(items[0].locality, "Sector 67");
  assert.equal(items[0].furnishing, "Furnished");
  assert.match(items[0].tenantNotes, /girls/);
  assert.equal(items[1].locality, "Sector 68");
  assert.equal(items[0].source, "House4Ever");
});

test("House4Ever list page: missing JSON-LD is a parse error, not zero listings", () => {
  assert.throws(() => h4e.parseListPage("<html><body>redesigned</body></html>", "u"), (e) => e.kind === "parse");
});

test("House4Ever detail page: coordinates give a verified distance", () => {
  const d = h4e.parseDetailPage(F.h4eDetailPage({ url: "u", name: "Room", price: 5500, lat: 30.6781, lng: 76.7304 }), "u");
  assert.equal(d.rent, 5500);
  assert.ok(d.distanceKm > 0.5 && d.distanceKm < 1, `distance ${d.distanceKm}`);
  assert.equal(d.listingDate, "2026-11-20T04:48:45.508Z");
  assert.deepEqual(d.amenities, ["Fully Furnished"]);
  assert.equal(d.sourceAvailability, "InStock");
});

test("99acres: embedded data with a following window assignment parses", () => {
  const { items } = acres.parseListPage(F.acresPage([F.acresProp()]), "p");
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.key, "99acres:U93538524");
  assert.equal(it.rent, 8000);
  assert.equal(it.deposit, "₹4000");
  assert.equal(it.roomType, "PG");
  assert.equal(it.food, "Mentioned in listing");
  assert.ok(it.distanceKm > 1 && it.distanceKm < 1.5, `distance ${it.distanceKm}`);
  assert.equal(it.url, "https://www.99acres.com/paying-guest-pg-for-rent-in-unity-homeland-cp-67-sector-67-mohali-spid-U93538524");
  assert.equal(it.listingDate, new Date(1786800690000).toISOString());
});

test("99acres: unmapped coordinates stay unverified; unrelated locality is skipped", () => {
  const { items } = acres.parseListPage(F.acresPage([
    F.acresProp({ PROP_ID: "A1", MAP_DETAILS: { LATITUDE: "30.67", LONGITUDE: "76.71", MAPPED: "N" } }),
    F.acresProp({ PROP_ID: "A2", LOCALITY: "Whitefield Bangalore" }),
  ]), "p");
  assert.equal(items.length, 1);
  assert.equal(items[0].distanceKm, null);
  assert.throws(() => acres.parseListPage("<html>no data</html>", "p"), (e) => e.kind === "parse");
});

// ---------------- filtering ----------------
test("filters: budget, radius, relevance", () => {
  assert.equal(lib.budgetProblem(10000), null);
  assert.equal(lib.budgetProblem(10001), "above budget");
  assert.equal(lib.budgetProblem(null), "price not provided");
  assert.equal(lib.distanceProblem(4.99), null);
  assert.equal(lib.distanceProblem(5.2), "outside radius");
  assert.equal(lib.distanceProblem(null), null, "unverified distance is kept, not treated as zero or excluded");
  assert.equal(lib.relevanceProblem("Office space for rent in Sector 67"), "commercial property");
  assert.equal(lib.relevanceProblem("3 BHK flat for rent in Sector 67"), "entire apartment/house");
  assert.equal(lib.relevanceProblem("Room available in 3 BHK flat, sharing for boys"), null);
  assert.equal(lib.relevanceProblem("Plot for sale in Sector 67"), "sale property");
  assert.equal(lib.relevanceProblem("Single room with kitchen for rent"), null);
});

test("distance: invalid or far-away coordinates are rejected, not invented", () => {
  assert.equal(lib.distanceFromReference(0, 0), null);
  assert.equal(lib.distanceFromReference("x", 76.7), null);
  assert.equal(lib.distanceFromReference(12.97, 77.59), null);
  assert.equal(lib.distanceFromReference(CP67.lat, CP67.lng), 0);
});

test("robots.txt: House4Ever rules (longest match wins)", () => {
  const r = lib.parseRobots(F.H4E_ROBOTS, "MohaliRoomFinder/2.0");
  assert.equal(r.isAllowed("/mohali/sector-67/rooms-for-rent/"), true);
  assert.equal(r.isAllowed("/mohali/sector-67/rooms-for-rent/?page=2"), true);
  assert.equal(r.isAllowed("/mohali/sector-67/rooms-for-rent/?sort=price"), false);
  assert.equal(r.isAllowed("/api/listings"), false);
  const g = lib.parseRobots(F.H4E_ROBOTS, "GPTBot");
  assert.equal(g.isAllowed("/mohali/"), false);
});

// ---------------- http ----------------
const resp = (status, body = "") => new Response(body, { status });

test("fetchText: retries 5xx then succeeds; 403 is blocked without retry; robots enforced", async () => {
  let n = 0;
  const flaky = async () => (++n < 2 ? resp(503, "down") : resp(200, "ok".repeat(20000)));
  assert.ok((await lib.fetchText("https://a.test/x", { fetchImpl: flaky, gap: 0 })).startsWith("ok"));
  assert.equal(n, 2);

  let m = 0;
  const blocked = async () => { m++; return resp(403, "Access Denied"); };
  await assert.rejects(lib.fetchText("https://b.test/x", { fetchImpl: blocked, gap: 0 }), (e) => e.kind === "blocked");
  assert.equal(m, 1);

  await assert.rejects(lib.fetchText("https://c.test/x", { fetchImpl: async () => resp(404) , gap: 0 }), (e) => e.kind === "not_found");
  await assert.rejects(lib.fetchText("https://e.test/x", { deadline: Date.now() - 1, fetchImpl: async () => resp(200, "x"), gap: 0 }), (e) => e.kind === "budget");
  const robots = lib.parseRobots("User-agent: *\nDisallow: /private/");
  await assert.rejects(lib.fetchText("https://d.test/private/1", { robots, fetchImpl: async () => resp(200, "x"), gap: 0 }), (e) => e.kind === "robots");
});

// ---------------- dedupe ----------------
test("dedupe: exact duplicates merge; cross-source look-alikes are grouped, not removed", () => {
  const a = { key: "house4ever:1", source: "House4Ever", url: "https://house4ever.com/room-1/", title: "Furnished single room Sector 67", rent: 7000, locality: "Sector 67" };
  const a2 = { key: "house4ever:1", source: "House4Ever", url: "https://house4ever.com/room-1/?utm=x", title: "Furnished single room Sector 67", rent: 7000, locality: "Sector 67", furnishing: "Furnished" };
  const b = { key: "99acres:X", source: "99acres", url: "https://www.99acres.com/x", title: "Furnished single room in Sector 67 Mohali", rent: 7000, locality: "Sector 67" };
  const c = { key: "99acres:Y", source: "99acres", url: "https://www.99acres.com/y", title: "PG for girls", rent: 6500, locality: "Sector 67" };
  const merged = mergeExact([a, a2, b, c]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].furnishing, "Furnished");
  const g = groupDuplicates(merged);
  assert.equal(g.get("house4ever:1"), g.get("99acres:X"));
  assert.equal(g.has("99acres:Y"), false);
  assert.equal(lib.normalizeUrl("https://house4ever.com/room-1/?utm=x#top"), "https://house4ever.com/room-1");
});

// ---------------- state ----------------
test("state: new only once, price changes tracked, missing listings marked but never deleted", () => {
  const s = emptyState();
  const page = "https://house4ever.com/mohali/sector-67/rooms-for-rent/";
  const l = { key: "house4ever:1", source: "House4Ever", url: "u1", title: "Room", rent: 7000, foundOnPage: page };
  const r1 = mergeRun(s, [l], new Set([page]), "2026-11-26T10:00:00Z");
  assert.deepEqual(r1.newKeys, ["house4ever:1"]);
  const r2 = mergeRun(s, [{ ...l, rent: 6500 }], new Set([page]), "2026-11-26T10:05:00Z");
  assert.deepEqual(r2.newKeys, []);
  assert.equal(r2.priceChanges[0].from, 7000);
  assert.equal(r2.priceChanges[0].to, 6500);
  assert.equal(r2.priceChanges[0].meaningful, true);

  // Page not re-checked (source failed) -> no miss counted.
  for (let i = 0; i < 5; i++) mergeRun(s, [], new Set(), `2026-11-26T11:0${i}:00Z`);
  assert.equal(s.listings["house4ever:1"].missingRuns, 0);
  // Page re-checked 3 times without the listing -> "not seen recently", still kept.
  for (let i = 0; i < 3; i++) mergeRun(s, [], new Set([page]), `2026-11-26T12:0${i}:00Z`);
  assert.equal(s.listings["house4ever:1"].status, "not_seen_recently");
  assert.ok(s.listings["house4ever:1"].rentHistory.length === 2);
  // Comes back -> active again, not "new".
  const r3 = mergeRun(s, [l], new Set([page]), "2026-11-26T13:00:00Z");
  assert.deepEqual(r3.newKeys, []);
  assert.deepEqual(r3.reappeared, ["house4ever:1"]);
  assert.ok(validateState(s));

  // A first listing-page read that corrects the list-page price is not a "price change".
  const k = { key: "house4ever:2", source: "House4Ever", url: "u2", title: "Room", rent: 6500, listPrice: 6500, foundOnPage: page };
  mergeRun(s, [k], new Set([page]));
  const r4 = mergeRun(s, [{ ...k, rent: 13500, detailRent: 13500 }], new Set([page]));
  assert.deepEqual(r4.priceChanges, []);
  assert.equal(s.listings["house4ever:2"].rent, 13500);
  // A later run that only re-reads the list page (same list price) keeps the listing-page rent, no change.
  const r5 = mergeRun(s, [{ ...k, rent: 6500 }], new Set([page]));
  assert.deepEqual(r5.priceChanges, []);
  assert.equal(s.listings["house4ever:2"].rent, 13500);
  // A real change on the listing page is reported.
  const r6 = mergeRun(s, [{ ...k, rent: 12000, detailRent: 12000 }], new Set([page]));
  assert.equal(r6.priceChanges.length, 1);
  assert.equal(r6.priceChanges[0].from, 13500);
  // Legacy record without listPrice/detailRent (older state): no false change.
  s.listings["house4ever:3"] = { key: "house4ever:3", rent: 9000, rentHistory: [], pages: [page], status: "active" };
  const r7 = mergeRun(s, [{ key: "house4ever:3", url: "u3", rent: 7000, listPrice: 7000, foundOnPage: page }], new Set([page]));
  assert.deepEqual(r7.priceChanges, []);
});

test("sorting: verified distance first, unverified never treated as zero", () => {
  const out = sortListings([
    { key: "u", rent: 3000, distanceKm: null },
    { key: "far", rent: 4000, distanceKm: 3 },
    { key: "near-exp", rent: 9000, distanceKm: 0.5 },
    { key: "near-cheap", rent: 6000, distanceKm: 0.5 },
  ]).map((x) => x.key);
  assert.deepEqual(out, ["near-cheap", "near-exp", "far", "u"]);
  const rec = toRecord({ key: "u", url: "x", source: "S", rent: 3000, distanceKm: null });
  assert.equal(rec.distanceLabel, "Distance unverified");
  assert.equal(rec.availabilityConfirmedByOwner, false);
  assert.equal(rec.securityDeposit, "Not provided");
});

// ---------------- end-to-end with a mocked network ----------------
function mockSite({ failAll = false } = {}) {
  const listUrl = "https://house4ever.com/mohali/sector-67/rooms-for-rent/";
  return async (url) => {
    if (failAll) throw new TypeError("fetch failed");
    if (url === "https://house4ever.com/robots.txt") return resp(200, F.H4E_ROBOTS);
    if (url === "https://www.99acres.com/robots.txt") return resp(200, "User-agent: *\nDisallow: /search/property/\n");
    if (url === listUrl) return resp(200, F.h4eListPage([
      { url: "https://house4ever.com/single-bed-for-rent-in-sector-67-mohali-12502/", name: "Single bed room for rent in Sector 67", price: 5500 },
      { url: "https://house4ever.com/office-for-rent-sector-67-500/", name: "Office space for rent in Sector 67", price: 9000 },
      { url: "https://house4ever.com/room-far-away-600/", name: "Room for rent", price: 4000 },
      { url: "https://house4ever.com/room-pricey-700/", name: "Room for rent", price: 15000 },
    ]));
    if (url.includes("12502")) return resp(200, F.h4eDetailPage({ url, name: "Single bed room", price: 5500, lat: 30.6781, lng: 76.7304 }));
    if (url.includes("room-far-away-600")) return resp(200, F.h4eDetailPage({ url, name: "Room", price: 4000, lat: 30.75, lng: 76.65 }));
    if (url.includes("room-pricey-700")) return resp(200, F.h4eDetailPage({ url, name: "Room", price: 15000, lat: 30.68, lng: 76.72 }));
    if (url === "https://www.99acres.com/pg-in-sector-67-mohali-ffid") return resp(200, F.acresPage([F.acresProp()]));
    if (url === "https://www.99acres.com/pg-in-sector-82-mohali-ffid") return resp(403, "Access Denied");
    return resp(404, "not found");
  };
}

test("end-to-end: second run reports no new listings; total failure keeps history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rf-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { main } = await import("../search.mjs");
    const r1 = await main({ fetchImpl: mockSite() });
    assert.equal(r1.anySuccess, true);
    const keys = r1.report.listings.map((l) => l.sourceListingId).sort();
    assert.deepEqual(keys, ["12502", "U93538524"]);
    assert.equal(r1.report.totals.newListings, 2);
    assert.equal(r1.report.totals.excluded["commercial property"], 1);
    assert.equal(r1.report.totals.excluded["outside radius"], 1);
    assert.equal(r1.report.totals.excluded["above budget"], 1);
    const s99 = r1.report.sources.find((s) => s.id === "99acres");
    assert.equal(s99.status, "partial", "403 on some pages must not be reported as a clean search");
    assert.ok(r1.report.sources.find((s) => s.id === "magicbricks").status === "disabled");
    assert.ok(r1.report.listings[0].distanceKm < r1.report.listings[1].distanceKm);

    const r2 = await main({ fetchImpl: mockSite() });
    assert.equal(r2.report.totals.newListings, 0);

    const before = JSON.parse(await readFile("room-finder-state/state.json", "utf8"));
    const r3 = await main({ fetchImpl: mockSite({ failAll: true }) });
    assert.equal(r3.anySuccess, false);
    assert.ok(r3.report.sources.filter((s) => s.status !== "disabled" && s.status !== "skipped").every((s) => s.status === "failed"));
    const after = JSON.parse(await readFile("room-finder-state/state.json", "utf8"));
    assert.deepEqual(Object.keys(after.listings).sort(), Object.keys(before.listings).sort());
    assert.equal(after.lastSuccessfulCheck, before.lastSuccessfulCheck);
    const latest = JSON.parse(await readFile("room-finder-output/latest.json", "utf8"));
    assert.equal(latest.stale, true);
    assert.equal(latest.listings.length, 2, "last known listings are kept, not replaced by an empty list");
    const md = await readFile("room-finder-output/REPORT.md", "utf8");
    assert.match(md, /Failed or limited sources/);
  } finally {
    process.chdir(cwd);
  }
});

test("time budget: unchecked pages make a source 'partial', never 'ok'; nothing checked = 'skipped'", async () => {
  const { summarise } = await import("../search.mjs");
  const ad = { id: "x", name: "X" };
  const part = summarise(ad, { listings: [], pages: [{ url: "a", status: "ok" }, { url: "b", status: "budget" }] });
  assert.equal(part.status, "partial");
  assert.match(part.error, /not checked/);
  assert.equal(summarise(ad, { listings: [], pages: [{ url: "a", status: "budget" }] }).status, "skipped");
  assert.equal(summarise(ad, { listings: [], pages: [{ url: "a", status: "ok" }, { url: "b", status: "not_found" }] }).status, "ok");
  assert.equal(summarise(ad, { listings: [], pages: [{ url: "a", status: "blocked", error: "x" }] }).status, "blocked");
});

test("House4Ever: core localities paginate fully; over-budget listings get no detail fetch", async () => {
  const fetched = [];
  const items = Array.from({ length: 12 }, (_, i) => ({ url: `https://house4ever.com/room-${i}-${100 + i}/`, name: "Room for rent", price: i === 0 ? 15000 : 5000 }));
  const page = F.h4eListPage(items, 30);
  const ctx = {
    extendedDue: false,
    getKnown: () => undefined,
    fetch: async (url) => {
      fetched.push(url);
      if (url.includes("/mohali/sector-67/rooms-for-rent/")) {
        const p = Number(new URL(url).searchParams.get("page") || 1);
        return F.h4eListPage(items.map((it) => ({ ...it, url: it.url.replace(/-(\d+)\/$/, (m, n) => `-${Number(n) + p * 1000}/`) })), 30);
      }
      if (/room-\d+-\d+\/$/.test(url)) return F.h4eDetailPage({ url, name: "Room", price: 5000, lat: 30.68, lng: 76.72 });
      throw Object.assign(new Error("HTTP 404"), { kind: "not_found" });
    },
  };
  const out = await h4e.run(ctx);
  const s67 = out.pages.filter((p) => !p.detail && p.url.includes("sector-67/rooms"));
  assert.equal(s67.length, 3, "30 listings = 3 pages of 12");
  const detailUrls = fetched.filter((u) => /room-0-/.test(u));
  assert.equal(detailUrls.length, 0, "the ₹15,000 listing must not trigger a detail fetch");
});
