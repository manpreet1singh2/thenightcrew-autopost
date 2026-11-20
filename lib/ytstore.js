// YouTube refresh tokens: secret YT_REFRESH_TOKENS + repo me jode gaye channels (state/yt-tokens.json).
// State file me token AES-256-GCM se encrypted rehta hai (key = YT_CLIENT_SECRET), plain token kabhi save nahi hota.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const file = () => join(env.STATE_DIR || "state", "yt-tokens.json");
const key = () => createHash("sha256").update(`yt-store:${env.YT_CLIENT_SECRET}`).digest();

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export function storedChannels() {
  if (!existsSync(file())) return [];
  try { return JSON.parse(readFileSync(file(), "utf8")); } catch { return []; }
}

export function saveChannel({ id, name, refresh }) {
  const list = storedChannels().filter((c) => c.id !== id);
  list.push({ id, name, token: encrypt(refresh), added: new Date().toISOString() });
  writeFileSync(file(), JSON.stringify(list, null, 2) + "\n");
  return list.length;
}

export function refreshTokens() {
  const out = (env.YT_REFRESH_TOKENS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.YT_CLIENT_SECRET) for (const c of storedChannels()) {
    try { const t = decrypt(c.token); if (!out.includes(t)) out.push(t); } catch { /* secret badla to purane tokens skip */ }
  }
  return out;
}
