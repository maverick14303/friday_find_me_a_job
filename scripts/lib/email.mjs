import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { Buffer } from "node:buffer";
import { safeName, formatHumanDate } from "./util.mjs";

export async function sendPacketEmail(resume, generated, summary, runDir) {
  const user = process.env.GMAIL_USER;
  const password = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const to = process.env.TO_EMAIL || resume.email;
  const subject = `Daily AI/ML job packet - ${formatHumanDate(new Date())}`;

  if (!user) {
    await fs.writeFile(path.join(runDir, "email-preview.txt"), summary);
    console.log("Gmail sender email is missing. Saved email-preview.txt instead of sending.");
    return "missing_gmail_secrets";
  }

  const attachments = [];
  for (const item of generated) {
    const prefix = safeName(`${item.job.company}-${item.job.title}`).slice(0, 60);
    attachments.push({
      filename: `${prefix}-resume.pdf`,
      contentType: "application/pdf",
      content: await fs.readFile(item.resumeFile)
    });
    attachments.push({
      filename: `${prefix}-cover-letter.pdf`,
      contentType: "application/pdf",
      content: await fs.readFile(item.coverFile)
    });
  }

  if (hasGmailOAuthSecrets()) {
    await sendGmailApiMail({
      user,
      to,
      subject,
      text: summary,
      attachments
    });
    console.log(`Email sent to ${to} with Gmail Sign-in.`);
  } else if (password) {
    await sendSmtpMail({
      user,
      password,
      to,
      subject,
      text: summary,
      attachments
    });
    console.log(`Email sent to ${to}.`);
  } else {
    await fs.writeFile(path.join(runDir, "email-preview.txt"), summary);
    console.log("Gmail Sign-in token or app password is missing. Saved email-preview.txt instead of sending.");
    return "missing_gmail_secrets";
  }

  return "sent";
}

function hasGmailOAuthSecrets() {
  return Boolean(process.env.GMAIL_OAUTH_CLIENT_ID && process.env.GMAIL_OAUTH_CLIENT_SECRET && process.env.GMAIL_OAUTH_REFRESH_TOKEN);
}

async function sendGmailApiMail({ user, to, subject, text, attachments }) {
  const accessToken = await getGmailAccessToken();
  const raw = buildMimeMessage({ from: user, to, subject, text, attachments });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      raw: Buffer.from(raw, "utf8").toString("base64url")
    })
  });

  if (!response.ok) {
    throw new Error(`Gmail API send failed: ${response.status} ${await response.text()}`);
  }
}

async function getGmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_OAUTH_CLIENT_ID,
      client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

function buildMimeMessage({ from, to, subject, text, attachments }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
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
    message.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.content.toString("base64").match(/.{1,76}/g).join("\n"),
      ""
    );
  }
  message.push(`--${boundary}--`, "");
  return message.join("\r\n");
}

async function sendSmtpMail({ user, password, to, subject, text, attachments }) {
  const rawMessage = buildMimeMessage({ from: user, to, subject, text, attachments });

  const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
  socket.setEncoding("utf8");

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
  });

  const send = async (command, expectedCode) => {
    socket.write(`${command}\r\n`);
    const response = await readResponse();
    if (!response.startsWith(String(expectedCode))) {
      throw new Error(`SMTP command failed: ${command} -> ${response}`);
    }
  };

  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  let greeting = await readResponse();
  if (!greeting.startsWith("220")) throw new Error(`SMTP greeting failed: ${greeting}`);
  await send("EHLO ats-job-assistant", 250);
  await send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString("base64")}`, 235);
  await send(`MAIL FROM:<${user}>`, 250);
  await send(`RCPT TO:<${to}>`, 250);
  await send("DATA", 354);
  socket.write(`${rawMessage}\r\n.\r\n`);
  const dataResponse = await readResponse();
  if (!dataResponse.startsWith("250")) throw new Error(`SMTP data failed: ${dataResponse}`);
  await send("QUIT", 221);
  socket.end();
}
