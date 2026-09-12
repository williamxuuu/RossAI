/**
 * Build the practice document the /jargon reader opens with (`npm run practice:pdf`).
 *
 * The reader needs a PDF with a real text layer to select from, and a client trying
 * the overlay for the first time should not have to upload their own paperwork to see
 * what it does. So this is a short, deliberately jargon-dense form-instruction excerpt
 * written by the clinic: every page says it is practice material and not an official
 * USCIS document, and it contains no one's data.
 *
 * The explanations the overlay shows still come from uscis.gov by way of Exa — nothing
 * on these pages is a source for anything (spec §4.1).
 *
 * Output: public/samples/practice-i-485-instructions.pdf
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const OUT = path.join(process.cwd(), "public", "samples", "practice-i-485-instructions.pdf");

const TITLE = "Form I-485, Application to Register Permanent Residence or Adjust Status";
const BANNER = "PRACTICE READING - NOT AN OFFICIAL USCIS DOCUMENT";

type Block = { heading?: string; body?: string; bullets?: string[] };

const PAGES: Block[][] = [
  [
    { body: "Instruction excerpt rewritten by the clinic for reading practice. Select any word or sentence to see what it means." },
    {
      heading: "What this application is",
      body:
        "Form I-485 is the application a person already in the United States files to ask for adjustment of status: to become a lawful permanent resident without leaving the country to apply for an immigrant visa abroad. Most people may file only when an immigrant visa is available to them, which depends on their priority date and the category shown in the Visa Bulletin for that month.",
    },
    {
      heading: "What you will be asked for",
      bullets: [
        "Your A-Number, if USCIS has already assigned you one.",
        "Your USCIS Online Account Number, if you have filed anything online before.",
        "The receipt notice, Form I-797, for the petition filed on your behalf.",
        "Two passport-style photographs and government-issued photo identification.",
        "A certified translation of any document that is not in English.",
      ],
    },
    {
      heading: "Financial support",
      body:
        "Family-based applications are generally filed with an Affidavit of Support, Form I-864, signed by the sponsor. The sponsor states their household size and their income, and USCIS uses it when considering whether an applicant is likely to become a public charge.",
    },
    {
      heading: "After you file",
      body:
        "USCIS mails a receipt notice, then a notice for a biometrics appointment at an Application Support Center, where fingerprints and a photograph are taken. Later notices may schedule an interview, or ask for something missing.",
    },
  ],
  [
    {
      heading: "Working and travelling while the application is pending",
      body:
        "An applicant may file Form I-765 to request an Employment Authorization Document, and Form I-131 to request advance parole before leaving the United States. Departing without advance parole may be treated as abandonment of the application, and time spent here without status may count as unlawful presence.",
    },
    {
      heading: "Words that appear in USCIS notices",
      bullets: [
        "Derivative beneficiary - a spouse or child who may apply because of the principal applicant.",
        "Priority date - the date that fixes an applicant's place in line in their category.",
        "Adjudication - the decision USCIS makes on an application.",
        "Request for Evidence - a notice asking for something the file is missing.",
        "Notice of Intent to Deny - a notice that USCIS expects to deny, and why.",
        "Waiver - a request to be excused from a ground of inadmissibility.",
      ],
    },
    {
      heading: "Questions on the form itself",
      body:
        "Part 8 of the form asks a long series of questions about a person's history, including whether they have ever been a member of, involved in, or in any way associated with any Communist or other totalitarian party, and whether they have ever ordered, incited, called for, committed, assisted, helped with, or otherwise participated in genocide.",
    },
    {
      body:
        "Selecting text on this page shows what the words mean, with the USCIS passage the explanation came from. It does not say whether anyone qualifies or how anyone should answer. For that, ask the clinic.",
    },
  ],
];

// ---------------------------------------------------------------------------

const INK = rgb(0.16, 0.15, 0.14);
const FAINT = rgb(0.42, 0.4, 0.38);
const MARGIN = 62;
const WIDTH = 612;
const HEIGHT = 792;
const TEXT_WIDTH = WIDTH - MARGIN * 2;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type Fonts = { body: PDFFont; bold: PDFFont };

function draw(page: PDFPage, fonts: Fonts, blocks: Block[], pageNumber: number, total: number): void {
  let y = HEIGHT - MARGIN;

  page.drawText(BANNER, { x: MARGIN, y, size: 8, font: fonts.bold, color: FAINT });
  y -= 26;

  if (pageNumber === 1) {
    for (const line of wrap(TITLE, fonts.bold, 15, TEXT_WIDTH)) {
      page.drawText(line, { x: MARGIN, y, size: 15, font: fonts.bold, color: INK });
      y -= 21;
    }
    y -= 10;
  }

  for (const block of blocks) {
    if (block.heading) {
      y -= 8;
      page.drawText(block.heading, { x: MARGIN, y, size: 11.5, font: fonts.bold, color: INK });
      y -= 18;
    }
    if (block.body) {
      for (const line of wrap(block.body, fonts.body, 10.5, TEXT_WIDTH)) {
        page.drawText(line, { x: MARGIN, y, size: 10.5, font: fonts.body, color: INK });
        y -= 16;
      }
      y -= 6;
    }
    for (const bullet of block.bullets ?? []) {
      const lines = wrap(bullet, fonts.body, 10.5, TEXT_WIDTH - 16);
      lines.forEach((line, i) => {
        if (i === 0) page.drawText("-", { x: MARGIN, y, size: 10.5, font: fonts.body, color: FAINT });
        page.drawText(line, { x: MARGIN + 16, y, size: 10.5, font: fonts.body, color: INK });
        y -= 16;
      });
      y -= 2;
    }
  }

  page.drawText(`Practice material prepared by the clinic. Page ${pageNumber} of ${total}.`, {
    x: MARGIN,
    y: MARGIN - 18,
    size: 8,
    font: fonts.body,
    color: FAINT,
  });
}

async function main(): Promise<void> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = { body: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };

  PAGES.forEach((blocks, i) => {
    draw(pdf.addPage([WIDTH, HEIGHT]), fonts, blocks, i + 1, PAGES.length);
  });

  // The reader reads this title to bias retrieval toward Form I-485's instructions.
  pdf.setTitle(`${TITLE} - practice excerpt`);
  pdf.setSubject(BANNER);
  pdf.setProducer("RossAI scripts/make-practice-form.ts");

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, await pdf.save());
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
