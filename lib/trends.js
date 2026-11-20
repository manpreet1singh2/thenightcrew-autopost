// Roz ka VIRAL topic: free RSS (Google Trends + Google News) se trending cheezein → AI brand ke niche se juda best topic chunta hai.
// Koi API key nahi chahiye. Fail ho to posts.json wala topic hi chalega.
// Env: TOPIC_MODE=viral (default) | list      TREND_GEO=IN      TREND_QUERY="AI automation OR AI agents"
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const env = process.env;
const PROMPT = readFileSync(fileURLToPath(new URL("../prompt.txt", import.meta.url)), "utf8");

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

async function rss(url, limit = 15) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 AutoPost" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => decode(m[1])).slice(0, limit);
}

export async function trendingItems() {
  const geo = env.TREND_GEO || "IN";
  const q = encodeURIComponent(env.TREND_QUERY || "AI automation OR AI agents OR chatbot business");
  const sources = {
    "Google Trends (aaj)": `https://trends.google.com/trending/rss?geo=${geo}`,
    "AI news (aaj)": `https://news.google.com/rss/search?q=${q}+when:1d&hl=en-${geo}&gl=${geo}&ceid=${geo}:en`,
  };
  const out = {};
  await Promise.all(Object.entries(sources).map(async ([name, url]) => {
    try { out[name] = await rss(url); } catch (e) { console.warn(`Trends ${name} fail: ${e.message}`); }
  }));
  return out;
}

// chat = lib/ai.js ka chat function (circular import se bachne ke liye pass karte hain)
export async function viralTopic(chat, fallback) {
  if ((env.TOPIC_MODE || "viral") !== "viral") return { topic: fallback };
  const items = await trendingItems();
  let lines = Object.entries(items).flatMap(([src, list]) => list.map((t) => `- [${src}] ${t}`));
  if (!lines.length) return { topic: fallback };
  // Har ghante alag trend: list ko ghante ke hisaab se ghumao aur pehle 6 me se hi chunne do
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  const k = (h * 5) % lines.length;
  lines = [...lines.slice(k), ...lines.slice(0, k)].slice(0, Math.min(6, lines.length));

  const raw = await chat(`${PROMPT}

Here is what is trending TODAY (headlines only):
${lines.join("\n")}

Pick the ONE trending item that this brand can most credibly and naturally connect to its audience (AI automation for businesses). Prefer AI/tech/business news; a general trend is OK only if there is a genuine, non-insensitive angle. Never pick tragedies, deaths, disasters, crime, elections or communal topics.
Reply JSON only: {"trend": "<the headline you picked>", "topic": "<a post topic for the brand that rides this trend, under 120 chars>"}
If nothing fits, reply {"trend": "", "topic": "${fallback.replace(/"/g, "'")}"}`);
  try {
    const p = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (p.topic) {
      console.log(`🔥 Viral: "${p.trend}" → ${p.topic}`);
      return { topic: `${p.topic}${p.trend ? ` (trending today: "${p.trend}" — use it only as the hook, do not invent facts or numbers about it)` : ""}`, trend: p.trend };
    }
  } catch (e) { console.warn(`Viral topic parse fail: ${e.message}`); }
  return { topic: fallback };
}

// Purane callers ke liye (run.js, local/daily-video.mjs): → { trend, topic } ya null
export async function trendingTopic(fallback = "AI automation for businesses") {
  if (!env.OPENROUTER_API_KEY && !env.COHERE_API_KEY) return null;
  try {
    const { chat } = await import("./ai.js");
    const v = await viralTopic(chat, fallback);
    return v.trend ? v : null;
  } catch (e) {
    console.warn(`Trend fetch fail (${e.message}) → normal topic`);
    return null;
  }
}

// Ek din ke liye N alag viral topics (har long video ka apna). Kam milen to fallbacks se bharo.
export async function trendingTopics(n = 5, fallbacks = []) {
  const out = [];
  try {
    if (env.OPENROUTER_API_KEY || env.COHERE_API_KEY) {
      const { chat } = await import("./ai.js");
      const items = await trendingItems();
      const lines = Object.entries(items).flatMap(([src, list]) => list.map((t) => `- [${src}] ${t}`));
      if (lines.length) {
        const raw = await chat(`${PROMPT}

Trending TODAY (headlines only):
${lines.join("\n")}

Pick up to ${n} DIFFERENT trending items this brand can credibly connect to its audience (AI automation for businesses). Prefer AI/tech/business; a general trend only with a genuine, non-insensitive angle. Never pick tragedies, deaths, disasters, crime, elections, politics or religious/communal topics.
Reply JSON only: {"picks": [{"trend": "<headline>", "topic": "<post/video topic for the brand riding this trend, under 120 chars>"}]}`);
        const p = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
        for (const x of p.picks || []) if (x?.topic && out.length < n) out.push({
          trend: x.trend || "",
          topic: `${x.topic}${x.trend ? ` (trending today: "${x.trend}" — use it only as the hook, do not invent facts or numbers about it)` : ""}`,
        });
      }
    }
  } catch (e) { console.warn(`Trends fail (${e.message}) → posts.json topics`); }
  for (let i = 0; out.length < n && fallbacks.length; i++) out.push({ trend: "", topic: fallbacks[i % fallbacks.length] });
  return out;
}
