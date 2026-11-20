// Poora autopost flow ek jagah: topic chuno → AI post likhe → Pexels se best photo/video → sab platforms par post.
// Vercel endpoint (api/post.js) aur GitHub Actions script (scripts/autopost.mjs) dono yahi use karte hain.
import { pickPost } from "./pick.js";
import { enabledPlatforms, finalUrl } from "./platforms.js";
import { aiEnabled, writePost, chooseBestMedia } from "./ai.js";
import { photoCandidates, videoCandidates } from "./pexels.js";
import { postAllPages } from "./fbpages.js";
import { trendingTopic } from "./trends.js";

export async function runAutopost({ dry = false } = {}) {
  const picked = pickPost();
  if (!picked) return { status: 200, body: { message: "posts.json khaali hai" } };
  const post = { ...picked };
  if (process.env.FORCE_TYPE && !picked.image && !picked.video) post.type = process.env.FORCE_TYPE;
  if (process.env.TREND_TOPICS === "1" && !picked.date && !picked.text) {
    const t = await trendingTopic(picked.topic);
    if (t) Object.assign(post, { topic: t.topic, trend: t.trend });
  }
  const kind = post.type === "video" ? "video" : "photo";

  try {
    // 1) Heading + paragraphs wala post (text khud diya ho to AI skip)
    if (!post.text) {
      if (!aiEnabled()) throw new Error("AI key (OPENROUTER_API_KEY / COHERE_API_KEY) set nahi hai");
      Object.assign(post, await writePost(post.topic, kind));
    }

    // 2) Pexels se options → AI dekh kar best chunta hai
    if (!post.image && !post.video && process.env.PEXELS_API_KEY) {
      const find = kind === "video" ? videoCandidates : photoCandidates;
      let options = await find(post.mediaQuery || post.topic);
      if (!options.length && post.topic) options = await find(post.topic);
      if (!options.length) throw new Error(`Pexels par "${post.mediaQuery || post.topic}" ke liye kuch nahi mila`);

      const best = aiEnabled() ? await chooseBestMedia(post, options, kind) : 0;
      const { preview, alt, ...chosen } = options[best];
      Object.assign(post, chosen, { mediaAlt: alt });
    }

    if (post.image) post.image = await finalUrl(post.image);
  } catch (e) {
    return { status: 502, body: { error: e.message, post } };
  }

  const platforms = enabledPlatforms();
  const only = (process.env.PLATFORMS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allPages = Boolean(process.env.FB_USER_TOKEN) && (!only.length || only.includes("facebook"));
  if (!platforms.length && !allPages) return { status: 502, body: { error: "Koi platform set nahi hai (tokens missing)", post } };

  if (dry) {
    const pages = allPages ? await postAllPages(post, { dry: true }).catch((e) => ({ facebook: `❌ ${e.message}` })) : undefined;
    return { status: 200, body: { dryRun: true, post, platforms: platforms.map(([n]) => n), facebookPages: pages } };
  }

  const results = await Promise.allSettled(platforms.map(([, p]) => p.fn(post)));
  const report = Object.fromEntries(
    platforms.map(([name], i) => [name, results[i].status === "fulfilled" ? "✅ posted" : `❌ ${results[i].reason.message}`])
  );
  if (allPages) Object.assign(report, await postAllPages(post).catch((e) => ({ facebook: `❌ ${e.message}` })));

  const media = post.image || post.video;
  const states = Object.values(report).filter((r) => typeof r === "string" && !r.startsWith("⏭️"));
  const allFailed = states.length > 0 && states.every((r) => r.startsWith("❌"));
  const someFailed = states.some((r) => r.startsWith("❌"));
  return { status: allFailed ? 502 : someFailed ? 207 : 200, body: { headline: post.headline, media, report } };
}
