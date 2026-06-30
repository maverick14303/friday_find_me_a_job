import { processInboxReplies } from "../scripts/lib/applyFlow.mjs";
import { matchesAny } from "../scripts/security.mjs";

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Use GET for cron-job.org or POST for manual triggers." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const secret = body.secret || req.query?.secret || readBearerToken(req.headers.authorization);
    const validSecrets = [process.env.RUN_NOW_SECRET, process.env.CRON_SECRET].filter(Boolean);

    if (process.env.VERCEL && validSecrets.length === 0) {
      res.status(500).json({ error: "Set RUN_NOW_SECRET or CRON_SECRET before deploying this endpoint." });
      return;
    }

    if (validSecrets.length > 0 && !matchesAny(secret, validSecrets)) {
      res.status(401).json({ error: "The run secret is incorrect." });
      return;
    }

    const result = await processInboxReplies();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message || "Checking replies failed." });
  }
}

function readBearerToken(value = "") {
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}
