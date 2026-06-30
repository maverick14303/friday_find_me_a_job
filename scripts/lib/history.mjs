import { companyKey } from "./util.mjs";

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function headers() {
  const key = process.env.SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

// Companies already emailed in a previous run, so the same company is never
// re-sent. Falls back to "no history" (nothing filtered) if Supabase isn't
// configured, so the assistant still works without this feature set up.
export async function getSentCompanyKeys() {
  if (!isConfigured()) return new Set();
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sent_companies?select=company_key`, {
      headers: headers()
    });
    if (!response.ok) {
      console.log(`Could not load sent-company history: ${response.status} ${await response.text()}`);
      return new Set();
    }
    const rows = await response.json();
    return new Set(rows.map((row) => row.company_key));
  } catch (error) {
    console.log(`Could not load sent-company history: ${error.message}`);
    return new Set();
  }
}

// Records the jobs that were just emailed, including enough detail (title,
// apply link, recruiter emails, matched keywords) to recreate the same
// cover letter later when the user replies asking to apply.
export async function recordSentCompanies(jobs) {
  if (!isConfigured() || jobs.length === 0) return;
  const now = new Date().toISOString();
  const rows = jobs.map((job) => ({
    company_key: companyKey(job.company),
    company_name: job.company,
    job_title: job.title,
    apply_url: job.applyUrl,
    recruiter_emails: job.recruiterEmails || [],
    keyword_matches: job.keywordMatches || [],
    last_sent_at: now
  }));

  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sent_companies?on_conflict=company_key`, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows)
    });
    if (!response.ok) {
      console.log(`Could not save sent-company history: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.log(`Could not save sent-company history: ${error.message}`);
  }
}

// Finds the most recently sent company whose key is contained in (or
// contains) the reply text, e.g. a reply of "TCS Research" matches a stored
// company "TCS Research and Development". Returns null if nothing matches.
export async function findRecentJobByReplyText(replyText) {
  if (!isConfigured()) return null;
  const needle = companyKey(replyText);
  if (!needle) return null;

  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/sent_companies?select=*&order=last_sent_at.desc&limit=200`,
      { headers: headers() }
    );
    if (!response.ok) {
      console.log(`Could not search sent-company history: ${response.status} ${await response.text()}`);
      return null;
    }
    const rows = await response.json();
    return rows.find((row) => needle.includes(row.company_key) || row.company_key.includes(needle)) || null;
  } catch (error) {
    console.log(`Could not search sent-company history: ${error.message}`);
    return null;
  }
}

export async function markApplied(companyKeyValue, appliedEmail) {
  if (!isConfigured()) return;
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/sent_companies?company_key=eq.${encodeURIComponent(companyKeyValue)}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ applied_at: new Date().toISOString(), applied_email: appliedEmail || null })
      }
    );
    if (!response.ok) {
      console.log(`Could not mark company as applied: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.log(`Could not mark company as applied: ${error.message}`);
  }
}
