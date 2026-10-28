import webpush from "web-push";
import { db, pushConfigured } from "./lib.js";
import { readRaw, verify } from "./qstash.js";

// Called by Upstash QStash when a rep's time is up. Only requests signed by QStash are accepted.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const raw = await readRaw(req);
  if (!verify(req.headers["upstash-signature"], raw)) return res.status(401).json({ error: "Not allowed" });
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
