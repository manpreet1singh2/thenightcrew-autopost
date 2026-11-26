// Validates the files written by search.mjs. Exits non-zero if any is missing or malformed.
import { readFile } from "node:fs/promises";
import { OUT_DIR, STATE_FILE } from "./config.mjs";
import { validateState } from "./state.mjs";

const problems = [];
async function json(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (e) { problems.push(`${path}: ${e.message}`); return null; }
}
const report = await json(`${OUT_DIR}/report.json`);
const latest = await json(`${OUT_DIR}/latest.json`);
const state = await json(STATE_FILE);
await json(`${OUT_DIR}/notifications.json`);
try { if (!(await readFile(`${OUT_DIR}/REPORT.md`, "utf8")).startsWith("# Mohali Room Finder")) problems.push("REPORT.md has unexpected content"); } catch (e) { problems.push(`REPORT.md: ${e.message}`); }

if (report) {
  for (const k of ["checkedAt", "search", "totals", "sources", "listings", "newListings", "priceChanges", "byLocality"]) if (!(k in report)) problems.push(`report.json missing "${k}"`);
  for (const s of report.sources || []) if (!["ok", "partial", "failed", "blocked", "skipped", "disabled"].includes(s.status)) problems.push(`bad source status ${s.status}`);
  for (const l of report.listings || []) {
    if (!l.url || !l.source) problems.push(`listing without url/source: ${l.title}`);
    if (l.monthlyRentINR !== null && (l.monthlyRentINR < 1 || l.monthlyRentINR > report.search.maxMonthlyRentINR)) problems.push(`listing over budget in results: ${l.url}`);
    if (l.distanceKm !== null && l.distanceKm > report.search.intendedRadiusKm) problems.push(`listing outside radius in results: ${l.url}`);
    if (l.availabilityConfirmedByOwner !== false) problems.push(`availability wrongly marked confirmed: ${l.url}`);
  }
}
if (latest && !Array.isArray(latest.listings)) problems.push("latest.json listings is not an array");
if (state && !validateState(state)) problems.push("state.json has invalid shape");

if (problems.length) { console.error("Output validation FAILED:\n- " + problems.join("\n- ")); process.exit(1); }
console.log(`Output validation passed: ${report.listings.length} listings, ${report.sources.length} sources.`);
