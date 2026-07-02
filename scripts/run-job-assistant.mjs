import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

import { collectPublicJobs, dedupeJobs, dedupeRankedJobs } from "./lib/scrape.mjs";
import { scoreJob } from "./lib/scoring.mjs";
import { createResumePdf, createCoverLetterPdf } from "./lib/pdf.mjs";
import { buildCoverLetterLines, buildSummary } from "./lib/resume.mjs";
import { sendPacketEmail } from "./lib/email.mjs";
import { getSentCompanyKeys, recordSentCompanies } from "./lib/history.mjs";
import { safeName, formatDateForPath, companyKey } from "./lib/util.mjs";

const ROOT = process.cwd();
const DEFAULT_OUTPUT_DIR = process.env.JOB_ASSISTANT_OUTPUT_DIR ||
  (process.env.VERCEL ? path.join(os.tmpdir(), "friday-find-me-a-job-output") : path.join(ROOT, "output"));
const RESUME_PATH = path.join(ROOT, "data", "resume-profile.json");
const SAMPLE_JOBS_PATH = path.join(ROOT, "data", "sample-jobs.json");

export async function runJobAssistant(options = {}) {
  const useSamples = options.useSamples ?? process.env.JOB_SOURCE_MODE === "sample";
  const noEmail = options.noEmail ?? process.env.SEND_EMAIL === "false";
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;

  await fs.mkdir(outputDir, { recursive: true });
  const resume = JSON.parse(await fs.readFile(RESUME_PATH, "utf8"));
  const runId = formatDateForPath(new Date());
  const runDir = path.join(outputDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`Starting job assistant run: ${runId}`);
  console.log("Plain meaning: searching public job pages. Technical word: source adapters.");

  const { jobs: rawJobs, sourceReports } = useSamples
    ? { jobs: await loadSampleJobs(), sourceReports: [] }
    : await collectPublicJobs();

  const uniqueJobs = dedupeJobs(rawJobs);
  const scoredJobs = uniqueJobs
    .map((job) => scoreJob(job, resume))
    .filter((job) => job.isDomainFit)
    .sort((a, b) => b.score - a.score || b.keywordMatches.length - a.keywordMatches.length);

  const uniqueScoredJobs = dedupeRankedJobs(scoredJobs);

  const sentCompanyKeys = useSamples ? new Set() : await getSentCompanyKeys();
  const freshJobs = uniqueScoredJobs.filter((job) => !sentCompanyKeys.has(companyKey(job.company)));
  const skippedAlreadySent = uniqueScoredJobs.length - freshJobs.length;

  const candidates = freshJobs.slice(0, 10);
  const specificJobs = freshJobs.filter((job) => !job.isGenericListing && !/company not shown/i.test(job.company || ""));
  const fallbackJobs = freshJobs.filter((job) => !specificJobs.includes(job));
  const topJobs = [...specificJobs, ...fallbackJobs].slice(0, 5);

  console.log(`Found ${uniqueJobs.length} raw jobs, ${scoredJobs.length} domain-fit jobs, ${skippedAlreadySent} already emailed, ${topJobs.length} top jobs.`);

  // The resume is never tailored per job - generate it once and reuse the
  // same PDF for every company in this run. Only the cover letter changes.
  const resumeFile = path.join(runDir, "resume.pdf");
  await fs.writeFile(resumeFile, await createResumePdf(resume));

  const generated = [];
  for (const job of topJobs) {
    const folderName = safeName(`${job.company}-${job.title}`);
    const jobDir = path.join(runDir, folderName);
    await fs.mkdir(jobDir, { recursive: true });

    const coverLetterLines = buildCoverLetterLines(resume, job);
    const coverPdf = await createCoverLetterPdf(coverLetterLines, `${resume.name} - ${job.company} Cover Letter`);
    const coverFile = path.join(jobDir, "cover-letter.pdf");

    await fs.writeFile(coverFile, coverPdf);
    await fs.writeFile(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

    generated.push({
      job,
      resumeFile,
      coverFile
    });
  }

  const summary = buildSummary(resume, candidates, generated, {
    totalRawJobs: uniqueJobs.length,
    totalDomainFitJobs: scoredJobs.length,
    skippedAlreadySent,
    sourceReports
  });
  await fs.writeFile(path.join(runDir, "summary.txt"), summary);
  await fs.writeFile(path.join(outputDir, "latest-run.json"), JSON.stringify({
    runId,
    createdAt: new Date().toISOString(),
    totalRawJobs: uniqueJobs.length,
    totalDomainFitJobs: scoredJobs.length,
    sourceReports,
    topJobs: generated.map((item) => item.job),
    candidates
  }, null, 2));

  if (generated.length === 0) {
    console.log("No suitable jobs were found. The run report was still saved.");
  }

  let emailStatus = "skipped";
  if (!noEmail) {
    emailStatus = await sendPacketEmail(resume, generated, summary, runDir);
    if (emailStatus === "sent" && !useSamples) {
      await recordSentCompanies(generated.map((item) => item.job));
    }
  } else {
    console.log("Email skipped because --no-email or SEND_EMAIL=false was used.");
  }

  console.log(`Done. Output folder: ${runDir}`);
  return {
    runId,
    runDir,
    totalRawJobs: uniqueJobs.length,
    totalDomainFitJobs: scoredJobs.length,
    topJobs: generated.map((item) => item.job),
    emailStatus,
    summary
  };
}

async function loadSampleJobs() {
  return JSON.parse(await fs.readFile(SAMPLE_JOBS_PATH, "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = new Set(process.argv.slice(2));
  runJobAssistant({
    useSamples: args.has("--sample") || process.env.JOB_SOURCE_MODE === "sample",
    noEmail: args.has("--no-email") || process.env.SEND_EMAIL === "false"
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
