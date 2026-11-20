// Roz AI video: FreeVideo (aapke apne GPU par) video banata hai → Facebook Page(s) par Reel/video post.
// Ye GitHub Actions par NAHI chalta (wahan GPU nahi hai). Aapke PC/Mac par Task Scheduler / cron se chalao.
//
// Zaroori:
//   - FreeVideo install aur chalu (window khuli ho): https://github.com/FlashML-org/FreeVideo
//     NVIDIA RTX 30/40/50 (8 GB+ VRAM, 16 GB RAM) ya Apple Silicon Mac
//   - .env me: OPENROUTER_API_KEY (ya COHERE_API_KEY), FB_USER_TOKEN (ya FB_PAGE_ID + FB_PAGE_TOKEN)
// Optional .env:
//   FREEVIDEO_CMD   FreeVideo command ka poora path (default "freevideo"; Windows par jaise C:\FreeVideo\freevideo.cmd)
//   VIDEO_SECONDS   default 30      VIDEO_QUALITY  light|medium|high|max (default light)
//   VIDEO_WIDTH / VIDEO_HEIGHT  (32 ke multiple; Mac default 544x960)   VIDEO_ASPECT  PC default 9:16
//   VIDEO_PAGES     khaali = sirf FB_PAGE_ID, "all" = saare pages, ya naam/ID comma se
//   DRY_RUN=1       video banao par post mat karo
//   TREND_TOPICS=0  Google Trends band (posts.json topics)   TREND_GEO  default IN
//   VIDEOS_PER_DAY  default 5    LONG_TIMES  IST, default "09:00,12:00,15:00,18:00,21:00" (agla aane wala slot)
//   CLIP_COUNT      har video ke clips, default 2 (0 = band)    CLIP_GAP_MIN  long video ke kitne min baad clip, default 60
//   FFMPEG          ffmpeg ka path (Mac: brew install ffmpeg)
//   YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKENS   YouTube (scripts/youtube-auth.mjs)   YT_MAX_UPLOADS_PER_DAY default 6
//
// Chalao:  node --env-file=.env local/daily-video.mjs
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, statSync, openAsBlob } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import posts from "../posts.json" with { type: "json" };
import { aiEnabled, writePost } from "../lib/ai.js";
import { pickPost, todayIST } from "../lib/pick.js";
import { trendingTopics } from "../lib/trends.js";
import { youtubeEnabled, uploadToYouTube } from "../lib/youtube.js";

const env = process.env;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "local", "videos");
const MAC = process.platform === "darwin";
const HOME = env.HOME || env.USERPROFILE || "";
// FreeVideo command khud dhoondo agar FREEVIDEO_CMD set nahi hai
const CMD = env.FREEVIDEO_CMD || [
  join(HOME, ".local", "share", "freevideo", "freevideo"),
  join(HOME, "FreeVideo", "freevideo"),
  join(HOME, "Applications", "FreeVideo", "freevideo"),
].find((p) => existsSync(p)) || "freevideo";
const GRAPH = env.FB_GRAPH_VERSION || "v23.0";
const log = (...a) => console.log(new Date().toISOString(), ...a);

