// Har platform ka chhota adapter. Sirf wahi platform chalega jiske env variables set hain.
// Koi npm package nahi — sirf built-in fetch aur crypto.
// post = { text, short, image?, video? }   (short = Instagram ke liye chhota caption)
import crypto from "node:crypto";

const env = process.env;
const GRAPH = `https://graph.facebook.com/${env.FB_GRAPH_VERSION || "v23.0"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(res, name) {
  if (!res.ok) throw new Error(`${name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json().catch(() => ({}));
}

// loremflickr jaise redirect wale URL ko final image URL me badlo (Instagram redirect follow nahi karta)
export async function finalUrl(url) {
  const r = await fetch(url, { method: "GET", redirect: "follow" });
  return r.url || url;
}

// ---------- Facebook Page (FREE, Graph API) ----------
export async function facebookPost({ text, image, video }, pageId = env.FB_PAGE_ID, token = env.FB_PAGE_TOKEN) {
  const body = new URLSearchParams({ access_token: token });
  let edge = "feed";
  if (video) { edge = "videos"; body.set("file_url", video); body.set("description", text); }
  else if (image) { edge = "photos"; body.set("url", image); body.set("caption", text); }
  else body.set("message", text);
  return check(await fetch(`${GRAPH}/${pageId}/${edge}`, { method: "POST", body }), "Facebook");
}
const facebook = (post) => facebookPost(post);

// FB_USER_TOKEN se account ke saare pages (har page ka apna token + category)
export async function listFacebookPages() {
  const pages = [];
  let url = `${GRAPH}/me/accounts?fields=id,name,category,about,description,access_token&limit=100&access_token=${encodeURIComponent(env.FB_USER_TOKEN)}`;
  while (url) {
    const d = await check(await fetch(url), "Facebook pages list");
    pages.push(...(d.data || []));
    url = d.paging?.next;
  }
  return pages;
}

