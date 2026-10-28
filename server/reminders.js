import crypto from "node:crypto";
import webpush from "web-push";
import { db, loadAll, pushConfigured } from "./lib.js";
import { cancel, publish, qstashReady, readRaw, siteOrigin, verify } from "./qstash.js";
import { isTimeZone, localDate, localWeekday, nextLocalTime } from "./time.js";
import { STAGES, dogName, fmt, todaySummary, weeklySummary, weeklyText } from "../public/plan.js";

// Daily reminders. Each phone picks its own morning and evening time (push_subs.prefs).
// With QStash: /api/cron-daily (just after midnight UTC) books each phone's next morning and evening
// reminder at its own time; QStash then calls /api/reminder-fire, which builds the message right then.
// Without QStash: /api/cron-evening sends the evening reminder to everyone at a fixed time (vercel.json).
// Every run writes one "reminders ..." line to the Vercel logs, so a missing notification can be traced.

export const DEFAULT_TIMES = { morning: "08:30", evening: "19:00" };
const KINDS = ["morning", "evening"];
const tzOf = (prefs, config) => (prefs && isTimeZone(prefs.tz) ? prefs.tz : (config && config.tz) || "UTC");
const timeOf = (prefs, kind) => (prefs && prefs[kind + "Time"]) || DEFAULT_TIMES[kind];

function cronAllowed(req) {
  return process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}
const logged = (res, label, status, result) => {
  (status === 200 ? console.log : console.error)(`reminders ${label}`, JSON.stringify(result));
  return res.status(status).json(result);
};

// The messages for one phone at one moment: [preference key, message] pairs.
function messagesFor(kind, all, prefs) {
  const config = all.config;
  const tz = tzOf(prefs, config);
  const today = localDate(tz);
  const sessions = new Map(all.sessions.map(x => [x.date, x]));
  const out = [];
  if (prefs[kind] !== false) {
    const daily = dailyMessage(kind, config, todaySummary(config, sessions, today, all.absences));
    if (daily) out.push([kind, daily]);
  }
  if (kind === "evening" && localWeekday(tz) === "Sun" && prefs.weekly !== false) {
    out.push(["weekly", { ...weeklyText(config, weeklySummary(config, sessions, today, all.absences)), url: "/#history", tag: "weekly" }]);
  }
  return out;
}

function dailyMessage(kind, config, t) {
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

// Sends to one phone; returns report lines. Forgets phones that have unsubscribed.
async function sendTo(sql, s, messages) {
  webpush.setVapidDetails("mailto:yeti-training@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const report = [];
  for (const [pref, message] of messages) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(message), { urgency: "high", TTL: 4 * 3600 });
      report.push(`${s.name}: ${pref} sent`);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sql`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`;
        report.push(`${s.name}: phone no longer signed up, removed`);
        break;
      }
      report.push(`${s.name}: ${pref} failed (${err.statusCode || err.message})`);
    }
  }
  return report;
}

// Books this phone's next morning and evening reminders, replacing any not yet sent.
export async function schedulePhone(sql, s, config, origin, now = Date.now()) {
  if (!qstashReady()) return null;
  const prefs = s.prefs || {};
  const tz = tzOf(prefs, config);
  const prev = s.scheduled || {};
  const next = {};
  const id = crypto.createHash("sha256").update(s.endpoint).digest("hex").slice(0, 16);
  for (const kind of KINDS) {
    if (prev[kind] && prev[kind].at > now) await cancel(prev[kind].id);
    const wanted = kind === "morning" ? prefs.morning !== false : prefs.evening !== false || prefs.weekly !== false;
    if (!wanted) continue;
    const at = nextLocalTime(timeOf(prefs, kind), tz, now);
    if (!at) continue;
    const messageId = await publish(`${origin}/api/reminder-fire`, { endpoint: s.endpoint, kind, at }, { at, dedupeId: `${kind}-${id}-${at}` });
    next[kind] = { id: messageId, at, local: `${localDate(tz, at)} ${timeOf(prefs, kind)} ${tz}` };
  }
  await sql`UPDATE push_subs SET scheduled = ${JSON.stringify(next)}::jsonb WHERE endpoint = ${s.endpoint}`;
  return next;
}

export async function cancelPhone(s) {
  for (const k of KINDS) if (s.scheduled && s.scheduled[k] && s.scheduled[k].at > Date.now()) await cancel(s.scheduled[k].id);
}

// /api/cron-daily: book everyone's reminders for the coming day.
export async function cronDaily(req, res) {
  if (!cronAllowed(req)) return logged(res, "daily", 401, { error: "Not allowed (CRON_SECRET missing or doesn't match)" });
  if (!pushConfigured()) return logged(res, "daily", 200, { skipped: "push not configured" });
  if (!qstashReady()) return logged(res, "daily", 200, { skipped: "QStash not set up: only the fixed-time evening reminder runs" });
  const sql = await db();
  const all = await loadAll(sql);
  if (!all.config) return logged(res, "daily", 200, { skipped: "no plan set up yet" });
  const subs = await sql`SELECT endpoint, name, prefs, scheduled FROM push_subs`;
  const report = [];
  for (const s of subs) {
    try {
      const next = await schedulePhone(sql, s, all.config, siteOrigin(req));
      report.push(`${s.name}: ${Object.values(next).map(x => x.local).join(", ") || "nothing on"}`);
    } catch (err) {
      report.push(`${s.name}: booking failed (${err.message})`);
    }
  }
  logged(res, "daily", 200, { phones: subs.length, report });
}

// /api/cron-evening: the fixed-time fallback when QStash isn't set up.
export async function cronEvening(req, res) {
  if (!cronAllowed(req)) return logged(res, "evening", 401, { error: "Not allowed (CRON_SECRET missing or doesn't match)" });
  if (qstashReady()) return logged(res, "evening", 200, { skipped: "QStash books reminders at each phone's own time" });
  if (!pushConfigured()) return logged(res, "evening", 200, { skipped: "push not configured" });
  const sql = await db();
  const all = await loadAll(sql);
  if (!all.config) return logged(res, "evening", 200, { skipped: "no plan set up yet" });
  const subs = await sql`SELECT endpoint, name, sub, prefs FROM push_subs`;
  const report = [];
  for (const s of subs) report.push(...(await sendTo(sql, s, messagesFor("evening", all, s.prefs || {}))));
  logged(res, "evening", 200, { phones: subs.length, report });
}

// /api/reminder-fire: QStash calls this at a phone's reminder time. Only QStash-signed requests count.
export async function reminderFire(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const raw = await readRaw(req);
  if (!verify(req.headers["upstash-signature"], raw)) return logged(res, "fire", 401, { error: "Not allowed" });
  const { endpoint, kind } = JSON.parse(raw);
  if (!KINDS.includes(kind)) return logged(res, "fire", 400, { error: "Unknown reminder" });
  if (!pushConfigured()) return logged(res, "fire", 200, { skipped: "push not configured" });
  const sql = await db();
  const [s] = await sql`SELECT endpoint, name, sub, prefs FROM push_subs WHERE endpoint = ${String(endpoint || "")}`;
  if (!s) return logged(res, kind, 200, { skipped: "phone not signed up" });
  const all = await loadAll(sql);
  if (!all.config) return logged(res, kind, 200, { skipped: "no plan set up yet" });
  const messages = messagesFor(kind, all, s.prefs || {});
  if (!messages.length) return logged(res, kind, 200, { skipped: `${s.name}: nothing to remind about` });
  logged(res, kind, 200, { report: await sendTo(sql, s, messages) });
}
