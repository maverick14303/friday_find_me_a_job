import fs from "node:fs/promises";
import path from "node:path";

import { listUnreadInboxMessages, markAsRead } from "./gmailInbox.mjs";
import { findRecentJobByReplyText, markApplied } from "./history.mjs";
import { buildCoverLetterLines } from "./resume.mjs";
import { createResumePdf, createCoverLetterPdf } from "./pdf.mjs";
import { getGmailAccessToken, buildMimeMessage, sendGmailApiRaw } from "./email.mjs";
import { companyKey, safeName } from "./util.mjs";

const RESUME_PATH = path.join(process.cwd(), "data", "resume-profile.json");

// Polled by /api/check-replies. The user replies to a daily packet email
// with just a company name; this looks that company up in the sent-company
// history, regenerates the same cover letter + the (always-original)
// resume, emails the application directly to a recruiter address if one
// was found, and always replies back to the user with the packet and the
// direct apply link so they can submit it themselves either way.
export async function processInboxReplies() {
  const user = process.env.GMAIL_USER;
  if (!user) {
    return { processed: 0, message: "GMAIL_USER is not configured." };
  }

  const messages = await listUnreadInboxMessages();
  const resume = await loadResume();
  let resumePdf = null;
  const results = [];

  for (const message of messages) {
    try {
      if (!message.text) {
        await markAsRead(message.id);
        continue;
      }

      const job = await findRecentJobByReplyText(message.text);
      if (!job) {
        await replyToUser(message, user, {
          subject: replySubject(message.subject),
          text: `I couldn't match "${message.text.slice(0, 80)}" to a company from a recent job packet. Reply with just the company name as it appeared in the email.`,
          attachments: []
        });
        await markAsRead(message.id);
        results.push({ matched: false, replyText: message.text });
        continue;
      }

      resumePdf = resumePdf || await createResumePdf(resume);

      const coverLetterLines = buildCoverLetterLines(resume, {
        title: job.job_title,
        company: job.company_name,
        keywordMatches: job.keyword_matches || []
      });
      const coverPdf = await createCoverLetterPdf(coverLetterLines, `${resume.name} - ${job.company_name} Cover Letter`);

      const recruiterEmail = (job.recruiter_emails || [])[0] || null;
      const alreadyApplied = Boolean(job.applied_at);
      if (recruiterEmail && !alreadyApplied) {
        await sendApplicationEmail({
          user,
          to: recruiterEmail,
          resume,
          job,
          coverLetterLines,
          resumePdf,
          coverPdf
        });
      }

      await replyToUser(message, user, {
        subject: replySubject(message.subject),
        text: [
          `Here is your application packet for ${job.company_name} (${job.job_title}).`,
          `Apply link: ${job.apply_url || "not available"}`,
          alreadyApplied
            ? `This was already auto-applied earlier (to ${job.applied_email}), so I haven't re-sent it - here's the packet again for your records.`
            : recruiterEmail
              ? `I also emailed this application directly to ${recruiterEmail}.`
              : "No public recruiter email was found for this listing, so please apply using the link above."
        ].join("\n\n"),
        attachments: [
          { filename: `${safeName(resume.name)}-resume.pdf`, contentType: "application/pdf", content: resumePdf },
          { filename: `${safeName(job.company_name)}-cover-letter.pdf`, contentType: "application/pdf", content: coverPdf }
        ]
      });

      await markApplied(companyKey(job.company_name), recruiterEmail);
      await markAsRead(message.id);
      results.push({ matched: true, company: job.company_name, autoApplied: Boolean(recruiterEmail) });
    } catch (error) {
      console.error(`Failed to process reply ${message.id}: ${error.message}`);
      results.push({ matched: false, error: error.message });
    }
  }

  return { processed: results.length, results };
}

async function sendApplicationEmail({ user, to, resume, job, coverLetterLines, resumePdf, coverPdf }) {
  const accessToken = await getGmailAccessToken();
  const raw = buildMimeMessage({
    from: user,
    to,
    subject: `Application for ${job.job_title} - ${resume.name}`,
    text: coverLetterLines.join("\n"),
    attachments: [
      { filename: `${safeName(resume.name)}-resume.pdf`, contentType: "application/pdf", content: resumePdf },
      { filename: `${safeName(job.company_name)}-cover-letter.pdf`, contentType: "application/pdf", content: coverPdf }
    ]
  });
  await sendGmailApiRaw({ accessToken, raw });
}

async function replyToUser(message, user, { subject, text, attachments }) {
  const accessToken = await getGmailAccessToken();
  const to = parseEmailAddress(message.from);
  const references = [message.references, message.messageIdHeader].filter(Boolean).join(" ");
  const raw = buildMimeMessage({
    from: user,
    to,
    subject,
    text,
    attachments,
    extraHeaders: [
      message.messageIdHeader ? `In-Reply-To: ${message.messageIdHeader}` : "",
      references ? `References: ${references}` : ""
    ].filter(Boolean)
  });
  await sendGmailApiRaw({ accessToken, raw, threadId: message.threadId });
}

function replySubject(originalSubject) {
  return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

function parseEmailAddress(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

async function loadResume() {
  return JSON.parse(await fs.readFile(RESUME_PATH, "utf8"));
}
