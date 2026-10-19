import { allow, checkEnv, db, passwordMatches, setSession } from "./lib.js";

const MAX_FAILS = 10;      // wrong passwords allowed...
const WINDOW_MIN = 15;     // ...per this many minutes, per network address

export default async function handler(req, res) {
  if (!allow(req, res, "POST") || !checkEnv(res)) return;
  const name = String((req.body && req.body.name) || "").trim().slice(0, 40);
  const password = String((req.body && req.body.password) || "");
  if (!name) return res.status(400).json({ error: "Type your name." });

  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown").split(",")[0].trim();
  const sql = await db();
  const [{ fails }] = await sql`SELECT count(*)::int AS fails FROM login_attempts WHERE ip = ${ip} AND at > now() - make_interval(mins => ${WINDOW_MIN})`;
  if (fails >= MAX_FAILS) return res.status(429).json({ error: `Too many wrong passwords. Wait ${WINDOW_MIN} minutes and try again.` });

  if (!passwordMatches(password)) {
    await sql`INSERT INTO login_attempts (ip) VALUES (${ip})`;
    await sql`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`;
    return res.status(401).json({ error: "That password isn't right." });
  }
  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
  setSession(res, name);
  res.status(200).json({ name });
}
