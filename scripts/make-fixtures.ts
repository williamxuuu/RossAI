/**
 * Build the demo document packet (`npm run fixtures`).
 *
 * These are the files the /dev/phone simulator emails in, and the reason the demo
 * produces real flags with no API keys: the PDFs have a real text layer, so the
 * deterministic extractor in src/lib/pipeline/extract.ts finds real labelled fields,
 * and the scan rules find real contradictions between them. Nothing is faked at the
 * flag level — the disagreements are actually printed on the pages.
 *
 * What each file is built to trigger, in the packet as a whole:
 *   acta-de-nacimiento.pdf   Spanish, no translation in the packet → missing_translation
 *   passport.pdf             expiration inside six months           → id_expiration
 *   i-797-notice.pdf         a different name and a different DOB   → name_mismatch, dob_mismatch
 *                            two blank required fields              → blank_required_field
 *   marriage-certificate.pdf consistent — it is here so the packet is not all problems
 *   photo-id-blurry.png      240×160 → below the legibility floor, rejected on arrival
 *   photo-id.png             1400×900 → accepted
 *
 * Regenerate with `npm run fixtures` after changing a rule; `npm run db:seed` reads
 * whatever is in src/db/fixtures.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT_DIR = path.join(process.cwd(), "src", "db", "fixtures");

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

type Doc = { filename: string; title: string; lines: string[] };

/**
 * One page of monospaced label/value lines. Courier is used on purpose: it is what
 * a filled government form looks like after scanning, and pdf-parse keeps the
 * `Label: value` line structure the extractor matches on.
 */
async function buildPdf(doc: Doc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const bold = await pdf.embedFont(StandardFonts.CourierBold);
  const body = await pdf.embedFont(StandardFonts.Courier);
  const ink = rgb(0.14, 0.13, 0.12);

  let y = 720;
  for (const line of doc.title.split("\n")) {
    page.drawText(line, { x: 56, y, size: 13, font: bold, color: ink });
    y -= 22;
  }
  y -= 14;
  for (const line of doc.lines) {
    page.drawText(line, { x: 56, y, size: 11, font: body, color: ink });
    y -= 18;
  }
  pdf.setTitle(doc.title.replace(/\n/g, " — "));
  return pdf.save();
}

const PDFS: Doc[] = [
  {
    filename: "acta-de-nacimiento.pdf",
    title: "REGISTRO CIVIL DEL ESTADO DE JALISCO\nACTA DE NACIMIENTO",
    lines: [
      "Nombre: Maria Elena Garcia Lopez",
      "Fecha de nacimiento: 14/03/1988",
      "Lugar de nacimiento: Guadalajara, Jalisco, Mexico",
      "Sexo: Femenino",
      "Idioma: Espanol",
      "",
      "Nombre del padre: Jose Luis Garcia Ramirez",
      "Nombre de la madre: Elena Lopez Morales",
      "",
      "Autoridad: Oficialia del Registro Civil de Guadalajara",
      "Libro: 12   Acta: 0447   Ano de registro: 1988",
      "",
      "El presente documento certifica que la persona arriba mencionada",
      "fue registrada en el libro de nacimientos de esta oficialia del",
      "registro civil, de conformidad con la ley del estado de Jalisco.",
    ],
  },
  {
    filename: "passport.pdf",
    title: "ESTADOS UNIDOS MEXICANOS\nPASAPORTE / PASSPORT",
    lines: [
      "Surname and given names: GARCIA LOPEZ MARIA ELENA",
      "Date of birth: 14 MAR 1988",
      "Place of birth: GUADALAJARA, JALISCO",
      "Nationality: MEXICAN",
      "Sex: F",
      "Document number: G12345678",
      "Issuing authority: SECRETARIA DE RELACIONES EXTERIORES",
      "Date of issue: 2016-12-01",
      "Expiration date: 2026-11-30",
    ],
  },
  {
    filename: "i-797-notice.pdf",
    title: "U.S. CITIZENSHIP AND IMMIGRATION SERVICES\nFORM I-797C, NOTICE OF ACTION",
    lines: [
      "Notice type: Receipt Notice",
      "Name: MARIA E. GARCIA",
      "Date of birth: 03/04/1988",
      "Address: 412 W Main Street Apt 3, Houston, TX 77002",
      "",
      "Receipt Number: __________",
      "Priority Date: __________",
      "",
      "This notice does not grant any immigration status or benefit.",
      "Keep this notice with your records.",
    ],
  },
  {
    filename: "marriage-certificate.pdf",
    title: "STATE OF TEXAS\nCERTIFICATE OF MARRIAGE",
    lines: [
      "Full name: Maria Elena Garcia Lopez",
      "Date of birth: 14/03/1988",
      "Address: 412 West Main St. #3, Houston, Texas 77002",
      "Date of marriage: 2019-06-22",
      "County: Harris",
      "Issuing authority: Harris County Clerk",
    ],
  },
];

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A minimal RGB PNG, written by hand so the fixtures need no image library.
 * `detail` draws a grid of dark bars: it makes the file look like a scan rather than
 * a flat rectangle, and it keeps the compressed size above the extractor's
 * "suspiciously small" floor for the copy that is supposed to pass.
 */
function buildPng(width: number, height: number, detail: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const onBar = detail > 0 && (Math.floor(x / detail) + Math.floor(y / detail)) % 2 === 0;
      const v = onBar ? 60 + ((x * 7 + y * 13) % 40) : 232;
      const i = rowStart + 1 + x * 3;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const written: string[] = [];

  for (const doc of PDFS) {
    await writeFile(path.join(OUT_DIR, doc.filename), await buildPdf(doc));
    written.push(doc.filename);
  }

  // 1400×900: comfortably above MIN_LONG_EDGE_PX / MIN_SHORT_EDGE_PX.
  await writeFile(path.join(OUT_DIR, "photo-id.png"), buildPng(1400, 900, 9));
  written.push("photo-id.png");

  // 240×160: below the floor, so the pipeline rejects it and re-requests the document.
  await writeFile(path.join(OUT_DIR, "photo-id-blurry.png"), buildPng(240, 160, 0));
  written.push("photo-id-blurry.png");

  console.log(`wrote ${written.length} fixtures to ${path.relative(process.cwd(), OUT_DIR)}`);
  for (const f of written) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
