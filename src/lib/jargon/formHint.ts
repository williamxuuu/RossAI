/**
 * Detect a USCIS form number in the selected text or the page URL so retrieval
 * can be biased toward that form's instructions (`ground(..., { hint })`).
 *
 * Patterns (spec for this module): I-\d{2,3}[A-Z]?, N-\d{3}, G-\d{2,4}
 * (G accepts two digits so "G-28" is caught). The optional suffix letter only
 * counts when it is not followed by another letter, so a URL like
 * ".../i-485instr.pdf" yields "I-485", not "I-485I".
 */
const FORM_NUMBER = /\b(I-\d{2,3}|N-\d{3}|G-\d{2,4})(?!\d)([A-Z](?![A-Z]))?/i;

/** First form number found in `text`, then in `pageUrl`. Normalized to upper case, e.g. "I-485". */
export function detectFormNumber(text: string, pageUrl?: string | null): string | undefined {
  return matchForm(text) ?? (pageUrl ? matchForm(pageUrl) : undefined);
}

function matchForm(s: string): string | undefined {
  const m = FORM_NUMBER.exec(s);
  if (!m) return undefined;
  return `${m[1]}${m[2] ?? ""}`.toUpperCase();
}
