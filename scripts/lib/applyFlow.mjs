import { listUnreadInboxMessages, markAsRead } from "./gmailInbox.mjs";
import { findRecentJobByReplyText, markApplied } from "./history.mjs";
import { buildCoverLetterLines } from "./resume.mjs";
import { createResumePdf, createCoverLetterPdf } from "./pdf.mjs";
import { sendMail } from "./email.mjs";
import { findRecruiterEmail } from "./recruiterLookup.mjs";
import { loadResumeProfile } from "./loadResume.mjs";
import { companyKey, safeName } from "./util.mjs";

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

      const alreadyApplied = Boolean(job.applied_at);

      // Prefer a recruiter email scraped at search time; if none, fall back
      // to paid enrichment (Apollo/Lusha) - only here, only for a company the
      // user actually chose to apply to. Skipped if already applied.
      let recruiterEmail = (job.recruiter_emails || [])[0] || null;
      let recruiterSource = recruiterEmail ? "scraped" : null;
      if (!recruiterEmail && !alreadyApplied) {
        const enriched = await findRecruiterEmail({ companyName: job.company_name, applyUrl: job.apply_url });
        if (enriched) {
          recruiterEmail = enriched.email;
          recruiterSource = enriched.provider;
        }
      }

      if (recruiterEmail && !alreadyApplied) {
        await sendApplicationEmail({
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
              ? `I also emailed this application directly to ${recruiterEmail} (found via ${recruiterSource}). Note: this address is unverified - double-check before relying on it.`
              : "No recruiter email was found for this listing (not in the public posting, and enrichment returned nothing), so please apply using the link above."
        ].join("\n\n"),
        attachments: [
          { filename: `${safeName(resume.name)}-resume.pdf`, contentType: "application/pdf", content: resumePdf },
          { filename: `${safeName(job.company_name)}-cover-letter.pdf`, contentType: "application/pdf", content: coverPdf }
        ]
      });

      await markApplied(companyKey(job.company_name), recruiterEmail);
      await markAsRead(message.id);
      results.push({ matched: true, company: job.company_name, autoApplied: Boolean(recruiterEmail && !alreadyApplied), recruiterSource });
    } catch (error) {
      console.error(`Failed to process reply ${message.id}: ${error.message}`);
      results.push({ matched: false, error: error.message });
    }
  }

  return { processed: results.length, results };
}

async function sendApplicationEmail({ to, resume, job, coverLetterLines, resumePdf, coverPdf }) {
  await sendMail({
    to,
    subject: `Application for ${job.job_title} - ${resume.name}`,
    text: coverLetterLines.join("\n"),
    attachments: [
      { filename: `${safeName(resume.name)}-resume.pdf`, contentType: "application/pdf", content: resumePdf },
      { filename: `${safeName(job.company_name)}-cover-letter.pdf`, contentType: "application/pdf", content: coverPdf }
    ]
  });
}

// Reply in the same thread. SMTP has no thread id, so threading is done purely
// with the In-Reply-To / References headers pointing at the user's message.
async function replyToUser(message, user, { subject, text, attachments }) {
  const to = parseEmailAddress(message.from);
  const references = [message.references, message.messageIdHeader].filter(Boolean).join(" ");
  await sendMail({
    to,
    subject,
    text,
    attachments,
    extraHeaders: [
      message.messageIdHeader ? `In-Reply-To: ${message.messageIdHeader}` : "",
      references ? `References: ${references}` : ""
    ].filter(Boolean)
  });
}

function replySubject(originalSubject) {
  return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

function parseEmailAddress(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

async function loadResume() {
  return loadResumeProfile();
}
