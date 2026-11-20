// YouTube channel ko repo se jodo (Mac/Terminal ki zarurat nahi).
// 1) GitHub → Actions → youtube-connect → Run workflow (khali) → job summary me "Allow link" milega.
// 2) Link kholo → channel chuno → Allow. Browser "127.0.0.1 refused to connect" dikhayega — wo normal hai.
// 3) Address bar ka poora URL copy karo → youtube-connect dobara Run karo, "redirect_url" me paste karo.
// Refresh token encrypted form me automation-state/yt-tokens.json me save hota hai; log me kabhi nahi chhapta.
import { appendFileSync } from "node:fs";
import { saveChannel, storedChannels } from "../lib/ytstore.js";

const env = process.env;
const REDIRECT = "http://127.0.0.1:8085/callback";
const summary = (s) => { console.log(s); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s + "\n"); };

if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) {
  summary("❌ GitHub secrets me YT_CLIENT_ID aur YT_CLIENT_SECRET chahiye.");
  process.exit(1);
}

const input = (env.REDIRECT_URL || "").trim();
if (!input) {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: env.YT_CLIENT_ID, redirect_uri: REDIRECT, response_type: "code",
    access_type: "offline", prompt: "consent select_account",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  });
  summary(`## YouTube channel jodo\n\n1. Ye link kholo: [Allow link](${url})\n2. Channel chuno → (Advanced → Go to …) → **Allow**\n3. "127.0.0.1 refused to connect" aayega — address bar ka poora URL copy karo\n4. youtube-connect workflow dobara Run karo, **redirect_url** me wo URL paste karo (10 min ke andar)\n`);
  const list = storedChannels();
  summary(`\nAbhi jude channels (repo se): ${list.length ? list.map((c) => c.name).join(", ") : "koi nahi"}`);
  process.exit(0);
}

let code = input;
try { code = new URL(input).searchParams.get("code") || ""; } catch { /* seedha code diya */ }
if (!code) { summary("❌ URL me code nahi mila. Allow ke baad wala poora URL paste karo."); process.exit(1); }
console.log(`::add-mask::${code}`);

const t = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({ code, client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
})).json();
if (!t.refresh_token) {
  summary(`❌ Token nahi mila: ${t.error_description || t.error || "unknown"}. Code 10 min me expire hota hai aur ek hi baar chalta hai — naya Allow link se dobara karo.`);
  process.exit(1);
}
console.log(`::add-mask::${t.refresh_token}`);
console.log(`::add-mask::${t.access_token}`);

const ch = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
  headers: { Authorization: `Bearer ${t.access_token}` },
})).json();
const c = ch.items?.[0];
if (!c) { summary(`❌ Is Google account me YouTube channel nahi mila. ${ch.error?.message || ""}`); process.exit(1); }

const n = saveChannel({ id: c.id, name: c.snippet.title, refresh: t.refresh_token });
summary(`✅ **${c.snippet.title}** jud gaya. Repo se jude channels: ${n}. Doosra channel? Workflow khali Run karke naya Allow link lo.`);
