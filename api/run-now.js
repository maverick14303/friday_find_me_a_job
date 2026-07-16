import { runJobAssistant } from "../scripts/run-job-assistant.mjs";
import { checkSecret } from "../scripts/security.mjs";

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Use GET for cron-job.org or POST for the dashboard." });
    return;
  }

  const denied = checkSecret(req);
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const result = await runJobAssistant({
      useSamples: req.query?.sample === "1" || body.sample === true,
      noEmail: req.query?.email === "0" || body.email === false
    });

    res.status(200).json({
      ok: true,
      message: result.emailStatus === "sent"
        ? "Job packet generated and emailed."
        : "Job packet generated. Email was not sent because email is disabled or Gmail secrets are missing.",
      runId: result.runId,
      totalRawJobs: result.totalRawJobs,
      totalDomainFitJobs: result.totalDomainFitJobs,
      emailStatus: result.emailStatus,
      topJobs: result.topJobs.map((job) => ({
        title: job.title,
        company: job.company,
        score: job.score,
        applyUrl: job.applyUrl
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error.message || "The job assistant failed."
    });
  }
}
