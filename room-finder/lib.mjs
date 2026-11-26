// Shared helpers: structured logs, polite HTTP, robots.txt, geo, text normalisation, filters.
import { USER_AGENT, MIN_GAP_MS, REQUEST_TIMEOUT_MS, MAX_ATTEMPTS, BACKOFF_MS, REFERENCE, RADIUS_KM, MIN_RENT, MAX_RENT } from "./config.mjs";

// ---------- logging ----------
export function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

// ---------- errors ----------
export class FetchError extends Error {
  constructor(message, { status = null, kind = "network", url = "" } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // network | http | blocked | not_found | robots | parse | budget
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- polite HTTP ----------
const lastHit = new Map();
async function waitForHost(host, gap) {
  const prev = lastHit.get(host) || 0;
  const wait = prev + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

const BLOCK_PATTERNS = /captcha|access denied|are you a robot|unusual traffic|request blocked|cf-challenge|bot detection/i;

export function looksBlocked(status, body) {
  if (status === 403 || status === 429) return true;
  // Only treat small pages as block pages; real listing pages can mention "captcha" in scripts.
  return body.length < 20000 && BLOCK_PATTERNS.test(body);
}

export async function fetchText(url, { gap = MIN_GAP_MS, attempts = MAX_ATTEMPTS, fetchImpl = fetch, robots = null, deadline = null } = {}) {
  const u = new URL(url);
  if (deadline && Date.now() + gap > deadline) throw new FetchError("Run time budget reached; page not checked this run", { kind: "budget", url });
  if (robots && !robots.isAllowed(u.pathname + u.search)) {
    throw new FetchError(`robots.txt disallows ${u.pathname}${u.search}`, { kind: "robots", url });
  }
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await waitForHost(u.host, gap);
    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.text();
      if (res.status === 404 || res.status === 410) throw new FetchError(`HTTP ${res.status}`, { status: res.status, kind: "not_found", url });
      if (looksBlocked(res.status, body)) {
        // 429 may clear with backoff; 403 / challenge pages will not, and must not be bypassed.
        if (res.status === 429 && i < attempts - 1) { lastErr = new FetchError("HTTP 429", { status: 429, kind: "blocked", url }); await sleep(BACKOFF_MS * 2 * 2 ** i); continue; }
        throw new FetchError(`Blocked by site (${res.status === 200 ? "bot-check page" : `HTTP ${res.status}`}); not bypassed`, { status: res.status, kind: "blocked", url });
      }
      if (res.status >= 500) { lastErr = new FetchError(`HTTP ${res.status}`, { status: res.status, kind: "http", url }); await sleep(BACKOFF_MS * 2 ** i); continue; }
      if (!res.ok) throw new FetchError(`HTTP ${res.status}`, { status: res.status, kind: "http", url });
      return body;
    } catch (e) {
      if (e instanceof FetchError && e.kind !== "network" && !(e.kind === "http" && e.status >= 500)) throw e;
      lastErr = e instanceof FetchError ? e : new FetchError(e.name === "TimeoutError" ? "Request timed out" : `Network error: ${e.message}`, { kind: "network", url });
      if (i < attempts - 1) await sleep(BACKOFF_MS * 2 ** i);
    }
  }
  throw lastErr;
}

// ---------- robots.txt ----------
export function parseRobots(text, agent = "MohaliRoomFinder") {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const a = agent.toLowerCase();
  let rules = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x))).flatMap((g) => g.rules);
  if (!rules.length) rules = groups.filter((g) => g.agents.includes("*")).flatMap((g) => g.rules);
  const toRe = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  const compiled = rules.filter((r) => r.path !== "" || !r.allow).map((r) => ({ ...r, re: r.path === "" ? null : toRe(r.path) }));
  return {
    isAllowed(path) {
      let best = null;
      for (const r of compiled) {
        if (!r.re) continue; // "Disallow:" (empty) allows everything
        if (r.re.test(path)) {
          if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

// ---------- geo ----------
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function distanceFromReference(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la === 0 || ln === 0) return null;
  // Reject coordinates that are obviously not in the Mohali/Tricity area (bad source data).
  if (Math.abs(la - REFERENCE.lat) > 1 || Math.abs(ln - REFERENCE.lng) > 1) return null;
  return Math.round(haversineKm(REFERENCE.lat, REFERENCE.lng, la, ln) * 100) / 100;
}

// ---------- text ----------
export const decodeEntities = (s) => String(s ?? "")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export const cleanText = (s) => decodeEntities(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function normalizeTitle(s) {
  return cleanText(s).toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(for|rent|in|the|a|an|and|with|available|mohali|punjab|contact|more|details|room|rooms)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function normalizeLocality(s) {
  const t = cleanText(s).toLowerCase();
  const sec = t.match(/sector\s*-?\s*(\d+\s*[a-z]?)\b/);
  if (sec) return `Sector ${sec[1].replace(/\s+/g, "").toUpperCase()}`;
  const ph = t.match(/phase\s*-?\s*(\d+[a-z]?(?:\s*-?\s*\d)?)/);
  if (ph) return `Phase ${ph[1].replace(/\s+/g, "").toUpperCase()}`;
  const first = t.split(",")[0].trim();
  return first ? first.replace(/\b\w/g, (c) => c.toUpperCase()) : "Not provided";
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    u.hostname = u.hostname.toLowerCase().replace(/^m\./, "www.");
    let p = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.hostname}${p}`;
  } catch {
    return String(url || "").trim();
  }
}

export function parseRent(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function tokenSimilarity(a, b) {
  const A = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const B = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---------- classification (only from what the listing text/fields explicitly say) ----------
export function classify(text) {
  const t = cleanText(text).toLowerCase();
  const out = {};
  if (/\bpg\b|paying guest|hostel|co-?living/.test(t)) out.roomType = "PG";
  else if (/\b1\s*rk\b|room set|\b1\s*bhk\b|with kitchen|independent room|independent set/.test(t)) out.roomType = /independent/.test(t) ? "Independent room" : "Room set";
  else if (/sharing|shared/.test(t)) out.roomType = "Shared room";
  else if (/\broom\b|\bbed\b/.test(t)) out.roomType = "Room";

  if (/semi[\s-]?furnished/.test(t)) out.furnishing = "Semi-furnished";
  else if (/unfurnished|un-furnished|non[\s-]?furnished/.test(t)) out.furnishing = "Unfurnished";
  else if (/fully[\s-]?furnished|\bfurnished\b/.test(t)) out.furnishing = "Furnished";

  if (/triple|three sharing|3 sharing/.test(t)) out.occupancy = "Triple / shared";
  else if (/double|twin|two sharing|2 sharing/.test(t)) out.occupancy = "Double";
  else if (/sharing|shared/.test(t)) out.occupancy = "Shared";
  else if (/single (?:bed|room|occupancy)|private room/.test(t)) out.occupancy = "Single";

  if (/without food|no food|food not (?:included|available)/.test(t)) out.food = "Not included (per listing text)";
  else if (/\bfood\b|meals?\b|tiffin|breakfast|dinner/.test(t)) out.food = "Mentioned in listing";

  const tenants = [];
  if (/\bgirls?\b|ladies|female|women/.test(t)) tenants.push("girls/women mentioned");
  if (/\bboys?\b|gents|male\b|\bmen\b/.test(t)) tenants.push("boys/men mentioned");
  if (/family|families/.test(t)) tenants.push("family mentioned");
  if (/bachelor/.test(t)) tenants.push("bachelors mentioned");
  if (/student/.test(t)) tenants.push("students mentioned");
  if (/working|professional/.test(t)) tenants.push("working professionals mentioned");
  if (tenants.length) out.tenantNotes = tenants.join(", ");

  if (/listed by (?:the )?owner|\bby owner\b|owner listing/.test(t)) out.listedBy = "Owner (as stated by source)";
  else if (/listed by (?:an )?(?:agent|broker|dealer)/.test(t)) out.listedBy = "Agent/broker (as stated by source)";
  return out;
}

// ---------- relevance filters ----------
export function relevanceProblem(text) {
  const t = cleanText(text).toLowerCase();
  if (/\bfor sale\b|\bsale\b|resale|\bbuy\b/.test(t) && !/for rent|on rent|rent\b/.test(t)) return "sale property";
  if (/\boffice\b|\bshop\b|showroom|commercial|warehouse|godown|co-?working/.test(t)) return "commercial property";
  if (/\b([2-9])\s*bhk\b|\bvilla\b|independent house|kothi|penthouse/.test(t) && !/\bpg\b|paying guest|\broom\b(?! set)|sharing|\bbed\b/.test(t)) return "entire apartment/house";
  return null;
}

export function budgetProblem(rent) {
  if (rent === null) return "price not provided";
  if (rent < MIN_RENT) return "invalid price";
  if (rent > MAX_RENT) return "above budget";
  return null;
}

export function distanceProblem(distanceKm) {
  if (distanceKm === null || distanceKm === undefined) return null; // unverified is kept, and labelled
  return distanceKm > RADIUS_KM ? "outside radius" : null;
}
