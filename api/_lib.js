import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const COOKIE = "yeti_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

let sql = null;
let ready = null;

// Vercel's Neon integration sets both; either works.
const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Returns the Neon query function once the tables exist. Tables are created on first use.
export async function db() {
  if (!sql) sql = neon(databaseUrl());
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS config (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS push_subs (
        endpoint text PRIMARY KEY,
        name text NOT NULL,
        sub jsonb NOT NULL,
        prefs jsonb NOT NULL DEFAULT '{"morning": true, "evening": true}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        date text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch(err => {
      ready = null;
      throw err;
    });
  }
  await ready;
  return sql;
}

export function checkEnv(res) {
  const missing = ["APP_PASSWORD", "SESSION_SECRET"].filter(k => !process.env[k]);
  if (!databaseUrl()) missing.unshift("DATABASE_URL");
  if (missing.length) {
    res.status(500).json({ error: `Missing environment variables: ${missing.join(", ")}` });
    return false;
  }
  return true;
}

const sign = value => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const passwordMatches = given => safeEqual(given, process.env.APP_PASSWORD);

export function setSession(res, name) {
  const value = Buffer.from(JSON.stringify({ name, t: Date.now() })).toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_YEAR}`);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function getUser(req) {
  const match = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [value, sig] = match[1].split(".");
  if (!value || !sig || !safeEqual(sig, sign(value))) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString()).name || null;
  } catch {
    return null;
  }
}

export function requireUser(req, res) {
  const name = getUser(req);
  if (!name) res.status(401).json({ error: "Not logged in" });
  return name;
}

export function allow(req, res, ...methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  res.status(405).json({ error: `Use ${methods.join(" or ")}` });
  return false;
}

export const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
