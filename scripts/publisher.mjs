// Multi-channel publisher — GitHub Actions har ghante chalata hai.
// 1) Connected accounts fetch  2) Aaj ka plan (config.dailyTarget slots, channels me baante, platform caps ke saath)
// 3) Due slots publish (asli API)  4) Processing posts verify  5) Discovery (suggestions)  6) state.json + STATUS.md
// State: $STATE_DIR (default ./state) — workflow ise "automation-state" branch me save karta hai.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import "../lib/envclean.js";
import { connectedAccounts, CONFIG } from "../lib/accounts.js";
import { approvedItems, stockItem, download } from "../lib/sources.js";
import { captionFor } from "../lib/captions.js";
import { discover } from "../lib/discover.js";
import { renderDashboard } from "../lib/dashboard.js";
import { withRetry, TransientError, facebookPublish, facebookVerify, instagramPublish, instagramQuota, youtubePublish, youtubeVerify } from "../lib/publish.js";

const env = process.env;
const DRY = env.DRY_RUN === "1";
const STATE_DIR = env.STATE_DIR || "state";
const STATE_FILE = join(STATE_DIR, "state.json");
const IST = 330 * 60_000;
const now = Date.now();
const today = new Date(now + IST).toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

// ---------- state ----------
mkdirSync(STATE_DIR, { recursive: true });
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
Object.assign(state, { target: Number(env.DAILY_TARGET || CONFIG.dailyTarget || 13) });
state.days ||= {}; state.posted ||= {}; state.discovered ||= []; state.errors ||= [];
const err = (msg) => { state.errors.push({ at: Date.now(), msg }); console.error("❌", msg); };

// ---------- accounts ----------
const { accounts, errors } = await connectedAccounts();
errors.forEach(err);
state.accounts = { fetchedAt: now, list: accounts.map(({ token, ...a }) => a) };  // tokens kabhi save nahi
const eligible = accounts.filter((a) => a.eligible);
log(`Accounts: ${accounts.map((a) => `${a.platform}:${a.name}${a.eligible ? "" : " (✗ " + a.reason + ")"}`).join(", ") || "koi nahi"}`);

// ---------- aaj ka plan ----------
function istTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.parse(`${today}T00:00:00Z`) - IST + (h * 60 + m) * 60_000;
}
function buildPlan() {
  const N = state.target, [a, b] = (CONFIG.window || ["08:00", "23:00"]).map(istTime);
  const caps = { ...(CONFIG.platformDailyCaps || {}) };
  if (caps.youtube != null) caps.youtube = Math.min(caps.youtube, Number(env.YT_MAX_UPLOADS_PER_DAY || caps.youtube));
  const used = {}, slots = [];
  let rr = 0;
  for (let i = 0; i < N; i++) {
    const at = N === 1 ? a : Math.round(a + ((b - a) * i) / (N - 1));
    let acc = null;
    for (let k = 0; k < eligible.length && !acc; k++) {
      const c = eligible[(rr + k) % eligible.length];
      if ((used[c.platform] || 0) < (caps[c.platform] ?? Infinity)) { acc = c; rr = (rr + k + 1) % eligible.length; }
    }
    if (acc) used[acc.platform] = (used[acc.platform] || 0) + 1;
    slots.push({ i, at, channel: acc?.key || null, channelName: acc?.name || null, platform: acc?.platform || null,
      topic: (CONFIG.topics || [])[i % Math.max(1, (CONFIG.topics || []).length)] || null,
      status: acc ? "pending" : "skipped", attempts: 0, ...(acc ? {} : { error: "koi eligible channel / cap khatam" }) });
  }
  return { slots, quota: { youtubeUnits: 0, instagram: {} } };
}
if (!state.days[today] && eligible.length) {  // accounts na milein to plan mat banao, agle run me try
  state.days[today] = buildPlan();
  log(`📅 Plan bana: ${state.days[today].slots.filter((s) => s.channel).length}/${state.target} slots`);
}
const day = state.days[today] || { slots: [], quota: { youtubeUnits: 0, instagram: {} } };

