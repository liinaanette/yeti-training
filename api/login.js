import { allow, checkEnv, passwordMatches, setSession } from "./_lib.js";

export default function handler(req, res) {
  if (!allow(req, res, "POST") || !checkEnv(res)) return;
  const name = String((req.body && req.body.name) || "").trim().slice(0, 40);
  const password = String((req.body && req.body.password) || "");
  if (!name) return res.status(400).json({ error: "Type your name." });
  if (!passwordMatches(password)) return res.status(401).json({ error: "That password isn't right." });
  setSession(res, name);
  res.status(200).json({ name });
}
