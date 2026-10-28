import { allow, checkEnv, db, requireUser } from "./lib.js";
import { cancel, publish, qstashReady, siteOrigin } from "./qstash.js";

// Schedules (POST) or cancels (DELETE) the "time's up" push for a running rep. QStash calls
// /api/rep-alert-fire at the end time, which sends the push. Without QStash, POST answers { scheduled: false }.
// Delivery (QStash, a cold start, Apple/Google push) usually takes a few seconds, so ask for it early.
const LEAD_MS = 3000;

export default async function handler(req, res) {
  if (!allow(req, res, "POST", "DELETE") || !checkEnv(res) || !requireUser(req, res)) return;
  if (!qstashReady()) return res.status(200).json({ scheduled: false });
  const body = req.body || {};

  if (req.method === "DELETE") {
    await cancel(String(body.messageId || ""));
    return res.status(200).json({ ok: true });
  }

  const endsAt = Number(body.endsAt);
  if (!(endsAt > Date.now() - 5000) || endsAt > Date.now() + 6 * 3600e3) return res.status(400).json({ error: "The rep's end time looks wrong." });
  const sql = await db();
  const [sub] = await sql`SELECT endpoint FROM push_subs WHERE endpoint = ${String(body.endpoint || "")}`;
  if (!sub) return res.status(200).json({ scheduled: false });
  try {
    const messageId = await publish(`${siteOrigin(req)}/api/rep-alert-fire`,
      { endpoint: sub.endpoint, title: String(body.title || "Time's up").slice(0, 80), body: String(body.body || "").slice(0, 200) },
      { at: endsAt - LEAD_MS });
    res.status(200).json({ scheduled: true, messageId });
  } catch (err) {
    console.error(err.message);
    res.status(200).json({ scheduled: false });
  }
}
