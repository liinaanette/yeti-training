// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, computeWorking, guideProgress, guideStep, nextAfter, restSuggested, todaySummary, weeklySummary, weeklyText } from "../public/plan.js";

const config = { dogName: "Yeti", mode: "gate", bases: { gate: { seconds: 120, setOn: "2026-10-01", setAt: 1 } }, perWeek: 5, capMin: 30 };
const rep = (i, target, result, actual = target) => ({ i, target, actual, result });
const session = (date, working, reps, mode = "gate") => ({ date, mode, working, reps, createdAt: Date.parse(date) });
const map = list => new Map(list.map(s => [s.date, s]));

test("starts from the level that was set when there's no history", () => {
  assert.equal(computeWorking(config, map([]), "2026-10-19").w, 120);
});

test("all calm through the longest rep steps up about 15%", () => {
  const s = session("2026-10-18", 120, [rep(0, 30, "calm"), rep(1, 120, "calm")]);
  assert.equal(computeWorking(config, map([s]), "2026-10-19").w, 135);
});

test("mild stress steps back about 15%", () => {
  const s = session("2026-10-18", 120, [rep(0, 120, "mild")]);
  assert.equal(computeWorking(config, map([s]), "2026-10-19").w, 105);
});

test("upset drops to 60% of where it went wrong", () => {
  const s = session("2026-10-18", 120, [rep(0, 120, "upset", 50)]);
  assert.equal(nextAfter(s, "Yeti").w, 30);
});

test("not reaching the longest rep repeats the level", () => {
  const s = session("2026-10-18", 120, [rep(0, 30, "calm")]);
  assert.equal(computeWorking(config, map([s]), "2026-10-19").w, 120);
});

test("staying out longer on a calm day is a normal step up, not a jump", () => {
  const s = session("2026-10-18", 120, [rep(0, 30, "calm"), rep(1, 120, "calm", 300)]);
  assert.equal(computeWorking(config, map([s]), "2026-10-19").w, 135);
});

test("mild stress only in extra time holds the level", () => {
  const s = session("2026-10-18", 120, [rep(0, 30, "calm"), rep(1, 120, "mild", 200)]);
  assert.equal(computeWorking(config, map([s]), "2026-10-19").w, 120);
  const planned = session("2026-10-18", 120, [rep(0, 30, "mild"), rep(1, 120, "calm", 200)]);
  assert.equal(computeWorking(config, map([planned]), "2026-10-19").w, 105);
});

test("longer breaks start lower", () => {
  const s = session("2026-10-01", 120, [rep(0, 30, "calm")]);
  assert.equal(computeWorking(config, map([s]), "2026-10-04").w, 120);   // 3 days: no change
  assert.equal(computeWorking(config, map([s]), "2026-10-06").w, 105);   // 5 days: 85%
  assert.equal(computeWorking(config, map([s]), "2026-10-10").w, 90);    // 9 days: 70%
  assert.equal(computeWorking(config, map([s]), "2026-10-20").w, 60);    // 19 days: 50%
});

test("an upset real absence since the last session makes today easier", () => {
  const s = session("2026-10-17", 120, [rep(0, 30, "calm")]);
  const absences = [{ date: "2026-10-18", start: 1, seconds: 7200, result: "upset" }];
  assert.equal(computeWorking(config, map([s]), "2026-10-19", "gate", absences).w, 90);
  assert.equal(computeWorking(config, map([s]), "2026-10-19", "gate", [{ ...absences[0], result: "calm" }]).w, 120);
});

test("each stage keeps its own level", () => {
  const door = session("2026-10-18", 30, [rep(0, 30, "calm")], "door");
  assert.equal(computeWorking(config, map([door]), "2026-10-19", "gate").w, 120);
});

test("a level reset after the last session wins", () => {
  const s = session("2026-10-18", 120, [rep(0, 120, "calm")]);
  const reset = { ...config, bases: { gate: { seconds: 60, setOn: "2026-10-19", setAt: Date.parse("2026-10-19") } } };
  assert.equal(computeWorking(reset, map([s]), "2026-10-19").w, 60);
});

