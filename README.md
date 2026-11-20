# TheNightCrew AutoPost

Teen automation, sab ek repo me:

| Kya | Kahan chalta hai | Kab |
|---|---|---|
| **Har ghante video post**: viral topic (Google Trends + AI news) → AI caption → Pexels stock video (9:16) → Facebook Page | GitHub Actions (free) — `.github/workflows/autopost.yml` | Har ghante :17 par |
| **5 long AI videos + clips**: FreeVideo (MiniMax H3) se 30 sec videos, Facebook par 9, 12, 3, 6, 9 baje + har video ke 2 clips | Aapka MacBook M5 — `local/daily-video.mjs` | Raat 10:30 PM batch |
| **Lambi video ke clips**: `clip-queue.txt` ki videos → opensource-clipping (MIT) → Reels | GitHub Actions — `.github/workflows/clips.yml` | Roz 6:11 PM |

## 1. GitHub setup (ek baar)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Kahan se |
|---|---|
| `FB_USER_TOKEN` | Graph API Explorer → app *Dimple Bot App - Test1* → User Token → Access Token Debugger → **Extend** (~60 din) |
| `OPENROUTER_API_KEY` | openrouter.ai/keys (ya free `COHERE_API_KEY`) |
| `PEXELS_API_KEY` | pexels.com/api (free) |
| `GOOGLE_API_KEY` | aistudio.google.com/apikey (free) — sirf clips workflow ke liye |

Phir **Actions** tab → workflows enable karo → *autopost* → **Run workflow** (dry ✅) → summary me post ka preview dekho. Theek ho to bas — har ghante khud chalega.

Optional repo **Variables**: `FORCE_TYPE` (khaali = posts.json ka photo/video mix), `TREND_TOPICS=0` (viral band), `FB_SKIP_PAGES`, `CLIP_PAGES`, `OPENROUTER_MODEL`.

## 2. Mac setup (AI videos)
Steps: `local/README.md`. Short me: FreeVideo install → `brew install node ffmpeg` → `.env` banao (`.env.example` dekho) → `zsh local/schedule-mac.sh`.

## Dhyan rakho
- Har ghante post + Mac ke 15 posts = ek Page par bahut zyada. Facebook reach gira sakta hai — `autopost.yml` ka cron `17 */3 * * *` (har 3 ghante) aur Mac par `CLIP_COUNT=1` se shuru karna behtar.
- Tokens ~60 din me expire hote hain; run fail ho to naya `FB_USER_TOKEN` daalo.
- Repo me 60 din koi commit na ho to GitHub schedule band kar deta hai — Actions me "Enable" dabana hoga.
- Sirf apni/permission wali videos `clip-queue.txt` me daalo.
- Instagram ke liye Page se Instagram Business account link karna hoga (abhi linked nahi hai).
- Content badalna: brand/CTA `prompt.txt`, backup topics `posts.json`, per-page settings `pages.json`.
