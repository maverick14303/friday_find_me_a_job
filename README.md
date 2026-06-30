# ATS Job Assistant

This app finds AI/ML intern and fresher jobs, ranks them against Ankit's real resume, creates ATS-safe resume and cover letter PDFs, and emails the top 5 packets.

Plain words: Vercel shows the button and does the work. cron-job.org is the alarm clock.
Technical words: Vercel hosts the dashboard and serverless function. cron-job.org sends an HTTP trigger.

## What It Does

- Runs every day at 10:00 AM IST when cron-job.org calls the Vercel endpoint.
- Also supports a manual `Run Now` button from the Vercel dashboard.
- Searches public job pages only.
- Keeps resumes truthful and based on `data/resume-profile.json` (copy `data/resume-profile.example.json` to create it - it's gitignored since it holds your real name, phone, and email).
- Generates a single-column, selectable-text resume PDF once from `data/resume-profile.json` (never tailored per job) and reuses it for every company in a run - only the cover letter is written per company.
- Sends the resume + one cover letter per company through Gmail.
- Never emails the same company twice - once a company is sent, it's skipped in every future run (see "Never Repeat a Company" below).
- Reply to the daily email with just a company name to apply to it (see "Reply to Apply" below).
- Optionally finds a recruiter email via Apollo/Lusha when a posting doesn't list one, only at reply-to-apply time (see "Recruiter Email Enrichment" below).

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

Needed for the never-repeat-a-company and reply-to-apply features:

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_ANON_KEY`: your Supabase publishable/anon key.

If these aren't set, both features are silently skipped and the app behaves as if they don't exist - it does not block the rest of the run.

Optional, to find recruiter emails when a job posting doesn't list one (used only at reply-to-apply time):

- `APOLLO_API_KEY`: your Apollo.io API key.
- `LUSHA_API_KEY`: your Lusha API key.

If both are set, Apollo is tried first and Lusha is the fallback. If neither is set, enrichment is skipped and the reply just sends you the apply link. These are paid, credit-metered services - see "Recruiter Email Enrichment" below.

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

Plain words: you approve the app once, then it can send the daily email from the new Gmail account, and (for "Reply to Apply" below) read replies sent back to it.
Technical words: OAuth refresh token with the `gmail.send` and `gmail.modify` scopes.

**If you connected Gmail before this version**, your existing refresh token only has `gmail.send` and can't read replies. Repeat steps 8-11 above (you'll see a consent screen asking for the extra permission) to get a token with both scopes, then replace `GMAIL_OAUTH_REFRESH_TOKEN` in Vercel and redeploy.

## cron-job.org Setup

Create a daily cron job in cron-job.org:

- URL: `https://YOUR-VERCEL-APP.vercel.app/api/run-now?secret=YOUR_CRON_SECRET`
- Method: `GET`
- Time: `10:00 AM` in your cron-job.org timezone settings.

Keep `YOUR_CRON_SECRET` long and private. Anyone with that URL can trigger the job.

For "Reply to Apply" (below), create a **second** cron job that checks for replies more often:

- URL: `https://YOUR-VERCEL-APP.vercel.app/api/check-replies?secret=YOUR_CRON_SECRET`
- Method: `GET`
- Time: every 15 minutes.

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

## Never Repeat a Company

Every company that gets emailed is recorded in a Supabase table (`sent_companies`, keyed by a normalized company name). On each run, before picking the top 5, the app filters out any company already in that table - so the same company is never sent twice, even across days/redeploys/cold starts.

This needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` set (see "Required Secrets" above). Without them, this specific feature is silently skipped and the app behaves as it did before - it does not block the rest of the run.

To reset and allow a company to be sent again, delete its row from `sent_companies` in the Supabase dashboard.

## Reply to Apply

Reply to a daily packet email with just the company name (e.g. "TCS Research"). The next time `/api/check-replies` runs (every 15 minutes via cron-job.org):

1. It looks that company up in `sent_companies` (matches even a partial name).
2. It regenerates the original resume and that company's exact cover letter.
3. It finds a recruiter email: first the one scraped from the public posting, and if there was none, it falls back to enrichment (Apollo/Lusha) - see "Recruiter Email Enrichment" below. **If an email is found**, it emails the application directly to that address on your behalf. **If not**, this is skipped.
4. Either way, it replies to you in the same email thread with the apply link and both PDFs attached, so you can submit it yourself if step 3 didn't apply (or as a record if it did).

Important caveats:
- Recruiter emails are **not verified** - whether scraped from a posting or returned by Apollo/Lusha, an auto-sent application can go to a wrong, stale, or unrelated address. Check the confirmation reply each time to see exactly what happened and which source the address came from.
- This only works for companies recently emailed by this app (it can't apply to arbitrary companies you type in).
- It does **not** fill out web application forms (Workday, Greenhouse, Lever, career-site portals, etc.) - that would require a different, much less reliable kind of browser automation per company. When no recruiter email exists, you still have to submit through the link yourself.
- Needs `SUPABASE_URL`/`SUPABASE_ANON_KEY` (to look up the company) and a Gmail refresh token with the `gmail.modify` scope (to read/reply) - see "Gmail Setup" above if you connected before this feature existed.

## Recruiter Email Enrichment

When you reply to apply and the public job posting didn't include a recruiter email, the app can look one up via paid enrichment providers. This runs **only at reply time, only for the specific company you chose, and only when no scraped email already exists** - so credits are spent sparingly, never on the daily run.

- Set `APOLLO_API_KEY` and/or `LUSHA_API_KEY`. With both set, Apollo is tried first, Lusha is the fallback.
- It searches for people at that company with recruiter/talent-acquisition/HR titles and reveals the top match's email.
- Every provider call is wrapped defensively: a bad key, exhausted credits, no match, or a changed API just returns "no email found" and the reply falls back to link-only - it never breaks the run.

Caveats specific to enrichment:
- **It costs money.** Each email reveal spends provider credits. Only reply-to-apply triggers it, but each such reply for a company without a scraped email will use a credit.
- **Endpoints are best-effort.** The Apollo/Lusha API shapes used here follow their documented endpoints but those can change; if a provider changes its API, enrichment will quietly return nothing until the integration is updated. (This was built against the documented APIs but not run against live paid keys.)
- Returned emails are unverified guesses - the same "double-check before relying on it" caution applies.

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
- `scripts/lib/resume.mjs` - cover letter text, run summary report.
- `scripts/lib/pdf.mjs` - resume/cover-letter PDF rendering, built on `pdf-lib`. Resume rendering is job-agnostic by design.
- `scripts/lib/email.mjs` - Gmail API / SMTP delivery, plus shared MIME/OAuth-token helpers reused by the reply flow.
- `scripts/lib/history.mjs` - Supabase-backed sent-company history (dedup + the data the reply flow looks up).
- `scripts/lib/gmailInbox.mjs` - reads/replies-to/marks-read inbox messages via the Gmail API.
- `scripts/lib/recruiterLookup.mjs` - Apollo/Lusha recruiter-email enrichment, used as a reply-time fallback.
- `scripts/lib/applyFlow.mjs` - the "Reply to Apply" orchestration, polled by `/api/check-replies`.
- `scripts/lib/{util,http,terms}.mjs` - shared helpers, fetch wrappers, and keyword lists.
- `scripts/security.mjs` - constant-time secret comparison, shared by the `api/` handlers.
- `api/` - Vercel serverless endpoints (dashboard run trigger, reply checker, Gmail OAuth start/callback).

## Important Limit

Free public sources sometimes return job-board listing pages instead of one exact company opening. When that happens, the app still reports the link, but it does not invent company-specific details. The best results come from company career pages and public job pages that expose a clear title, company, and description.

Indeed in particular rate-limits scraping aggressively: firing its 3 search queries at the same time gets all 3 blocked with a 403, even with proper browser headers. The app now runs Indeed queries one at a time with a short delay between them, which fixes the self-inflicted part of this (verified - all 3 succeed when spaced out). Indeed can still block a given IP/session independently of how the app behaves; when that happens it's logged in the run's search diagnostics and the run continues using the other 8 sources (LinkedIn guest search, RemoteOK, Jobicy, Arbeitnow, and DuckDuckGo across 15 queries) without failing.
