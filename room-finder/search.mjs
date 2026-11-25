import { mkdir, writeFile, readFile } from "node:fs/promises";

const URLS = [
  "https://house4ever.com/mohali/sector-67/rooms-for-rent-under-10000/",
  "https://house4ever.com/mohali/sector-67/rooms-for-rent/",
];
const MAX_RENT = 10000;
const OUT = "room-finder-output";
const clean = (s) => s.replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
  .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#8377;|&#x20b9;|₹/gi, "₹")
  .replace(/\\s+/g, " ").trim();

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; RoomFinder/1.0; +https://github.com/)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function extract(html, sourceUrl) {
  const found = new Map();
  // Listing detail URLs are stable, individual pages on House4Ever.
  const links = [...html.matchAll(/href=["'](https?:\\/\\/house4ever\\.com\\/[^"'#?]+\\/?)["'][^>]*>([\\s\\S]{0,1800}?)<\\/a>/gi)];
  for (const m of links) {
    const url = m[1];
    if (url === sourceUrl || /\\/(mohali|sector-67)\\//i.test(new URL(url).pathname) && /rooms-for-rent/i.test(url)) continue;
    const text = clean(m[2]);
    const priceMatch = text.match(/₹\\s?([\\d,]+)\\s?\\/(?:month|mo)|₹\\s?([\\d,]+)\\s?(?:per month|monthly)/i);
    const rent = priceMatch ? Number((priceMatch[1] || priceMatch[2]).replace(/,/g, "")) : null;
    if (!rent || rent > MAX_RENT || !/room|pg|bed|kitchen|washroom/i.test(text)) continue;
    found.set(url, { title: text.slice(0, 180), rent, url, source: "House4Ever" });
  }

  // Also parse JSON-LD offers when the listing is represented as structured data.
  for (const m of html.matchAll(/<script[^>]*type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const walk = (v) => {
        if (!v || typeof v !== "object") return;
        if (Array.isArray(v)) return v.forEach(walk);
        const offers = v.offers ? (Array.isArray(v.offers) ? v.offers : [v.offers]) : [];
        for (const o of offers) {
          const rent = Number(String(o.price || "").replace(/[^0-9.]/g, ""));
          if (rent > 0 && rent <= MAX_RENT && v.url) found.set(v.url, {
            title: String(v.name || "Room listing").slice(0, 180), rent, url: v.url, source: "House4Ever",
          });
        }
        Object.values(v).forEach(walk);
      };
      walk(data);
    } catch {}
  }
  return [...found.values()];
}

await mkdir(OUT, { recursive: true });
const errors = [];
const all = new Map();
for (const url of URLS) {
  try {
    const html = await fetchPage(url);
    for (const item of extract(html, url)) all.set(item.url, item);
  } catch (e) { errors.push(`${url}: ${e.message}`); }
}
const results = [...all.values()].sort((a, b) => a.rent - b.rent);
const previousPath = `${OUT}/latest.json`;
let previous = [];
try { previous = JSON.parse(await readFile(previousPath, "utf8")); } catch {}
const oldUrls = new Set(previous.map((x) => x.url));
const newListings = results.filter((x) => !oldUrls.has(x.url));
const now = new Date().toISOString();
const payload = {
  checkedAt: now,
  search: { location: "Sector 67, Mohali (CP67 area)", radiusKm: 5, maxMonthlyRentINR: MAX_RENT },
  sourcePages: URLS,
  resultCount: results.length,
  newCount: newListings.length,
  listings: results,
  newListings,
  errors,
  limitations: [
    "Coverage is limited to publicly accessible House4Ever pages; this does not prove a complete 5 km radius search.",
    "Facebook Marketplace and OLX are not accessed or messaged automatically.",
    "Availability, deposit, restrictions and owner identity must be confirmed directly before payment or visit.",
    "This workflow only discovers and reports listings. It does not contact sellers, book viewings, or commit money."
  ]
};
await writeFile(previousPath, JSON.stringify(results, null, 2));
await writeFile(`${OUT}/report.json`, JSON.stringify(payload, null, 2));
const lines = [
  "# Mohali Room Finder",
  `Checked: ${now}`,
  "**Target:** CP67 Mall area, Sector 67 Mohali · max ₹10,000/month · 5 km intended radius",
  `**Listings extracted:** ${results.length} · **New since previous successful run:** ${newListings.length}`,
  "",
  ...results.map((x) => `- **₹${x.rent.toLocaleString("en-IN")}/month** — ${x.title || "Room listing"}\n  ${x.url}`),
  "",
  "## Errors",
  ...(errors.length ? errors.map((e) => `- ${e}`) : ["- None"]),
  "",
  "## Automation boundary",
  "This run searches publicly accessible House4Ever listing pages and reports candidates. It does not access Facebook Marketplace, send seller messages, confirm availability, or arrange viewings."
];
await writeFile(`${OUT}/REPORT.md`, lines.join("\n"));
console.log(lines.join("\n"));
if (errors.length && results.length === 0) process.exitCode = 1;
