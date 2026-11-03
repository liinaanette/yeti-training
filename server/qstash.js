import crypto from "node:crypto";
import { safeEqual } from "./lib.js";

// Upstash QStash: delivers a request to one of our URLs at a set time. Used for the "time's up"
// alert at the end of a rep and for daily reminders at each phone's chosen time.
export const qstashReady = () => !!process.env.QSTASH_TOKEN;
const base = () => (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
const auth = () => ({ Authorization: `Bearer ${process.env.QSTASH_TOKEN}` });

// The app's main public address, for QStash to call back. Vercel sets VERCEL_PROJECT_PRODUCTION_URL;
// using it (rather than the host a request came in on) avoids per-deployment addresses that may be protected.
export const siteOrigin = req => `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers["x-forwarded-host"] || req.headers.host}`;

// Schedules a POST of `body` (JSON) to `url` at `at` (ms). Returns the QStash message id.
export async function publish(url, body, { at, dedupeId } = {}) {
  const headers = { ...auth(), "Content-Type": "application/json", "Upstash-Retries": "1" };
  if (at) headers["Upstash-Not-Before"] = String(Math.max(Math.floor(Date.now() / 1000), Math.floor(at / 1000)));
  if (dedupeId) headers["Upstash-Deduplication-Id"] = dedupeId;
  const r = await fetch(`${base()}/v2/publish/${url}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`QStash publish failed (${r.status}): ${await r.text().catch(() => "")}`);
  return (await r.json()).messageId;
}

export async function cancel(messageId) {
  if (!messageId || !/^[\w:-]{1,200}$/.test(messageId)) return;
  await fetch(`${base()}/v2/messages/${encodeURIComponent(messageId)}`, { method: "DELETE", headers: auth() }).catch(() => {});
}

// True only for requests signed by QStash (JWT in the Upstash-Signature header, over the raw body).
export function verify(token, rawBody) {
  const [h, p, sig] = String(token || "").split(".");
  if (!h || !p || !sig) return false;
  for (const key of [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean)) {
    if (!safeEqual(sig, crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url"))) continue;
    let claims;
    try { claims = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return false; }
    const now = Date.now() / 1000;
    if (claims.iss !== "Upstash" || !(claims.exp > now) || claims.nbf > now + 5) return false;
    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("base64url");
    return String(claims.body || "").replace(/=+$/, "") === bodyHash;
  }
  return false;
}

export async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  if (chunks.length) return Buffer.concat(chunks).toString();
  return req.body ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : "";
}
