// (Optional) Vercel endpoint. GitHub Actions wale setup me iski zaroorat nahi.
// /api/post            → asli post
// /api/post?dry=1      → sirf dikhayega kya post hoga
import { runAutopost } from "../lib/run.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || "").replace("Bearer ", "") || req.query.key;
  if (!secret || given !== secret) return res.status(401).json({ error: "unauthorized" });

  const { status, body } = await runAutopost({ dry: Boolean(req.query.dry) });
  console.log("autopost", JSON.stringify(body));
  return res.status(status).json(body);
}
