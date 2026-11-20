// GitHub Actions (ya apne computer) se seedha chalao — Vercel ki zaroorat nahi.
//   node scripts/autopost.mjs          → asli post
//   node scripts/autopost.mjs --dry    → sirf preview (post nahi hogi)
// Local par: node --env-file=.env scripts/autopost.mjs --dry
import { runAutopost } from "../lib/run.js";

const dry = process.argv.includes("--dry") || process.env.DRY_RUN === "1";
const { status, body } = await runAutopost({ dry });

console.log(JSON.stringify(body, null, 2));
if (body.report) for (const [name, r] of Object.entries(body.report)) console.log(`${name}: ${r}`);

// Summary GitHub Actions run page par dikhe
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const lines = [
    `## ${dry ? "🧪 Dry run" : "📣 AutoPost"}`,
    body.headline || body.post?.headline ? `**${body.headline || body.post.headline}**` : "",
    body.media || body.post?.image || body.post?.video ? `Media: ${body.media || body.post.image || body.post.video}` : "",
    body.error ? `❌ ${body.error}` : "",
    ...Object.entries(body.report || {}).map(([n, r]) => `- ${n}: ${r}`),
    ...Object.entries(body.facebookPages || {}).map(([n, r]) =>
      typeof r === "string" ? `- ${n}: ${r}` : `### ${n}\n**${r.headline}**\n${r.media || ""}\n\n\`\`\`\n${r.text}\n\`\`\``),
    dry && body.post?.text ? "\n```\n" + body.post.text + "\n```" : "",
  ].filter(Boolean);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

process.exit(status >= 500 ? 1 : 0);
