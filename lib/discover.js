// Discovery: YouTube par config.discovery.query (default "MrBeast") ki nayi videos dhoondho → SIRF suggestion list.
// Ye kabhi publish nahi hoti. Inpe apni reaction/commentary video banao aur use content/approved.json me daalo.
import { googleAccessToken } from "./accounts.js";

const env = process.env;

export async function discover(cfg, known = []) {
  if (!cfg?.enabled) return { items: [], units: 0 };
  const queries = cfg.queries || [cfg.query || "MrBeast"];
  let all = [], units = 0;
  for (const q of queries) { const r = await discoverOne({ ...cfg, query: q }, [...known, ...all]); all = all.concat(r.items); units += r.units; }
  return { items: all, units };
}

async function discoverOne(cfg, known = []) {
  let auth = env.YT_API_KEY ? `key=${encodeURIComponent(env.YT_API_KEY)}` : null;
  const headers = {};
  if (!auth && env.YT_REFRESH_TOKENS && env.YT_CLIENT_ID) {
    headers.Authorization = `Bearer ${await googleAccessToken(env.YT_REFRESH_TOKENS.split(",")[0].trim())}`;
    auth = "";
  }
  if (auth === null) return { items: [], units: 0, note: "YouTube key/token nahi — discovery skip" };
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=${cfg.maxResults || 10}`
    + `&publishedAfter=${since}&q=${encodeURIComponent(cfg.query || "MrBeast")}${auth ? "&" + auth : ""}`;
  const r = await fetch(url, { headers });
  const d = await r.json();
  if (!r.ok) throw new Error(`YouTube search: ${d.error?.message || r.status}`);
  const seen = new Set(known.map((k) => k.id));
  const items = (d.items || []).filter((v) => !seen.has(v.id.videoId)).map((v) => ({
    id: v.id.videoId, url: `https://www.youtube.com/watch?v=${v.id.videoId}`, title: v.snippet.title,
    channel: v.snippet.channelTitle, publishedAt: v.snippet.publishedAt, status: "needs_approval",
  }));
  return { items, units: 100 };
}
