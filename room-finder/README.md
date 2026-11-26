# Mohali Room Finder

Automatically looks for rooms, PGs and room sets for rent near **CP67 Mall, Sector 67, Mohali**:
within **5 km**, at **₹10,000/month or less**. It runs on GitHub Actions (`.github/workflows/room-finder.yml`)
and is completely separate from the Facebook publisher workflows.

Every result is only a **lead**. The tool never contacts owners, never books a visit and never pays anything.

## What it searches

| Source | How | Status |
|---|---|---|
| House4Ever | Public locality pages (`/mohali/<locality>/rooms-for-rent/` and `/pg-for-rent/`) plus each listing's public page for coordinates and dates. Allowed by its robots.txt. | Active, every run (closest localities); wider sweep every 30 min |
| 99acres | Public "PG in <sector>, Mohali" pages. robots.txt does not disallow them. If 99acres blocks GitHub's servers, the run reports **blocked** — it is never bypassed. | Active, every 30 min |
| MagicBricks, NoBroker | Not built yet: no public Mohali page has been verified for automated access. | Shown as "disabled" |
| Facebook Marketplace, OLX | Only possible with authorized access. Login or cookie scraping is not used. | Shown as "disabled" |

Owner phone numbers are not collected (House4Ever hides them behind an "unlock"; this tool does not unlock anything).

## How results are decided

- **Budget:** ₹1–₹10,000. Listings with no price are excluded (counted in the report).
- **Distance:** straight-line distance from CP67 Mall, using the coordinates the site publishes. If a site gives no coordinates the listing is kept and marked **"Distance unverified"** — never treated as 0 km.
- **Relevance:** sale, commercial (office/shop/showroom) and entire 2+ BHK flats/houses are dropped unless the text clearly offers a room, bed or PG.
- **Sorting:** verified distance (nearest first), then rent, then most recently updated.
- **Duplicates:** the same listing seen twice on one site is merged. Look-alikes on different sites (same rent, same locality or within 150 m, similar title) are grouped as **possible duplicates**; all URLs are kept.
- **New / changed:** a listing is "New" only if it has never been seen before. Rent changes are tracked with history. A listing missing from a page that was re-checked successfully 3 times is marked "not seen recently" — never deleted.

## Files each run produces (in the run's artifact)

- `room-finder-output/REPORT.md` — readable report (also shown on the run's summary page)
- `room-finder-output/report.json` — full report: search settings, totals, per-source status and errors, listings
- `room-finder-output/latest.json` — current matching listings (if every source failed, the last known ones, marked `stale`)
- `room-finder-output/notifications.json` — new listings and meaningful price changes (for future Telegram/email alerts)
- `room-finder-state/state.json` — history carried between runs with the Actions cache

## Reliability

Request timeouts, retries with exponential backoff, a 2-second gap between requests to the same site,
robots.txt checks, page-structure validation (a redesigned page is reported as a parse error, not "0 listings"),
per-source status (`ok`, `partial`, `failed`, `blocked`, `skipped`, `disabled`) and health history.
One source failing does not stop the others. If **every** source fails, the stored history is left untouched and the run is marked failed.

## Settings

Edit `room-finder/config.mjs` (reference point, radius, budget, localities, request pacing).

## Tests

```
node --test room-finder/test/room-finder.test.mjs
```

The workflow runs these tests before every search, then validates the JSON output.

## Before you visit or pay

Confirm with the owner: actual availability, exact address, security deposit, brokerage, electricity and
maintenance charges, tenant restrictions, owner identity and the property's condition.
