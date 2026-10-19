import { allow, checkEnv, db, requireUser } from "./_lib.js";

export default async function handler(req, res) {
  if (!allow(req, res, "GET") || !checkEnv(res) || !requireUser(req, res)) return;
  const sql = await db();
  const [config] = await sql`SELECT data FROM config WHERE id = 'main'`;
  const sessions = await sql`SELECT date, data FROM sessions ORDER BY date`;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    config: config ? config.data : null,
    sessions: sessions.map(r => ({ ...r.data, date: r.date })),
  });
}
