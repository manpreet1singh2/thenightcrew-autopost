// AI: (1) heading + paragraphs wala poora post likhta hai, (2) Pexels query banata hai,
// (3) Pexels ki kai photos DEKH kar sabse relevant photo chunta hai.
// OpenRouter (default Claude Opus 5.5) ya Cohere — jo key set ho.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const env = process.env;
const PROMPT = readFileSync(fileURLToPath(new URL("../prompt.txt", import.meta.url)), "utf8");

const DEFAULT_MODEL = "anthropic/claude-opus-5.5";
const FALLBACK_MODEL = "openrouter/auto";

export const aiEnabled = () => Boolean(env.OPENROUTER_API_KEY || env.COHERE_API_KEY);
const canSee = () => Boolean(env.OPENROUTER_API_KEY); // photo dekhne ke liye vision model (OpenRouter)

async function openrouter(model, content, maxTokens = 1500) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "TheNightCrew AutoPost",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`OpenRouter (${model}) ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices[0].message.content;
}

export async function chat(content, options = {}) {
  if (env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
    try { return await openrouter(model, content, options.maxTokens || 1500); }
    catch (e) {
      if (model === FALLBACK_MODEL) throw e;
      console.warn(`${e.message} → fallback ${FALLBACK_MODEL}`);
      return openrouter(FALLBACK_MODEL, content, options.maxTokens || 1500);
    }
  }
  const text = typeof content === "string" ? content : content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const r = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.COHERE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.COHERE_MODEL || "command-a-03-2025", messages: [{ role: "user", content: text }], max_tokens: options.maxTokens || 1500 }),
  });
  if (!r.ok) throw new Error(`Cohere ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).message.content.map((c) => c.text).join("");
}

// Model ke jawab me se JSON nikaalo (```json ... ``` ho ya na ho)
function parseJSON(s) {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI ne JSON nahi diya");
  return JSON.parse(m[0]);
}

const strip = (s = "") => s.replace(/\*\*?/g, "").replace(/^#+\s*/gm, "").replace(/\\/g, "").trim();

// Heading ko bold unicode me (LinkedIn/Facebook/Instagram par bold dikhta hai). BOLD_HEADLINE=0 se band.
function bold(s) {
  if (env.BOLD_HEADLINE === "0") return s;
  return [...s].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
    return ch;
  }).join("");
}

export async function writePost(topic = "", kind = "photo", prompt = PROMPT) {
  const raw = await chat(`${prompt}

Today's topic: ${topic || "pick a fresh, useful topic that fits this page"}

Write ONE high-quality social media post. Reply with JSON only, in this exact shape:
{
  "headline": "scroll-stopping hook, max 90 characters, 1 emoji allowed",
  "paragraphs": ["2-3 short paragraphs, each 1-3 sentences, concrete and benefit-led"],
  "bullets": ["3-5 crisp benefit/feature points, each under 60 characters"],
  "cta": "one strong call-to-action line including the contact number and website",
  "hashtags": ["6-8 relevant hashtags without #"],
  "instagram": "separate short Instagram caption under 350 characters (hook + 1-2 lines + CTA), no hashtags",
  "media_query": "2-4 word Pexels ${kind} search query that visually matches THIS post (concrete: people, devices, office, phone call, etc.)"
}
Rules: no markdown, no asterisks, total post under 1300 characters, don't repeat generic phrases like "in today's fast-paced world".`);

  const p = parseJSON(raw);
  const tags = (p.hashtags || []).map((h) => "#" + String(h).replace(/^#/, "").replace(/\s+/g, "")).join(" ");
  const headline = strip(p.headline);
  const text = [
    bold(headline),
    ...(p.paragraphs || []).map(strip),
    (p.bullets || []).map((b) => `✅ ${strip(b)}`).join("\n"),
    `👉 ${strip(p.cta)}`,
    tags,
  ].filter(Boolean).join("\n\n");
  const short = [bold(headline), strip(p.instagram), tags].filter(Boolean).join("\n\n");

  return {
    headline,
    text: text.slice(0, 2900),
    short: short.slice(0, 2200),
    mediaQuery: strip(p.media_query).replace(/["'.]/g, "").slice(0, 60) || topic,
  };
}

// candidates: [{ preview, alt }]  →  sabse best ka index
export async function chooseBestMedia(post, candidates, kind = "photo") {
  if (candidates.length <= 1) return 0;
  const list = candidates.map((c, i) => `${i}: ${c.alt || "(no description)"}`).join("\n");
  const ask = `You are choosing the ${kind} for this social media post.

POST HEADLINE: ${post.headline}
POST: ${post.text.slice(0, 600)}

Pick the single ${kind} that best matches the post's message, looks professional and modern, has no visible text/watermark/logos, and would make a business owner stop scrolling.
Candidates are numbered 0-${candidates.length - 1}${canSee() ? " in the order of the images attached" : ""}:
${list}

Reply with JSON only: {"best": <number>, "reason": "<short>"}`;

  const content = canSee()
    ? [{ type: "text", text: ask }, ...candidates.map((c) => ({ type: "image_url", image_url: { url: c.preview } }))]
    : ask;

  try {
    const { best, reason } = parseJSON(await chat(content));
    const i = Number(best);
    if (Number.isInteger(i) && i >= 0 && i < candidates.length) {
      console.log(`AI ne ${kind} #${i} chuna: ${reason}`);
      return i;
    }
  } catch (e) {
    console.warn(`Photo selection fail (${e.message}) → pehla result`);
  }
  return 0;
}