// ---------- Instagram Business (FREE, Graph API) ----------
// Step 1: container banao → Step 2: ready hone tak ruko → Step 3: publish
async function instagram({ text, short, image, video }) {
  if (!image && !video) throw new Error("Instagram ko image ya video chahiye");
  const token = env.IG_TOKEN || env.FB_PAGE_TOKEN;
  const body = new URLSearchParams({ access_token: token, caption: (short || text).slice(0, 2200) });
  if (video) { body.set("media_type", "REELS"); body.set("video_url", video); }
  else body.set("image_url", image);

  const c = await check(await fetch(`${GRAPH}/${env.IG_USER_ID}/media`, { method: "POST", body }), "Instagram container");

  // Reel process hone me time lagta hai — status check karte raho (max ~4 min)
  for (let i = 0; i < 48; i++) {
    const s = await check(
      await fetch(`${GRAPH}/${c.id}?fields=status_code&access_token=${encodeURIComponent(token)}`),
      "Instagram status"
    );
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("Instagram media processing failed");
    await sleep(5000);
  }

  return check(
    await fetch(`${GRAPH}/${env.IG_USER_ID}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({ access_token: token, creation_id: c.id }),
    }),
    "Instagram publish"
  );
}

// ---------- LinkedIn Company Pages (FREE) ----------
// Ek token se kai company pages: LINKEDIN_ORGS=111,222   Doosre account ke liye LINKEDIN_TOKEN_2 + LINKEDIN_ORGS_2
async function linkedinOne(token, org, { text, image }) {
  const h = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": env.LINKEDIN_VERSION || "202510",
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
  // "person:abc123" = personal profile, warna company page ID
  const author = org.startsWith("person:") ? `urn:li:person:${org.slice(7)}` : `urn:li:organization:${org}`;
  const post = {
    author,
    commentary: text.slice(0, 3000).replace(/[(){}\[\]<>@|~_*#\\]/g, (c) => "\\" + c), // LinkedIn "little text" escaping
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (image) {
    const init = await check(
      await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
        method: "POST", headers: h, body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      }),
      `LinkedIn ${org} image init`
    );
    const img = await fetch(image);
    const up = await fetch(init.value.uploadUrl, {
      method: "PUT", headers: { Authorization: h.Authorization }, body: Buffer.from(await img.arrayBuffer()),
    });
    if (!up.ok) throw new Error(`LinkedIn ${org} image upload ${up.status}`);
    post.content = { media: { id: init.value.image } };
  }

  const res = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers: h, body: JSON.stringify(post) });
  if (!res.ok) throw new Error(`LinkedIn ${org} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { id: res.headers.get("x-restli-id") };
}

async function linkedin(post) {
  const jobs = [];
  for (const sfx of ["", "_2", "_3"]) {
    const token = env[`LINKEDIN_TOKEN${sfx}`];
    const orgs = (env[`LINKEDIN_ORGS${sfx}`] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (token) for (const org of orgs) jobs.push(linkedinOne(token, org, post).then(() => org));
  }
  const r = await Promise.allSettled(jobs);
  const failed = r.filter((x) => x.status === "rejected").map((x) => x.reason.message);
  if (failed.length) throw new Error(failed.join(" | "));
  return { orgs: r.map((x) => x.value) };
}

// ---------- Bluesky (FREE) ----------
async function bluesky({ text, short, image }) {
  text = (short || text).slice(0, 300);
  const host = env.BSKY_SERVICE || "https://bsky.social";
  const s = await check(
    await fetch(`${host}/xrpc/com.atproto.server.createSession`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
    }),
    "Bluesky login"
  );
  const auth = { Authorization: `Bearer ${s.accessJwt}` };
  const record = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
  const enc = new TextEncoder();
  const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  if (facets.length) record.facets = facets;
  if (image) {
    const img = await fetch(image);
    const blob = await check(
      await fetch(`${host}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST", headers: { ...auth, "Content-Type": img.headers.get("content-type") || "image/jpeg" },
        body: Buffer.from(await img.arrayBuffer()),
      }),
      "Bluesky image"
    );
    record.embed = { $type: "app.bsky.embed.images", images: [{ image: blob.blob, alt: "" }] };
  }
  return check(
    await fetch(`${host}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
    }),
    "Bluesky post"
  );
}

// ---------- Telegram channel/group (FREE) ----------
async function telegram({ text, image, video }) {
  const method = video ? "sendVideo" : image ? "sendPhoto" : "sendMessage";
  const payload = { chat_id: env.TELEGRAM_CHAT_ID };
  if (video) Object.assign(payload, { video, caption: text.slice(0, 1024) });
  else if (image) Object.assign(payload, { photo: image, caption: text.slice(0, 1024) });
  else payload.text = text;
  return check(
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    "Telegram"
  );
}

// ---------- Discord webhook (FREE) ----------
async function discord({ text, image, video }) {
  const payload = { content: (text + (video ? `\n${video}` : "")).slice(0, 2000) };
  if (image) payload.embeds = [{ image: { url: image } }];
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
  return { ok: true };
}

// ---------- X / Twitter (PAID — pay-per-use since Feb 2026) ----------
function oauth1Header(method, url) {
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const p = {
    oauth_consumer_key: env.X_API_KEY, oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN, oauth_version: "1.0",
  };
  const paramStr = Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join("&");
  const base = [method, enc(url), enc(paramStr)].join("&");
  p.oauth_signature = crypto.createHmac("sha1", `${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(", ");
}
async function x({ text, short }) {
  const url = "https://api.x.com/2/tweets";
  return check(
    await fetch(url, {
      method: "POST", headers: { Authorization: oauth1Header("POST", url), "Content-Type": "application/json" },
      body: JSON.stringify({ text: (short || text).slice(0, 280) }),
    }),
    "X"
  );
}

// Platform → kaunse env variables chahiye
export const PLATFORMS = {
  // FB_USER_TOKEN set ho to ye skip hota hai aur lib/fbpages.js saare pages sambhalta hai
  facebook: { fn: facebook, needs: ["FB_PAGE_ID", "FB_PAGE_TOKEN"], skipIf: "FB_USER_TOKEN" },
  instagram: { fn: instagram, needs: ["IG_USER_ID"], any: ["IG_TOKEN", "FB_PAGE_TOKEN"] },
  linkedin: { fn: linkedin, needs: ["LINKEDIN_TOKEN", "LINKEDIN_ORGS"] },
  bluesky: { fn: bluesky, needs: ["BSKY_HANDLE", "BSKY_APP_PASSWORD"] },
  telegram: { fn: telegram, needs: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] },
  discord: { fn: discord, needs: ["DISCORD_WEBHOOK_URL"] },
  x: { fn: x, needs: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] },
};

export function enabledPlatforms() {
  const only = (env.PLATFORMS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return Object.entries(PLATFORMS).filter(
    ([name, p]) =>
      (!only.length || only.includes(name)) &&
      p.needs.every((k) => env[k]) &&
      !(p.skipIf && env[p.skipIf]) &&
      (!p.any || p.any.some((k) => env[k]))
  );
}
