import { fetchText, fetchJson } from "./http.mjs";
import { cleanHtml, decodeHtml, decodeDuckDuckGoUrl, findEmails, firstMatch, normalize, inferLocation } from "./util.mjs";
import { ROLE_TERMS, SOFTWARE_BRIDGE_TERMS, SEARCH_QUERIES } from "./terms.mjs";

export async function collectPublicJobs() {
  const jobs = [];
  const sourceReports = [];

  const queryRuns = SEARCH_QUERIES.map(async (query) => {
    const results = await searchDuckDuckGo(query);
    sourceReports.push({ source: `duckduckgo: ${query}`, count: results.length, error: "" });
    for (const result of results) {
      const job = jobFromSearchResult(result, query);
      if (job) jobs.push(job);
    }
  });

  const directRuns = [
    searchLinkedInGuest("machine learning intern", "India"),
    searchLinkedInGuest("ai intern", "India"),
    searchLinkedInGuest("data science intern", "India"),
    searchLinkedInGuest("computer vision intern", "India"),
    searchLinkedInGuest("python ai intern", "India"),
    searchIndeedAll(["machine learning intern", "ai ml intern", "data science intern"], "India"),
    searchRemoteOk(),
    searchJobicy(),
    searchArbeitnow()
  ].map(async (promise) => {
    const { jobs: found, report } = await promise;
    jobs.push(...found);
    for (const item of Array.isArray(report) ? report : [report]) {
      if (item) sourceReports.push(item);
    }
  });

  await Promise.allSettled([...queryRuns, ...directRuns]);
  return { jobs, sourceReports };
}

async function searchLinkedInGuest(query, location) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=0`;
  try {
    const html = await fetchText(url);
    const cards = html.match(/<li>[\s\S]*?<\/li>/gi) || [];
    const jobs = [];

    for (const card of cards.slice(0, 15)) {
      const title = cleanHtml(firstMatch(card, [
        /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i,
        /<span[^>]*class="sr-only"[^>]*>([\s\S]*?)<\/span>/i
      ]));
      const company = cleanHtml(firstMatch(card, [
        /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
        /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
      ]));
      const jobLocation = cleanHtml(firstMatch(card, [
        /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ])) || location;
      const href = decodeHtml(firstMatch(card, [
        /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i
      ])).split("?")[0];
      const date = firstMatch(card, [/<time[^>]*datetime="([^"]+)"/i]);

      if (!title || !href) continue;
      jobs.push({
        title,
        company: company || "Company not shown",
        location: jobLocation,
        description: `${title} at ${company || "company not shown"} in ${jobLocation}. Public LinkedIn listing${date ? ` dated ${date}` : ""}. ${query}.`,
        applyUrl: href,
        recruiterEmails: [],
        source: "linkedin-guest"
      });
    }

    return { jobs, report: { source: `linkedin: ${query}`, count: jobs.length, error: "" } };
  } catch (error) {
    console.log(`LinkedIn guest search failed for "${query}": ${error.message}`);
    return { jobs: [], report: { source: `linkedin: ${query}`, count: 0, error: error.message } };
  }
}

async function searchRemoteOk() {
  try {
    const data = await fetchJson("https://remoteok.com/api");
    const jobs = data.slice(1).map((item) => ({
      title: item.position || item.title || "",
      company: item.company || "Company not shown",
      location: item.location || "Remote",
      description: cleanHtml(item.description || item.tags?.join(" ") || ""),
      applyUrl: item.url || item.apply_url || `https://remoteok.com/remote-jobs/${item.id}`,
      source: "remoteok"
    })).filter((job) => looksLikeJob(`${job.title} ${job.description}`));
    return { jobs, report: { source: "remoteok", count: jobs.length, error: "" } };
  } catch (error) {
    console.log(`RemoteOK search failed: ${error.message}`);
    return { jobs: [], report: { source: "remoteok", count: 0, error: error.message } };
  }
}

async function searchJobicy() {
  const urls = [
    "https://jobicy.com/api/v2/remote-jobs?count=50&tag=machine-learning",
    "https://jobicy.com/api/v2/remote-jobs?count=50&tag=python",
    "https://jobicy.com/api/v2/remote-jobs?count=50&tag=data-science"
  ];
  const jobs = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      for (const item of data.jobs || []) {
        jobs.push({
          title: item.jobTitle || "",
          company: item.companyName || "Company not shown",
          location: item.jobGeo || "Remote",
          description: cleanHtml(item.jobDescription || ""),
          applyUrl: item.url || item.jobUrl,
          source: "jobicy"
        });
      }
    } catch (error) {
      console.log(`Jobicy search failed: ${error.message}`);
    }
  }
  const filtered = jobs.filter((job) => looksLikeJob(`${job.title} ${job.description}`));
  return { jobs: filtered, report: { source: "jobicy", count: filtered.length, error: "" } };
}

async function searchArbeitnow() {
  try {
    const data = await fetchJson("https://www.arbeitnow.com/api/job-board-api");
    const jobs = (data.data || []).map((item) => ({
      title: item.title || "",
      company: item.company_name || "Company not shown",
      location: item.location || (item.remote ? "Remote" : "Not shown"),
      description: cleanHtml(item.description || ""),
      applyUrl: item.url,
      source: "arbeitnow"
    })).filter((job) => looksLikeJob(`${job.title} ${job.description}`));
    return { jobs, report: { source: "arbeitnow", count: jobs.length, error: "" } };
  } catch (error) {
    console.log(`Arbeitnow search failed: ${error.message}`);
    return { jobs: [], report: { source: "arbeitnow", count: 0, error: error.message } };
  }
}

