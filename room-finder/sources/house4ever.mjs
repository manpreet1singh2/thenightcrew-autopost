// House4Ever adapter. Reads the public locality pages' schema.org JSON-LD (rent, title, locality)
// and, for listings we have not looked at yet, the public listing page (coordinates, dates, furnishing).
// robots.txt allows these pages for all user agents; owner contact details sit behind an "unlock" and are NOT accessed.
import { CORE_LOCALITIES, EXTENDED_LOCALITIES, MAX_DETAIL_FETCHES, DETAIL_REFRESH_DAYS } from "../config.mjs";
import { FetchError, cleanText, parseRent, normalizeUrl, normalizeLocality, distanceFromReference, classify } from "../lib.mjs";

export const id = "house4ever";
export const name = "House4Ever";
export const enabled = true;
export const origin = "https://house4ever.com";
const PAGE_SIZE = 12;
const MAX_PAGES = 4;

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1])); } catch { /* skip invalid block */ }
  }
  return out;
}
const graph = (blocks) => blocks.flatMap((d) => (Array.isArray(d) ? d : d["@graph"] || [d]));

export function listingId(url) {
  const m = String(url).match(/-(\d+)\/?$/);
  return m ? m[1] : null;
}

/** Parse one locality list page. Throws a parse error if the expected structure is missing. */
export function parseListPage(html, pageUrl) {
  const nodes = graph(jsonLdBlocks(html));
  const page = nodes.find((n) => n["@type"] === "CollectionPage" && n.mainEntity);
  if (!page || !Array.isArray(page.mainEntity.itemListElement)) {
    throw new FetchError("Page structure changed: no CollectionPage/ItemList JSON-LD found", { kind: "parse", url: pageUrl });
  }
  const total = Number(page.mainEntity.numberOfItems) || null;
  const items = [];
  for (const el of page.mainEntity.itemListElement) {
    const it = el && (el.item || el);
    if (!it || !it.url) continue;
    const offered = it.itemOffered || {};
    const addr = offered.address || {};
    const title = cleanText(it.name || offered.name || "");
    const sid = listingId(it.url);
    items.push({
      source: name,
      sourceId: sid,
      key: `${id}:${sid || normalizeUrl(it.url)}`,
      url: normalizeUrl(it.url) + "/",
      title,
      rent: parseRent(it.price),
      currency: it.priceCurrency || "INR",
      address: cleanText(addr.streetAddress || ""),
      locality: normalizeLocality(addr.streetAddress || addr.addressLocality || ""),
      text: title,
      foundOnPage: pageUrl,
      ...classify(title),
    });
  }
  return { items, total };
}

/** Parse a listing detail page for coordinates, dates and stated features. */
export function parseDetailPage(html, url) {
  const nodes = graph(jsonLdBlocks(html));
  const listing = nodes.find((n) => n["@type"] === "RealEstateListing");
  const home = nodes.find((n) => n.geo || (n["@type"] && /Room|Residence|House|Apartment|Accommodation/.test(String(n["@type"]))));
  if (!listing && !home) throw new FetchError("Listing page structure changed: no RealEstateListing JSON-LD", { kind: "parse", url });
  const offers = listing?.offers || {};
  const geo = home?.geo || listing?.geo || {};
  const amen = [].concat(home?.amenityFeature || []).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).flat();
  const description = cleanText(listing?.description || "");
  const lat = Number(geo.latitude), lng = Number(geo.longitude);
  const availability = String(offers.availability || "");
  return {
    rent: parseRent(offers.price ?? offers.priceSpecification?.price),
    title: cleanText(listing?.name || home?.name || ""),
    description,
    listingDate: listing?.datePosted || null,
    updatedDate: listing?.dateModified || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    distanceKm: distanceFromReference(lat, lng),
    amenities: amen.map(String),
    address: cleanText(home?.address?.streetAddress || ""),
    sourceAvailability: availability ? availability.replace(/^https?:\/\/schema\.org\//, "") : null,
    text: `${description} ${amen.join(" ")}`,
  };
}

export function plan({ extendedDue }) {
  const locs = extendedDue ? [...CORE_LOCALITIES, ...EXTENDED_LOCALITIES] : CORE_LOCALITIES;
  return locs.flatMap((loc) => ["rooms-for-rent", "pg-for-rent"].map((cat) => `${origin}/mohali/${loc}/${cat}/`));
}

/**
 * Run the adapter.
 * ctx: { fetch(url) -> html, extendedDue, getKnown(key) -> stored listing|undefined, log }
 */
export async function run(ctx) {
  const pages = [];
  const listings = new Map();
  for (const base of plan(ctx)) {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = p === 1 ? base : `${base}?page=${p}`;
      try {
        const html = await ctx.fetch(url);
        const { items, total } = parseListPage(html, url);
        pages.push({ url, status: "ok", count: items.length });
        let added = 0;
        for (const it of items) if (!listings.has(it.key)) { listings.set(it.key, it); added++; }
        const more = total ? p * PAGE_SIZE < total : items.length >= PAGE_SIZE;
        if (!more || added === 0) break;
      } catch (e) {
        pages.push({ url, status: e.kind === "not_found" ? "not_found" : e.kind || "error", error: e.message });
        break;
      }
    }
  }

  // Detail pages: only for listings with no stored details, or stale ones, up to a per-run cap.
  let detailFetches = 0;
  const now = Date.now();
  for (const it of listings.values()) {
    const known = ctx.getKnown(it.key);
    const fresh = known?.detailsFetchedAt && now - Date.parse(known.detailsFetchedAt) < DETAIL_REFRESH_DAYS * 864e5;
    if (fresh) { Object.assign(it, pickDetails(known)); continue; }
    if (detailFetches >= MAX_DETAIL_FETCHES) { if (known) Object.assign(it, pickDetails(known)); continue; }
    detailFetches++;
    try {
      const d = parseDetailPage(await ctx.fetch(it.url), it.url);
      const extra = classify(`${it.title} ${d.text}`);
      Object.assign(it, {
        lat: d.lat, lng: d.lng, distanceKm: d.distanceKm,
        listingDate: d.listingDate, updatedDate: d.updatedDate,
        amenities: d.amenities, sourceAvailability: d.sourceAvailability,
        address: d.address || it.address,
        ...extra,
        roomType: it.roomType || extra.roomType,
        detailsFetchedAt: new Date().toISOString(),
      });
      if (d.rent && d.rent !== it.rent) it.rentNote = `List page shows ₹${it.rent}, listing page shows ₹${d.rent}; using listing page`;
      if (d.rent) it.rent = d.rent;
      pages.push({ url: it.url, status: "ok", count: 1, detail: true });
    } catch (e) {
      pages.push({ url: it.url, status: e.kind === "not_found" ? "not_found" : e.kind || "error", error: e.message, detail: true });
      if (e.kind === "not_found") it.inaccessible = true;
      if (known) Object.assign(it, pickDetails(known));
    }
  }
  return { pages, listings: [...listings.values()] };
}

function pickDetails(k) {
  const out = {};
  for (const f of ["lat", "lng", "distanceKm", "listingDate", "updatedDate", "amenities", "sourceAvailability", "detailsFetchedAt", "furnishing", "occupancy", "food", "tenantNotes", "listedBy"]) {
    if (k[f] !== undefined && k[f] !== null) out[f] = k[f];
  }
  return out;
}
