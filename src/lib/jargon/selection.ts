/**
 * Selection handling for the in-page overlay (spec §3.2).
 *
 * Pure, browser-free geometry and text rules so the reader component holds nothing
 * but DOM wiring. Two jobs:
 *
 * 1. Decide what a selection means. A PDF text layer hands back text broken by the
 *    line boxes it was drawn in, so "adjustment of sta-\ntus" has to become
 *    "adjustment of status" before it is worth looking up, and anything too short or
 *    too long is not a term at all.
 * 2. Place the card. Coordinates are relative to the scrolling document, so the card
 *    travels with the text it explains instead of being hidden on scroll the way the
 *    extension's fixed card is.
 */

/** Below this, a selection is a stray click or a single word fragment, not a term. */
export const SELECTION_MIN_CHARS = 3;
/** Matches the `text` bound on POST /api/jargon/explain — a longer selection is a page, not a term. */
export const SELECTION_MAX_CHARS = 400;

/** Gap between the selected line and the card, in CSS pixels. */
export const CARD_GAP = 10;

/**
 * Collapse a PDF text-layer selection into one line of prose.
 *
 * Soft hyphens and a hyphen at a line break are joins ("sta-\ntus" → "status");
 * every other run of whitespace becomes a single space.
 */
export function normalizeSelection(raw: string): string {
  return raw
    .replace(/­/g, "")
    .replace(/(\p{Ll})-[\r\n]+(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export type SelectionVerdict =
  /** Nothing to do: no selection, or too short to be a term. The card stays closed. */
  | { kind: "ignore" }
  /** A whole paragraph or page. The card says so rather than sending it. */
  | { kind: "too_long"; text: string }
  /** Worth an explain call. */
  | { kind: "lookup"; text: string };

/** What the overlay should do with the raw `Selection.toString()` of a selection. */
export function classifySelection(raw: string): SelectionVerdict {
  const text = normalizeSelection(raw);
  if (text.length < SELECTION_MIN_CHARS) return { kind: "ignore" };
  if (text.length > SELECTION_MAX_CHARS) return { kind: "too_long", text };
  return { kind: "lookup", text };
}

/** A selection's box in the coordinates of the scrolling document, not the screen. */
export type SelectionRect = { top: number; left: number; bottom: number; right: number };

/** The scrolling document the card is placed inside, in its own coordinates. */
export type Frame = {
  /** Full scrollable size. */
  width: number;
  height: number;
  /** The part of it on screen right now. */
  scrollTop: number;
  viewHeight: number;
};

export type CardPlacement = { left: number; top: number; side: "above" | "below" };

/**
 * Anchor the card next to a selection: under it by default, above it when the card
 * would otherwise run off the bottom of the visible area and there is room above.
 *
 * A real explanation and its passage can be nearly as tall as the reader, leaving room
 * on neither side. The card is then slid into the visible area instead — overlapping
 * the line it explains is recoverable, having the escalate button clipped off the
 * bottom is not. Also clamped so the card never hangs outside the document.
 */
export function anchorCard(sel: SelectionRect, card: { width: number; height: number }, frame: Frame, gap = CARD_GAP): CardPlacement {
  const below = sel.bottom + gap;
  const above = sel.top - gap - card.height;
  const fitsBelow = below + card.height <= frame.scrollTop + frame.viewHeight;
  const fitsAbove = above >= frame.scrollTop;
  const side: CardPlacement["side"] = fitsBelow || !fitsAbove ? "below" : "above";

  const lowestOnScreen = frame.scrollTop + Math.max(0, frame.viewHeight - card.height);
  const onScreen = clamp(side === "below" ? below : above, frame.scrollTop, lowestOnScreen);
  return {
    left: clamp(sel.left, 0, Math.max(0, frame.width - card.width)),
    top: clamp(onScreen, 0, Math.max(0, frame.height - card.height)),
    side,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * The `pageUrl` the overlay reports for a document being read in the browser.
 *
 * The reader is not a web page the clinic can link to, and a filename can carry the
 * client's name, so neither is sent. What goes over the wire is this page's own URL
 * plus the form number the document announces — enough for retrieval to prefer that
 * form's instructions (`ground(..., { hint })`), and nothing about the reader.
 */
export function readerPageUrl(origin: string, pathname: string, formHint?: string): string {
  const base = `${origin}${pathname}`;
  return formHint ? `${base}?form=${encodeURIComponent(formHint)}` : base;
}
