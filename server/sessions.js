import { allow, checkEnv, db, isPlainObject, requireUser } from "./lib.js";

// PATCH merges top-level fields (plan, notes, cues...) into the day's session.
// With create: true, fields already saved by the other person win, so two phones
// opening the same day can't wipe each other's plan or notes.
export default async function handler(req, res) {
  if (!allow(req, res, "PATCH") || !checkEnv(res) || !requireUser(req, res)) return;
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Date must look like 2026-10-19." });
  const patch = req.body && req.body.patch;
  if (!isPlainObject(patch)) return res.status(400).json({ error: "Send the change as { patch: {...} }." });
  delete patch.date;
  delete patch.reps; // reps are saved one by one through /api/reps
  const sql = await db();
  const json = JSON.stringify(patch);
  const [row] = req.body.create
    ? await sql`INSERT INTO sessions (date, data) VALUES (${date}, ${json}::jsonb)
        ON CONFLICT (date) DO UPDATE SET data = EXCLUDED.data || sessions.data, updated_at = now()
        RETURNING date, data`
    : await sql`INSERT INTO sessions (date, data) VALUES (${date}, ${json}::jsonb)
        ON CONFLICT (date) DO UPDATE SET data = sessions.data || EXCLUDED.data, updated_at = now()
        RETURNING date, data`;
  res.status(200).json({ session: { ...row.data, date: row.date } });
}
