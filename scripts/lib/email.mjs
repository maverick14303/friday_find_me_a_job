import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { Buffer } from "node:buffer";
import { safeName, formatHumanDate } from "./util.mjs";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const MAX_SEND_ATTEMPTS = 3;

function appPassword() {
  return (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
}

export function hasGmailCredentials() {
  return Boolean(process.env.GMAIL_USER && appPassword());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Primary (and only) send path: Gmail SMTP with an app password. Retries with
// backoff so a transient network/SMTP blip doesn't silently skip a day. Used
// for the daily packet, the direct-to-recruiter application, and the in-thread
// reply back to the user.
export async function sendMail({ to, subject, text, attachments = [], extraHeaders = [] }) {
  const user = process.env.GMAIL_USER;
  const password = appPassword();
  if (!user || !password) {
    throw new Error("Email not configured: set GMAIL_USER and GMAIL_APP_PASSWORD.");
  }
  const recipient = to || process.env.TO_EMAIL || user;
  const rawMessage = buildMimeMessage({ from: user, to: recipient, subject, text, attachments, extraHeaders });

  let lastError;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await smtpSend({ user, password, to: recipient, rawMessage });
      return;
    } catch (error) {
      lastError = error;
      console.log(`Email send attempt ${attempt}/${MAX_SEND_ATTEMPTS} failed: ${error.message}`);
      if (attempt < MAX_SEND_ATTEMPTS) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

export async function sendPacketEmail(resume, generated, summary, runDir) {
  const subject = `Daily AI/ML job packet - ${formatHumanDate(new Date())}`;

  if (!hasGmailCredentials()) {
    await fs.writeFile(path.join(runDir, "email-preview.txt"), summary);
    console.log("GMAIL_USER/GMAIL_APP_PASSWORD missing. Saved email-preview.txt instead of sending.");
    return "missing_gmail_secrets";
  }

  const attachments = [];
  if (generated.length > 0) {
    attachments.push({
      filename: `${safeName(resume.name)}-resume.pdf`,
      contentType: "application/pdf",
      content: await fs.readFile(generated[0].resumeFile)
    });
  }
  for (const item of generated) {
    const prefix = safeName(`${item.job.company}-${item.job.title}`).slice(0, 60);
    attachments.push({
      filename: `${prefix}-cover-letter.pdf`,
      contentType: "application/pdf",
      content: await fs.readFile(item.coverFile)
    });
  }

  const to = process.env.TO_EMAIL || resume.email;
  await sendMail({ to, subject, text: summary, attachments });
  console.log(`Email sent to ${to}.`);
  return "sent";
}

export function buildMimeMessage({ from, to, subject, text, attachments = [], extraHeaders = [] }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    ...extraHeaders,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    ""
  ];

  for (const attachment of attachments) {
    const encoded = (attachment.content.toString("base64").match(/.{1,76}/g) || []).join("\n");
    message.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      encoded,
      ""
    );
  }
  message.push(`--${boundary}--`, "");
  return message.join("\r\n");
}

// One SMTP-over-TLS transaction: greet, EHLO, AUTH PLAIN, MAIL/RCPT/DATA, QUIT.
async function smtpSend({ user, password, to, rawMessage }) {
  const socket = tls.connect(SMTP_PORT, SMTP_HOST, { servername: SMTP_HOST });
  socket.setEncoding("utf8");
  socket.setTimeout(20000);

  let buffer = "";
  const readResponse = () => new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        const response = buffer;
        buffer = "";
        resolve(response);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("SMTP timeout")));
  });

  const send = async (command, expectedCode) => {
    socket.write(`${command}\r\n`);
    const response = await readResponse();
    if (!response.startsWith(String(expectedCode))) {
      throw new Error(`SMTP command failed: ${command.split(" ")[0]} -> ${response.trim()}`);
    }
  };

  try {
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
      socket.once("timeout", () => reject(new Error("SMTP connect timeout")));
    });

    const greeting = await readResponse();
    if (!greeting.startsWith("220")) throw new Error(`SMTP greeting failed: ${greeting.trim()}`);
    await send("EHLO sunday-find-me-a-job", 250);
    await send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString("base64")}`, 235);
    await send(`MAIL FROM:<${user}>`, 250);
    await send(`RCPT TO:<${to}>`, 250);
    await send("DATA", 354);
    socket.write(`${rawMessage}\r\n.\r\n`);
    const dataResponse = await readResponse();
    if (!dataResponse.startsWith("250")) throw new Error(`SMTP data failed: ${dataResponse.trim()}`);
    await send("QUIT", 221);
  } finally {
    socket.end();
    socket.destroy();
  }
}
