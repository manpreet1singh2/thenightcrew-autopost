# Mohali Room Finder

A separate workflow for rental discovery. It does not import or modify the existing publisher workflow.

## Current search configuration
- Target: CP67 Mall / Sector 67, Mohali
- Intended radius: 5 km (the current adapter searches Sector 67 pages, so it does not yet guarantee complete radius coverage)
- Maximum monthly rent: ₹10,000
- Types: rooms, room-sets and PGs when surfaced by the source
- Source adapter: publicly accessible House4Ever Sector 67 listing pages
- Schedule: GitHub Actions every 5 minutes, plus manual dispatch

## Output
Each run creates `room-finder-output/REPORT.md`, `report.json`, and `latest.json`, uploaded as a 30-day GitHub Actions artifact.

## Important limitations
- GitHub scheduled workflows are best-effort; a five-minute cron is not an exact real-time guarantee.
- This first adapter is a public-page parser and may return zero results if the site changes its HTML or blocks automated requests.
- Facebook Marketplace is not accessed. Personal Marketplace search and seller messaging are not available through the existing Facebook Page publishing token.
- The workflow does not send messages, call owners, book visits, or pay deposits. It reports candidate links only.
- Do not share Facebook passwords or automate around platform access controls. Seller contact and any commitment require the user's explicit review.
- Always independently verify availability, full address, tenant restrictions, deposit, brokerage, and identity before visiting or paying.
