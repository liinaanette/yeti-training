// Training plan logic, shared by the app (browser) and the notification job (server).
// Pure functions: pass in the config, the sessions Map (date -> session) and today's date (YYYY-MM-DD).

// Stage 1 keeps the person inside the flat behind a baby gate; stage 2 is the real front door.
export const STAGES = {
  gate: {
    label: "Behind the gate", defaultStart: 60, goal: 600,
    desc: "Dog stays behind the baby gate, you go out of sight inside the flat.",
    cues: ["Pick up keys", "Open and close the first front door (stay inside)", "Put on shoes", "Rattle the door handle", "Put on jacket", "Close the gate and step straight back", "Grab your bag"],
  },
  door: {
    label: "Front door", defaultStart: 30,
    desc: "You go out through both front doors.",
    cues: ["Pick up keys", "Open and close the first door", "Put on shoes", "Open both doors and close them again", "Put on jacket", "Step into the hallway and come straight back", "Grab your bag"],
  },
};
// Up-and-down rep shapes (fractions of the working duration). The longest rep sits late, an easy rep closes the session.
const PATTERNS = [
  [0.1, 0.3, 0.6, 0.2, 0.8, 0.45, 1, 0.25],
  [0.15, 0.5, 0.25, 0.7, 0.35, 0.9, 1, 0.2],
  [0.1, 0.4, 0.7, 0.3, 1, 0.5, 0.85, 0.15],
];
export const REST_BETWEEN = 90;

// ---------- dates and durations ----------
const pad = n => String(n).padStart(2, "0");
export const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const addDays = (s, n) => new Date((dayNum(s) + n) * 864e5).toISOString().slice(0, 10);

export function fmt(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) { const m = Math.floor(sec / 60), r = sec % 60; return r ? `${m}m ${r}s` : `${m}m`; }
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${pad(m)}m` : `${h}h`;
}
export function roundDur(s) {
  const step = s < 20 ? 1 : s < 60 ? 5 : s < 600 ? 15 : 60;
  return Math.max(2, Math.round(s / step) * step);
}
function grow(w) {
  if (w < 60) return w + Math.max(5, w * 0.25);
  if (w < 600) return w * 1.15;
  if (w < 1800) return w * 1.1;
  return w * 1.07;
}

// ---------- the training logic ----------
export const dogName = config => (config && config.dogName) || "Yeti";
export const doneReps = s => (s.reps || []).filter(r => r.result && r.result !== "skip");
export const curMode = config => (config && config.mode) || "door";
export const sessionMode = s => (s && s.mode) || "door";
export const getBase = (config, mode) => (config.bases && config.bases[mode]) || (mode === "door" ? config.base : null);

// What the next session's working (longest) duration should be after a given session.
export function nextAfter(s, dog) {
  const prev = s.working;
  const done = doneReps(s);
  const upset = done.filter(r => r.result === "upset");
  const mild = done.filter(r => r.result === "mild");
  const calmTop = done.some(r => r.result === "calm" && r.target >= prev * 0.97);
  if (upset.length) {
    const t = Math.min(...upset.map(r => r.actual || r.target));
    return { w: Math.min(prev, t) * 0.6, why: `${dog} got upset last session, so today steps back for an easy win.` };
  }
  if (mild.length) return { w: prev * 0.85, why: "Some mild stress last session, so today is a small step back." };
  if (calmTop) return { w: grow(prev), why: `${dog} stayed calm through the longest rep last time, so today steps up.` };
  return { w: prev, why: "Last session didn't get through the longest rep, so today repeats the same level." };
}

// absences: real times alone outside training ({ date, seconds, result }), oldest first.
export function computeWorking(config, sessions, today, mode = curMode(config), absences = []) {
  const base = getBase(config, mode) || { seconds: STAGES[mode].defaultStart, setOn: today, setAt: 0 };
  const past = [...sessions.values()]
    .filter(s => s.date < today && doneReps(s).length && sessionMode(s) === mode)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const last = past[0];
  if (!last || base.setOn > last.date || (base.setOn === last.date && base.setAt > (last.createdAt || 0))) {
    return { w: roundDur(base.seconds), why: `Starting from the level you set: ${fmt(base.seconds)}.` };
  }
  let { w, why } = nextAfter(last, dogName(config));
  const gap = daysBetween(last.date, today);
  // The longer the break, the further back the next session starts.
  const breakFactor = gap >= 14 ? 0.5 : gap >= 7 ? 0.7 : gap >= 4 ? 0.85 : 1;
  if (breakFactor < 1) { w *= breakFactor; why += ` It's been ${gap} days, so today starts at ${Math.round(breakFactor * 100)}% to warm back up.`; }
  // Struggling when really left alone since the last session also sets things back a bit.
  const rough = absences.filter(a => a.date >= last.date && a.date < today && a.result === "upset");
  if (rough.length) { w *= 0.75; why += ` ${dogName(config)} struggled when left alone on ${shortDay(rough[rough.length - 1].date)}, so it's easier today.`; }
  return { w: roundDur(Math.max(3, w)), why };
}

