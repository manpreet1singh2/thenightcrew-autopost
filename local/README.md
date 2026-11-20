# Roz 5 long AI videos + clips (FreeVideo) → Facebook

**Roz ka flow:** raat 10:30 PM pe Mac pe script chalti hai.
1. Google Trends aur aaj ki AI news se **5 alag viral topics** chunti hai.
2. Har topic pe 30 sec ki video banati hai. M5 pe ek video ~66 min leti hai, to 5 videos ~5.5 ghante, yaani raat bhar.
3. Agle din ke liye sab Facebook pe schedule kar deti hai:
   - **long videos:** 9 AM, 12 PM, 3 PM, 6 PM, 9 PM
   - **clips:** har video ke 2 clips, uske 1 aur 2 ghante baad. Din me kul 15 posts.
4. Sab kuch `.env` se badal sakte ho: `VIDEOS_PER_DAY`, `VIDEO_SECONDS`, `LONG_TIMES`, `CLIP_COUNT`, `CLIP_GAP_MIN`.

Ek hi Page pe 15 posts/din kaafi zyada hai, aur Facebook reach kam kar sakta hai. Shuru me `CLIP_COUNT=1` rakhna better rahega.

---


Ye script aapke **apne computer** pe chalti hai (FreeVideo + MiniMax H3 model).

**GitHub Actions pe kyun nahi?** FreeVideo ko NVIDIA RTX 30/40/50 (8 GB+ VRAM) ya Apple Silicon Mac chahiye. GitHub ke free servers pe GPU nahi hota, aur Kaggle/Colab ke free T4 GPU bhi supported nahi hain.

## 🍎 MacBook M5 (aapka setup)
FreeVideo ki Mac guide ke hisaab se M5 (24 GB, Light quality) pe timing aisi hai:
- 10 sec @ 960×544 → ~22 min. Default 30 sec @ 544×960 hai, jo ~66 min leta hai.
- 10 sec @ 1344×768 → ~42 min (`VIDEO_WIDTH=768 VIDEO_HEIGHT=1344`)

Mac support abhi "experimental" hai. macOS 14+ aur Xcode Command Line Tools chahiye (`xcode-select --install`).

1. FreeVideo-Mac-arm64.dmg install karo. Pehli baar System Settings → Privacy & Security → **Open Anyway** dabana padega. Install location jo bhi chuno, use yaad rakhna.
2. App me ek baar khud chhoti video bana ke dekh lo.
3. Node.js 20+ install karo (nodejs.org ya `brew install node`).
4. `.env` me `FREEVIDEO_CMD=/aapka/install/folder/freevideo` daalo. Script khud bhi `~/.local/share/freevideo` me dhoondhti hai.
5. Test (sirf 1 chhoti video, post nahi hogi): `DRY_RUN=1 VIDEOS_PER_DAY=1 VIDEO_SECONDS=10 node --env-file=.env local/daily-video.mjs`
6. ffmpeg install karo (clips ke liye): `brew install ffmpeg`
7. Schedule: `zsh local/schedule-mac.sh` → roz 10:30 PM batch.
   - FreeVideo band ho to script use khud kholti hai, aur `caffeinate` video bante waqt Mac ko sone nahi deta.
   - Mac raat bhar charger pe aur lid khuli rakhni hai. Mac khud 10:25 PM pe jaage, iske liye: `sudo pmset repeat wakeorpoweron MTWRFSU 22:25:00`

## ▶️ YouTube (har channel par Shorts)
Har long AI video Facebook ke saath aapke saare YouTube channels pe bhi usi time pe Shorts ki tarah jaati hai.
1. Google Cloud Console → **APIs & Services → Library** → "YouTube Data API v3" → **Enable**.
2. **OAuth consent screen:**
   - aapka email Test users me ho, **ya**
   - **Publish app** ("In production") kar do. Testing mode me login 7 din me expire ho jaata hai.
3. **Credentials:** OAuth client "Desktop app" type ka ho. Agar "Web" hai to Authorized redirect URI me `http://127.0.0.1:8085/callback` jodo.
4. `.env` me `YT_CLIENT_ID` aur `YT_CLIENT_SECRET` daalo.
5. Har channel ke liye ek baar `node --env-file=.env scripts/youtube-auth.mjs` chalao. Browser khulega, channel chun ke Allow dabao. Token apne aap `.env` me jud jaata hai.

**Google ke niyam:**
- Naye unverified project se upload hui videos **private** rehti hain. Public karne ke liye YouTube API audit form bharna padta hai.
- Free quota me din me ~6 uploads hi ho sakte hain, saare channels milake (`YT_MAX_UPLOADS_PER_DAY`). Jaise 2 channels hon to 3 videos/din har channel pe jaayengi.

## Setup (Windows / Linux PC)
1. FreeVideo install karo: https://github.com/FlashML-org/FreeVideo (Windows .exe / Mac .dmg / Linux). Ek baar app me khud ek video bana ke dekh lo ki chal raha hai.
2. Node.js 20+ install karo (nodejs.org).
3. `autopost` folder me `.env` file banao:
   ```
   OPENROUTER_API_KEY=sk-or-...
   FB_USER_TOKEN=EAA...            # Graph API Explorer wala long-lived user token
   FB_PAGE_ID=628058697050691      # The night crew
   FREEVIDEO_CMD=C:\FreeVideo\freevideo.cmd   # FreeVideo folder me jo freevideo.cmd / freevideo hai uska path
   VIDEO_SECONDS=10
   VIDEO_QUALITY=light
   ```
4. Test (post nahi hogi, sirf 1 chhoti video): `DRY_RUN=1 VIDEOS_PER_DAY=1 VIDEO_SECONDS=10 node --env-file=.env local/daily-video.mjs`
   Windows pe: `set DRY_RUN=1 && node --env-file=.env local\daily-video.mjs`
   Video `local/videos/` me save hogi.
5. Roz ka schedule:
   - **Windows:** `local\schedule-windows.cmd` pe double-click karo. Ye roz 7:30 PM pe chalega (task ka time Task Scheduler me badal sakte ho).
   - **Mac/Linux:** `crontab -e` me ye line daalo:
     `30 19 * * * cd /path/to/autopost && node --env-file=.env local/daily-video.mjs >> local/videos/log.txt 2>&1`

## Dhyan rakho
- Us time computer ON hona chahiye aur FreeVideo app khula hona chahiye.
- `light` quality me RTX 3060/4060 pe 10 sec ki video ~5–15 min me banti hai. `high` ya `max` me kaafi zyada time lagta hai.
- Topic `posts.json` se rotate hote hain aur caption `prompt.txt` ke hisaab se banta hai, roz ke text post jaisa hi.
- Instagram pe tab hi jaayega jab Page ke saath Instagram Business account linked ho. Abhi The night crew ke saath koi linked nahi hai.
- FreeVideo Apache-2.0 license ke under hai. MiniMax H3 model ki license/terms bhi ek baar padh lena.
