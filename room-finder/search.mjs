// Mohali Room Finder — entry point (run by .github/workflows/room-finder.yml).
// Finds public rental-room / PG leads near CP67 Mall, Sector 67, Mohali, under the budget in config.mjs.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { OUT_DIR, STATE_FILE, EXTENDED_EVERY_MIN, MAX_RENT, RUN_BUDGET_MS } from "./config.mjs";
import { log, fetchText, parseRobots, relevanceProblem, budgetProblem, distanceProblem } from "./lib.mjs";
import { ADAPTERS, DISABLED_SOURCES } from "./sources/index.mjs";
import { loadState, saveState, mergeRun, updateSourceHealth } from "./state.mjs";
import { mergeExact, groupDuplicates } from "./dedupe.mjs";
import { buildReport, renderMarkdown, sortListings, toRecord } from "./report.mjs";
import { buildEvents, dispatch } from "./notify.mjs";

const ROBOTS_TTL_MS = 24 * 3600e3;

async function getRobots(state, origin, fetchImpl) {
  state.robotsCache ||= {};
  const c = state.robotsCache[origin];
  if (c && Date.now() - Date.parse(c.at) < ROBOTS_TTL_MS) return parseRobots(c.text);
  try {
    const text = await fetchText(`${origin}/robots.txt`, fetchImpl ? { fetchImpl } : {});
    state.robotsCache[origin] = { at: new Date().toISOString(), text };
    return parseRobots(text);
  } catch (e) {
    if (e.kind === "not_found") return parseRobots("");
    throw new Error(`robots.txt could not be checked (${e.message}); source skipped to stay compliant`);
  }
}

export function summarise(adapter, out) {
  const list = out.pages.filter((p) => !p.detail);
  const ok = list.filter((p) => p.status === "ok").length;
  const nf = list.filter((p) => p.status === "not_found").length;
  const notChecked = list.filter((p) => p.status === "budget").length;
  const bad = list.filter((p) => !["ok", "not_found", "budget"].includes(p.status));
  let status;
  if (!list.length || (ok === 0 && !bad.length && notChecked)) status = "skipped";
  else if (bad.length === 0 && !notChecked && ok > 0) status = "ok";
  else if (ok > 0) status = "partial";
  else if (bad.some((p) => p.status === "blocked")) status = "blocked";
  else status = "failed";
  const errs = [];
  if (status === "failed" && !bad.length && nf) errs.push("No listing pages exist for the configured localities");
  if (bad.length) errs.push(`${bad.length} page(s) failed: ${[...new Set(bad.map((b) => b.error))].slice(0, 3).join("; ")}`);
  if (notChecked) errs.push(`${notChecked} page(s) not checked: run time budget reached`);
  const error = errs.join(" · ") || null;
  const detailErrors = out.pages.filter((p) => p.detail && !["ok"].includes(p.status));
  return {
    id: adapter.id, name: adapter.name, status, error,
    pagesChecked: list.length - notChecked, pagesOk: ok, pagesNotFound: nf, pagesNotCheckedTimeBudget: notChecked,
    detailPagesFetched: out.pages.filter((p) => p.detail).length, detailPageErrors: detailErrors.length,
    listingCount: out.listings.length,
    pageErrors: [...bad, ...detailErrors].map((p) => ({ url: p.url, error: p.error })),
  };
}