function run(args, { timeoutMin = 120 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(CMD, args, {
      cwd: ROOT, timeout: timeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32", // .cmd file ko shell chahiye
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${CMD} ${args.slice(0, 2).join(" ")} fail: ${(stderr || err.message).slice(-800)}`));
      resolve(stdout);
    });
  });
}

// stdout me se aakhri JSON object nikaalo
function lastJSON(text) {
  for (let i = text.lastIndexOf("{"); i >= 0; i = text.lastIndexOf("{", i - 1)) {
    try { return JSON.parse(text.slice(i)); } catch {}
  }
  try { return JSON.parse(text); } catch { return null; }
}

// Result JSON me kahin bhi library video id / file path dhoondo
function findOutput(obj) {
  let id = null, path = null;
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (!id && /^(library_id|saved_id|library)$/.test(k) && (typeof v === "string" || typeof v === "number")) id = String(v);
      if (!path && typeof v === "string" && /\.mp4$/i.test(v)) path = v;
      if (typeof v === "object") walk(v);
    }
  })(obj);
  return { id, path };
}

async function videoPrompt(topic, guide) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5",
      max_tokens: 2500,
      messages: [{ role: "user", content: `Write ONE text-to-video prompt for the FreeVideo / MiniMax H3 model, following this official prompt guide exactly:

${guide.slice(0, 12000)}

Video: ${env.VIDEO_SECONDS || 30} seconds, vertical ${env.VIDEO_ASPECT || "9:16"} social media reel for the brand TheNightCrew (AI automation agency).
Today's topic: ${topic}
Make it cinematic, modern and professional: real people using AI on phones/laptops, futuristic office, glowing UI. No logos, brand names or on-screen text (the model renders text badly). Keep it in one location, 4-6 [Shot N] cuts of 2-4 seconds each, so the video can later be cut into short standalone clips.
Reply with ONLY the prompt text (the six sections), nothing else.` }],
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices[0].message.content.trim();
}

async function pages() {
  const want = (env.VIDEO_PAGES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.FB_USER_TOKEN) {
    const list = [];
    let url = `https://graph.facebook.com/${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(env.FB_USER_TOKEN)}`;
    while (url) {
      const d = await (await fetch(url)).json();
      if (d.error) throw new Error(`Facebook pages: ${d.error.message}`);
      list.push(...(d.data || []));
      url = d.paging?.next;
    }
    if (!want.length) return list.filter((p) => p.id === env.FB_PAGE_ID);
    return want[0] === "all" ? list : list.filter((p) => want.includes(p.id) || want.includes(p.name));
  }
  return env.FB_PAGE_ID && env.FB_PAGE_TOKEN ? [{ id: env.FB_PAGE_ID, name: "main page", access_token: env.FB_PAGE_TOKEN }] : [];
}

// ffmpeg se video ke chhote clips (har clip apne aap me ek short reel)
function ffmpeg(args) {
  return new Promise((resolve, reject) =>
    execFile(env.FFMPEG || "ffmpeg", args, { timeout: 10 * 60_000 }, (e, _o, err) => (e ? reject(new Error(String(err || e.message).slice(-300))) : resolve())));
}
async function makeClips(mp4, total, count) {
  const len = total / count, files = [];
  for (let i = 0; i < count; i++) {
    const out = mp4.replace(/\.mp4$/, `-clip${i + 1}.mp4`);
    await ffmpeg(["-y", "-ss", String(i * len), "-t", String(len), "-i", mp4, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", out]);
    files.push(out);
  }
  return files;
}

// Local MP4 seedha upload (public URL ki zaroorat nahi)
async function uploadVideo(page, file, description, title, publishAt) {
  const form = new FormData();
  if (publishAt) { form.set("published", "false"); form.set("scheduled_publish_time", String(Math.floor(publishAt / 1000))); }
  form.set("access_token", page.access_token);
  form.set("description", description);
  form.set("title", title.slice(0, 250));
  form.set("source", await openAsBlob(file, { type: "video/mp4" }), "video.mp4");
  const r = await fetch(`https://graph-video.facebook.com/${GRAPH}/${page.id}/videos`, { method: "POST", body: form });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return d.id;
}

// "HH:MM" (IST) ka agla aane wala time (ms), `after` ke baad
function nextIST(hhmm, after) {
  const [h, m] = hhmm.split(":").map(Number);
  const ist = new Date(after + 330 * 60_000);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - 330 * 60_000;
  while (t < after + 15 * 60_000) t += 86400_000;
  return t;
}
const fmt = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" });

async function main() {
  if (!aiEnabled() || !env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY chahiye (video prompt likhne ke liye)");
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();

  // 0) FreeVideo chalu hai? Mac par band ho to khud khol do aur ready hone ka wait karo
  log(`FreeVideo status check (${CMD})…`);
  let status = await run(["agent", "status"], { timeoutMin: 2 }).catch((e) => e);
  if (status instanceof Error && MAC) {
    log("FreeVideo band hai → app khol raha hoon…");
    await new Promise((r) => execFile("open", ["-a", "FreeVideo"], () => r()));
    for (let i = 0; i < 40 && status instanceof Error; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      status = await run(["agent", "status"], { timeoutMin: 2 }).catch((e) => e);
    }
  }
  if (status instanceof Error) throw status;
  log(status.trim().slice(0, 400));

  // 1) Aaj ke N viral topics (har long video ka alag)
  const N = Number(env.VIDEOS_PER_DAY || 5);
  const seconds = Number(env.VIDEO_SECONDS || (MAC ? 30 : 30));
  const longTimes = (env.LONG_TIMES || "09:00,12:00,15:00,18:00,21:00").split(",").map((t) => t.trim()).filter(Boolean);
  const clipCount = Number(env.CLIP_COUNT ?? 2);
  const clipGapMin = Number(env.CLIP_GAP_MIN || 60);
  const fallbacks = [...posts.filter((p) => !p.date).map((p) => p.topic)];
  const rot = fallbacks.indexOf((pickPost() || posts[0]).topic);
  const ordered = rot > 0 ? [...fallbacks.slice(rot), ...fallbacks.slice(0, rot)] : fallbacks;
  const topics = env.TREND_TOPICS === "0" ? ordered.slice(0, N).map((topic) => ({ topic, trend: "" })) : await trendingTopics(N, ordered);
  topics.forEach((t, i) => log(`Topic ${i + 1}:`, t.trend ? `🔥 ${t.trend} →` : "", t.topic.split(" (trending")[0]));

  // Post ka time-table shuru me hi fix (agla din ke slots, agar raat ko chalaya)
  const slots = topics.map((_, i) => nextIST(longTimes[i % longTimes.length], started));
  const guide = await run(["agent", "guide"], { timeoutMin: 2 }).catch(() => "");
  const targets = env.DRY_RUN === "1" ? [] : await pages();
  if (env.DRY_RUN !== "1" && !targets.length) throw new Error("Koi Facebook page nahi mila (FB_USER_TOKEN / FB_PAGE_ID check karo)");
  const day = todayIST();
  let made = 0;
  // YouTube quota: ek upload ≈ 1600 units, free 10,000/din → saare channels milake ~6 uploads
  const ytChannels = youtubeEnabled() ? env.YT_REFRESH_TOKENS.split(",").filter((x) => x.trim()).length : 0;
  let ytLeft = Number(env.YT_MAX_UPLOADS_PER_DAY || 6);

  for (const [i, t] of topics.entries()) {
    const tag = `${day}-${i + 1}`;
    try {
      // 2) Caption + H3 prompt
      const caption = await writePost(t.topic, "video");
      const prompt = await videoPrompt(t.topic, guide);

      // 3) Video job
      const jobFile = join(OUT, `${tag}-job.json`);
      writeFileSync(jobFile, JSON.stringify({
        kind: "generate",
        prompt,
        // Mac (M5) par 544x960 ≈ 2.2 min per second of video (30 sec ≈ 66 min). PC par default 9:16 full size.
        ...(env.VIDEO_WIDTH || MAC
          ? { width: Number(env.VIDEO_WIDTH || 544), height: Number(env.VIDEO_HEIGHT || 960) }
          : { aspect: env.VIDEO_ASPECT || "9:16" }),
        seconds,
        quality: env.VIDEO_QUALITY || "light",
        release_gpu_after: i === topics.length - 1,
      }, null, 2));
      log(`🎬 Video ${i + 1}/${topics.length} ban raha hai (${seconds}s)…`);
      const result = lastJSON(await run(["agent", "submit", jobFile, "--wait"], { timeoutMin: 240 }));
      writeFileSync(join(OUT, `${tag}-result.json`), JSON.stringify(result, null, 2));

      // 4) MP4 nikaalo
      const { id, path } = findOutput(result);
      let mp4 = join(OUT, `${tag}.mp4`);
      if (id) await run(["agent", "asset", id, mp4], { timeoutMin: 10 });
      else if (path && existsSync(path)) mp4 = path;
      else throw new Error(`Video ka output nahi mila — ${OUT}/${tag}-result.json dekho`);
      log("Video:", mp4, `${(statSync(mp4).size / 1e6).toFixed(1)} MB`);
      made++;

      if (env.DRY_RUN === "1") { log("🧪 DRY_RUN: post skip.\n" + caption.text); continue; }

      // 5) Long video schedule (slot nikal gaya ho to 15 min baad)
      const soon = Date.now() + 15 * 60_000;
      const at = Math.max(slots[i], soon);
      for (const p of targets) {
        try { await uploadVideo(p, mp4, caption.text, caption.headline, at); log(`🕒 ${p.name}: video ${i + 1} → ${fmt(at)}`); }
        catch (e) { log(`❌ ${p.name}: video ${i + 1}: ${e.message}`); }
      }

      // 5b) YouTube (har channel par Shorts, usi time par)
      if (ytChannels && ytLeft >= ytChannels) {
        ytLeft -= ytChannels;
        for (const y of await uploadToYouTube(mp4, { headline: caption.headline, text: caption.text, publishAt: at })) {
          log(y.error ? `❌ YouTube ${y.channel}: ${y.error}` : `▶️ YouTube ${y.channel}: https://youtu.be/${y.id} (${y.privacy}) → ${fmt(at)}`);
        }
      } else if (ytChannels) log(`⏭️ YouTube skip (aaj ka quota limit YT_MAX_UPLOADS_PER_DAY pura)`);

      // 6) Iske clips: long video ke clipGapMin, 2×clipGapMin… minute baad
      if (clipCount > 0) {
        let clips = [];
        try { clips = await makeClips(mp4, seconds, clipCount); }
        catch (e) { log(`⚠️ Clips nahi bane (ffmpeg chahiye: brew install ffmpeg): ${e.message}`); }
        for (const [k, clip] of clips.entries()) {
          const cat = at + (k + 1) * clipGapMin * 60_000;
          const text = `${caption.short}\n\n🎬 Part ${k + 1}/${clips.length}`;
          for (const p of targets) {
            try { await uploadVideo(p, clip, text, `${caption.headline} (Part ${k + 1})`, cat); log(`🕒 ${p.name}: clip ${i + 1}.${k + 1} → ${fmt(cat)}`); }
            catch (e) { log(`❌ ${p.name}: clip ${i + 1}.${k + 1}: ${e.message}`); }
          }
        }
      }
    } catch (e) {
      log(`❌ Video ${i + 1} fail: ${e.message} → agla video`);
    }
  }
  log(`Ho gaya: ${made}/${topics.length} videos, ${((Date.now() - started) / 60000).toFixed(0)} min`);
  if (!made) process.exit(1);
}

main().catch((e) => { log("❌", e.message); process.exit(1); });
