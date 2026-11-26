#!/usr/bin/env python3
"""
Inbox Agent — saare FB Pages (Messenger) + linked Instagram DMs ke naye/unread messages
ka khud reply karta hai, aur conversation ko "seen" mark karta hai.

- Tokens: META_USER_TOKEN / META_TOKEN_* (wahi jo autopost use karta hai)
  Extra permissions chahiye: pages_messaging, pages_manage_metadata,
  instagram_manage_messages (+ pages_show_list, pages_read_engagement, instagram_basic)
- Reply: OpenRouter (OPENROUTER_API_KEY) ya Gemini (GEMINI_API_KEY) page ke naam/category + inbox/pages.json ki info se.
  Key na ho toh friendly default reply.
- Meta rule: user ke last message ke 24 ghante ke andar hi reply ho sakta hai
  (purane messages skip + log).
- Paise, order, refund, complaint, legal, collab/deal jaise messages: polite "team jaldi reply
  karegi" + state.json mein needs_human list (sirf page + conversation id; Inbox mein khud dekho).
- Privacy: customer ka message text ya naam na log hota hai na repo mein save (naam masked).
- DRY_RUN=true -> kuch bhejega nahi, sirf log.
"""
import json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
STATE = HERE / "state.json"
PAGES_INFO = HERE / "pages.json"
GV = os.getenv("GRAPH_VERSION") or "v21.0"
G = f"https://graph.facebook.com/{GV}"
DRY = (os.getenv("DRY_RUN") or "false").lower() == "true"
DEFAULT_EXCLUDE = {"dimple1singh", "manpreet1brar"}
HUMAN_WORDS = re.compile(
    r"\b(refund|paisa|paise|payment|paid|upi|order|deliver|complain|complaint|scam|fraud|legal|"
    r"police|lawyer|copyright|collab|collaboration|sponsor|deal|price|rate card|business|"
    r"invoice|account hack|hacked|password)\b", re.I)


def tokens():
    out = []
    for raw in (os.getenv("META_USER_TOKEN") or "").replace(",", "\n").splitlines():
        if raw.strip():
            out.append(("META_USER_TOKEN", raw.strip()))
    for k, v in sorted(os.environ.items()):
        if k.startswith("META_TOKEN_") and v.strip():
            out.append((k, v.strip()))
    return out


def api(method, path, **kw):
    url = path if path.startswith("http") else f"{G}/{path.lstrip('/')}"
    r = requests.request(method, url, timeout=60, **kw)
    try:
        d = r.json()
    except ValueError:
        d = {"raw": r.text}
    if r.status_code >= 400 or (isinstance(d, dict) and "error" in d):
        raise RuntimeError(f"{method} {url.split('?')[0]} -> {r.status_code}: {d}")
    return d


def pages_for(tok):
    res, url = [], "me/accounts"
    params = {"fields": "id,name,category,access_token,instagram_business_account{id,username}",
              "limit": 100, "access_token": tok}
    while url:
        d = api("GET", url, params=params)
        res += d.get("data", [])
        url, params = d.get("paging", {}).get("next"), None
    return res


def mask(name):
    """Logs public ho sakte hain -> customer ka naam chhupao (Ravi Kumar -> R***r)."""
    n = str(name or "?")
    return n[0] + "***" + n[-1] if len(n) > 2 else "***"


def ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z")


def load(p, default):
    return json.loads(p.read_text()) if p.exists() else default


def llm(prompt):
    """OpenRouter (OPENROUTER_API_KEY) pehle, phir Gemini (GEMINI_API_KEY)."""
    ork = os.getenv("OPENROUTER_API_KEY")
    if ork:
        try:
            r = requests.post("https://openrouter.ai/api/v1/chat/completions", timeout=60,
                              headers={"Authorization": f"Bearer {ork}",
                                       "X-Title": "TheNightCrew Inbox Agent"},
                              json={"model": os.getenv("OPENROUTER_MODEL") or "google/gemini-2.5-flash",
                                    "messages": [{"role": "user", "content": prompt}],
                                    "temperature": 0.6, "max_tokens": 250})
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"[openrouter] {e}", file=sys.stderr)
    key = os.getenv("GEMINI_API_KEY")
    if key:
        try:
            r = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{os.getenv('GEMINI_MODEL') or 'gemini-2.5-flash'}:generateContent",
                params={"key": key}, timeout=60,
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 0.6, "maxOutputTokens": 250}})
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            print(f"[gemini] {e}", file=sys.stderr)
    return None


def gen_reply(page, platform, history, info):
    """history: list of (who, text) oldest->newest, who in {'user','page'}"""
    # page ke last reply ke baad ke saare user messages
    pending = []
    for w, t in reversed(history):
        if w == "page":
            break
        pending.insert(0, t)
    last = " ".join(pending) if pending else (history[-1][1] if history else "")
    if HUMAN_WORDS.search(last or ""):
        return ("Thanks for reaching out! 🙏 Aapka message humari team tak pahunch gaya hai, "
                "wo jaldi hi aapko personally reply karenge."), True
    convo = "\n".join(f"{'Customer' if w == 'user' else 'Page'}: {t}" for w, t in history[-25:])
    prompt = (
        f"You are the friendly admin of the {platform} page '{page['name']}' "
        f"(category: {page.get('category')}). Page info from owner: {info or 'n/a'}.\n"
        "This is an ongoing conversation: read the whole history, remember what was already "
        "said, don't repeat greetings or earlier answers, and answer ALL of the customer's "
        "messages that came after the page's last reply in one natural message. Keep the "
        "conversation going (ask a light follow-up question when it fits). "
        "Reply in the SAME language/style the customer used (Hinglish/Hindi/Punjabi/English). "
        "1-3 short sentences, warm, a fitting emoji ok. Never invent facts, prices, links, phone "
        "numbers, offers or promises; if unsure, say the team will update them soon. Never ask "
        "for passwords, OTP or payment details. If they share a meme/compliment, thank them and "
        "invite them to follow for daily funny videos. No politics/religion debates. If the "
        "message needs a human decision (money, orders, complaints, legal, business deals), say "
        "the team will reply personally and start your answer with [HUMAN]. "
        "Output only the reply text.\n\n" + convo)
    txt = llm(prompt)
    if txt:
        human = txt.startswith("[HUMAN]")
        txt = txt.replace("[HUMAN]", "").strip()
        if txt:
            return txt[:900], human
    return ("Hey! Message ke liye thank you 😊 Hum jaldi reply karenge. Tab tak daily funny "
            "videos ke liye page follow kar lo! 😂"), False


