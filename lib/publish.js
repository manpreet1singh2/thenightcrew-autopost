// Asli publishing + verification: Facebook Page video, Instagram Reel, YouTube Short. Koi simulation nahi.
import { openAsBlob, statSync } from "node:fs";

const env = process.env;
const V = env.FB_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${V}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TransientError extends Error {}

async function call(r, what) {
  const d = await r.json().catch(() => ({}));
  if (r.ok && !d.error) return d;
  const msg = `${what}: ${d.error?.message || JSON.stringify(d).slice(0, 200) || r.status}`;
  // 429 / 5xx / Graph transient codes (1, 2, 4, 17, 32, 613) → retry layak
  const code = d.error?.code;
  if (r.status === 429 || r.status >= 500 || [1, 2, 4, 17, 32, 341, 613].includes(code) || d.error?.is_transient) throw new TransientError(msg);
  throw new Error(msg);
}

export async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const transient = e instanceof TransientError || /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(e.message);
      if (!transient || i >= tries) throw e;
      await sleep(2000 * 2 ** i);
    }
  }
}

// ---------- Facebook Page ----------
export async function facebookPublish(acc, file, { title, description }) {
  const form = new FormData();
  form.set("access_token", acc.token);
  form.set("title", title.slice(0, 250));
  form.set("description", description);
  form.set("source", await openAsBlob(file, { type: "video/mp4" }), "video.mp4");
  const d = await call(await fetch(`https://graph-video.facebook.com/${V}/${acc.id}/videos`, { method: "POST", body: form }), "Facebook upload");
  return { remoteId: d.id, status: "processing" };
}

export async function facebookVerify(acc, remoteId) {
  const d = await call(await fetch(`${GRAPH}/${remoteId}?fields=status,permalink_url,published&access_token=${encodeURIComponent(acc.token)}`), "Facebook status");
  const s = d.status?.video_status;
  if (s === "error") return { status: "failed", error: JSON.stringify(d.status).slice(0, 200) };
  if (s === "ready" || d.published) return { status: "published", permalink: d.permalink_url ? `https://www.facebook.com${d.permalink_url}` : "" };
  return { status: "processing" };
}

// ---------- Instagram Reel (public mp4 URL chahiye) ----------
export async function instagramPublish(acc, videoUrl, { caption }) {
  if (!videoUrl) throw new Error("Instagram ko public .mp4 URL chahiye");
  const body = new URLSearchParams({ access_token: acc.token, media_type: "REELS", video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: "true" });
  const c = await call(await fetch(`${GRAPH}/${acc.id}/media`, { method: "POST", body }), "Instagram container");
  for (let i = 0; i < 60; i++) {
    const s = await call(await fetch(`${GRAPH}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(acc.token)}`), "Instagram status");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram processing: ${s.status || s.status_code}`);
    if (i === 59) throw new TransientError("Instagram processing timeout");
    await sleep(5000);
  }
  const p = await call(await fetch(`${GRAPH}/${acc.id}/media_publish`, { method: "POST", body: new URLSearchParams({ access_token: acc.token, creation_id: c.id }) }), "Instagram publish");
  const m = await call(await fetch(`${GRAPH}/${p.id}?fields=permalink&access_token=${encodeURIComponent(acc.token)}`), "Instagram verify");
  return { remoteId: p.id, status: "published", permalink: m.permalink || "" };
}

export async function instagramQuota(acc) {
  const d = await call(await fetch(`${GRAPH}/${acc.id}/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(acc.token)}`), "Instagram quota");
  const q = d.data?.[0];
  return q ? { used: q.quota_usage, limit: q.config?.quota_total } : null;
}

// ---------- YouTube Short ----------
export async function youtubePublish(acc, file, { title, description, tags }) {
  const meta = {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), tags: tags.slice(0, 15), categoryId: env.YT_CATEGORY || "28" },
    status: { privacyStatus: env.YT_PRIVACY || "public", selfDeclaredMadeForKids: false },
  };
  const size = statSync(file).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify(meta),
  });
  if (!init.ok) await call(init, "YouTube init");
  const put = await fetch(init.headers.get("location"), {
    method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: await openAsBlob(file, { type: "video/mp4" }), duplex: "half",
  });
  const d = await call(put, "YouTube upload");
  return { remoteId: d.id, status: "processing", permalink: `https://youtube.com/shorts/${d.id}`, privacy: d.status?.privacyStatus };
}

export async function youtubeVerify(acc, remoteId) {
  const d = await call(await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${remoteId}`, {
    headers: { Authorization: `Bearer ${acc.token}` },
  }), "YouTube status");
  const v = d.items?.[0];
  if (!v) return { status: "failed", error: "YouTube video nahi mila (delete/reject?)" };
  if (v.status.uploadStatus === "rejected" || v.status.uploadStatus === "failed") return { status: "failed", error: `${v.status.uploadStatus}: ${v.status.rejectionReason || v.status.failureReason || ""}` };
  if (v.status.uploadStatus === "processed") return { status: "published", note: v.status.privacyStatus === "private" ? "private (Google API audit ke bina public nahi hoti)" : "" };
  return { status: "processing" };
}
