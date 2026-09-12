import type { RejectionCode } from "./extract";

/**
 * What the client is told when a document comes back.
 *
 * Clinic-owned fixed text, like the message templates — one short line per reason,
 * written so the client knows what to do differently. The paralegal sees the
 * measurement that produced the code (`LegibilityCheck.notes`); the client sees this.
 */
const REASONS: Record<string, Record<RejectionCode, string>> = {
  en: {
    too_small: "the photo is too small for us to read the text",
    too_compressed: "the photo is too blurry for us to read the text",
    unreadable_file: "we could not read the file",
    unknown_document: "we could not tell which document this is",
    not_requested: "it does not look like one of the documents we asked for",
    file_missing: "the file did not arrive",
  },
  es: {
    too_small: "la foto es demasiado pequeña para leer el texto",
    too_compressed: "la foto está demasiado borrosa para leer el texto",
    unreadable_file: "no pudimos leer el archivo",
    unknown_document: "no pudimos identificar qué documento es",
    not_requested: "no parece ser uno de los documentos que le pedimos",
    file_missing: "el archivo no llegó",
  },
};

export function rejectionReason(code: RejectionCode, language = "en"): string {
  return (REASONS[language] ?? REASONS.en)[code] ?? REASONS.en[code];
}
