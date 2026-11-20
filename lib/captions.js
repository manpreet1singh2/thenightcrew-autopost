// Platform ke hisaab se alag AI caption / title / description / hashtags / keywords / CTA.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chat } from "./ai.js";
import { CONFIG } from "./accounts.js";

const PROMPT = readFileSync(fileURLToPath(new URL("../prompt.txt", import.meta.url)), "utf8");
const STYLE = {
  facebook: "Facebook Page video post: hook line, 2 short paragraphs, 3 emoji bullet points, CTA, 5-7 hashtags. Max 1200 characters.",
  instagram: "Instagram Reel caption: punchy hook, 1-2 short lines, CTA, then 10-15 hashtags on a new line. Max 900 characters.",
  youtube: "YouTube Shorts: title under 90 characters ending with #Shorts, description of 2-4 sentences + CTA + 5 hashtags, 10 keyword tags.",
};

export async function captionFor(platform, item, account) {
  const credit = item.kind === "approved" && item.owner ? `Credit/owner: ${item.owner}. License: ${item.license}.` : item.kind === "stock" ? "Visuals are licensed stock footage." : "";
  const raw = await chat(`${CONFIG.captionPrompt || PROMPT}

You are writing for the ${platform} account "${account.name}".
Video topic / today's headline: ${item.topic || item.title || "AI automation for businesses"}
${item.title ? `Video title from source: ${item.title}` : ""}
${credit}
Format: ${STYLE[platform]}
Rules: natural and engaging, unique wording (don't reuse generic phrases), no markdown asterisks.
Never claim or imply that this account is MrBeast, Rockstar Games, works with them, or is officially affiliated with any creator, studio or brand mentioned in the topic. The visuals are generic stock footage, not official footage — don't say "watch the trailer" or describe scenes from it. Don't invent facts, numbers or quotes.
Reply JSON only: {"title": "...", "caption": "...", "description": "...", "hashtags": ["..."], "keywords": ["..."], "cta": "..."}`);
  const p = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  const tags = (p.hashtags || []).map((h) => "#" + String(h).replace(/^#/, "").replace(/\s+/g, ""));
  const clean = (s = "") => String(s).replace(/\*\*/g, "").trim();
  const title = clean(p.title).slice(0, platform === "youtube" ? 100 : 250) || clean(p.caption).slice(0, 80);
  const caption = [clean(p.caption), clean(p.cta), platform === "youtube" ? "" : tags.join(" ")].filter(Boolean).join("\n\n");
  const description = [clean(p.description || p.caption), clean(p.cta), tags.join(" "), credit].filter(Boolean).join("\n\n");
  return { title, caption, description, hashtags: tags, keywords: (p.keywords || []).map(String).slice(0, 15) };
}
