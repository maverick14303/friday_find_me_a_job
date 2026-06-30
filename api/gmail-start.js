export default function handler(req, res) {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI || absoluteUrl(req, "/api/gmail-callback");
  const state = process.env.GMAIL_OAUTH_STATE || "";

  if (!clientId) {
    res.status(500).send("Set GMAIL_OAUTH_CLIENT_ID in Vercel first.");
    return;
  }

  if (!state) {
    res.status(500).send("Set GMAIL_OAUTH_STATE in Vercel first (a long random value, separate from RUN_NOW_SECRET/CRON_SECRET).");
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",
    access_type: "offline",
    prompt: "consent",
    state
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

function absoluteUrl(req, pathname) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}${pathname}`;
}
