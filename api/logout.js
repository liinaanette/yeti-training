import { allow, clearSession } from "./_lib.js";

export default function handler(req, res) {
  if (!allow(req, res, "POST")) return;
  clearSession(res);
  res.status(200).json({ ok: true });
}
