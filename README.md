# SUNDAY - Find Me A Job 

> **Sunday is my Friday.**

SUNDAY is my personal assistant. She runs a few jobs for me, and this repo is one of them: the job finder. Every morning she digs through AI/ML intern and fresher openings, ranks them against my real resume, builds ATS-safe resume and cover-letter PDFs, and drops the top 5 in my inbox. Reply with a company name and she applies for me.

The short version: Vercel puts up the dashboard and runs the work, cron-job.org is the alarm clock, and SUNDAY is what ties it together.
Under the hood: Vercel hosts the dashboard and the serverless functions, and cron-job.org fires the HTTP triggers.

## What It Does

- Runs every day at 10:00 AM IST when cron-job.org calls the Vercel endpoint.
- Also supports a manual `Run Now` button from the Vercel dashboard.
- Searches public job pages only.
- Keeps resumes truthful and based on `data/resume-profile.json` (copy `data/resume-profile.example.json` to create it - it's gitignored since it holds your real name, phone, and email).
- Generates a single-column, selectable-text resume PDF once from `data/resume-profile.json` (never tailored per job) and reuses it for every company in a run - only the cover letter is written per company.
- Sends the resume + one cover letter per company through Gmail.
- Never emails the same company twice - once a company is sent, it's skipped in every future run (see "Never Repeat a Company" below).
- Reply to the daily email with just a company name to apply to it (see "Reply to Apply" below).
- Optionally finds a recruiter email via Hunter.io (free tier) or Apollo/Lusha when a posting doesn't list one, only at reply-to-apply time (see "Recruiter Email Enrichment" below).

## Configuration

Set these in Vercel environment variables. There are far fewer than there used to be - one secret, one Gmail app password, and that's the core of it.

**Required:**

- `APP_SECRET`: one long random password. Protects the run, reply-check, and health endpoints (dashboard field + `?secret=` in your cron URLs).
- `GMAIL_USER`: the sender Gmail address.
- `GMAIL_APP_PASSWORD`: a Gmail App Password (see "Gmail Setup" below). One password does both sending (SMTP) and reading your replies (IMAP).
- `TO_EMAIL`: where the daily packet is sent (your personal email).
- `RESUME_PROFILE_JSON`: your `resume-profile.json` as a single line. Keeps your personal data out of the repo and out of the deployed bundle. (Locally you can instead just create `data/resume-profile.json`.)

**For never-repeat-a-company, reply-to-apply, and run history** (skipped silently if unset - the daily email still works):

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

**Optional recruiter-email enrichment** (reply-to-apply only), tried in order Hunter -> Apollo -> Lusha:

- `HUNTER_API_KEY` (free tier), `APOLLO_API_KEY`, `LUSHA_API_KEY` (both effectively paid). See "Recruiter Email Enrichment" below.

> Migration note: the old `RUN_NOW_SECRET` / `CRON_SECRET` are still accepted as fallbacks so existing cron URLs don't break mid-switch. Once `APP_SECRET` is set and your cron URLs use it, delete those two. The old Gmail OAuth vars (`GMAIL_OAUTH_*`) are no longer used at all - delete them.

## Gmail Setup (App Password)

Use a dedicated Gmail account as the sender. One App Password gives the app SMTP (send) and IMAP (read your replies) access - no OAuth, no tokens that expire every week.

1. Create (or pick) a Gmail account just for sending these packets.
2. Turn on **2-Step Verification**: Google Account -> Security -> 2-Step Verification. (App Passwords don't exist without it - that's a Google requirement.)
3. Go to Google Account -> Security -> **App passwords**, create one (name it "sunday"), and copy the 16-character password.
4. In Vercel, set `GMAIL_USER` (the account) and `GMAIL_APP_PASSWORD` (the 16 chars, spaces are fine - they're stripped).
5. Redeploy.

That's it - there's nothing to re-approve or refresh later. If you rotate/remove the App Password in Google, just set a new one in Vercel.

Plain words: one password lets the assistant send from this account and read the replies you send back.
Technical words: Gmail SMTP (`smtp.gmail.com:465`) + IMAP (`imap.gmail.com:993`), authenticated with the App Password.

## cron-job.org Setup

Create a daily cron job in cron-job.org:

- URL: `https://YOUR-VERCEL-APP.vercel.app/api/run-now?secret=YOUR_APP_SECRET`
- Method: `GET`
- Time: `10:00 AM` in your cron-job.org timezone settings.

Keep `YOUR_APP_SECRET` long and private. Anyone with that URL can trigger the job.

For "Reply to Apply" (below), create a **second** cron job that checks for replies more often:

- URL: `https://YOUR-VERCEL-APP.vercel.app/api/check-replies?secret=YOUR_APP_SECRET`
- Method: `GET`
- Time: every 15 minutes.

## Health Check

Open `https://YOUR-VERCEL-APP.vercel.app/api/health?secret=YOUR_APP_SECRET` (or click **Check Status** on the dashboard) any time to see, without triggering a run: whether required config is present, whether Gmail and Supabase are reachable, and when the last run happened and how it went. Returns HTTP 200 when healthy, 503 when something needs attention.

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
3. It finds a recruiter email: first the one scraped from the public posting, and if there was none, it falls back to enrichment (Hunter free tier, or Apollo/Lusha) - see "Recruiter Email Enrichment" below. **If an email is found**, it emails the application directly to that address on your behalf. **If not**, this is skipped.
4. Either way, it replies to you in the same email thread with the apply link and both PDFs attached, so you can submit it yourself if step 3 didn't apply (or as a record if it did).

Important caveats:
- Recruiter emails are **not verified** - whether scraped from a posting or returned by Apollo/Lusha, an auto-sent application can go to a wrong, stale, or unrelated address. Check the confirmation reply each time to see exactly what happened and which source the address came from.
- This only works for companies recently emailed by this app (it can't apply to arbitrary companies you type in).
- It does **not** fill out web application forms (Workday, Greenhouse, Lever, career-site portals, etc.) - that would require a different, much less reliable kind of browser automation per company. When no recruiter email exists, you still have to submit through the link yourself.
- Needs `SUPABASE_URL`/`SUPABASE_ANON_KEY` (to look up the company) and the Gmail App Password (its IMAP access is what reads your reply) - see "Gmail Setup" above.

## Recruiter Email Enrichment

When you reply to apply and the public job posting didn't include a recruiter email, the app can look one up via an enrichment provider. This runs **only at reply time, only for the specific company you chose, and only when no scraped email already exists** - so lookups are spent sparingly, never on the daily run.

Providers are tried in order, using whichever keys are set:

1. **Hunter.io (`HUNTER_API_KEY`) - the free option.** Sign up at <https://hunter.io>, then open Dashboard -> API and copy your key. The free tier gives 50 lookups/month with no credit card. It does a domain search for the company and prefers an HR/recruiting contact.
2. **Apollo (`APOLLO_API_KEY`)** and **Lusha (`LUSHA_API_KEY`)** - searched after Hunter, but note their API access is effectively **paid-only** (Apollo needs the ~$119/mo Organization plan; Lusha's API is a paid add-on), so a free account on either generally won't work here.

How to add the key (Hunter shown):
1. Get the key from the Hunter dashboard.
2. In Vercel: Project -> Settings -> Environment Variables -> add `HUNTER_API_KEY` (Production).
3. Redeploy (or just push - Vercel redeploys on push if git integration is on).

Notes:
- Hunter needs a company **domain**, which the app infers from the apply link. For jobs whose only link is a job board (LinkedIn/Indeed/etc.), it passes the company name to Hunter instead, which is less reliable - so some companies still won't resolve to an email, and that's expected.
- Every provider call is wrapped defensively: a bad key, exhausted credits, no match, or a changed API just returns "no email found" and the reply falls back to link-only - it never breaks the run.
- Returned emails are unverified guesses - the same "double-check before relying on it" caution applies.
- The Apollo/Lusha adapters follow each provider's documented API shapes but were not run against live paid keys; if a provider changes its API, that adapter quietly returns nothing until updated.

## ATS Safety Rules

- No fake experience.
- No fake tools.
- No fake metrics.
- No unsupported skills.
- Missing job keywords are listed as gaps instead of being added to the resume.

## Project Structure

- `scripts/run-job-assistant.mjs` - orchestrates a run (validate config -> search -> score -> generate -> email -> record status) and the CLI entry point.
- `scripts/lib/scrape.mjs` - public job source adapters (LinkedIn, Indeed, RemoteOK, Jobicy, Arbeitnow, DuckDuckGo).
- `scripts/lib/scoring.mjs` - ATS keyword matching and job scoring.
- `scripts/lib/resume.mjs` - cover letter text, run summary report.
- `scripts/lib/pdf.mjs` - resume/cover-letter PDF rendering, built on `pdf-lib`. Resume rendering is job-agnostic by design.
- `scripts/lib/email.mjs` - Gmail SMTP delivery (send with retry/backoff) + MIME builder, shared by the daily packet and the reply flow.
- `scripts/lib/gmailInbox.mjs` - reads/marks-read inbox replies over IMAP (`imapflow` + `mailparser`).
- `scripts/lib/history.mjs` - Supabase-backed sent-company history, reply-lookup data, and run-status records (all timeout-guarded and best-effort).
- `scripts/lib/config.mjs` - env-var spec + validation, used at run start and by `/api/health`.
- `scripts/lib/loadResume.mjs` - loads the resume from `RESUME_PROFILE_JSON` (prod) or the local file (dev).
- `scripts/lib/recruiterLookup.mjs` - Hunter/Apollo/Lusha recruiter-email enrichment, used as a reply-time fallback.
- `scripts/lib/applyFlow.mjs` - the "Reply to Apply" orchestration, polled by `/api/check-replies`.
- `scripts/lib/{util,http,terms}.mjs` - shared helpers, fetch wrappers, and keyword lists.
- `scripts/security.mjs` - constant-time secret comparison + the shared endpoint auth gate.
- `api/` - Vercel serverless endpoints: `run-now` (daily/dashboard), `check-replies` (reply-to-apply), `health` (status).

## Important Limit

Free public sources sometimes return job-board listing pages instead of one exact company opening. When that happens, the app still reports the link, but it does not invent company-specific details. The best results come from company career pages and public job pages that expose a clear title, company, and description.

Indeed in particular rate-limits scraping aggressively: firing its 3 search queries at the same time gets all 3 blocked with a 403, even with proper browser headers. The app now runs Indeed queries one at a time with a short delay between them, which fixes the self-inflicted part of this (verified - all 3 succeed when spaced out). Indeed can still block a given IP/session independently of how the app behaves; when that happens it's logged in the run's search diagnostics and the run continues using the other 8 sources (LinkedIn guest search, RemoteOK, Jobicy, Arbeitnow, and DuckDuckGo across 15 queries) without failing.
