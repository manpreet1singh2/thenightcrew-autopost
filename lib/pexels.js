// Pexels se topic ke hisaab se relevant photo / video ke candidates laata hai (free API).
// Best wala AI chunta hai (lib/ai.js → chooseBestMedia).
const KEY = () => process.env.PEXELS_API_KEY;
const N = () => Number(process.env.MEDIA_CANDIDATES || 8); // kitne options AI ko dikhane hain

async function get(url) {
  const r = await fetch(url, { headers: { Authorization: KEY() } });
  if (!r.ok) throw new Error(`Pexels ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Har baar alag results ke liye random page (1-3) — wahi photo baar-baar na aaye
const page = () => 1 + Math.floor(Math.random() * 3);

// Square photos — Instagram, Facebook, LinkedIn sab par theek
export async function photoCandidates(query) {
  const q = encodeURIComponent(query);
  let d = await get(`https://api.pexels.com/v1/search?query=${q}&orientation=square&size=large&per_page=${N()}&page=${page()}`);
  if (!d.photos?.length) d = await get(`https://api.pexels.com/v1/search?query=${q}&orientation=square&per_page=${N()}`);
  return (d.photos || []).map((p) => ({
    image: p.src.large2x || p.src.large,
    preview: p.src.medium, // chhoti image — AI ko dikhane ke liye
    alt: p.alt,
    credit: `Photo: ${p.photographer} on Pexels`,
  }));
}

// Portrait videos (Reels 9:16), 5–60 sec, max 1080p mp4
export async function videoCandidates(query) {
  const q = encodeURIComponent(query);
  const d = await get(`https://api.pexels.com/videos/search?query=${q}&orientation=portrait&per_page=${N() * 2}&page=${page()}`);
  return (d.videos || [])
    .filter((v) => v.duration >= 5 && v.duration <= 60)
    .map((v) => {
      const file = v.video_files
        .filter((f) => f.file_type === "video/mp4" && f.height <= 1920 && f.width <= 1080)
        .sort((a, b) => b.height - a.height)[0];
      return file && {
        video: file.link,
        preview: v.image, // video ka thumbnail — AI ko dikhane ke liye
        alt: (v.url || "").split("/").filter(Boolean).pop()?.replace(/-\d+$/, "").replace(/-/g, " "),
        credit: `Video: ${v.user?.name || "Pexels"} on Pexels`,
      };
    })
    .filter(Boolean)
    .slice(0, N());
}
