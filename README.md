# ATS Job Assistant

This app finds AI/ML intern and fresher jobs, ranks them against Ankit's real resume, creates ATS-safe resume and cover letter PDFs, and emails the top 5 packets.

Plain words: Vercel shows the button and does the work. cron-job.org is the alarm clock.
Technical words: Vercel hosts the dashboard and serverless function. cron-job.org sends an HTTP trigger.

## What It Does

- Runs every day at 10:00 AM IST when cron-job.org calls the Vercel endpoint.
- Also supports a manual `Run Now` button from the Vercel dashboard.
- Searches public job pages only.
- Keeps resumes truthful and based on `data/resume-profile.json` (copy `data/resume-profile.example.json` to create it - it's gitignored since it holds your real name, phone, and email).
- Generates single-column, selectable-text PDFs.
- Sends the final packet through Gmail.

## Required Secrets

Add these to Vercel environment variables:

- `GMAIL_USER`: the new sender Gmail address.
- `TO_EMAIL`: `your-personal-email@gmail.com`.
- `RUN_NOW_SECRET`: the password you type in the dashboard.
- `CRON_SECRET`: the secret in the cron-job.org URL.
- `GMAIL_OAUTH_CLIENT_ID`: Google OAuth client ID.
- `GMAIL_OAUTH_CLIENT_SECRET`: Google OAuth client secret.
- `GMAIL_OAUTH_REDIRECT_URI`: `https://YOUR-VERCEL-APP.vercel.app/api/gmail-callback`.
- `GMAIL_OAUTH_STATE`: a long random password for the Gmail connection flow. **Required** and must be different from `RUN_NOW_SECRET`/`CRON_SECRET` - `/api/gmail-start` and `/api/gmail-callback` now refuse to run without it, since reusing a run secret as the OAuth CSRF token would mix two unrelated trust boundaries.
- `GMAIL_OAUTH_REFRESH_TOKEN`: created after you click `Connect Gmail`.

`GMAIL_APP_PASSWORD` is still supported as an optional fallback if Google allows it later.

## Gmail Setup With Google Sign-in

Do not use the normal Gmail password. Google usually blocks normal-password SMTP anyway, and it is not a good secret to put into an app.

Use Google Sign-in instead:

1. Create a new Gmail account just for sending these job packets.
2. Go to Google Cloud Console and create/select a project.
3. Enable the Gmail API for that project.
4. Configure the OAuth consent screen. If it asks for users, add the new Gmail account as a test user.
5. Create an OAuth Client ID for a Web Application.
6. Add this authorized redirect URI: `https://YOUR-VERCEL-APP.vercel.app/api/gmail-callback`.
7. Put the client ID, client secret, redirect URI, and state value into Vercel environment variables.
8. Open `https://YOUR-VERCEL-APP.vercel.app/api/gmail-start`.
9. Sign in with the new Gmail account and approve the Gmail send permission.
10. Copy the refresh token shown on the success page into Vercel as `GMAIL_OAUTH_REFRESH_TOKEN`.
11. Redeploy on Vercel.

Plain words: you approve the app once, then it can send the daily email from the new Gmail account.
Technical words: OAuth refresh token with the `gmail.send` scope.

## cron-job.org Setup

Create a daily cron job in cron-job.org:

- URL: `https://YOUR-VERCEL-APP.vercel.app/api/run-now?secret=YOUR_CRON_SECRET`
- Method: `GET`
- Time: `10:00 AM` in your cron-job.org timezone settings.

Keep `YOUR_CRON_SECRET` long and private. Anyone with that URL can trigger the job.

## Run Locally

```bash
npm test
```

This uses sample jobs and does not send email.

To run real public searches:

```bash
npm run run:jobs
```

If Gmail secrets are missing, the app writes an `email-preview.txt` instead of sending.

## ATS Safety Rules

- No fake experience.
- No fake tools.
- No fake metrics.
- No unsupported skills.
- Missing job keywords are listed as gaps instead of being added to the resume.

## Project Structure

- `scripts/run-job-assistant.mjs` - orchestrates a run (search -> score -> generate -> email) and the CLI entry point.
- `scripts/lib/scrape.mjs` - public job source adapters (LinkedIn, Indeed, RemoteOK, Jobicy, Arbeitnow, DuckDuckGo).
- `scripts/lib/scoring.mjs` - ATS keyword matching and job scoring.
- `scripts/lib/resume.mjs` - tailored summary, cover letter text, run summary report.
- `scripts/lib/pdf.mjs` - resume/cover-letter PDF rendering, built on `pdf-lib`.
- `scripts/lib/email.mjs` - Gmail API / SMTP delivery.
- `scripts/lib/{util,http,terms}.mjs` - shared helpers, fetch wrappers, and keyword lists.
- `scripts/security.mjs` - constant-time secret comparison, shared by the `api/` handlers.
- `api/` - Vercel serverless endpoints (dashboard run trigger, Gmail OAuth start/callback).

## Important Limit

Free public sources sometimes return job-board listing pages instead of one exact company opening. When that happens, the app still reports the link, but it does not invent company-specific details. The best results come from company career pages and public job pages that expose a clear title, company, and description.
