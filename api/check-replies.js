import { processInboxReplies } from "../scripts/lib/applyFlow.mjs";
import { checkSecret } from "../scripts/security.mjs";

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Use GET for cron-job.org or POST for manual triggers." });
    return;
  }

  const denied = checkSecret(req);
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return;
  }

  try {
    const result = await processInboxReplies();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message || "Checking replies failed." });
  }
}
