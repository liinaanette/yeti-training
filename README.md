# Yeti Alone-Time Training

A small web app for training a dog with separation anxiety. It gives you a daily plan of alone-time reps with a timer, logs how each rep went and who did it, and adjusts the next day's plan automatically. Both people share one login password and see the same plan and history.

- `public/` is the app (one HTML page, plus icons so it can be added to a phone's home screen)
- `api/` holds Vercel serverless functions that read and write a Neon Postgres database
- Tables are created automatically on the first request

## Deploy (about 10 minutes)

1. **Vercel:** sign in at vercel.com with GitHub, click **Add New → Project**, and import `yeti-training`. Leave the framework as **Other** and the build settings empty. If it deploys right away and shows an error, that's expected until the next steps are done.
2. **Neon database:** in the Vercel project, open **Storage → Create Database → Neon** (free plan) and connect it to the project. This adds `DATABASE_URL` for you.
3. **Environment variables:** in **Settings → Environment Variables**, add:
   - `APP_PASSWORD`: the password you and your partner will type to log in
   - `SESSION_SECRET`: a long random string, for example from running `openssl rand -base64 32`
4. **Redeploy:** go to **Deployments**, open the latest one and click **Redeploy**, so it picks up the new variables.
5. Open the site and log in with your name and the password, then set the dog's current alone time.

## Daily reminders (optional)

Push notifications: today's plan every morning, and an evening nudge if nobody has trained yet.

1. Add three more environment variables in Vercel:
   - `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: generate a pair with `npx web-push generate-vapid-keys`
   - `CRON_SECRET`: any long random string. Vercel sends it to the reminder job so nobody else can trigger it.
2. Redeploy.
3. On each phone, open **Settings → Reminders → Turn on reminders on this phone**. On iPhone this only works from the home screen app (iOS 16.4 or newer).

**Time's up alerts during reps (optional):** add the free **Upstash QStash** integration in Vercel (Storage or Integrations → Upstash → QStash). It sets `QSTASH_TOKEN`, `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`. Redeploy. Phones with reminders on then get a push when each rep ends, even when locked.

The times are set in `vercel.json` in UTC: 05:00 for the morning and 16:00 for the evening. On Vercel's free plan a job can run any time within that hour.

## Features

- Daily plan with a rep timer, departure cues and automatic step-up/step-back
- Two stages: behind a baby gate, then the front door
- Tap a logged rep to change or delete it; log real absences ("Log time alone")
- History with progress chart, last-7-days summary and calm rate by time of day and person
- Report for your behaviourist: pick a period, save as PDF or image
- Download all data as CSV
- Push reminders: morning plan, evening nudge, Sunday weekly summary

## Tests

`npm install` then `npm test` runs the training-logic tests in `test/`.

## On your phones

- **iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap ⋮, then **Add to Home screen** or **Install app**.

## Changing things later

- To change the password, update `APP_PASSWORD` in Vercel and redeploy.
- To log everyone out, change `SESSION_SECRET` and redeploy.
- Every push to `master` deploys automatically.
