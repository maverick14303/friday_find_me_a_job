import crypto from "node:crypto";

export function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function matchesAny(value, candidates) {
  return candidates.some((candidate) => timingSafeEqual(value, candidate));
}

// APP_SECRET is the single secret going forward. RUN_NOW_SECRET / CRON_SECRET
// are accepted as legacy fallbacks so existing cron URLs keep working during
// migration - delete them from Vercel once APP_SECRET is set everywhere.
export function validSecrets() {
  return [process.env.APP_SECRET, process.env.RUN_NOW_SECRET, process.env.CRON_SECRET].filter(Boolean);
}

function readBearerToken(value = "") {
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

export function readRequestSecret(req) {
  const body = typeof req.body === "string" ? safeJsonParse(req.body) : req.body || {};
  return body.secret || req.query?.secret || readBearerToken(req.headers?.authorization || "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

// Shared gate for every secret-protected endpoint. Returns null when the
// request is authorized, or { status, error } to send back otherwise.
export function checkSecret(req) {
  const secrets = validSecrets();
  if (process.env.VERCEL && secrets.length === 0) {
    return { status: 500, error: "Set APP_SECRET before deploying this endpoint." };
  }
  if (secrets.length > 0 && !matchesAny(readRequestSecret(req), secrets)) {
    return { status: 401, error: "The app secret is incorrect." };
  }
  return null;
}
