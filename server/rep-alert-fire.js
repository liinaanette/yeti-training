import crypto from "node:crypto";
import webpush from "web-push";
import { db, pushConfigured, safeEqual } from "./lib.js";

// Called by Upstash QStash when a rep's time is up. Only requests signed by QStash are accepted.
function verifyQstash(token, rawBody) {
  const [h, p, sig] = String(token || "").split(".");
  if (!h || !p || !sig) return false;
  for (const key of [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean)) {
    if (!safeEqual(sig, crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url"))) continue;
    let claims;
    try { claims = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return false; }
    const now = Date.now() / 1000;
    if (claims.iss !== "Upstash" || !(claims.exp > now) || claims.nbf > now + 5) return false;
    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("base64url");
    return String(claims.body || "").replace(/=+$/, "") === bodyHash;
  }
  return false;
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  if (chunks.length) return Buffer.concat(chunks).toString();
  return req.body ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const raw = await readRaw(req);
  if (!verifyQstash(req.headers["upstash-signature"], raw)) return res.status(401).json({ error: "Not allowed" });
  if (!pushConfigured()) return res.status(200).json({ skipped: "push not configured" });
  const { endpoint, title, body } = JSON.parse(raw);
  const sql = await db();
  const [row] = await sql`SELECT sub FROM push_subs WHERE endpoint = ${String(endpoint || "")}`;
  if (!row) return res.status(200).json({ skipped: "phone not signed up" });
  webpush.setVapidDetails("mailto:yeti-training@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(row.sub, JSON.stringify({ title, body, tag: "rep", renotify: true, requireInteraction: true, vibrate: [300, 150, 300, 150, 300] }), { urgency: "high", TTL: 300 });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) await sql`DELETE FROM push_subs WHERE endpoint = ${endpoint}`;
    else throw err;
  }
  res.status(200).json({ sent: true });
}
