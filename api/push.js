import webpush from "web-push";
import { allow, checkEnv, db, isPlainObject, pushConfigured, requireUser } from "./_lib.js";

// GET: public key (and this phone's settings when ?endpoint= is given)
// POST: save this phone's subscription and settings, or { test: true, endpoint } to send a test
// DELETE: { endpoint } turns reminders off for this phone
export default async function handler(req, res) {
  if (!allow(req, res, "GET", "POST", "DELETE") || !checkEnv(res)) return;
  const name = requireUser(req, res);
  if (!name) return;
  if (!pushConfigured()) return res.status(500).json({ error: "Reminders aren't set up on the server yet: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are missing." });
  const sql = await db();
  const body = req.body || {};

  if (req.method === "GET") {
    const endpoint = String(req.query.endpoint || "");
    const [row] = endpoint ? await sql`SELECT prefs FROM push_subs WHERE endpoint = ${endpoint}` : [];
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY, subscribed: !!row, prefs: row ? row.prefs : null });
  }

  if (req.method === "DELETE") {
    await sql`DELETE FROM push_subs WHERE endpoint = ${String(body.endpoint || "")}`;
    return res.status(200).json({ ok: true });
  }

  if (body.test) {
    const [row] = await sql`SELECT sub FROM push_subs WHERE endpoint = ${String(body.endpoint || "")}`;
    if (!row) return res.status(404).json({ error: "This phone isn't signed up for reminders." });
    webpush.setVapidDetails("mailto:yeti-training@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    await webpush.sendNotification(row.sub, JSON.stringify({ title: "Reminders are on", body: "You'll get today's plan every morning." }));
    return res.status(200).json({ ok: true });
  }

  const sub = body.subscription;
  if (!isPlainObject(sub) || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) {
    return res.status(400).json({ error: "Missing push subscription." });
  }
  const prefs = { morning: body.prefs ? body.prefs.morning !== false : true, evening: body.prefs ? body.prefs.evening !== false : true };
  await sql`INSERT INTO push_subs (endpoint, name, sub, prefs) VALUES (${sub.endpoint}, ${name}, ${JSON.stringify(sub)}::jsonb, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET name = EXCLUDED.name, sub = EXCLUDED.sub, prefs = EXCLUDED.prefs`;
  res.status(200).json({ subscribed: true, prefs });
}
