# Yeti Alone-Time Training

A phone-first web app two people (the dog's owners) use to run separation-anxiety training for their dog, Yeti: a daily plan of alone-time reps with a timer, shared history, reminders, and a report for their behaviourist. Deployed on Vercel with a Neon Postgres database. See README.md for deploy steps and environment variables.

## Layout

- `public/index.html` – the whole app UI: one page, vanilla JS in a `<script type="module">`, CSS tokens at the top (light + dark). No build step, no framework.
- `public/plan.js` – **the training logic** (pure functions). Shared by the browser and the server reminder job. Change training rules here and only here.
- `public/sw.js` – service worker that shows push notifications.
- `public/vendor/` – html2canvas 1.4.1 and jsPDF 2.5.1, loaded only when exporting the report.
- `api/app.js` – the **only** serverless function. `vercel.json` rewrites every `/api/<route>` to it as `?route=<route>`, and it dispatches to a handler in `server/`. Vercel's Hobby plan allows at most 12 functions per deployment, so never add files to `api/`: add a handler in `server/` and register it in the `routes` map in `api/app.js`.
- `server/lib.js` – DB connection, table creation/migrations, auth cookie helpers, `loadAll()`.
- `server/cron.js` – daily reminder jobs, reached as `/api/cron-morning` and `/api/cron-evening` (schedules in `vercel.json`, UTC). Sunday evening also sends the weekly summary.
- `server/rep-alert.js` + `server/rep-alert-fire.js` – "time's up" push at the end of a rep, scheduled through Upstash QStash (optional; needs `QSTASH_*` env). The fire endpoint only accepts QStash-signed requests.
- `test/plan.test.js` – unit tests for `plan.js`. Run `npm test`.

## Data model (Postgres, created automatically on first request)

- `config` (one row, id `main`): dog name, stage (`mode`: `gate` | `door`), per-stage starting levels (`bases`), sessions per week, session cap, time zone.
- `sessions` (one row per local date `YYYY-MM-DD`): stage, working (longest rep) seconds, plan (array of rep seconds), cues, notes.
- `reps` (one row per rep, key `date + i`): target, actual, result (`calm` | `mild` | `upset` | `skip`), `tags` (labels picked after the result; lists in `TAGS` in index.html, the owners' own in `config.customTags`), trainer name, `startedAt`/`at` timestamps. Kept separate from sessions so two phones can't overwrite each other.
- `absences`: real times alone outside training.
- `push_subs`: one row per phone with notification preferences (`morning`, `evening`, `weekly`).
- `login_attempts`: wrong-password limiter (10 per 15 min per IP).

Sessions PATCH (`server/sessions.js`, at `/api/sessions/<date>`) merges top-level fields; with `create: true` existing fields win. Never put reps back into the session document.

## Training rules (plan.js)

Each session has a "longest rep" (working level) and an up-and-down plan of shorter reps around it.
- All calm through the longest rep → next ×1.15 (or +5s under a minute). Mild stress → ×0.85. Upset → 60% of where it went wrong. Didn't reach the longest rep → same level.
- The rep timer keeps counting past the planned time ("extra time") until "I'm back", so `actual` can exceed `target`. Extra time never makes the step bigger; mild stress that only happened in extra time (with the longest rep reached) holds the level.
- Breaks: 4–6 days ×0.85, 7–13 ×0.7, 14+ ×0.5. An upset real absence since the last session ×0.75.
- Each stage (`gate`, `door`) has its own level and history. A manual level reset (`bases[mode]`) after the last session wins.
- Rest day suggested after `perWeek` sessions in the previous 6 days.

If you change a rule, update `test/plan.test.js`, the "How the plan works" text in Settings, and the method note in the report.

## Running locally

There's no local dev server in the repo. `vercel dev` works if the Vercel CLI is linked to the project; otherwise point `DATABASE_URL` at a Neon branch. Required env: `DATABASE_URL` (or `POSTGRES_URL`), `APP_PASSWORD`, `SESSION_SECRET`; for reminders `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.

## Conventions

- Plain, friendly UI copy from the owners' point of view; the dog's name comes from config (`dog()`), never hard-code "Yeti" in UI text.
- Form fields must stay at 16px (iPhones zoom into smaller ones).
- Vercel Hobby cron jobs run once a day and anywhere within the scheduled hour; don't add more frequent schedules.
- Push to `master` deploys to production.
