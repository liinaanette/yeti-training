import { RESULTS, allow, checkEnv, db, isDate, isPlainObject, requireUser } from "./lib.js";

// One row per rep, so two phones logging at once can never overwrite each other.
// POST { date, reps: [rep, ...] } saves or replaces those reps. DELETE { date, i } removes one.
export default async function handler(req, res) {
  if (!allow(req, res, "POST", "DELETE") || !checkEnv(res)) return;
  const name = requireUser(req, res);
  if (!name) return;
  const body = req.body || {};
  if (!isDate(body.date)) return res.status(400).json({ error: "Date must look like 2026-10-19." });
  const sql = await db();

  if (req.method === "DELETE") {
    const i = Number(body.i);
    if (!Number.isInteger(i) || i < 0) return res.status(400).json({ error: "Which rep? Send its number as i." });
    await sql`DELETE FROM reps WHERE date = ${body.date} AND i = ${i}`;
    return res.status(200).json({ ok: true });
  }

  const reps = Array.isArray(body.reps) ? body.reps : [];
  if (!reps.length || reps.length > 50) return res.status(400).json({ error: "Send between 1 and 50 reps." });
  for (const r of reps) {
    if (!isPlainObject(r) || !Number.isInteger(r.i) || r.i < 0 || !RESULTS.includes(r.result) || !(r.target > 0)) {
      return res.status(400).json({ error: "Each rep needs a number (i), a planned length (target) and a result." });
    }
  }
  for (const r of reps) {
    await sql`INSERT INTO reps (date, i, data) VALUES (${body.date}, ${r.i}, ${JSON.stringify(r)}::jsonb)
      ON CONFLICT (date, i) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }
  res.status(200).json({ ok: true });
}
