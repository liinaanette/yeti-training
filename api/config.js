import { allow, checkEnv, db, isPlainObject, requireUser } from "./_lib.js";

export default async function handler(req, res) {
  if (!allow(req, res, "PUT") || !checkEnv(res) || !requireUser(req, res)) return;
  const data = req.body && req.body.data;
  if (!isPlainObject(data)) return res.status(400).json({ error: "Send the settings as { data: {...} }." });
  const sql = await db();
  await sql`INSERT INTO config (id, data) VALUES ('main', ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  res.status(200).json({ config: data });
}
