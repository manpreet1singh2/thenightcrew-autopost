// 99acres adapter. Reads the public "PG in <locality>, Mohali" pages, which embed the listing data
// (rent, deposit, brokerage, coordinates) in the page. robots.txt does not disallow these pages.
// If 99acres blocks the request (bot protection), the source is reported as blocked — never bypassed.
import { CORE_LOCALITIES, EXTENDED_LOCALITIES } from "../config.mjs";
import { FetchError, cleanText, parseRent, normalizeUrl, normalizeLocality, distanceFromReference, classify } from "../lib.mjs";

export const id = "99acres";
export const name = "99acres";
export const enabled = true;
export const origin = "https://www.99acres.com";
// Bot-protected site: check it on the slower sweep only.
export const onlyOnExtended = true;

export function extractInitialData(html, url = "") {
  const i = html.indexOf("window.__initialData__");
  if (i < 0) throw new FetchError("Page structure changed: embedded listing data not found", { kind: "parse", url });
  const end = html.indexOf("</script>", i);
  let body = html.slice(html.indexOf("=", i) + 1, end < 0 ? undefined : end).trim();
  const cut = body.search(/;\s*window\.[A-Za-z_$]+\s*=/);
  if (cut > 0) body = body.slice(0, cut);
  body = body.replace(/;\s*$/, "");
  try {
    return JSON.parse(body);
  } catch {
    throw new FetchError("Embedded listing data is not valid JSON", { kind: "parse", url });
  }
}

const ms = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString() : null;
};

export function parseListPage(html, pageUrl) {
  const data = extractInitialData(html, pageUrl);
  const props = data?.srp?.pageData?.properties;
  if (!Array.isArray(props)) throw new FetchError("Page structure changed: srp.pageData.properties missing", { kind: "parse", url: pageUrl });
  const items = [];
  for (const p of props) {
    const path = p.PD_URL || p.PROP_DETAILS_URL;
    if (!path || !p.PROP_ID) continue;
    const locality = String(p.LOCALITY || p.localityLabel || "");
    if (!/mohali|sector|phase|sohana|kumbra/i.test(locality)) continue; // guard against redirects to unrelated pages
    const url = normalizeUrl(new URL(path, origin).href);
    const title = cleanText(p.PROP_HEADING || p.PROP_NAME || "PG listing");
    const desc = cleanText(p.DESCRIPTION || "");
    const min = parseRent(p.MIN_PRICE), max = parseRent(p.MAX_PRICE);
    const mapped = p.MAP_DETAILS && String(p.MAP_DETAILS.MAPPED).toUpperCase() === "Y";
    const lat = mapped ? Number(p.MAP_DETAILS.LATITUDE) : null;
    const lng = mapped ? Number(p.MAP_DETAILS.LONGITUDE) : null;
    const dep = parseRent(p.DEPOSIT);
    const text = `${title} ${p.SUB_HEADING || ""} ${desc}`;
    const cls = classify(text);
    items.push({
      source: name,
      sourceId: String(p.PROP_ID),
      key: `${id}:${p.PROP_ID}`,
      url,
      title,
      rent: min,
      rentNote: [p.FORMATTED_PRICE ? `Shown as ₹${p.FORMATTED_PRICE}` : "", max && min && max !== min ? `range ₹${min}–₹${max}` : ""].filter(Boolean).join("; ") || undefined,
      locality: normalizeLocality(locality),
      address: cleanText(locality),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      distanceKm: distanceFromReference(lat, lng),
      deposit: dep ? (String(p.DEPOSIT_TYPE).toUpperCase() === "FIXED" ? `₹${dep}` : `${dep} (${p.DEPOSIT_TYPE || "type not stated"})`) : undefined,
      brokerage: p.BROKERAGE !== undefined && p.BROKERAGE !== null && p.BROKERAGE !== "" ? `${p.BROKERAGE} (as listed — verify)` : undefined,
      occupancy: p.SHARING_COUNT ? `${p.SHARING_COUNT}-sharing (as listed)` : cls.occupancy,
      listingDate: ms(p.POSTING_DATE),
      updatedDate: ms(p.UPDATE_DATE),
      roomType: "PG",
      text,
      foundOnPage: pageUrl,
      ...Object.fromEntries(Object.entries(cls).filter(([k]) => !["roomType", "occupancy"].includes(k))),
    });
  }
  return { items };
}

export function plan({ extendedDue }) {
  if (!extendedDue) return [];
  return [...CORE_LOCALITIES, ...EXTENDED_LOCALITIES]
    .filter((l) => l.startsWith("sector-"))
    .map((loc) => `${origin}/pg-in-${loc}-mohali-ffid`);
}

export async function run(ctx) {
  const pages = [];
  const listings = new Map();
  for (const url of plan(ctx)) {
    try {
      const { items } = parseListPage(await ctx.fetch(url), url);
      pages.push({ url, status: "ok", count: items.length });
      for (const it of items) if (!listings.has(it.key)) listings.set(it.key, it);
    } catch (e) {
      pages.push({ url, status: e.kind === "not_found" ? "not_found" : e.kind || "error", error: e.message });
      if (e.kind === "blocked") break; // stop hammering a site that is blocking us
    }
  }
  return { pages, listings: [...listings.values()] };
}
