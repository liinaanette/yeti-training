import { allow, checkEnv, requireUser } from "./lib.js";

export default function handler(req, res) {
  if (!allow(req, res, "GET") || !checkEnv(res)) return;
  const name = requireUser(req, res);
  if (name) res.status(200).json({ name });
}