def send(page_id, tok, recipient, text):
    api("POST", f"{page_id}/messages", json={
        "recipient": {"id": recipient}, "messaging_type": "RESPONSE",
        "message": {"text": text}}, params={"access_token": tok})


def mark_seen(page_id, tok, recipient):
    try:
        api("POST", f"{page_id}/messages", json={
            "recipient": {"id": recipient}, "sender_action": "mark_seen"},
            params={"access_token": tok})
    except Exception:
        pass  # IG pe kabhi-kabhi support nahi, ignore


def handle(page, platform, state, info, exclude):
    pid, tok = page["id"], page["access_token"]
    self_ids = {pid}
    ig = page.get("instagram_business_account") or {}
    if platform == "instagram":
        if not ig.get("id"):
            return 0
        self_ids.add(ig["id"])
    fields = ("id,updated_time,unread_count,participants,"
              "messages.limit(25){id,message,from,created_time}")
    try:
        convs = api("GET", f"{pid}/conversations", params={
            "platform": platform, "fields": fields, "limit": 50, "access_token": tok}).get("data", [])
    except Exception as e:
        print(f"  ✗ {page['name']} [{platform}] conversations: {e}", file=sys.stderr)
        return 0

    done = 0
    now = datetime.now(timezone.utc)
    for c in convs:
        msgs = (c.get("messages") or {}).get("data", [])
        if not msgs:
            continue
        latest = msgs[0]  # newest first
        frm = latest.get("from") or {}
        if frm.get("id") in self_ids:
            continue  # last message hamara hai -> pehle hi reply ho chuka
        uname = (frm.get("username") or frm.get("name") or "").lower()
        if frm.get("id") in exclude or uname in exclude:
            continue
        key = f"{platform}:{c['id']}"
        if state["replied"].get(key) == latest["id"]:
            continue
        age_h = (now - ts(latest["created_time"])).total_seconds() / 3600
        if age_h > 23.5:
            state["replied"][key] = latest["id"]
            state["expired"].append({"page": page["name"], "platform": platform,
                                     "conversation": c["id"], "at": latest["created_time"]})
            continue
        history = [("page" if (m.get("from") or {}).get("id") in self_ids else "user",
                    m.get("message") or "[attachment/sticker]") for m in reversed(msgs)]
        reply, human = gen_reply(page, platform, history, info.get(page["name"]) or info.get(pid))
        who = mask(frm.get("name") or frm.get("username") or frm.get("id"))
        if DRY:
            print(f"  [dry] {page['name']} [{platform}] {who}: reply ready ({len(reply)} chars)")
        else:
            try:
                mark_seen(pid, tok, frm["id"])
                send(pid, tok, frm["id"], reply)
                print(f"  ✓ {page['name']} [{platform}] replied to {who}")
            except Exception as e:
                print(f"  ✗ {page['name']} [{platform}] {who}: {e}", file=sys.stderr)
                continue
        state["replied"][key] = latest["id"]
        if human:
            state["needs_human"].append({"page": page["name"], "platform": platform,
                                         "conversation": c["id"], "at": latest["created_time"]})
        done += 1
        time.sleep(1.5)
    return done


def main():
    toks = tokens()
    if not toks:
        sys.exit("Koi Meta token nahi mila (META_USER_TOKEN / META_TOKEN_*)")
    exclude = DEFAULT_EXCLUDE | {x.strip().lower() for x in (os.getenv("EXCLUDE") or "").split(",") if x.strip()}
    state = load(STATE, {"replied": {}, "needs_human": [], "expired": []})
    info = load(PAGES_INFO, {})
    seen, total = set(), 0
    for name, tok in toks:
        try:
            pages = pages_for(tok)
        except Exception as e:
            print(f"::error::{name}: {e}", file=sys.stderr)
            continue
        for p in pages:
            if p["id"] in seen:
                continue
            seen.add(p["id"])
            ig = p.get("instagram_business_account") or {}
            if {p["name"].lower(), p["id"]} & exclude:
                continue
            total += handle(p, "messenger", state, info, exclude)
            if (ig.get("username") or "").lower() not in exclude:
                total += handle(p, "instagram", state, info, exclude)
    state["needs_human"] = state["needs_human"][-200:]
    state["expired"] = state["expired"][-200:]
    if len(state["replied"]) > 5000:
        state["replied"] = dict(list(state["replied"].items())[-3000:])
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False))
    print(f"[inbox] {len(seen)} pages checked, {total} replies")
    if state["needs_human"]:
        print(f"::notice::{len(state['needs_human'])} messages aapke personal reply ke liye "
              "inbox/state.json -> needs_human mein hain")


if __name__ == "__main__":
    main()
