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

## On your phones

- **iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap ⋮, then **Add to Home screen** or **Install app**.

## Changing things later

- To change the password, update `APP_PASSWORD` in Vercel and redeploy.
- To log everyone out, change `SESSION_SECRET` and redeploy.
- Every push to `master` deploys automatically.
