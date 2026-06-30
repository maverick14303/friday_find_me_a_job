import { timingSafeEqual } from "../scripts/security.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const code = req.query?.code;
  const returnedState = req.query?.state || "";
  const expectedState = process.env.GMAIL_OAUTH_STATE || "";
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI || absoluteUrl(req, "/api/gmail-callback");

  if (!expectedState) {
    res.status(500).send("Set GMAIL_OAUTH_STATE in Vercel before connecting Gmail.");
    return;
  }

  if (!timingSafeEqual(returnedState, expectedState)) {
    res.status(401).send("Google connection rejected because the state value did not match.");
    return;
  }

  if (!code || !clientId || !clientSecret) {
    res.status(400).send("Missing OAuth code, client ID, or client secret.");
    return;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    res.status(500).send(`<pre>${escapeHtml(JSON.stringify(tokenData, null, 2))}</pre>`);
    return;
  }

  const refreshToken = tokenData.refresh_token || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Gmail Connected</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; line-height: 1.55; color: #172026; }
          code, pre { background: #f4f6f8; border: 1px solid #d9e0e6; border-radius: 6px; padding: 10px; display: block; overflow-x: auto; }
          .warn { color: #8a4b00; }
        </style>
      </head>
      <body>
        <h1>Gmail connected</h1>
        <p>Copy this value into Vercel as <strong>GMAIL_OAUTH_REFRESH_TOKEN</strong>.</p>
        ${refreshToken
          ? `<pre>${escapeHtml(refreshToken)}</pre><p class="warn">This token grants Gmail send access. Copy it now, then close this tab - don't share, screenshot, or bookmark this page.</p>`
          : `<p class="warn">Google did not return a refresh token. Open <code>/api/gmail-start</code> again and approve the consent screen.</p>`}
        <p>After saving it in Vercel, redeploy. The app can then send daily email without your Gmail password.</p>
      </body>
    </html>
  `);
}

function absoluteUrl(req, pathname) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}${pathname}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
