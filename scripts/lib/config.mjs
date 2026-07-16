// Central declaration of every environment variable the app reads, plus a
// validator used both at run start (fail fast with a clear message instead of
// a cryptic mid-run crash) and by /api/health (report config health without
// ever exposing the values).

export const ENV_SPEC = {
  required: [
    { name: "GMAIL_USER", why: "sender Gmail address (SMTP + IMAP login)" },
    { name: "GMAIL_APP_PASSWORD", why: "Gmail app password used to send and to read replies" }
  ],
  recommended: [
    { name: "APP_SECRET", why: "protects the run / reply / health endpoints" },
    { name: "TO_EMAIL", why: "where daily packets are sent (falls back to the resume email)" },
    { name: "RESUME_PROFILE_JSON", why: "resume data in production (else data/resume-profile.json)" },
    { name: "SUPABASE_URL", why: "never-repeat, reply-to-apply, and run history" },
    { name: "SUPABASE_ANON_KEY", why: "never-repeat, reply-to-apply, and run history" }
  ],
  optional: [
    { name: "HUNTER_API_KEY", why: "free recruiter-email lookup at reply time" },
    { name: "APOLLO_API_KEY", why: "paid recruiter-email lookup" },
    { name: "LUSHA_API_KEY", why: "paid recruiter-email lookup" }
  ]
};

function isSet(name) {
  return Boolean((process.env[name] || "").trim());
}

export function validateConfig() {
  const missingRequired = ENV_SPEC.required.filter((v) => !isSet(v.name));
  const missingRecommended = ENV_SPEC.recommended.filter((v) => !isSet(v.name));
  return {
    ok: missingRequired.length === 0,
    errors: missingRequired.map((v) => `${v.name} is required (${v.why}).`),
    warnings: missingRecommended.map((v) => `${v.name} is not set - ${v.why}.`)
  };
}

// Booleans only - never values - so it's safe to return from /api/health.
export function configReport() {
  const report = {};
  for (const group of ["required", "recommended", "optional"]) {
    for (const v of ENV_SPEC[group]) report[v.name] = isSet(v.name);
  }
  return report;
}

// Throw a single clear error listing everything missing, so a misconfigured
// deploy fails loudly at the top of a run instead of somewhere deep inside it.
export function assertRunnable() {
  const { ok, errors } = validateConfig();
  if (!ok) {
    throw new Error(`Missing required configuration:\n- ${errors.join("\n- ")}`);
  }
}
