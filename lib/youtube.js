// YouTube upload (Shorts) — har channel ke refresh token se. Koi npm package nahi.
// Env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKENS (comma se, har channel ka ek; scripts/youtube-auth.mjs se milte hain)
// Dhyan: unverified Google project se upload hui videos YouTube PRIVATE rakhta hai jab tak API audit pass na ho.
// Quota: ek upload ≈ 1600 units, free quota 10,000/din → ~6 uploads/din (saare channels milake).
import { openAsBlob, statSync } from "node:fs";

const env = process.env;

export const youtubeEnabled = () => Boolean(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_REFRESH_TOKENS);

async function accessToken(refresh) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`Google token: ${d.error_description || d.error || r.status}`);
  return d.access_token;
}

async function channelTitle(token) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  return d.items?.[0]?.snippet?.title || "YouTube channel";
}

// Ek channel par resumable upload
async function uploadOne(token, file, { title, description, tags = [], publishAt }) {
  const status = publishAt && publishAt > Date.now() + 15 * 60_000
    ? { privacyStatus: "private", publishAt: new Date(publishAt).toISOString(), selfDeclaredMadeForKids: false }
    : { privacyStatus: env.YT_PRIVACY || "public", selfDeclaredMadeForKids: false };
  const meta = {
    snippet: {
      title: title.slice(0, 100),
      description: description.slice(0, 4900),
      tags: tags.map((t) => t.replace(/^#/, "")).filter(Boolean).slice(0, 15),
      categoryId: env.YT_CATEGORY || "28", // Science & Technology
    },
    status,
  };
  const size = statSync(file).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const put = await fetch(init.headers.get("location"), {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: await openAsBlob(file, { type: "video/mp4" }),
    duplex: "half",
  });
  const d = await put.json().catch(() => ({}));
  if (!put.ok || !d.id) throw new Error(`YouTube upload ${put.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return { id: d.id, privacy: d.status?.privacyStatus };
}

// Saare channels par upload → [{ channel, id | error }]
export async function uploadToYouTube(file, { headline, text, publishAt }) {
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []);
  const title = `${headline.replace(/[<>]/g, "")} #Shorts`;
  const out = [];
  for (const refresh of env.YT_REFRESH_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)) {
    let channel = "?";
    try {
      const token = await accessToken(refresh);
      channel = await channelTitle(token);
      const r = await uploadOne(token, file, { title, description: text, tags, publishAt });
      out.push({ channel, id: r.id, privacy: r.privacy });
    } catch (e) {
      out.push({ channel, error: e.message });
    }
  }
  return out;
}
