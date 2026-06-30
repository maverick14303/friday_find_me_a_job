import { unique, normalize } from "./util.mjs";

export function tailoredSummary(resume, job) {
  const relevant = [];
  if (job.keywordMatches.includes("python")) relevant.push("Python");
  if (job.keywordMatches.some((term) => ["machine learning", "ml", "ai", "artificial intelligence"].includes(term))) {
    relevant.push("machine learning");
  }
  if (job.keywordMatches.includes("regression")) relevant.push("regression modeling");
  if (job.keywordMatches.includes("model evaluation")) relevant.push("model evaluation");
  if (job.keywordMatches.includes("adversarial ml")) relevant.push("adversarial ML");

  const focus = relevant.length ? ` Relevant focus for this role: ${unique(relevant).join(", ")}.` : "";
  return `${resume.summary}${focus}`;
}

export function buildCoverLetterLines(resume, job) {
  const role = job.title || "AI/ML role";
  const company = job.company || "your team";
  const relevantSkills = naturalSkillList(job.keywordMatches);

  return [
    resume.name,
    `${resume.email} | ${resume.phone}`,
    "",
    `Dear ${company} Hiring Team,`,
    "",
    `I am writing to express my interest in the ${role} position at ${company}. I am a B.Tech Mechanical Engineering student at NIT Delhi with a Minor in Artificial Intelligence and Machine Learning, and I have built a strong foundation in machine learning pipelines, model evaluation, and data-driven experimentation.`,
    "",
    `During my research internship at DRDO SAG, Delhi, I worked on adversarial machine learning by engineering black-box attack pipelines across 8+ models and 9,000+ samples, implementing transfer-based PGD attacks, and evaluating model robustness using DeepFace embeddings. This experience helped me develop a careful, experiment-driven approach to building and evaluating ML systems.`,
    "",
    `Alongside this, my projects include a multi-output regression pipeline for dataset expansion, an uncertainty estimation framework based on model disagreement and nearest-neighbor distance, and a structured-data regression framework using Python, Scikit-learn, Pandas, NumPy, Random Forest, XGBoost, and SVR.${relevantSkills}`,
    "",
    `I would be grateful for the opportunity to contribute to ${company} and learn from practical AI/ML work in a professional environment. Thank you for considering my application. I would welcome the chance to discuss how my background can support your team.`,
    "",
    "Sincerely,",
    resume.name
  ];
}

function naturalSkillList(keywordMatches = []) {
  const allowed = unique(keywordMatches)
    .filter((term) => !["ai", "ml", "c"].includes(normalize(term)))
    .slice(0, 5);
  if (allowed.length === 0) return "";
  return ` For this role, I would especially bring relevant exposure to ${allowed.join(", ")}.`;
}

export function buildSummary(resume, candidates, generated, diagnostics = {}) {
  const lines = [];
  lines.push(`ATS Job Assistant Run`);
  lines.push(`Candidate: ${resume.name}`);
  lines.push(`Created: ${new Date().toISOString()}`);
  lines.push(`Raw jobs found: ${diagnostics.totalRawJobs ?? "unknown"}`);
  lines.push(`Domain-fit jobs found: ${diagnostics.totalDomainFitJobs ?? "unknown"}`);
  lines.push("");
  lines.push("Top Generated Packets");
  if (generated.length === 0) {
    lines.push("- No suitable AI/ML fresher openings were found in this run.");
    lines.push("- This usually means the public job sites blocked the request or returned only generic listing pages.");
  }

  for (const [index, item] of generated.entries()) {
    const job = item.job;
    lines.push(`${index + 1}. ${job.title} - ${job.company}`);
    lines.push(`   Location: ${job.location}`);
    lines.push(`   ATS match estimate: ${job.score}/100`);
    lines.push(`   Apply: ${job.applyUrl}`);
    lines.push(`   Public recruiter email: ${job.recruiterEmails?.join(", ") || "Not found publicly"}`);
    lines.push(`   Matched keywords: ${job.keywordMatches.slice(0, 12).join(", ") || "None"}`);
    lines.push(`   Gaps not added to resume: ${job.missingKeywords.slice(0, 10).join(", ") || "None"}`);
  }

  lines.push("");
  lines.push("Ten Candidate Jobs Considered");
  if (candidates.length === 0) {
    lines.push("- No candidate jobs passed the AI/ML domain filters.");
  }
  for (const [index, job] of candidates.entries()) {
    lines.push(`${index + 1}. ${job.title} - ${job.company} (${job.score}/100)`);
    lines.push(`   ${job.applyUrl}`);
  }

  lines.push("");
  lines.push("Search Diagnostics");
  for (const report of diagnostics.sourceReports || []) {
    const suffix = report.error ? ` - ${report.error}` : "";
    lines.push(`- ${report.source}: ${report.count} result(s)${suffix}`);
  }

  return lines.join("\n");
}
