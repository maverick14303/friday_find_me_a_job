import { getGmailAccessToken } from "./email.mjs";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailFetch(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
  if (!response.ok) {
    throw new Error(`Gmail API request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Unread messages sitting in the inbox - i.e. replies the user sent back to
// a daily packet email, since that's the only thing that lands here unread.
export async function listUnreadInboxMessages() {
  const accessToken = await getGmailAccessToken();
  const list = await gmailFetch(`${API_BASE}/messages?q=${encodeURIComponent("is:unread in:inbox")}`, accessToken);
  const ids = (list.messages || []).map((item) => item.id);
  const messages = [];
  for (const id of ids) {
    const message = await gmailFetch(`${API_BASE}/messages/${id}?format=full`, accessToken);
    messages.push(parseMessage(message));
  }
  return messages;
}

function parseMessage(message) {
  const headerValue = (name) => message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  return {
    id: message.id,
    threadId: message.threadId,
    messageIdHeader: headerValue("Message-Id") || headerValue("Message-ID"),
    references: headerValue("References"),
    from: headerValue("From"),
    subject: headerValue("Subject"),
    text: extractReplyText(extractPlainText(message.payload))
  };
}

function extractPlainText(payload) {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return "";
}

// Strips quoted history from a reply so only the user's new text remains -
// otherwise matching would see every company name from the original digest.
function extractReplyText(body) {
  const cutMarkers = [/^On .+wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}/m, /^>/m];
  let text = body;
  for (const marker of cutMarkers) {
    const match = text.match(marker);
    if (match && match.index !== undefined) {
      text = text.slice(0, match.index);
    }
  }
  return text.trim();
}

export async function markAsRead(messageId) {
  const accessToken = await getGmailAccessToken();
  await gmailFetch(`${API_BASE}/messages/${messageId}/modify`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] })
  });
}