test("plans go up and down, keep the longest rep, and fit the session cap", () => {
  const plan = buildPlan(config, 600, "2026-10-19");
  assert.ok(plan.includes(600));
  assert.notDeepEqual(plan, [...plan].sort((a, b) => a - b));
  const total = plan.reduce((a, b) => a + b, 0) + 90 * (plan.length - 1);
  assert.ok(total <= 30 * 60 || plan.length === 3);
});

test("behind the gate: 3-4 longer reps that still go up and down", () => {
  for (const date of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
    const plan = buildPlan(config, 420, date, "gate");
    assert.ok(plan.length >= 3 && plan.length <= 4, `${date}: ${plan}`);
    assert.ok(plan.includes(420));
    assert.ok(Math.min(...plan) >= 420 * 0.25);
  }
  assert.ok(buildPlan(config, 420, "2026-11-03", "door").length >= 6);
});

test("long gate levels still fit the session cap", () => {
  const plan = buildPlan(config, 1500, "2026-11-03", "gate");
  assert.ok(plan.includes(1500));
  assert.ok(plan.length >= 2);
});

test("suggests a rest day after the weekly number of sessions", () => {
  const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
  const sessions = map(days.map(d => session(d, 120, [rep(0, 30, "calm")])));
  assert.equal(restSuggested(config, sessions, "2026-10-19"), true);
  assert.equal(restSuggested({ ...config, perWeek: 6 }, sessions, "2026-10-19"), false);
  assert.equal(todaySummary(config, sessions, "2026-10-19").rest, true);
});

test("skipped reps don't count as done", () => {
  const s = session("2026-10-18", 120, [rep(0, 120, "skip", 0)]);
  assert.equal(restSuggested({ ...config, perWeek: 1 }, map([s]), "2026-10-19"), false);
});

test("weekly summary counts the last 7 days", () => {
  const sessions = map([
    session("2026-10-10", 90, [rep(0, 90, "calm")]),
    session("2026-10-14", 105, [rep(0, 105, "calm"), rep(1, 30, "mild")]),
    session("2026-10-18", 120, [rep(0, 120, "calm")]),
  ]);
  const w = weeklySummary(config, sessions, "2026-10-19");
  assert.equal(w.sessions, 2);
  assert.equal(w.reps, 3);
  assert.equal(w.calmPct, 67);
  assert.equal(w.levelFrom, 90);
  assert.equal(w.levelTo, 120);
  assert.match(weeklyText(config, w).body, /went up from 1m 30s to 2m/);
});

test("guide step follows the stage and setup unless chosen", () => {
  assert.equal(guideStep({ mode: "gate" }), 0);
  assert.equal(guideStep({ mode: "door", lastSetup: "gate" }), 1);
  assert.equal(guideStep({ mode: "door", lastSetup: "free" }), 2);
  assert.equal(guideStep({ mode: "door", lastSetup: "free", guideStep: 3 }), 3);
});

test("gate step is ready after 20 calm minutes, 3 calm sessions in a row and cues ignored", () => {
  const gate = (date, res, actual) => ({ ...session(date, 600, [rep(0, 600, res, actual)]), setup: "gate" });
  let sessions = map([gate("2026-10-20", "calm", 540), gate("2026-10-21", "mild", 600), gate("2026-10-22", "calm", 600), gate("2026-10-23", "calm", 1300)]);
  let g = guideProgress(config, sessions);
  assert.equal(g.step, 0);
  assert.deepEqual(g.checks.map(c => c.done), [true, false, false]);   // 21m 40s best, only 2 calm in a row, cues not ticked
  assert.equal(g.checks[1].inRow, 2);
  sessions = map([...sessions.values(), gate("2026-10-24", "calm", 600)]);
  g = guideProgress({ ...config, guideChecks: { "gate:cues": true } }, sessions);
  assert.equal(g.ready, true);
});

test("door step only counts door reps with the dog behind the gate", () => {
  const door = (date, setup, actual) => ({ ...session(date, 1800, [rep(0, 1800, "calm", actual)], "door"), setup });
  const g = guideProgress({ ...config, mode: "door", lastSetup: "gate" }, map([door("2026-10-20", "free", 2000), door("2026-10-21", "gate", 900)]));
  assert.equal(g.step, 1);
  assert.equal(g.checks[0].best, 900);
  assert.equal(g.stats.sessions, 1);
});
