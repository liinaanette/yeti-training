import webpush from "web-push";
import { db, pushConfigured } from "./_lib.js";
import { STAGES, dogName, fmt, todaySummary } from "../public/plan.js";

// Shared by api/cron-morning.js and api/cron-evening.js, which Vercel Cron calls (see vercel.json).
export async function runReminders(kind, req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Not allowed" });
  }
  if (!pushConfigured()) return res.status(200).json({ skipped: "push not configured" });
  const sql = await db();
  const [cfgRow] = await sql`SELECT data FROM config WHERE id = 'main'`;
  if (!cfgRow) return res.status(200).json({ skipped: "no plan set up yet" });
  const config = cfgRow.data;
  const rows = await sql`SELECT date, data FROM sessions`;
  const sessions = new Map(rows.map(r => [r.date, { ...r.data, date: r.date }]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const message = buildMessage(kind, config, todaySummary(config, sessions, today));
  if (!message) return res.status(200).json({ skipped: "nothing to remind about" });

  webpush.setVapidDetails("mailto:yeti-training@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const subs = await sql`SELECT endpoint, sub, prefs FROM push_subs`;
  let sent = 0;
  for (const s of subs) {
    if (s.prefs && s.prefs[kind] === false) continue;
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(message));
      sent++;
    } catch (err) {
      // The phone unsubscribed or the app was removed: forget it.
      if (err.statusCode === 404 || err.statusCode === 410) await sql`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`;
      else console.error("push failed", err.statusCode, err.body);
    }
  }
  res.status(200).json({ kind, today, sent });
}

function buildMessage(kind, config, t) {
  const dog = dogName(config);
  const stage = STAGES[t.mode].label.toLowerCase();
  if (t.started) return null;
  if (t.rest) {
    return kind === "morning"
      ? { title: `Rest day for ${dog}`, body: `${dog} has trained a lot this week. Keep any time alone today under ${fmt(t.w)}.` }
      : null;
  }
  if (kind === "morning") {
    return { title: `${dog}'s plan today`, body: `${t.plan.length} reps, longest ${fmt(t.w)} (${stage}). About ${t.minutes} min.` };
  }
  return { title: `No session yet today`, body: `${dog}'s ${t.plan.length} reps are waiting: longest ${fmt(t.w)}, about ${t.minutes} min.` };
}
