import { allow, checkEnv, db, requireUser } from "./_lib.js";

// Every rep as one row, for Excel or Google Sheets. Times are in the household's time zone.
export default async function handler(req, res) {
  if (!allow(req, res, "GET") || !checkEnv(res) || !requireUser(req, res)) return;
  const sql = await db();
  const [cfgRow] = await sql`SELECT data FROM config WHERE id = 'main'`;
  const tz = (cfgRow && cfgRow.data.tz) || "UTC";
  const rows = await sql`SELECT date, data FROM sessions ORDER BY date`;

  const local = ts => {
    if (!ts) return "";
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return `${p.hour}:${p.minute}`;
  };
  const hour = ts => (ts ? +local(ts).slice(0, 2) : null);
  const partOfDay = h => (h == null ? "" : h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night");
  const cell = v => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };

  const header = ["date", "weekday", "stage", "rep", "planned_seconds", "actual_seconds", "result", "trainer", "started", "finished", "time_of_day", "session_longest_seconds", "cues_done", "rep_note", "session_notes"];
  const lines = [header.join(",")];
  for (const { date, data: s } of rows) {
    const weekday = new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const reps = (s.reps || []).filter(r => r.result).sort((a, b) => a.i - b.i);
    reps.forEach((r, n) => {
      lines.push([
        date, weekday, s.mode || "door", r.i + 1, r.target, r.result === "skip" ? "" : r.actual, r.result, r.by || "",
        local(r.startedAt), local(r.at), partOfDay(hour(r.at)), s.working, s.cuesDone ? "yes" : "no", r.note || "", n === 0 ? s.notes || "" : "",
      ].map(cell).join(","));
    });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="yeti-training-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("﻿" + lines.join("\n"));
}
