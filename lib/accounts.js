// Connected accounts dynamically: FB Pages (/me/accounts), unke linked Instagram Professional accounts, YouTube channels.
// Personal Facebook profile kabhi target nahi hota (sirf Pages ke page-tokens use hote hain).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const env = process.env;
const GRAPH = `https://graph.facebook.com/${env.FB_GRAPH_VERSION || "v23.0"}`;
const CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));

async function json(r, what) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`${what}: ${d.error?.message || d.error_description || r.status}`);
  return d;
}

export async function googleAccessToken(refresh) {
  const d = await json(await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
  }), "Google token");
  return d.access_token;
}

async function facebookAccounts() {
  if (!env.FB_USER_TOKEN) return [];
  const exclude = (CONFIG.excludePages || []).map((s) => s.toLowerCase());
  const pages = [];
  let url = `${GRAPH}/me/accounts?fields=id,name,category,access_token,fan_count,followers_count,tasks,instagram_business_account{id,username,followers_count,media_count}&limit=100&access_token=${encodeURIComponent(env.FB_USER_TOKEN)}`;
  while (url) {
    const d = await json(await fetch(url), "Facebook pages");
    pages.push(...(d.data || []));
    url = d.paging?.next;
  }
  const out = [];
  for (const p of pages) {
    const excluded = exclude.includes(p.name.toLowerCase()) || exclude.includes(String(p.id));
    const canPost = !p.tasks || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE");
    out.push({
      key: `facebook:${p.id}`, platform: "facebook", id: p.id, name: p.name, category: p.category,
      token: p.access_token, eligible: !excluded && canPost,
      reason: excluded ? "config.json excludePages" : canPost ? "" : "CREATE_CONTENT permission nahi",
      stats: { followers: p.followers_count ?? p.fan_count ?? null },
    });
    const ig = p.instagram_business_account;
    if (ig) out.push({
      key: `instagram:${ig.id}`, platform: "instagram", id: ig.id, name: `@${ig.username}`, page: p.name,
      token: p.access_token, eligible: !excluded && !exclude.includes(`@${ig.username}`.toLowerCase()),
      reason: excluded ? "linked Page excluded" : "",
      stats: { followers: ig.followers_count ?? null, media: ig.media_count ?? null },
    });
  }
  return out;
}

async function youtubeAccounts() {
  if (!(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_REFRESH_TOKENS)) return [];
  const out = [];
  for (const [i, refresh] of env.YT_REFRESH_TOKENS.split(",").map((s) => s.trim()).filter(Boolean).entries()) {
    try {
      const token = await googleAccessToken(refresh);
      const d = await json(await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
        headers: { Authorization: `Bearer ${token}` },
      }), "YouTube channels");
      for (const c of d.items || []) out.push({
        key: `youtube:${c.id}`, platform: "youtube", id: c.id, name: c.snippet.title, refreshIndex: i,
        token, eligible: true, reason: "",
        stats: { subscribers: Number(c.statistics.subscriberCount ?? 0), views: Number(c.statistics.viewCount ?? 0), videos: Number(c.statistics.videoCount ?? 0) },
      });
    } catch (e) {
      out.push({ key: `youtube:token${i + 1}`, platform: "youtube", name: `YouTube token #${i + 1}`, eligible: false, reason: e.message, stats: {} });
    }
  }
  return out;
}

export async function connectedAccounts() {
  const errors = [];
  const [fb, yt] = await Promise.all([
    facebookAccounts().catch((e) => (errors.push(e.message), [])),
    youtubeAccounts().catch((e) => (errors.push(e.message), [])),
  ]);
  return { accounts: [...fb, ...yt], errors };
}

export { CONFIG };
