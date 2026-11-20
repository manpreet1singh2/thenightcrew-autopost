// STATUS.md dashboard (automation-state branch me har run par update hota hai)
const fmt = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const icon = { published: "✅", processing: "⏳", pending: "🕒", failed: "❌", skipped: "⏭️", retry: "🔁" };

export function renderDashboard(state, today, now = Date.now()) {
  const day = state.days[today] || { slots: [], quota: {} };
  const count = (s) => day.slots.filter((x) => x.status === s).length;
  const accounts = state.accounts?.list || [];
  const lines = [
    `# 📊 TheNightCrew Publishing Dashboard`,
    `_Last update: ${fmt(now)} IST · auto-refresh har ghante_`,
    ``,
    `## Aaj (${today}) — target ${state.target}`,
    `| ✅ Published | ⏳ Processing | 🕒 Pending | 🔁 Retry | ❌ Failed | ⏭️ Skipped |`,
    `|---|---|---|---|---|---|`,
    `| ${count("published")} | ${count("processing")} | ${count("pending")} | ${count("retry")} | ${count("failed")} | ${count("skipped")} |`,
    ``,
    `## Connected accounts`,
    `| Platform | Account | Eligible | Followers / Subs | Aaj published |`,
    `|---|---|---|---|---|`,
    ...accounts.map((a) => `| ${a.platform} | ${a.name}${a.page ? ` (Page: ${a.page})` : ""} | ${a.eligible ? "✅" : `❌ ${a.reason}`} | ${a.stats?.followers ?? a.stats?.subscribers ?? "–"}${a.platform === "youtube" ? ` · ${a.stats?.views ?? 0} views · ${a.stats?.videos ?? 0} videos` : ""} | ${day.slots.filter((s) => s.channel === a.key && s.status === "published").length} |`),
    ``,
    `## Schedule (aaj)`,
    `| # | Time (IST) | Channel | Status | Content | Link / Error |`,
    `|---|---|---|---|---|---|`,
    ...day.slots.map((s) => `| ${s.i + 1} | ${fmt(s.at).split(", ").pop()} | ${s.channelName || s.channel} | ${icon[s.status] || ""} ${s.status}${s.attempts ? ` (${s.attempts})` : ""} | ${s.sourceId || "–"} | ${s.permalink || (s.error ? "`" + s.error.slice(0, 120).replace(/\|/g, "/") + "`" : "")} |`),
    ``,
    `## Quota (aaj)`,
    `- YouTube: ${day.quota.youtubeUnits || 0} / 10,000 units (upload ≈ 1,600)`,
    ...Object.entries(day.quota.instagram || {}).map(([k, v]) => `- Instagram ${k}: ${v.used ?? "?"} / ${v.limit ?? 50} posts (24h)`),
    ``,
    `## 🔎 Discovered (needs approval — kabhi auto-publish nahi)`,
    `Inpe apni reaction/commentary video banao, phir \`content/approved.json\` me license ke saath daalo.`,
    ...((state.discovered || []).slice(-15).reverse().map((d) => `- [${d.title.replace(/[[\]]/g, "")}](${d.url}) — ${d.channel}, ${d.publishedAt.slice(0, 10)}`)),
    ``,
    `## API errors (latest)`,
    ...((state.errors || []).slice(-10).reverse().map((e) => `- ${fmt(e.at)}: ${e.msg.slice(0, 200)}`)),
  ];
  return lines.join("\n") + "\n";
}
