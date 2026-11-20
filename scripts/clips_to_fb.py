#!/usr/bin/env python3
"""Bane hue clips ko Facebook Pages par Reels ki tarah upload karo (opensource-clipping ka uploader use karke).

Kaunse pages par jaayenge (CLIP_PAGES env):
  khaali      → sirf FB_PAGE_ID wala main page
  all         → FB_USER_TOKEN ke saare pages
  naam/ID,... → sirf ye pages (comma se)
Pehla clip turant publish, baaki CLIP_INTERVAL_HOURS (default 4) ke gap par Facebook khud schedule karta hai.
"""
import glob
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPPER = os.path.join(ROOT, "clipper")
sys.path.insert(0, CLIPPER)

from facebook_uploader import upload_manifest_to_facebook  # noqa: E402

GRAPH = os.environ.get("META_GRAPH_VERSION") or "v23.0"


def list_pages(user_token: str) -> list[dict]:
    pages = []
    url = f"https://graph.facebook.com/{GRAPH}/me/accounts?" + urllib.parse.urlencode(
        {"fields": "id,name,category,access_token", "limit": 100, "access_token": user_token}
    )
    while url:
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.load(r)
        pages += d.get("data", [])
        url = d.get("paging", {}).get("next")
    return pages


def target_pages() -> list[dict]:
    want = [s.strip() for s in os.environ.get("CLIP_PAGES", "").split(",") if s.strip()]
    user_token = os.environ.get("FB_USER_TOKEN", "").strip()
    main_id = os.environ.get("FB_PAGE_ID", "").strip()

    if user_token:
        pages = list_pages(user_token)
        if not want:
            return [p for p in pages if p["id"] == main_id]
        if want == ["all"]:
            return pages
        return [p for p in pages if p["id"] in want or p["name"] in want]

    # User token nahi hai → sirf main page token
    token = os.environ.get("FB_PAGE_TOKEN", "").strip()
    return [{"id": main_id, "name": "main page", "category": "", "access_token": token}] if main_id and token else []


def main() -> int:
    dry = os.environ.get("DRY_RUN") == "1"
    manifests = sorted(glob.glob(os.path.join(CLIPPER, "outputs", "**", "render_manifest.json"), recursive=True))
    if not manifests:
        print("❌ Koi render_manifest.json nahi mila — clips bane hi nahi.")
        return 1

    pages = target_pages()
    if not pages:
        print("⚠️ Koi Facebook page set nahi (FB_USER_TOKEN ya FB_PAGE_ID + FB_PAGE_TOKEN chahiye). Upload skip.")
        return 0

    interval = int(os.environ.get("CLIP_INTERVAL_HOURS") or 4)
    failed = 0
    for page in pages:
        print(f"\n===== 📘 {page['name']} ({page.get('category') or '?'}) =====")
        if dry:
            print(f"🧪 Dry run: {len(manifests)} manifest(s) is page par jaate.")
            continue
        os.environ["META_PAGE_ID"] = page["id"]
        os.environ["META_PAGE_ACCESS_TOKEN"] = page["access_token"]
        os.environ["META_GRAPH_VERSION"] = GRAPH
        for m in manifests:
            out = os.path.dirname(m)
            try:
                upload_manifest_to_facebook(
                    manifest_file=m,
                    result_file=os.path.join(out, f"fb_{page['id']}_results.json"),
                    updated_manifest_file=os.path.join(out, f"render_manifest_fb_{page['id']}.json"),
                    tz_name="Asia/Kolkata",
                    interval_hours=interval,
                )
            except Exception as e:  # ek page fail ho to baaki chalte rahein
                failed += 1
                print(f"❌ {page['name']}: {e}")
    return 1 if failed and failed == len(pages) * len(manifests) else 0


if __name__ == "__main__":
    sys.exit(main())
