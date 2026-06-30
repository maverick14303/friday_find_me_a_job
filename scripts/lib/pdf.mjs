import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatHumanDate } from "./util.mjs";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const TEXT_REPLACEMENTS = {
  "–": "-",
  "—": "-",
  "→": "->",
  "²": "2",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"'
};

function sanitizeText(value) {
  return Array.from(String(value ?? "")).map((char) => {
    if (TEXT_REPLACEMENTS[char]) return TEXT_REPLACEMENTS[char];
    if (char === "•") return char;
    const code = char.charCodeAt(0);
    if (code >= 32 && code <= 126) return char;
    return "";
  }).join("");
}

function wrapToWidth(value, maxWidth, font, size) {
  const clean = sanitizeText(value);
  if (!clean) return [""];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function embedFonts(doc) {
  return {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic)
  };
}

class PdfLayout {
  constructor(doc, fonts, options = {}) {
    this.doc = doc;
    this.fonts = fonts;
    this.marginLeft = options.marginLeft ?? 46;
    this.marginRight = options.marginRight ?? 46;
    this.marginTop = options.marginTop ?? 34;
    this.marginBottom = options.marginBottom ?? 34;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - this.marginTop;
  }

  font(weight) {
    if (weight === "bold") return this.fonts.bold;
    if (weight === "italic") return this.fonts.italic;
    return this.fonts.regular;
  }

  ensure(space = 24) {
    if (this.y - space < this.marginBottom) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - this.marginTop;
    }
  }

  text(value, size = 9, weight = "regular", x = this.marginLeft) {
    this.ensure(size + 6);
    const font = this.font(weight);
    this.page.drawText(sanitizeText(value), { x, y: this.y, size, font });
    this.y -= size + 3.8;
  }

  center(value, size = 10, weight = "regular") {
    this.ensure(size + 6);
    const font = this.font(weight);
    const clean = sanitizeText(value);
    const width = font.widthOfTextAtSize(clean, size);
    const x = Math.max(this.marginLeft, (PAGE_WIDTH - width) / 2);
    this.page.drawText(clean, { x, y: this.y, size, font });
    this.y -= size + 4;
  }

  section(title) {
    this.ensure(28);
    this.gap(6);
    const font = this.fonts.bold;
    const clean = sanitizeText(title);
    this.page.drawText(clean, { x: this.marginLeft, y: this.y, size: 11, font });
    const lineY = this.y - 2.5;
    const titleWidth = font.widthOfTextAtSize(clean, 11);
    this.page.drawLine({
      start: { x: this.marginLeft + titleWidth + 8, y: lineY },
      end: { x: PAGE_WIDTH - this.marginRight, y: lineY },
      thickness: 0.45,
      color: rgb(0, 0, 0)
    });
    this.y -= 13;
  }

  bullet(value, size = 9, weight = "regular") {
    this.wrapped(value, {
      size,
      weight,
      x: this.marginLeft + 12,
      firstPrefix: "• ",
      nextPrefix: "  ",
      maxWidth: PAGE_WIDTH - this.marginLeft - this.marginRight - 12
    });
  }

  indentText(value, size = 9, weight = "regular") {
    this.wrapped(value, {
      size,
      weight,
      x: this.marginLeft + 18,
      firstPrefix: "",
      nextPrefix: "",
      maxWidth: PAGE_WIDTH - this.marginLeft - this.marginRight - 18
    });
  }

  paragraph(value, size = 10) {
    this.wrapped(value, {
      size,
      weight: "regular",
      x: this.marginLeft,
      firstPrefix: "",
      nextPrefix: "",
      maxWidth: PAGE_WIDTH - this.marginLeft - this.marginRight
    });
  }

  wrapped(value, options) {
    const font = this.font(options.weight);
    const lines = wrapToWidth(value, options.maxWidth, font, options.size);
    for (const [index, line] of lines.entries()) {
      this.text(`${index === 0 ? options.firstPrefix : options.nextPrefix}${line}`, options.size, options.weight, options.x);
    }
  }

  gap(points) {
    this.y -= points;
  }

  async render() {
    return Buffer.from(await this.doc.save());
  }
}

// Renders the resume exactly as written in the profile - no per-job
// tailoring, ordering, or skill re-ranking. One PDF, reused for every
// company in a run, so what gets sent always matches the original resume.
export async function createResumePdf(resume) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${resume.name} - Resume`);
  const fonts = await embedFonts(doc);
  const pdf = new PdfLayout(doc, fonts);

  pdf.center(resume.name, 18, "bold");
  pdf.center(resume.headline, 10, "regular");
  pdf.center(`${resume.phone} | ${resume.email} | ${resume.alternateEmail}`, 9, "regular");
  pdf.gap(7);

  pdf.section("Summary");
  pdf.bullet(resume.summary, 9);

  pdf.section("Education");
  for (const item of resume.education) pdf.bullet(item, 9);

  pdf.section("Experience");
  for (const item of resume.experience) {
    pdf.bullet(item.company, 9.2, "bold");
    pdf.indentText(`${item.role} | ${item.dates}`, 9, "italic");
    for (const bullet of item.bullets) pdf.bullet(bullet, 9);
  }

  pdf.section("Projects");
  for (const project of resume.projects) {
    pdf.bullet(project.name, 9.2, "bold");
    pdf.indentText(project.tools.join(", "), 9, "italic");
    for (const bullet of project.bullets) pdf.bullet(bullet, 9);
  }

  pdf.section("Technical Skills");
  for (const [category, values] of Object.entries(resume.skills)) {
    pdf.bullet(`${category}: ${values.join(", ")}`, 9);
  }

  pdf.section("Positions of Responsibility");
  for (const item of resume.responsibilities) pdf.bullet(item, 9);

  if (resume.hobbies) {
    pdf.section("Hobbies & Interests");
    pdf.bullet(resume.hobbies, 9);
  }

  return pdf.render();
}

export async function createCoverLetterPdf(lines, title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const fonts = await embedFonts(doc);
  const pdf = new PdfLayout(doc, fonts, { marginLeft: 56, marginRight: 56, marginTop: 62, marginBottom: 54 });
  const [name, contact, , greeting, , ...rest] = lines;
  const closingIndex = rest.findIndex((line) => line === "Sincerely,");
  const paragraphs = closingIndex >= 0 ? rest.slice(0, closingIndex).filter(Boolean) : rest.filter(Boolean);
  const closing = closingIndex >= 0 ? rest.slice(closingIndex).filter(Boolean) : [];

  pdf.text(name, 14, "bold");
  pdf.text(contact, 9, "regular");
  pdf.text(formatHumanDate(new Date()), 9, "regular");
  pdf.gap(18);
  pdf.text(greeting, 10.5, "regular");
  pdf.gap(8);
  for (const paragraph of paragraphs) {
    pdf.paragraph(paragraph, 10.5);
    pdf.gap(8);
  }
  pdf.gap(6);
  for (const line of closing) pdf.text(line, 10.5, "regular");
  return pdf.render();
}
