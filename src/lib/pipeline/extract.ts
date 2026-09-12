import "server-only";
import type { ExtractedDocument } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * Deterministic document inspection: image dimensions, PDF text, and labelled
 * fields. No model, no network — so it produces the same answer every time and
 * still works when OPENROUTER_API_KEY is absent.
 *
 * This is the floor, not the ceiling. `verify.ts` runs the vision model on top when
 * one is configured and lets it overrule anything here. What this module must never
 * do is guess: an unreadable image reports `legible: false` with the measurement
 * that failed, and a scan with no text layer reports `null` (unknown), never "fine".
 */

const logger = log.scope("extract");

// ---------------------------------------------------------------------------
// image dimensions (PNG / JPEG headers — no image library)
// ---------------------------------------------------------------------------

export type ImageDimensions = { width: number; height: number };

export function pngDimensions(bytes: Buffer): ImageDimensions | null {
  // 8-byte signature, then the IHDR chunk: 4-byte length, "IHDR", width, height.
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function jpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resynchronize on padding bytes
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers at 0xc4/0xc8/0xcc.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

export function imageDimensions(bytes: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType.includes("png")) return pngDimensions(bytes);
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return jpegDimensions(bytes);
  return pngDimensions(bytes) ?? jpegDimensions(bytes);
}

// ---------------------------------------------------------------------------
// legibility floor
// ---------------------------------------------------------------------------

/**
 * A phone photo of a letter-size page needs roughly 1000px on its long edge before
 * printed text survives USCIS's black-and-white scanning ("Submit legible copies of
 * official documents … Are not blurry or faded", uscis.gov filing tips). These
 * thresholds are deliberately generous: they only catch copies that cannot possibly
 * be read, and everything else is passed to the vision model or to a human.
 */
export const MIN_LONG_EDGE_PX = 900;
export const MIN_SHORT_EDGE_PX = 600;
export const MIN_IMAGE_BYTES = 20_000;

/**
 * Why a document was refused, as a code rather than a sentence.
 *
 * The client is told in their own language (src/lib/pipeline/rejections.ts) and the
 * paralegal sees the measurement in `notes`. An English sentence interpolated into a
 * Spanish template is the kind of seam that makes a clinic stop trusting the tool.
 */
export type RejectionCode =
  | "too_small"
  | "too_compressed"
  | "unreadable_file"
  | "unknown_document"
  | "not_requested"
  | "file_missing";

export type LegibilityCheck = {
  /** true = readable, false = definitely not, null = cannot tell without a model or a person. */
  legible: boolean | null;
  /** One line naming the measurement that decided it. Shown to the paralegal. */
  notes: string;
  /** Why it failed, when it did. Translated for the client at send time. */
  reasonCode?: RejectionCode;
  dimensions?: ImageDimensions;
};

export function checkLegibility(bytes: Buffer, mimeType: string, textLength = 0): LegibilityCheck {
  if (mimeType === "application/pdf") {
    if (textLength >= 40) return { legible: true, notes: `PDF text layer: ${textLength} characters extracted.` };
    return {
      legible: null,
      notes: "PDF has no usable text layer (likely a scan); legibility needs the vision model or a person.",
    };
  }

  if (!mimeType.startsWith("image/")) {
    return { legible: null, notes: `Unsupported type ${mimeType}; not checked.` };
  }

  const dims = imageDimensions(bytes, mimeType);
  if (!dims) {
    return bytes.length < MIN_IMAGE_BYTES
      ? {
          legible: false,
          notes: `Image is only ${Math.round(bytes.length / 1024)} KB and its dimensions could not be read.`,
          reasonCode: "unreadable_file",
        }
      : { legible: null, notes: "Image dimensions could not be read; not checked." };
  }

  const long = Math.max(dims.width, dims.height);
  const short = Math.min(dims.width, dims.height);
  if (long < MIN_LONG_EDGE_PX || short < MIN_SHORT_EDGE_PX) {
    return {
      legible: false,
      notes: `Image is ${dims.width}×${dims.height}px, below the ${MIN_LONG_EDGE_PX}×${MIN_SHORT_EDGE_PX}px floor for readable text.`,
      reasonCode: "too_small",
      dimensions: dims,
    };
  }
  if (bytes.length < MIN_IMAGE_BYTES) {
    return {
      legible: false,
      notes: `Image is ${dims.width}×${dims.height}px but only ${Math.round(bytes.length / 1024)} KB — heavily compressed.`,
      reasonCode: "too_compressed",
      dimensions: dims,
    };
  }
  return { legible: null, notes: `Image is ${dims.width}×${dims.height}px; size is adequate.`, dimensions: dims };
}

// ---------------------------------------------------------------------------
// PDF text
// ---------------------------------------------------------------------------

/**
 * Extract a PDF's text layer. Returns "" for image-only PDFs (a phone scan has no
 * text layer) and on any failure — the caller must treat "" as "unknown", never as
 * "empty document".
 *
 * pdf-parse 2.x is a class, not the callable default export 1.x had.
 */
