// Kaunsi post aaj jaayegi, ye decide karta hai — bina database ke.
// 1) Agar kisi post ki "date" aaj (IST) se match kare, wahi jaayegi.
// 2) Warna baaki posts rotation me chalti hain (har slot me agli post).
import posts from "../posts.json" with { type: "json" };

export function todayIST(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function pickPost(now = new Date()) {
  const today = todayIST(now);
  const intervalMin = Number(process.env.INTERVAL_MINUTES || 1440); // default: roz 1
  // Din me kai post ho rahi ho to dated post sirf DATED_HOUR (IST, default 9 baje) wale run me jaaye
  const istHour = new Date(now.getTime() + 330 * 60 * 1000).getUTCHours();
  const datedHour = Number(process.env.DATED_HOUR ?? 9);
  const dated = posts.find((p) => p.date === today);
  if (dated && (intervalMin >= 1440 || istHour === datedHour)) return dated;

  const pool = posts.filter((p) => !p.date);
  if (!pool.length) return null;

  const start = Date.parse(process.env.START_DATE || "2026-01-01T00:00:00Z");
  const slot = Math.floor((now.getTime() - start) / (intervalMin * 60 * 1000));
  return pool[((slot % pool.length) + pool.length) % pool.length];
}
