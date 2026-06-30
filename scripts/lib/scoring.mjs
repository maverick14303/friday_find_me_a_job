import { normalize, termPresent, inferLocation, findEmails } from "./util.mjs";
import { ROLE_TERMS, SOFTWARE_BRIDGE_TERMS, ATS_TERMS, NON_JOB_TERMS, GENERIC_LISTING_TERMS } from "./terms.mjs";

export function scoreJob(job, resume) {
  const text = normalize(`${job.title} ${job.company} ${job.location} ${job.description}`);
  const resumeText = normalize(JSON.stringify(resume));
  const isTrainingPage = NON_JOB_TERMS.some((term) => termPresent(text, term));
  const isGenericListing = GENERIC_LISTING_TERMS.some((term) => termPresent(text, term)) ||
    /indeed\.com\/q-|indeed\.com\/.*jobs|glassdoor\..*\/Job\/jobs|internshala\.com\/internship\/search|simplyhired\..*\/search|career-advice|internships\.php/i.test(job.applyUrl || "");
  const roleMatches = ROLE_TERMS.filter((term) => termPresent(text, term));
  const softwareBridgeMatches = SOFTWARE_BRIDGE_TERMS.filter((term) => termPresent(text, term));
  const keywordMatches = ATS_TERMS.filter((term) => termPresent(text, term) && termPresent(resumeText, term));
  const requestedKeywords = ATS_TERMS.filter((term) => termPresent(text, term));
  const missingKeywords = requestedKeywords.filter((term) => !resumeText.includes(normalize(term)));
  const isEarlyCareer = /\b(intern|internship|fresher|entry level|entry-level|junior|trainee|student|2027|0-1|0 to 1|0-2|0 to 2)\b/i.test(text);
  const isIndiaOrRemote = /\b(india|remote|delhi|noida|gurgaon|gurugram|bangalore|bengaluru|hyderabad|pune|mumbai|chennai|jaipur|gandhinagar)\b/i.test(text);
  const hasMlBridge = /\b(ai|ml|machine learning|data science|python|model|analytics)\b/i.test(text);
  const isDomainFit = !isTrainingPage && (roleMatches.length > 0 || (softwareBridgeMatches.length > 0 && hasMlBridge));

  let score = 0;
  score += Math.min(roleMatches.length, 4) * 18;
  score += Math.min(keywordMatches.length, 10) * 4;
  if (isEarlyCareer) score += 18;
  if (isIndiaOrRemote) score += 12;
  if (["remoteok", "jobicy", "arbeitnow"].includes(job.source) && !/company not shown/i.test(job.company || "")) score += 10;
  if (isGenericListing) score -= 35;
  if (/company not shown/i.test(job.company || "")) score -= 8;
  if (softwareBridgeMatches.length > 0 && roleMatches.length === 0) score -= 10;
  if (/\b(3\+|4\+|5\+|senior|lead|manager|principal)\b/i.test(text)) score -= 30;
  score = Math.max(0, Math.min(100, score));

  return {
    ...job,
    location: job.location || inferLocation(text),
    recruiterEmails: job.recruiterEmails || findEmails(text),
    score,
    isDomainFit,
    isGenericListing,
    isTrainingPage,
    isEarlyCareer,
    isIndiaOrRemote,
    roleMatches,
    keywordMatches,
    missingKeywords
  };
}
