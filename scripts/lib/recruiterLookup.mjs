// Finds a recruiter email for a company using paid enrichment providers
// (Apollo, then Lusha as fallback). Only called from the apply flow when no
// public email was scraped, so credits are spent only on companies the user
// explicitly chose to apply to.
//
// NOTE: these hit live, credit-metered third-party APIs. Endpoints/fields
// follow each provider's documented v1/v2 shapes but can change - every call
// is wrapped so any failure (bad key, no credits, changed schema, no match)
// returns null and the caller falls back to link-only, never crashing.

const RECRUITER_TITLES = [
  "recruiter",
  "technical recruiter",
  "talent acquisition",
  "talent acquisition specialist",
  "hr",
  "human resources",
  "people operations",
  "hiring manager"
];

const JOB_BOARD_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "remoteok.com",
  "jobicy.com",
  "arbeitnow.com",
  "glassdoor.com",
  "wellfound.com",
  "cutshort.io",
  "instahyre.com",
  "internshala.com",
  "duckduckgo.com",
  "simplyhired.com"
];

export async function findRecruiterEmail({ companyName, applyUrl }) {
  const domain = domainFromUrl(applyUrl);

  if (process.env.APOLLO_API_KEY) {
    const email = await tryApollo({ companyName, domain });
    if (email) return { email, provider: "apollo" };
  }

  if (process.env.LUSHA_API_KEY) {
    const email = await tryLusha({ companyName, domain });
    if (email) return { email, provider: "lusha" };
  }

  return null;
}

function looksRevealed(email) {
  return Boolean(email) && !/email_not_unlocked|not_unlocked|@domain\.com$/i.test(email);
}

// Apollo: search people by org + recruiter titles, then reveal the top
// match's email. https://docs.apollo.io/ (People Search + People Match).
async function tryApollo({ companyName, domain }) {
  try {
    const searchBody = {
      person_titles: RECRUITER_TITLES,
      page: 1,
      per_page: 5,
      ...(domain ? { q_organization_domains_list: [domain] } : { q_organization_name: companyName })
    };
    const search = await apolloPost("https://api.apollo.io/api/v1/mixed_people/search", searchBody);
    const person = (search?.people || [])[0];
    if (!person) return null;

    if (looksRevealed(person.email)) return person.email;

    const match = await apolloPost("https://api.apollo.io/api/v1/people/match", {
      id: person.id,
      first_name: person.first_name,
      last_name: person.last_name,
      organization_name: companyName,
      reveal_personal_emails: true
    });
    const revealed = match?.person?.email;
    return looksRevealed(revealed) ? revealed : null;
  } catch (error) {
    console.log(`Apollo lookup failed: ${error.message}`);
    return null;
  }
}

async function apolloPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": process.env.APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Lusha prospecting: search contacts by company + titles, then enrich the
// chosen contacts to reveal emails. https://docs.lusha.com/ (Prospecting API).
async function tryLusha({ companyName, domain }) {
  try {
    const search = await lushaPost("https://api.lusha.com/prospecting/contact/search", {
      pages: { page: 0, size: 5 },
      filters: {
        contacts: { jobTitles: { values: RECRUITER_TITLES } },
        companies: domain
          ? { domains: { values: [domain] } }
          : { names: { values: [companyName] } }
      }
    });
    const requestId = search?.requestId;
    const contactIds = (search?.data || search?.contacts || []).map((c) => c.contactId || c.id).filter(Boolean);
    if (!requestId || contactIds.length === 0) return null;

    const enrich = await lushaPost("https://api.lusha.com/prospecting/contact/enrich", {
      requestId,
      contactIds: contactIds.slice(0, 1)
    });
    const contacts = enrich?.contacts || enrich?.data || [];
    for (const contact of contacts) {
      const emails = contact.emailAddresses || contact.emails || [];
      const email = emails.map((e) => (typeof e === "string" ? e : e.email)).find(Boolean);
      if (email) return email;
    }
    return null;
  } catch (error) {
    console.log(`Lusha lookup failed: ${error.message}`);
    return null;
  }
}

async function lushaPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_key": process.env.LUSHA_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

function domainFromUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/^(careers|jobs|apply|work|join|talent|recruiting)\./, "");
    if (JOB_BOARD_HOSTS.some((board) => host === board || host.endsWith(`.${board}`))) return null;
    return host;
  } catch {
    return null;
  }
}
