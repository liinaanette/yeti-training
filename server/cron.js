import webpush from "web-push";
import { db, loadAll, pushConfigured } from "./lib.js";
import { STAGES, dogName, fmt, todaySummary, weeklySummary, weeklyText } from "../public/plan.js";

// The daily reminder jobs. Vercel Cron calls /api/cron-morning and /api/cron-evening (see vercel.json and api/app.js).
// Every run writes one "reminders ..." line to the Vercel logs, so a missing notification can be traced.
export async function runReminders(kind, req, res) {
  const done = (status, result) => {
    (status === 200 ? console.log : console.error)(`reminders ${kind}`, JSON.stringify(result));
    return res.status(status).json(result);
  };
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return done(401, { error: "Not allowed (CRON_SECRET missing or doesn't match)" });
  }
  if (!pushConfigured()) return done(200, { skipped: "push not configured" });
  const sql = await db();
  const all = await loadAll(sql);
  if (!all.config) return done(200, { skipped: "no plan set up yet" });
  const config = all.config;
  const sessions = new Map(all.sessions.map(x => [x.date, x]));
  const tz = config.tz || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(new Date());

  // Each entry: [preference key, message]. Sunday evenings also carry the weekly summary.
  const messages = [];
  const daily = buildMessage(kind, config, todaySummary(config, sessions, today, all.absences));
  if (daily) messages.push([kind, daily]);
  if (kind === "evening" && weekday === "Sun") messages.push(["weekly", { ...weeklyText(config, weeklySummary(config, sessions, today, all.absences)), url: "/#history", tag: "weekly" }]);
  if (!messages.length) return done(200, { skipped: "nothing to remind about", today });

  webpush.setVapidDetails("mailto:yeti-training@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const subs = await sql`SELECT endpoint, name, sub, prefs FROM push_subs`;
  let sent = 0;
  const report = [];
  for (const s of subs) {
    for (const [pref, message] of messages) {
      if (s.prefs && s.prefs[pref] === false) { report.push(`${s.name}: ${pref} off`); continue; }
      try {
        await webpush.sendNotification(s.sub, JSON.stringify(message), { urgency: "high", TTL: 4 * 3600 });
        sent++;
        report.push(`${s.name}: ${pref} sent`);
      } catch (err) {
        // The phone unsubscribed or the app was removed: forget it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sql`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`;
          report.push(`${s.name}: phone no longer signed up, removed`);
          break;
        }
        report.push(`${s.name}: ${pref} failed (${err.statusCode || err.message})`);
      }
    }
  }
  done(200, { today, phones: subs.length, sent, report });
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