const shortDay = date => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

export function buildPlan(config, w, date) {
  const cap = ((config && config.capMin) || 30) * 60;
  const p = PATTERNS[((dayNum(date) % 3) + 3) % 3].slice();
  const total = arr => arr.reduce((a, f) => a + f * w, 0) + REST_BETWEEN * (arr.length - 1);
  while (total(p) > cap && p.length > 3) {
    let idx = -1, max = -1;
    p.forEach((f, i) => { if (f < 1 && i !== p.length - 1 && f > max) { max = f; idx = i; } });
    p.splice(idx, 1);
  }
  return p.map(f => roundDur(Math.max(2, f * w)));
}
export const pickCues = (date, mode) => { const c = STAGES[mode].cues, n = dayNum(date); return [c[n % c.length], c[(n + 3) % c.length]]; };

export function restSuggested(config, sessions, today) {
  const per = (config && config.perWeek) || 5;
  let count = 0;
  for (let i = 1; i <= 6; i++) { const s = sessions.get(addDays(today, -i)); if (s && doneReps(s).length) count++; }
  return count >= per;
}
export function weekCount(sessions, today) {
  let c = 0;
  for (let i = 0; i < 7; i++) { const s = sessions.get(addDays(today, -i)); if (s && doneReps(s).length) c++; }
  return c;
}
export function bestCalmEver(sessions, mode) {
  let best = 0;
  for (const s of sessions.values()) if (sessionMode(s) === mode) for (const r of doneReps(s)) if (r.result === "calm") best = Math.max(best, r.actual || r.target);
  return best;
}

// Today's plan in one object, as the Today tab would show it.
export function todaySummary(config, sessions, today, absences = []) {
  const s = sessions.get(today);
  const mode = s ? sessionMode(s) : curMode(config);
  const w = s ? s.working : computeWorking(config, sessions, today, mode, absences).w;
  const plan = s ? s.plan : buildPlan(config, w, today);
  const minutes = Math.round((plan.reduce((a, b) => a + b, 0) + REST_BETWEEN * (plan.length - 1)) / 60);
  return {
    mode, w, plan, minutes,
    rest: !s && restSuggested(config, sessions, today),
    started: !!(s && doneReps(s).length),
  };
}

// The last 7 days, ending today: what the weekly summary notification and card show.
export function weeklySummary(config, sessions, today, absences = []) {
  const from = addDays(today, -6);
  const week = [...sessions.values()].filter(s => s.date >= from && s.date <= today && doneReps(s).length).sort((a, b) => (a.date < b.date ? -1 : 1));
  const reps = week.flatMap(doneReps);
  const calm = reps.filter(r => r.result === "calm");
  const mode = curMode(config);
  const inStage = week.filter(s => sessionMode(s) === mode);
  const prevStage = [...sessions.values()].filter(s => s.date < from && sessionMode(s) === mode && doneReps(s).length).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return {
    from, to: today, mode,
    sessions: week.length,
    reps: reps.length,
    calmPct: reps.length ? Math.round((calm.length / reps.length) * 100) : null,
    bestCalm: calm.length ? Math.max(...calm.map(r => r.actual || r.target)) : 0,
    levelFrom: prevStage ? prevStage.working : inStage.length ? inStage[0].working : null,
    levelTo: inStage.length ? inStage[inStage.length - 1].working : null,
    absences: absences.filter(a => a.date >= from && a.date <= today).length,
  };
}

export function weeklyText(config, w) {
  const dog = dogName(config);
  if (!w.sessions) return { title: `${dog}'s week`, body: "No training sessions this week. Tomorrow is a good day to start again, a little easier." };
  const level = w.levelFrom && w.levelTo
    ? (w.levelTo > w.levelFrom ? ` Longest rep went up from ${fmt(w.levelFrom)} to ${fmt(w.levelTo)}.` : w.levelTo < w.levelFrom ? ` Longest rep is ${fmt(w.levelTo)}, down from ${fmt(w.levelFrom)}. That's normal, progress isn't a straight line.` : ` Longest rep held at ${fmt(w.levelTo)}.`)
    : "";
  return { title: `${dog}'s week`, body: `${w.sessions} session${w.sessions === 1 ? "" : "s"}, ${w.reps} reps, ${w.calmPct}% calm.${level}` };
}
