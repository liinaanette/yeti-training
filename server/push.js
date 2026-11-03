import webpush from "web-push";
import { allow, checkEnv, db, isPlainObject, pushConfigured, requireUser } from "./lib.js";
import { qstashReady, siteOrigin } from "./qstash.js";
import { DEFAULT_TIMES, cancelPhone, schedulePhone } from "./reminders.js";
import { isClockTime, isTimeZone } from "./time.js";

// GET: public key (and this phone's settings when ?endpoint= is given)
// POST: save this phone's subscription and settings, or { test: true, endpoint } to send a test.
//   With refresh: true it keeps the phone's saved settings and only updates the subscription
//   (sent when the app opens, and by the service worker when the phone replaces its subscription;
//   oldEndpoint names the one being replaced).
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
    const [row] = endpoint ? await sql`SELECT prefs, scheduled FROM push_subs WHERE endpoint = ${endpoint}` : [];
    const prefs = row ? { morningTime: DEFAULT_TIMES.morning, eveningTime: DEFAULT_TIMES.evening, ...row.prefs } : null;
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY, subscribed: !!row, prefs, scheduled: row ? row.scheduled : null, customTimes: qstashReady() });
  }

  if (req.method === "DELETE") {
    const [row] = await sql`DELETE FROM push_subs WHERE endpoint = ${String(body.endpoint || "")} RETURNING scheduled`;
    if (row) await cancelPhone(row);
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
  let given = body.prefs || {};
  if (body.refresh) {
    const oldEndpoint = typeof body.oldEndpoint === "string" ? body.oldEndpoint : sub.endpoint;
    const [existing] = await sql`SELECT endpoint, prefs, scheduled FROM push_subs WHERE endpoint IN (${sub.endpoint}, ${oldEndpoint}) ORDER BY (endpoint = ${sub.endpoint}) DESC LIMIT 1`;
    given = { ...(existing ? existing.prefs : {}), ...(isTimeZone(given.tz) ? { tz: given.tz } : {}) };
    if (existing && existing.endpoint !== sub.endpoint) {
      await cancelPhone(existing);
      await sql`DELETE FROM push_subs WHERE endpoint = ${existing.endpoint}`;
    }
  }
  const on = key => given[key] !== false;
  const prefs = {
    morning: on("morning"), evening: on("evening"), weekly: on("weekly"),
    morningTime: isClockTime(given.morningTime) ? given.morningTime : DEFAULT_TIMES.morning,
    eveningTime: isClockTime(given.eveningTime) ? given.eveningTime : DEFAULT_TIMES.evening,
    ...(isTimeZone(given.tz) ? { tz: given.tz } : {}),
  };
  const [row] = await sql`INSERT INTO push_subs (endpoint, name, sub, prefs) VALUES (${sub.endpoint}, ${name}, ${JSON.stringify(sub)}::jsonb, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET name = EXCLUDED.name, sub = EXCLUDED.sub, prefs = EXCLUDED.prefs
    RETURNING endpoint, name, prefs, scheduled`;
  // Re-book this phone's reminders now, so a changed time counts from today.
  let scheduled = null;
  if (qstashReady()) {
    const [cfg] = await sql`SELECT data FROM config WHERE id = 'main'`;
    try { scheduled = await schedulePhone(sql, row, cfg ? cfg.data : null, siteOrigin(req)); } catch (err) { console.error("booking reminders failed", err.message); }
  }
  res.status(200).json({ subscribed: true, prefs, scheduled, customTimes: qstashReady() });
}