// ---------- headlines (topics ki aaj ki news) ----------
const headlineCache = {};
async function headline(topic, n) {
  if (!topic) return null;
  if (!headlineCache[topic]) {
    try {
      const xml = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}+when:2d&hl=en-IN&gl=IN&ceid=IN:en`,
        { headers: { "User-Agent": "Mozilla/5.0 AutoPost" }, signal: AbortSignal.timeout(15000) })).text();
      headlineCache[topic] = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim());
    } catch { headlineCache[topic] = []; }
  }
  const list = headlineCache[topic];
  return list.length ? list[n % list.length] : topic;
}

// ---------- ek slot publish ----------
async function pickItem(acc, slot) {
  const used = new Set(state.posted[acc.key] || []);
  for (const it of approvedItems()) {
    if (used.has(it.sourceId)) continue;
    if (acc.platform === "instagram" && !it.publicUrl) continue;
    return it;
  }
  if (!CONFIG.stock?.enabled) return null;
  const h = await headline(slot.topic, slot.i);
  const q = (CONFIG.stockQueries || {})[slot.topic] || ({ "GTA 6": "neon city night car", MrBeast: "youtuber challenge excited" })[slot.topic] || CONFIG.stock.fallbackQuery;
  const it = await stockItem(q, used);
  return it && { ...it, topic: h ? `${slot.topic}: ${h}` : it.topic };
}

async function publishSlot(slot) {
  const acc = eligible.find((a) => a.key === slot.channel);
  if (!acc) { slot.status = "skipped"; slot.error = "account ab connected/eligible nahi"; return; }
  let item = await pickItem(acc, slot);
  if (!item) { slot.status = "skipped"; slot.error = "queue me nayi approved/stock video nahi"; return; }

  let dl = null;
  if (acc.platform !== "instagram") {
    dl = await withRetry(() => download(item));
    if ((state.posted[acc.key] || []).includes(dl.hash)) {  // same file pehle ja chuki (alag URL se bhi)
      (state.posted[acc.key] ||= []).push(item.sourceId);
      slot.status = "retry"; slot.error = "duplicate file — agla item"; return;
    }
  }
  const cap = await withRetry(() => captionFor(acc.platform, item, acc));
  Object.assign(slot, { sourceId: item.sourceId, sourceKind: item.kind, title: cap.title });
  if (DRY) { log(`🧪 [${acc.platform}] ${acc.name} ← ${item.sourceId}\n   ${cap.title}\n   ${cap.caption.slice(0, 300).replace(/\n/g, " ")}`); return cap; }

  let r;
  if (acc.platform === "facebook") r = await withRetry(() => facebookPublish(acc, dl.file, { title: cap.title, description: cap.caption }));
  else if (acc.platform === "instagram") r = await withRetry(() => instagramPublish(acc, item.publicUrl, { caption: cap.caption }));
  else if (acc.platform === "youtube") {
    r = await withRetry(() => youtubePublish(acc, dl.file, { title: cap.title, description: cap.description, tags: [...cap.keywords, ...cap.hashtags.map((h) => h.slice(1))] }));
    day.quota.youtubeUnits = (day.quota.youtubeUnits || 0) + 1600;
  }
  Object.assign(slot, r, { publishedAt: Date.now(), error: undefined });
  (state.posted[acc.key] ||= []).push(item.sourceId, ...(dl ? [dl.hash] : []));
  if (dl && dl.file.includes("vid-")) rmSync(dl.file, { force: true });
  log(`📤 [${acc.platform}] ${acc.name}: ${slot.status} ${r.remoteId} ${r.permalink || ""}`);
}

async function verifySlot(slot) {
  const acc = eligible.find((a) => a.key === slot.channel);
  if (!acc) return;
  const v = slot.platform === "facebook" ? await facebookVerify(acc, slot.remoteId) : slot.platform === "youtube" ? await youtubeVerify(acc, slot.remoteId) : { status: "published" };
  Object.assign(slot, v);
  if (v.status === "published") log(`✅ verified ${slot.channelName}: ${slot.permalink || slot.remoteId}${v.note ? " — " + v.note : ""}`);
}

// ---------- run ----------
const due = day.slots.filter((s) => ["pending", "retry"].includes(s.status) && s.at <= now + 5 * 60_000);
const maxAttempts = CONFIG.maxAttempts || 3;
const runLimit = Number(env.MAX_PER_RUN || (DRY ? 1 : 4));  // ek run me zyada se zyada itne (baaki agle ghante)
log(`⏰ ${today}: ${due.length} slot(s) due, is run me max ${runLimit}`);
let dryCap = null;
for (const slot of due.slice(0, runLimit)) {
  try {
    const before = slot.status;
    const r = await publishSlot(slot);
    if (DRY) { dryCap = r; slot.status = before; }
    else if (slot.status === "retry" && slot.error?.startsWith("duplicate")) await publishSlot(slot);
  } catch (e) {
    slot.attempts = (slot.attempts || 0) + 1;
    slot.error = e.message.slice(0, 300);
    slot.status = e instanceof TransientError && slot.attempts < maxAttempts ? "retry" : slot.attempts >= maxAttempts || !(e instanceof TransientError) ? "failed" : "retry";
    err(`${slot.channelName}: ${e.message}`);
  }
}
if (!DRY) for (const slot of day.slots.filter((s) => s.status === "processing")) {
  try { await verifySlot(slot); } catch (e) { err(`verify ${slot.channelName}: ${e.message}`); }
}

// Instagram quota
for (const a of eligible.filter((x) => x.platform === "instagram")) {
  try { day.quota.instagram[a.name] = await instagramQuota(a); } catch (e) { err(`IG quota ${a.name}: ${e.message}`); }
}

// Discovery: din me ek baar
if (state.discoveredOn !== today) {
  try {
    const d = await discover(CONFIG.discovery, state.discovered);
    state.discovered.push(...d.items);
    state.discovered = state.discovered.slice(-100);
    day.quota.youtubeUnits = (day.quota.youtubeUnits || 0) + d.units;
    state.discoveredOn = today;
    if (d.items.length) log(`🔎 ${d.items.length} nayi suggestions (approval chahiye)`);
  } catch (e) { err(`discovery: ${e.message}`); }
}

// purane din hatao, errors limit
for (const k of Object.keys(state.days).sort().slice(0, -7)) delete state.days[k];
state.errors = state.errors.slice(-50);

const md = renderDashboard(state, today);
if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, md + (dryCap ? `\n## 🧪 Dry run sample caption\n**${dryCap.title}**\n\n${dryCap.caption}\n` : ""), { flag: "a" });
if (!DRY) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  writeFileSync(join(STATE_DIR, "STATUS.md"), md);
}
const done = day.slots.filter((s) => s.status === "published" || s.status === "processing").length;
log(`📊 Aaj: ${done}/${state.target} published/processing`);
