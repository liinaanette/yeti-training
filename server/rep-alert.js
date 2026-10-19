import { allow, checkEnv, db, requireUser } from "./lib.js";

// Schedules (POST) or cancels (DELETE) the "time's up" push for a running rep, using Upstash QStash
// as the delayed scheduler. QStash calls api/rep-alert-fire at the end time, which sends the push.
// Without QStash configured, POST answers { scheduled: false } and the app still shows the start notification.
const qstashUrl = () => (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");

export default async function handler(req, res) {
  if (!allow(req, res, "POST", "DELETE") || !checkEnv(res) || !requireUser(req, res)) return;
  if (!process.env.QSTASH_TOKEN) return res.status(200).json({ scheduled: false });
  const body = req.body || {};
  const auth = { Authorization: `Bearer ${process.env.QSTASH_TOKEN}` };

  if (req.method === "DELETE") {
    const id = String(body.messageId || "");
    if (/^[\w:-]{1,200}$/.test(id)) await fetch(`${qstashUrl()}/v2/messages/${encodeURIComponent(id)}`, { method: "DELETE", headers: auth }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  const endsAt = Number(body.endsAt);
  if (!(endsAt > Date.now() - 5000) || endsAt > Date.now() + 6 * 3600e3) return res.status(400).json({ error: "The rep's end time looks wrong." });
  const sql = await db();
  const [sub] = await sql`SELECT endpoint FROM push_subs WHERE endpoint = ${String(body.endpoint || "")}`;
  if (!sub) return res.status(200).json({ scheduled: false });

  const destination = `https://${req.headers["x-forwarded-host"] || req.headers.host}/api/rep-alert-fire`;
  const message = JSON.stringify({ endpoint: sub.endpoint, title: String(body.title || "Time's up").slice(0, 80), body: String(body.body || "").slice(0, 200) });
  const r = await fetch(`${qstashUrl()}/v2/publish/${destination}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "Upstash-Not-Before": String(Math.ceil(endsAt / 1000)), "Upstash-Retries": "1" },
    body: message,
  });
  if (!r.ok) {
    console.error("qstash publish failed", r.status, await r.text().catch(() => ""));
    return res.status(200).json({ scheduled: false });
  }
  const { messageId } = await r.json();
  res.status(200).json({ scheduled: true, messageId });
}
