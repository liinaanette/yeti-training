// Local times in a given IANA time zone, without a date library. Pure functions (tested in test/time.test.js).

const parts = (tz, at) => Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(at)).map(p => [p.type, p.value]),
);

// How far the zone's wall clock is ahead of UTC at a given moment, in ms.
function offsetMs(tz, at) {
  const p = parts(tz, at);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
}

export const isTimeZone = tz => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string" && !!tz; } catch { return false; } };
export const isClockTime = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const localDate = (tz, at = Date.now()) => { const p = parts(tz, at); return `${p.year}-${p.month}-${p.day}`; };
export const localWeekday = (tz, at = Date.now()) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(new Date(at));

// The next moment after `now` when the clock in `tz` shows hh:mm (handles daylight-saving changes).
export function nextLocalTime(hhmm, tz, now = Date.now()) {
  const [h, m] = hhmm.split(":").map(Number);
  const today = parts(tz, now);
  for (let d = 0; d < 3; d++) {
    const wall = Date.UTC(+today.year, +today.month - 1, +today.day + d, h, m);
    const at = wall - offsetMs(tz, wall - offsetMs(tz, wall));
    if (at > now) return at;
  }
  return null;
}
