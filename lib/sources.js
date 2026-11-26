// Content queue: (1) content/approved.json — apni / licensed videos (license zaroori)  (2) Pexels stock (Pexels License).
// Duplicate check: sourceId (URL / Pexels id) + downloaded file ka SHA-256.
import { readFileSync, existsSync, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { videoCandidates } from "./pexels.js";
import { CONFIG } from "./accounts.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const sourceIdOf = (url) => "url:" + createHash("sha1").update(url.trim().toLowerCase().replace(/[?#].*$/, "")).digest("hex").slice(0, 16);

export function approvedItems() {
  const f = join(ROOT, "content", "approved.json");
  if (!existsSync(f)) return [];
  let list = [];
  try { list = JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.warn(`approved.json parse fail: ${e.message}`); }
  return list
    .filter((x) => x && x.url && String(x.license || "").trim())  // bina license ke kabhi nahi
    .map((x) => ({
      kind: "approved", sourceId: x.id || sourceIdOf(x.url), url: x.url, title: x.title || "", topic: x.topic || x.title || "",
      owner: x.owner || "", license: x.license,
      publicUrl: /^https?:\/\/.+\.mp4(\?|$)/i.test(x.url) ? x.url : null,
    }));
}

// Pexels se ek stock video jo is channel par pehle nahi gaya
export async function stockItem(query, usedIds) {
  if (!process.env.PEXELS_API_KEY) return null;
  const queries = [...new Set([query, ...(CONFIG.stock?.queries || []), CONFIG.stock?.fallbackQuery].filter(Boolean))];
  for (const q of queries) {
    const list = await videoCandidates(q).catch(() => []);
    for (const v of list) {
      const id = "pexels:" + (v.video.match(/video-files\/(\d+)\//)?.[1] || sourceIdOf(v.video));
      if (!usedIds.has(id)) return { kind: "stock", sourceId: id, url: v.video, publicUrl: v.video, title: "", topic: q, owner: v.credit, license: "Pexels License" };
    }
  }
  return null;
}

// Video ko local temp file me laao + hash
export async function download(item) {
  const file = join(tmpdir(), `vid-${item.sourceId.replace(/[^a-z0-9]/gi, "_")}.mp4`);
  if (!/^https?:/i.test(item.url)) {
    const p = join(ROOT, item.url);
    if (!existsSync(p)) throw new Error(`file nahi mila: ${item.url}`);
    return { file: p, hash: createHash("sha256").update(readFileSync(p)).digest("hex") };
  }
  if (/\.mp4(\?|$)/i.test(item.url)) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`download ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  } else {
    // Page link (sirf apni/licensed video) → yt-dlp
    await new Promise((res, rej) => execFile("yt-dlp", ["-f", "mp4[height<=1920]/mp4/best", "-o", file, "--no-playlist", item.url],
      { timeout: 15 * 60_000 }, (e, _o, err) => (e ? rej(new Error(`yt-dlp: ${String(err || e.message).slice(-200)}`)) : res())));
  }
  return { file, hash: createHash("sha256").update(readFileSync(file)).digest("hex") };
}
