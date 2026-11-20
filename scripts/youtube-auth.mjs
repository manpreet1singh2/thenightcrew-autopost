// Har YouTube channel ka refresh token lo (ek baar, apne Mac par chalao):
//   node --env-file=.env scripts/youtube-auth.mjs
// .env me pehle se YT_CLIENT_ID aur YT_CLIENT_SECRET hone chahiye.
// Google Console me OAuth client "Desktop app" type ka ho, ya "Web" ho to Authorized redirect URI me ye daalo:
//   http://127.0.0.1:8085/callback
// Browser khulega → account/channel chuno → Allow. Har channel ke liye dobara chalao (Brand account wale channel bhi).
// Mila hua token apne aap .env ki YT_REFRESH_TOKENS line me jud jaata hai.
import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const env = process.env;
const PORT = 8085;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) {
  console.error("❌ .env me YT_CLIENT_ID aur YT_CLIENT_SECRET daalo, phir: node --env-file=.env scripts/youtube-auth.mjs");
  process.exit(1);
}

const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: env.YT_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  access_type: "offline",
  prompt: "consent select_account",
  scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== "/callback") return res.end();
  const code = u.searchParams.get("code");
  if (!code) { res.end("Allow nahi hua: " + (u.searchParams.get("error") || "")); return finish(1); }
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ code, client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    })).json();
    if (!t.refresh_token) throw new Error(t.error_description || t.error || "refresh_token nahi mila (prompt=consent ke saath dobara try karo)");
    const ch = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    const name = ch.items?.[0]?.snippet?.title || "(channel nahi mila)";

    // .env ki YT_REFRESH_TOKENS line me jodo
    const f = ".env";
    let s = existsSync(f) ? readFileSync(f, "utf8") : "";
    const line = s.match(/^YT_REFRESH_TOKENS=(.*)$/m);
    const list = line ? line[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
    if (!list.includes(t.refresh_token)) list.push(t.refresh_token);
    const next = `YT_REFRESH_TOKENS=${list.join(",")}`;
    s = line ? s.replace(/^YT_REFRESH_TOKENS=.*$/m, next) : `${s.replace(/\s*$/, "")}\n${next}\n`;
    writeFileSync(f, s);

    res.end(`✅ "${name}" jud gaya. Ab ye tab band kar do. Doosra channel? Script dobara chalao.`);
    console.log(`✅ Channel "${name}" jud gaya. .env me ab ${list.length} channel(s) hain.`);
    console.log("   GitHub par bhi chahiye to YT_REFRESH_TOKENS ki poori line ki value secret me daalo.");
    finish(0);
  } catch (e) {
    res.end("❌ " + e.message);
    console.error("❌", e.message);
    finish(1);
  }
});

function finish(code) { setTimeout(() => { server.close(); process.exit(code); }, 500); }

server.listen(PORT, "127.0.0.1", () => {
  console.log("Browser me ye link khul raha hai (na khule to copy karke kholo):\n" + url);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [url], () => {});
});
