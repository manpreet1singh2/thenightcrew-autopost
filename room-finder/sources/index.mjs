// Source registry. To add a site: create an adapter exporting { id, name, enabled, origin, run(ctx) }
// and add it here. Disabled sources are listed in the report as "not searched" with the reason.
import * as house4ever from "./house4ever.mjs";
import * as acres99 from "./acres99.mjs";

// 99acres first: it is quick (few pages, or blocked at once) and must not be starved by House4Ever's longer crawl.
export const ADAPTERS = [acres99, house4ever];

export const DISABLED_SOURCES = [
  { id: "magicbricks", name: "MagicBricks", reason: "Adapter not built yet: no public Mohali locality page has been verified for automated access." },
  { id: "nobroker", name: "NoBroker", reason: "Adapter not built yet: no public Mohali rental page has been verified." },
  { id: "facebook-marketplace", name: "Facebook Marketplace", reason: "Needs authorized access; login/session-cookie scraping is not allowed." },
  { id: "olx", name: "OLX", reason: "Needs authorized access (no permitted public feed configured)." },
];
