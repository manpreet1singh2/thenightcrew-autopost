// Secrets paste karte waqt aksar extra cheez aa jaati hai: spaces/new line, quotes, ya "YT_CLIENT_ID=" prefix.
// Ye sab hata do, aur saaf batao ki value sahi format me hai ya nahi (value kabhi print nahi hoti).
const env = process.env;
const KEYS = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKENS", "FB_USER_TOKEN", "OPENROUTER_API_KEY", "PEXELS_API_KEY", "YT_API_KEY"];
for (const k of KEYS) {
  const raw = env[k];
  if (!raw) continue;
  let v = raw.trim().replace(new RegExp(`^${k}\\s*=\\s*`), "").replace(/^["']|["']$/g, "").trim();
  if (k === "YT_REFRESH_TOKENS") v = v.split(/[\s,]+/).filter(Boolean).join(",");
  else v = v.replace(/\s+/g, "");
  if (v !== raw) console.log(`ℹ️ ${k}: extra spaces/quotes/prefix hata diye`);
  env[k] = v;
}
export const checks = {
  YT_CLIENT_ID: !env.YT_CLIENT_ID || /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env.YT_CLIENT_ID),
  YT_CLIENT_SECRET: !env.YT_CLIENT_SECRET || /^GOCSPX-[\w-]+$/.test(env.YT_CLIENT_SECRET),
};
for (const [k, ok] of Object.entries(checks)) if (!ok) console.log(`⚠️ ${k} ka format galat lag raha hai (length ${env[k].length}). GitHub secret dobara paste karo.`);