export async function pdfText(bytes: Buffer): Promise<string> {
  let parser: { getText(): Promise<{ text?: string }>; destroy?: () => Promise<void> } | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(bytes) });
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } catch (err) {
    logger.warn("pdf text extraction failed", { err: String(err) });
    return "";
  } finally {
    await parser?.destroy?.().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// labelled field extraction
// ---------------------------------------------------------------------------

/**
 * Pull labelled fields out of a document's text. Only exact label matches count —
 * "Date of Birth: 1988-03-14" yields a date of birth; a bare date in a paragraph
 * does not. Extraction that is unsure returns nothing, because a wrong field value
 * turns into a wrong flag on a paralegal's screen.
 */
const FIELD_LABELS: { field: string; labels: string[] }[] = [
  { field: "fullName", labels: ["full name", "name", "nombre", "nombre completo", "nom", "nome", "holder", "applicant name", "surname and given names"] },
  { field: "dateOfBirth", labels: ["date of birth", "birth date", "dob", "fecha de nacimiento", "date de naissance", "data de nascimento", "born on"] },
  { field: "placeOfBirth", labels: ["place of birth", "lugar de nacimiento", "lieu de naissance"] },
  { field: "address", labels: ["address", "mailing address", "current address", "direccion", "dirección", "domicilio", "adresse"] },
  { field: "expirationDate", labels: ["expiration date", "expires", "expiration", "date of expiration", "valid until", "fecha de vencimiento", "vence", "expira"] },
  { field: "documentNumber", labels: ["document number", "passport no", "passport number", "card number", "number", "numero", "número", "a-number", "a number", "uscis number"] },
  { field: "issuingAuthority", labels: ["issuing authority", "issued by", "autoridad", "expedido por", "registro civil"] },
  { field: "language", labels: ["language", "idioma", "langue"] },
  { field: "sex", labels: ["sex", "gender", "sexo"] },
  { field: "nationality", labels: ["nationality", "nacionalidad", "country of citizenship", "nationalité"] },
];

const LABEL_LOOKUP = new Map<string, string>();
for (const { field, labels } of FIELD_LABELS) {
  for (const label of labels) LABEL_LOOKUP.set(label, field);
}

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `Label: value` pairs, one per line. Later lines do not overwrite earlier ones. */
export function extractLabelledFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]{2,40}):\s*(.+?)\s*$/);
    if (!m) continue;
    const field = LABEL_LOOKUP.get(normalizeLabel(m[1]));
    if (!field || out[field]) continue;
    const value = m[2].trim();
    if (value && value.length <= 120) out[field] = value;
  }
  return out;
}

/** Required-looking fields left blank: `Label:` with nothing after it, or an underscore rule. */
export function extractBlankFields(text: string): string[] {
  const blanks: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][^:]{2,60}?)\s*:\s*(_{2,}|-{2,}|)\s*$/);
    if (!m) continue;
    const label = m[1].trim();
    if (/^(note|notes|remarks?|comments?)$/i.test(label)) continue;
    if (!blanks.includes(label)) blanks.push(label);
  }
  return blanks.slice(0, 8);
}

const DOC_TYPE_RULES: { type: string; re: RegExp }[] = [
  { type: "birth_certificate", re: /birth certificate|certificate of (live )?birth|acta de nacimiento|certificado de nacimiento|certidão de nascimento|extrait de naissance/i },
  { type: "passport", re: /\bpassport\b|\bpasaporte\b|\bpasseport\b/i },
  { type: "permanent_resident_card", re: /permanent resident card|resident alien|green ?card|\bI-?551\b/i },
  { type: "employment_authorization", re: /employment authorization|\bI-?766\b|work permit/i },
  { type: "i-94", re: /\bI-?94\b|arrival\/departure record/i },
  { type: "uscis_notice", re: /\bI-?797\b|notice of action|receipt notice|u\.?s\.? citizenship and immigration services/i },
  { type: "drivers_license", re: /driver'?s? licen[cs]e|licencia de conducir/i },
  { type: "marriage_certificate", re: /marriage certificate|acta de matrimonio|certificate of marriage/i },
  { type: "translation", re: /certif(ied|ication) (of )?translat|translator'?s? certificat|traducci[oó]n certificada/i },
];

/** Classify a document by the phrases printed on it. Returns null when nothing matches. */
export function classifyDocumentText(text: string, filename?: string | null): string | null {
  const haystack = `${text}\n${filename ?? ""}`;
  for (const { type, re } of DOC_TYPE_RULES) {
    if (re.test(haystack)) return type;
  }
  return null;
}

export type DeterministicExtraction = {
  extracted: ExtractedDocument;
  legibility: LegibilityCheck;
  /** Characters of text recovered, so callers can tell "no text" from "no fields". */
  textLength: number;
};

/** Everything the deterministic path can say about one file. */
export async function extractDeterministically(input: {
  bytes: Buffer;
  mimeType: string;
  filename?: string | null;
}): Promise<DeterministicExtraction> {
  const text = input.mimeType === "application/pdf" ? await pdfText(input.bytes) : "";
  const legibility = checkLegibility(input.bytes, input.mimeType, text.length);
  const fields = extractLabelledFields(text);
  const docType = classifyDocumentText(text, input.filename);

  const extracted: ExtractedDocument = {
    docType: docType ?? "unknown",
    summary: docType
      ? `Recognized as ${docType.replace(/_/g, " ")} from the text printed on the document.`
      : "Document type could not be determined from the text on the document.",
    fields,
    blankRequiredFields: extractBlankFields(text),
    rawText: text ? text.slice(0, 8000) : undefined,
    legibilityNotes: legibility.notes,
  };
  return { extracted, legibility, textLength: text.length };
}
