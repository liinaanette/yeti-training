// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, computeWorking, nextAfter, restSuggested, todaySummary, weeklySummary, weeklyText } from "../public/plan.js";

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
