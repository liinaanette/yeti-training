import { allow, checkEnv, db, loadAll, requireUser } from "./lib.js";

export default async function handler(req, res) {
  if (!allow(req, res, "GET") || !checkEnv(res) || !requireUser(req, res)) return;
  const sql = await db();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(await loadAll(sql));
}
