import { readFileSync, statSync, rmSync } from "node:fs";
// Generates original AI/automation articles and attaches Pexels media.
// Images are the default; one video in every five days is used as a controlled format test.
import { chat, chooseBestMedia } from "./ai.js";
import { photoCandidates, videoCandidates } from "./pexels.js";
import { download } from "./sources.js";

const env = process.env;
const VERSION = env.LINKEDIN_VERSION || "202609";
const ORG_ID = env.LINKEDIN_ORG_ID || "105949608";
const BASE = "https://api.linkedin.com/rest";
const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
  "Content-Type": "application/json",
});
const parse = async (r, label) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${label} ${r.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
};
const jsonFrom = (raw) => {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI response did not contain JSON");
  return JSON.parse(m[0]);
};

async function createArticle(topic) {
  const prompt = `You are a senior AI engineer and technical thought-leadership editor.
Create a genuinely useful LinkedIn long-form feed post about AI engineering, AI agents, LLMs, generative AI, intelligent automation, RAG, workflow orchestration, evaluation, reliability, security, or practical AI adoption.
Author positioning: "AI Engineer | AI Automation Specialist | Building Intelligent Systems".
Write in confident first person, professional natural English. Sound technically informed, not boastful.
Never invent the author's employer, clients, qualifications, years of experience, shipped projects, revenue, metrics, awards, or personal case studies. Use general technical analysis and clearly framed opinions instead.
Avoid generic hype. Explain a real mechanism, trade-off, architecture choice, implementation pattern, or practical lesson. Use a strong opening, readable short paragraphs, concrete examples, and a thoughtful ending question.
No claim that AI replaces every job. No fake statistics or unsupported breaking-news claims.
Create two distinct versions on the SAME topic:
- personal: first-person professional thought leadership, no company-owner/founder claims.
- company: brand-neutral company-page perspective, useful and informative, no fake customer claims.
Topic: ${topic}
Return JSON only:
{"topic":"...","headline":"...","personal":"900-1800 characters, ready to post","company":"700-1500 characters, adapted and not copied verbatim","visual_query":"2-4 concrete English words for Pexels search","hashtags":["3-5 short relevant hashtags without #"]}`;
  const p = jsonFrom(await chat(prompt, { maxTokens: 3200 }));
  const tags = (p.hashtags || []).slice(0, 5).map((x) => "#" + String(x).replace(/^#/, "").replace(/\s+/g, ""));
  const clean = (s) => String(s || "").replace(/\*\*/g, "").trim();
  return {
    headline: clean(p.headline || p.topic || topic),
    personal: [clean(p.personal), tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2900),
    company: [clean(p.company), tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2900),
    visualQuery: clean(p.visual_query || "AI technology engineer").slice(0, 80),
  };
}

async function chooseMedia(query, dayNumber) {
  // 80% image / 20% video: image-first LinkedIn strategy with a recurring video test.
  const kind = dayNumber % 5 === 0 ? "video" : "photo";
  let candidates = kind === "video"
    ? await videoCandidates(query).catch(() => [])
    : await photoCandidates(query).catch(() => []);
  if (!candidates.length) {
    candidates = kind === "video"
      ? await photoCandidates(query).catch(() => [])
      : await videoCandidates(query).catch(() => []);
  }
  if (!candidates.length) return null;
  const best = await chooseBestMedia({ headline: query, text: query }, candidates, kind).catch(() => 0);
  const chosen = candidates[Math.max(0, Math.min(candidates.length - 1, Number(best) || 0))];
  return { kind: chosen.video ? "video" : "image", ...chosen, sourceId: `pexels-linkedin-${kind}-${dayNumber}` };
}

async function uploadImage(token, owner, media) {
  const image = await fetch(media.image);
  if (!image.ok) throw new Error(`Pexels image download ${image.status}`);
  const bytes = Buffer.from(await image.arrayBuffer());
  const init = await parse(await fetch(`${BASE}/images?action=initializeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  }), "LinkedIn image initialize");
  const value = init.value || init;
  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": image.headers.get("content-type") || "image/jpeg" },
    body: bytes,
  });
  if (!put.ok) throw new Error(`LinkedIn image upload ${put.status}`);
  return value.image;
}

async function uploadVideo(token, owner, media) {
  const local = await download({
    sourceId: media.sourceId,
    url: media.video,
    kind: "stock",
  });
  const size = statSync(local.file).size;
  const init = await parse(await fetch(`${BASE}/videos?action=initializeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: {
      owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false,
    } }),
  }), "LinkedIn video initialize");
  const value = init.value || init;
  const bytes = readFileSync(local.file);
  rmSync(local.file, { force: true });
  const etags = [];
  for (const part of value.uploadInstructions || []) {
    const chunk = bytes.subarray(Number(part.firstByte), Number(part.lastByte) + 1);
    const put = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(chunk.length) },
      body: chunk,
    });
    if (!put.ok) throw new Error(`LinkedIn video part upload ${put.status}`);
    const etag = put.headers.get("etag");
    if (!etag) throw new Error("LinkedIn video upload did not return an ETag");
    etags.push(etag.replace(/^"|"$/g, ""));
  }
  await parse(await fetch(`${BASE}/videos?action=finalizeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: {
      video: value.video, uploadToken: value.uploadToken || "", uploadedPartIds: etags,
    } }),
  }), "LinkedIn video finalize");
  // Wait until LinkedIn has processed the uploaded asset before creating the post.
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await parse(await fetch(`${BASE}/videos/${encodeURIComponent(value.video)}`, {
      headers: headers(token),
    }), "LinkedIn video status");
    if (status.status === "AVAILABLE") break;
    if (status.status === "PROCESSING_FAILED") throw new Error("LinkedIn video processing failed");
    if (attempt === 59) throw new Error("LinkedIn video processing timed out");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return value.video;
}

async function publishPost(token, author, commentary, media) {
  const content = media
    ? { content: { media: { id: media.urn, ...(media.kind === "image" ? { altText: media.alt || "AI and intelligent automation" } : { title: "AI and intelligent automation" }) } } }
    : {};
  const body = {
    author, commentary, visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...content,
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const response = await fetch(`${BASE}/posts`, {
    method: "POST", headers: headers(token), body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`LinkedIn post ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.headers.get("x-restli-id") || "";
}

async function publishForAuthor(token, author, text, media) {
  let uploaded = null;
  if (media) {
    uploaded = media.kind === "image"
      ? await uploadImage(token, author, media)
      : await uploadVideo(token, author, media);
  }
  return publishPost(token, author, text, uploaded ? { ...media, urn: uploaded } : null);
}

export async function publishLinkedInBrandPosts({ today, dayNumber, state, dryRun = false, log = console.log }) {
  const token = env.LINKEDIN_TOKEN;
  if (!token) { log("LinkedIn skipped: LINKEDIN_TOKEN secret is missing"); return; }
  if (!env.PEXELS_API_KEY) { log("LinkedIn skipped: PEXELS_API_KEY secret is missing"); return; }
  if (!env.OPENROUTER_API_KEY && !env.COHERE_API_KEY) { log("LinkedIn skipped: AI provider key is missing"); return; }

  const previous = state.linkedinBrand?.date === today ? state.linkedinBrand : {};
  if (previous.companyId) { log("LinkedIn posts already completed today"); return; }
  const [hour, minute] = (env.LINKEDIN_DAILY_TIME || "10:00").split(":").map(Number);
  const IST = 330 * 60_000;
  const dueAt = Date.parse(today + "T00:00:00Z") - IST + (hour * 60 + minute) * 60_000;
  if (Date.now() < dueAt) { log("LinkedIn scheduled time has not arrived"); return; }

  const topics = [
    "AI agents: when to use an agent and when a deterministic workflow is safer",
    "RAG systems: retrieval quality, chunking, evaluation and grounded answers",
    "Practical AI automation: connecting tools, APIs and human approval steps",
    "LLM evaluation: measuring accuracy, latency, cost and reliability",
    "AI engineering: designing secure and observable production workflows",
    "Generative AI: moving from impressive demos to dependable products",
    "Voice AI and conversational automation: latency, handoff and user experience",
  ];
  const topic = topics[(Math.floor(new Date(today + "T00:00:00Z").getTime() / 86400000)) % topics.length];
  const article = await createArticle(topic);
  const media = await chooseMedia(article.visualQuery, dayNumber);

  if (dryRun) {
    log(`DRY RUN LinkedIn topic: ${article.headline}`);
    log(`Personal draft:\n${article.personal}`);
    log(`Company draft:\n${article.company}`);
    log(`Media: ${media?.kind || "text-only"} — ${media?.alt || article.visualQuery}`);
    return;
  }

  const who = await parse(await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  }), "LinkedIn profile lookup");
  if (!who.sub) throw new Error("LinkedIn userinfo response did not include member id");

  const personAuthor = `urn:li:person:${who.sub}`;
  const orgAuthor = `urn:li:organization:${ORG_ID}`;
  let personalId = previous.personalId || "";
  if (!personalId) {
    personalId = await publishForAuthor(token, personAuthor, article.personal, media);
    state.linkedinBrand = { date: today, topic: article.headline, mediaKind: media?.kind || "none", personalId, companyId: "", publishedAt: Date.now() };
    log(`Published LinkedIn personal post: ${personalId}`);
  }
  // Upload separately for organization ownership; LinkedIn media assets are author-scoped.
  const companyId = await publishForAuthor(token, orgAuthor, article.company, media);
  log(`Published LinkedIn company-page post: ${companyId}`);
  state.linkedinBrand = { date: today, topic: article.headline, mediaKind: media?.kind || "none", personalId, companyId, publishedAt: Date.now() };
}
