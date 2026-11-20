# Approved videos (publish queue)

Sirf wahi videos yahan daalo jo **aapki apni** hain ya jinke liye aapke paas **reupload ki likhit permission** hai.
`approved.json` me har video ek entry hai:

```json
[
  {
    "url": "https://example.com/my-video.mp4",
    "title": "Video ka short title",
    "topic": "video kis baare me hai (caption ke liye)",
    "owner": "TheNightCrew",
    "license": "own"
  }
]
```

- `license` khaali ho to video publish **nahi** hogi. Values: `own`, `written-permission: <kis se, kab>`, ya koi aur license.
- `url` me direct `.mp4` link ho, ya repo me rakhi file ka path (jaise `content/videos/demo.mp4`). Instagram ke liye public `.mp4` URL chahiye.
- YouTube/TikTok jaise page links tabhi chalenge jab video aapki apni ho (download yt-dlp se hota hai).
- Ek video har channel pe sirf ek baar jaati hai (duplicate check: URL + file hash).

## Discovery (sirf suggestions)
Publisher roz `config.json → discovery.query` (default "MrBeast") se YouTube pe related videos dhoondhta hai aur unhe
automation-state branch ki `STATUS.md` me "Discovered (needs approval)" list me dikhata hai.
**Ye kabhi apne aap publish nahi hoti.** Permission mil jaaye to entry `approved.json` me `license` ke saath daalo.
Captions kabhi ye nahi kehte ki account MrBeast se official juda hai.
