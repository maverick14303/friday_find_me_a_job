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

export async function recordSentCompanies(companyNames) {
  if (!isConfigured() || companyNames.length === 0) return;
  const now = new Date().toISOString();
  const rows = companyNames.map((name) => ({
    company_key: companyKey(name),
    company_name: name,
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
