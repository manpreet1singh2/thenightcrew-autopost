// Facebook account ke SAARE pages par post — har page ki category/about ke hisaab se alag post + photo.
// Zaroori: FB_USER_TOKEN (permissions: pages_show_list, pages_manage_posts, pages_read_engagement)
// Optional: pages.json me per-page settings (page ID ya exact naam se):
//   { "123456": { "skip": true } }
//   { "My Cafe": { "topics": ["weekend offer", "new menu"], "prompt": "Extra info: open 9am-11pm, call 98xxxx" } }
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listFacebookPages, facebookPost } from "./platforms.js";
import { aiEnabled, writePost, chooseBestMedia } from "./ai.js";
import { photoCandidates, videoCandidates } from "./pexels.js";
import { todayIST } from "./pick.js";

const env = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadOverrides() {
  const f = fileURLToPath(new URL("../pages.json", import.meta.url));
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.warn(`pages.json padh nahi paaya: ${e.message}`); return {}; }
}

function pagePrompt(page, extra = "") {
  return `You are the social media manager for the Facebook Page "${page.name}".
Page category: ${page.category || "unknown"}
About the page: ${[page.about, page.description].filter(Boolean).join(" ").slice(0, 600) || "(not provided — infer from the name and category)"}
${extra ? `Extra instructions from the owner: ${extra}\n` : ""}
Audience: people who follow a "${page.category || "general"}" page like this one.
Write content that genuinely fits THIS page's niche and category (not generic AI/tech content unless the page is about that).
Tone: friendly, engaging, trustworthy. Vary the hook and structure every time.
Only mention contact details, prices or offers if they were given above — never invent phone numbers, addresses or discounts.
End with a natural call to action (follow, comment, message the page, visit, etc.).`;
}

// Har din har page ka alag topic (pages.json topics ho to unme rotation, warna AI khud chunta hai)
function topicFor(page, cfg, mainTopic) {
  const day = Math.floor(Date.parse(todayIST()) / 86400000);
  if (cfg.topics?.length) return cfg.topics[day % cfg.topics.length];
  const weekday = new Date().toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
  return `a fresh ${weekday} post for a ${page.category || "general"} page (date ${todayIST()}); pick a useful, seasonal or engaging angle — tips, facts, questions, behind-the-scenes, offers — different from usual`;
}

async function buildPagePost(page, cfg, kind) {
  const post = await writePost(topicFor(page, cfg), kind, pagePrompt(page, cfg.prompt));
  if (env.PEXELS_API_KEY) {
    const find = kind === "video" ? videoCandidates : photoCandidates;
    let options = await find(post.mediaQuery || page.category || page.name);
    if (!options.length && kind === "video") { kind = "photo"; options = await photoCandidates(post.mediaQuery || page.category); }
    if (options.length) {
      const best = await chooseBestMedia(post, options, kind);
      const { preview, alt, ...chosen } = options[best];
      Object.assign(post, chosen);
    }
  }
  return post;
}

// mainPost = aaj ki brand post (FB_PAGE_ID wale page par wahi jaati hai)
export async function postAllPages(mainPost, { dry = false } = {}) {
  if (!aiEnabled()) throw new Error("Saare pages ke liye AI key chahiye");
  const overrides = loadOverrides();
  const skip = (env.FB_SKIP_PAGES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const pages = await listFacebookPages();
  const kind = mainPost.video ? "video" : "photo";
  const report = {};

  for (const page of pages) {
    const cfg = overrides[page.id] || overrides[page.name] || {};
    const label = `facebook: ${page.name} (${page.category || "?"})`;
    if (cfg.skip || skip.includes(page.id) || skip.includes(page.name)) { report[label] = "⏭️ skipped"; continue; }
    try {
      const post = page.id === env.FB_PAGE_ID && !cfg.prompt && !cfg.topics ? mainPost : await buildPagePost(page, cfg, kind);
      if (dry) { report[label] = { headline: post.headline, media: post.image || post.video, text: post.text }; continue; }
      await facebookPost(post, page.id, page.access_token);
      report[label] = "✅ posted";
    } catch (e) {
      report[label] = `❌ ${e.message.slice(0, 300)}`;
    }
    await sleep(2000);
  }
  if (!pages.length) report.facebook = "❌ FB_USER_TOKEN se koi page nahi mila (pages_show_list permission check karo)";
  return report;
}
