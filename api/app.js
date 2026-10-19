// The one serverless function behind every /api/* address (Vercel's free plan allows 12 per deployment).
// vercel.json rewrites /api/<route> here as ?route=<route>; the handlers live in server/.
// The daily reminder jobs (vercel.json "crons") come in the same way.
import absences from "../server/absences.js";
import config from "../server/config.js";
import { runReminders } from "../server/cron.js";
import exportCsv from "../server/export.js";
import login from "../server/login.js";
import logout from "../server/logout.js";
import me from "../server/me.js";
import push from "../server/push.js";
import repAlert from "../server/rep-alert.js";
import repAlertFire from "../server/rep-alert-fire.js";
import reps from "../server/reps.js";
import sessions from "../server/sessions.js";
import state from "../server/state.js";

const routes = {
  absences, config, export: exportCsv, login, logout, me, push, "rep-alert": repAlert, "rep-alert-fire": repAlertFire, reps, state,
  "cron-morning": (req, res) => runReminders("morning", req, res),
  "cron-evening": (req, res) => runReminders("evening", req, res),
};

export default async function handler(req, res) {
  const route = String(req.query.route || new URL(req.url, "http://x").pathname.replace(/^\/api\//, "")).replace(/^\/+|\/+$/g, "");
  if (route.startsWith("sessions/")) {
    req.query.date = route.slice("sessions/".length);
    return sessions(req, res);
  }
  const fn = routes[route];
  if (!fn) return res.status(404).json({ error: "Not found" });
  return fn(req, res);
}
