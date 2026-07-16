import { checkSecret } from "../scripts/security.mjs";
import { configReport, validateConfig } from "../scripts/lib/config.mjs";
import { verifyInboxConnection } from "../scripts/lib/gmailInbox.mjs";
import { getLastRunStatus, verifySupabase } from "../scripts/lib/history.mjs";

export const config = {
  maxDuration: 30
};

// Secret-gated status page. Open it any time to see, without triggering a run:
// which config is present, whether Gmail + Supabase are reachable, and when the
// last run happened and how it went. Returns 200 when healthy, 503 when not.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const denied = checkSecret(req);
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return;
  }

  const cfg = validateConfig();
  const [gmail, supabase, lastRun] = await Promise.all([
    verifyInboxConnection(),
    verifySupabase(),
    getLastRunStatus()
  ]);

  const healthy = cfg.ok && gmail.ok;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    checkedAt: new Date().toISOString(),
    config: { ok: cfg.ok, errors: cfg.errors, warnings: cfg.warnings, present: configReport() },
    gmail,
    supabase,
    lastRun
  });
}