export async function main({ fetchImpl } = {}) {
  const now = new Date().toISOString();
  const deadline = Date.now() + RUN_BUDGET_MS;
  await mkdir(OUT_DIR, { recursive: true });
  const { state, loaded, warning } = await loadState(STATE_FILE);
  if (warning) log("warn", warning);
  if (!loaded) { try { await copyFile(STATE_FILE, `${STATE_FILE}.bad`); } catch {} }
  const extendedDue = !state.lastExtendedSweep || Date.now() - Date.parse(state.lastExtendedSweep) >= EXTENDED_EVERY_MIN * 60e3;
  log("info", "run start", { stateLoaded: loaded, knownListings: Object.keys(state.listings).length, extendedSweep: extendedDue });

  const sources = [];
  const raw = [];
  const okPages = new Set();
  for (const adapter of ADAPTERS) {
    if (!adapter.enabled) continue;
    if (adapter.onlyOnExtended && !extendedDue) {
      sources.push({ id: adapter.id, name: adapter.name, status: "skipped", reason: `Checked on the ${EXTENDED_EVERY_MIN}-minute sweep; not searched this run` });
      continue;
    }
    const t0 = Date.now();
    let summary;
    try {
      const robots = await getRobots(state, adapter.origin, fetchImpl);
      const ctx = {
        extendedDue,
        fetch: (url) => fetchText(url, { robots, deadline, ...(fetchImpl ? { fetchImpl } : {}) }),
        getKnown: (key) => state.listings[key],
        log,
      };
      const out = await adapter.run(ctx);
      summary = summarise(adapter, out);
      for (const p of out.pages) if (!p.detail && p.status === "ok") okPages.add(p.url);
      for (const l of out.listings) raw.push({ ...l, lastChecked: now });
    } catch (e) {
      summary = { id: adapter.id, name: adapter.name, status: "failed", error: e.message, listingCount: 0, pagesChecked: 0, pagesOk: 0 };
    }
    summary.durationMs = Date.now() - t0;
    sources.push(summary);
    updateSourceHealth(state, adapter.id, summary, now);
    log(summary.status === "ok" ? "info" : "warn", "source done", { source: adapter.id, status: summary.status, listings: summary.listingCount, pagesOk: summary.pagesOk, pagesChecked: summary.pagesChecked, error: summary.error });
  }
  for (const d of DISABLED_SOURCES) sources.push({ id: d.id, name: d.name, status: "disabled", reason: d.reason, listingCount: 0 });

  const anySuccess = sources.some((s) => s.status === "ok" || s.status === "partial");
  const excluded = {};
  const bump = (r) => { excluded[r] = (excluded[r] || 0) + 1; };

  // Relevance + distance decide what is tracked in history; budget decides what is reported.
  const candidates = [];
  for (const l of mergeExact(raw)) {
    const why = relevanceProblem(`${l.title} ${l.text || ""}`) || distanceProblem(l.distanceKm);
    if (why) { bump(why); continue; }
    candidates.push(l);
  }

  let changes = { newKeys: [], priceChanges: [], reappeared: [], notSeen: [] };
  if (anySuccess) {
    changes = mergeRun(state, candidates.map(({ text, ...rest }) => rest), okPages, now);
    state.lastSuccessfulCheck = now;
    if (extendedDue) state.lastExtendedSweep = now;
  } else {
    log("error", "all sources failed — previous listing history kept unchanged");
  }
  state.lastRun = now;

  const inBudget = [];
  // If every source failed, report the last known listings (marked stale) instead of an empty list.
  const pool = anySuccess ? candidates : Object.values(state.listings).filter((l) => l.status === "active").map((l) => ({ ...l, stale: true }));
  for (const l of pool) {
    if (l.inaccessible) { bump("listing page no longer accessible"); continue; }
    const why = budgetProblem(l.rent);
    if (why) { bump(why); continue; }
    inBudget.push(l);
  }
  const groups = groupDuplicates(inBudget);
  const newSet = new Set(changes.newKeys);
  const pcByKey = new Map(changes.priceChanges.map((p) => [p.key, p]));
  const records = sortListings(inBudget).map((l) => {
    const g = groups.get(l.key) || null;
    const others = g ? inBudget.filter((o) => groups.get(o.key) === g && o.key !== l.key).map((o) => `${o.source} (${o.url})`) : [];
    const pc = pcByKey.get(l.key);
    return toRecord(l, { isNew: newSet.has(l.key), priceChange: pc ? { from: pc.from, to: pc.to } : null, duplicateGroup: g, groupSources: others, firstSeen: state.listings[l.key]?.firstSeen || null });
  });
  const priceChanges = changes.priceChanges
    .filter((p) => p.from <= MAX_RENT || p.to <= MAX_RENT)
    .map((p) => ({ ...p, title: state.listings[p.key]?.title, url: state.listings[p.key]?.url, source: state.listings[p.key]?.source }));

  const stateNote = {
    previousStateLoaded: loaded,
    note: loaded ? "History restored from the previous run" : `${warning}. Every listing counts as new on this run.`,
    knownListings: Object.keys(state.listings).length,
    lastSuccessfulCheck: state.lastSuccessfulCheck,
  };
  const report = buildReport({ now, results: records, excluded, sources, newKeys: changes.newKeys, priceChanges, notSeen: changes.notSeen, stateNote, extendedSweep: extendedDue });
  const md = renderMarkdown(report);

  const events = anySuccess && loaded ? buildEvents(records, priceChanges) : [];
  const sent = await dispatch(events, process.env, log);

  await writeFile(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${OUT_DIR}/latest.json`, JSON.stringify({
    checkedAt: now,
    stale: !anySuccess,
    note: anySuccess ? "Current matching listings" : "All sources failed this run; these are the last known listings, not re-checked",
    count: records.length,
    listings: records,
  }, null, 2));
  await writeFile(`${OUT_DIR}/REPORT.md`, md);
  await writeFile(`${OUT_DIR}/notifications.json`, JSON.stringify({ checkedAt: now, channelsSent: sent, events }, null, 2));
  await saveState(STATE_FILE, state);
  log("info", "run end", { matched: records.length, new: report.totals.newListings, priceChanges: priceChanges.length, anySuccess });
  return { report, anySuccess };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("room-finder/search.mjs")) {
  main().then(({ anySuccess }) => {
    if (!anySuccess) process.exitCode = 1;
  }).catch((e) => {
    log("error", "fatal", { error: e.stack || e.message });
    process.exitCode = 1;
  });
}
