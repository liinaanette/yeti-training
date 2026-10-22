import { allow, checkEnv, db, loadAll, requireUser } from "./lib.js";

// Every rep (and every real absence) as one row, for Excel or Google Sheets.
// Times are in the household's time zone.
export default async function handler(req, res) {
  if (!allow(req, res, "GET") || !checkEnv(res) || !requireUser(req, res)) return;
  const sql = await db();
  const all = await loadAll(sql);
  const tz = (all.config && all.config.tz) || "UTC";

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

  const weekdayOf = date => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const header = ["type", "date", "weekday", "stage", "rep", "planned_seconds", "actual_seconds", "result", "tags", "trainer", "started", "finished", "time_of_day", "session_longest_seconds", "cues_done", "rep_note", "session_notes"];
  const lines = [header.join(",")];
  const out = [];
  for (const s of all.sessions) {
    const reps = (s.reps || []).filter(r => r.result).sort((a, b) => a.i - b.i);
    reps.forEach((r, n) => {
      out.push([r.at || 0, [
        "rep", s.date, weekdayOf(s.date), s.mode || "door", r.i + 1, r.target, r.result === "skip" ? "" : r.actual, r.result, (r.tags || []).join("; "), r.by || "",
        local(r.startedAt), local(r.at), partOfDay(hour(r.at)), s.working, s.cuesDone ? "yes" : "no", r.note || "", n === 0 ? s.notes || "" : "",
      ]]);
    });
  }
  for (const a of all.absences) {
    out.push([a.start, [
      "absence", a.date, weekdayOf(a.date), "", "", "", a.seconds, a.result, (a.tags || []).join("; "), a.by || "",
      local(a.start), local(a.start + a.seconds * 1000), partOfDay(hour(a.start)), "", "", a.note || "", "",
    ]]);
  }
  out.sort((x, y) => x[0] - y[0]).forEach(([, row]) => lines.push(row.map(cell).join(",")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="yeti-training-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("﻿" + lines.join("\n"));
}
