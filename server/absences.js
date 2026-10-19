import { allow, checkEnv, db, isDate, isPlainObject, requireUser } from "./lib.js";

// Real absences: times the dog was left alone outside training.
// POST { absence } saves or updates one (by id). DELETE { id } removes one.
export default async function handler(req, res) {
  if (!allow(req, res, "POST", "DELETE") || !checkEnv(res)) return;
  const name = requireUser(req, res);
  if (!name) return;
  const body = req.body || {};
  const sql = await db();

  if (req.method === "DELETE") {
    await sql`DELETE FROM absences WHERE id = ${String(body.id || "")}`;
    return res.status(200).json({ ok: true });
  }

  const a = body.absence;
  if (!isPlainObject(a) || typeof a.id !== "string" || !/^[\w-]{6,64}$/.test(a.id) || !isDate(a.date) || !(a.seconds > 0) || !(a.start > 0)) {
    return res.status(400).json({ error: "An absence needs an id, a date, a start time and how long it was." });
  }
  if (!["calm", "mild", "upset", "unknown"].includes(a.result)) return res.status(400).json({ error: "Say how it went: calm, mild, upset or unknown." });
  const absence = { id: a.id, date: a.date, start: a.start, seconds: Math.round(a.seconds), result: a.result, note: String(a.note || "").slice(0, 500), by: a.by || name };
  await sql`INSERT INTO absences (id, data) VALUES (${absence.id}, ${JSON.stringify(absence)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  res.status(200).json({ absence });
}
