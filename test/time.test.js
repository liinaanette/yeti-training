// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isClockTime, isTimeZone, localDate, nextLocalTime } from "../server/time.js";

const at = iso => Date.parse(iso);
const iso = ms => new Date(ms).toISOString().slice(0, 16);

test("next 08:30 in Tallinn, winter time (UTC+2)", () => {
  assert.equal(iso(nextLocalTime("08:30", "Europe/Tallinn", at("2026-10-28T00:00Z"))), "2026-10-28T06:30");
  assert.equal(iso(nextLocalTime("08:30", "Europe/Tallinn", at("2026-10-28T07:00Z"))), "2026-10-29T06:30");
});

test("next 08:30 in Tallinn, summer time (UTC+3)", () => {
  assert.equal(iso(nextLocalTime("08:30", "Europe/Tallinn", at("2026-10-24T00:00Z"))), "2026-10-24T05:30");
});

test("the night the clocks go back still lands on 08:30 local", () => {
  assert.equal(iso(nextLocalTime("08:30", "Europe/Tallinn", at("2026-10-25T00:00Z"))), "2026-10-25T06:30");
});

test("zones behind UTC roll to the right day", () => {
  // 00:00 UTC is 20:00 the evening before in New York (summer time until 1 Nov).
  assert.equal(iso(nextLocalTime("19:00", "America/New_York", at("2026-10-28T00:00Z"))), "2026-10-28T23:00");
  assert.equal(iso(nextLocalTime("21:00", "America/New_York", at("2026-10-28T00:00Z"))), "2026-10-28T01:00");
});

test("local dates and input checks", () => {
  assert.equal(localDate("Europe/Tallinn", at("2026-10-27T22:30Z")), "2026-10-28");
  assert.equal(isClockTime("08:30"), true);
  assert.equal(isClockTime("8:30"), false);
  assert.equal(isClockTime("24:00"), false);
  assert.equal(isTimeZone("Europe/Tallinn"), true);
  assert.equal(isTimeZone("Mars/Base"), false);
});
