import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function imapConfig() {
  return {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "")
    },
    logger: false,
    // Fail fast rather than hang the serverless function if IMAP is unreachable.
    socketTimeout: 20000,
    greetingTimeout: 10000
  };
}

async function withInbox(fn) {
  const client = new ImapFlow(imapConfig());
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Unread messages sitting in the inbox - i.e. replies the user sent back to a
// daily packet email, since that's the only thing that lands here unread on a
// dedicated sender account. `id` is the IMAP UID, used later by markAsRead.
export async function listUnreadInboxMessages() {
  return withInbox(async (client) => {
    const uids = await client.search({ seen: false }, { uid: true });
    const messages = [];
    for (const uid of uids || []) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const references = Array.isArray(parsed.references)
        ? parsed.references.join(" ")
        : (parsed.references || "");
      messages.push({
        id: uid,
        messageIdHeader: parsed.messageId || "",
        references,
        from: parsed.from?.text || "",
        subject: parsed.subject || "",
        text: extractReplyText(parsed.text || "")
      });
    }
    return messages;
  });
}

export async function markAsRead(uid) {
  return withInbox(async (client) => {
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
  });
}

// Lightweight connectivity check for /api/health: proves the app password
// authenticates against Gmail IMAP without fetching anything.
export async function verifyInboxConnection() {
  try {
    await withInbox(async () => true);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Strips quoted history from a reply so only the user's new text remains -
// otherwise matching would see every company name from the original digest.
function extractReplyText(body) {
  const cutMarkers = [/^On .+wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}/m, /^>/m];
  let text = body || "";
  for (const marker of cutMarkers) {
    const match = text.match(marker);
    if (match && match.index !== undefined) {
      text = text.slice(0, match.index);
    }
  }
  return text.trim();
}