async function searchDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchText(url);
    const blocks = html.split(/result__body/g).slice(1);
    const results = [];

    for (const block of blocks) {
      const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const href = decodeDuckDuckGoUrl(decodeHtml(linkMatch[1]));
      const title = cleanHtml(linkMatch[2]);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
      const snippet = snippetMatch ? cleanHtml(snippetMatch[1] || snippetMatch[2] || "") : "";
      results.push({ title, url: href, snippet, source: "duckduckgo" });
      if (results.length >= 8) break;
    }

    return results;
  } catch (error) {
    console.log(`Search failed for "${query}": ${error.message}`);
    return [];
  }
}

async function searchIndeed(query, location) {
  const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
  try {
    const html = await fetchText(url);
    const jobs = [];
    const cardRegex = /<div[^>]+class="[^"]*job_seen_beacon[^"]*"[\s\S]*?<\/table>|<li[\s\S]*?data-jk="([^"]+)"[\s\S]*?<\/li>/gi;
    const matches = html.match(cardRegex) || [];

    for (const card of matches.slice(0, 10)) {
      const title = cleanHtml(firstMatch(card, [
        /<h2[^>]*>[\s\S]*?<span[^>]*title="([^"]+)"/i,
        /<a[^>]+class="[^"]*jcs-JobTitle[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      ]));
      const company = cleanHtml(firstMatch(card, [
        /data-testid="company-name"[^>]*>([\s\S]*?)<\/span>/i,
        /class="[^"]*companyName[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ]));
      const jobKey = firstMatch(card, [/data-jk="([^"]+)"/i]);
      const description = cleanHtml(card).slice(0, 900);

      if (!title) continue;
      jobs.push({
        title,
        company: company || "Company not shown",
        location,
        description,
        applyUrl: jobKey ? `https://in.indeed.com/viewjob?jk=${jobKey}` : url,
        source: "indeed"
      });
    }

    return { jobs, report: { source: `indeed: ${query}`, count: jobs.length, error: "" } };
  } catch (error) {
    console.log(`Indeed search failed for "${query}": ${error.message}`);
    return { jobs: [], report: { source: `indeed: ${query}`, count: 0, error: error.message } };
  }
}

// Indeed rate-limits aggressively on simultaneous requests from the same
// origin (verified: 3 parallel requests get 403'd even with browser headers,
// while the same requests spaced out succeed). Run queries one at a time.
async function searchIndeedAll(queries, location) {
  const jobs = [];
  const reports = [];
  for (const query of queries) {
    const { jobs: found, report } = await searchIndeed(query, location);
    jobs.push(...found);
    reports.push(report);
    await sleep(1200);
  }
  return { jobs, report: reports };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobFromSearchResult(result, query) {
  const text = `${result.title} ${result.snippet}`;
  if (!looksLikeJob(text)) return null;

  const parsed = parseTitleCompany(result.title);
  return {
    title: parsed.title,
    company: parsed.company,
    location: inferLocation(text),
    description: result.snippet || `Public search result for ${query}.`,
    applyUrl: result.url,
    recruiterEmails: findEmails(text),
    source: result.source
  };
}

function parseTitleCompany(title) {
  const clean = title.replace(/\s+/g, " ").trim();
  const atMatch = clean.match(/^(.+?)\s+at\s+(.+?)(\s+\||\s+-|$)/i);
  if (atMatch) {
    return {
      title: atMatch[1].replace(/\b(apply now|job offer|hiring)\b/gi, "").trim().slice(0, 90),
      company: atMatch[2].replace(/\b(apply now|careers|jobs|linkedin|indeed)\b/gi, "").trim().slice(0, 80) || "Company not shown"
    };
  }

  const separators = [" - ", " | ", " at ", " @ "];
  for (const separator of separators) {
    if (clean.toLowerCase().includes(separator.trim())) {
      const parts = clean.split(separator);
      if (parts.length >= 2) {
        return {
          title: parts[0].trim().slice(0, 90),
          company: parts.slice(1).join(separator).replace(/careers|jobs|linkedin|indeed/gi, "").trim().slice(0, 80) || "Company not shown"
        };
      }
    }
  }

  return {
    title: clean.replace(/\b(job|jobs|career|careers|hiring)\b/gi, "").trim().slice(0, 90) || "AI/ML Opening",
    company: "Company not shown"
  };
}

function looksLikeJob(text) {
  const lower = normalize(text);
  const hasRole = ROLE_TERMS.some((term) => lower.includes(normalize(term))) ||
    SOFTWARE_BRIDGE_TERMS.some((term) => lower.includes(normalize(term)));
  const hasJobSignal = /\b(job|jobs|opening|hiring|career|careers|intern|internship|apply|role)\b/i.test(text);
  return hasRole && hasJobSignal;
}

export function dedupeJobs(jobs) {
  const seen = new Set();
  const result = [];
  for (const job of jobs) {
    if (!job?.title || !job?.applyUrl) continue;
    const key = normalize(`${job.title}-${job.company}-${job.applyUrl}`).replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      title: job.title.trim(),
      company: (job.company || "Company not shown").trim(),
      location: (job.location || "India / Remote").trim(),
      description: (job.description || "").trim(),
      applyUrl: job.applyUrl,
      recruiterEmails: job.recruiterEmails || [],
      source: job.source || "public"
    });
  }
  return result;
}

export function dedupeRankedJobs(jobs) {
  const seen = new Set();
  const result = [];
  for (const job of jobs) {
    const key = normalize(`${job.title}-${job.company}`)
      .replace(/\b(noida|bangalore|bengaluru|gurgaon|gurugram|mumbai|delhi|hybrid|remote|india|internship|intern)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(job);
  }
  return result;
}
