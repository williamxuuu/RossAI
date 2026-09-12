/**
 * Wire shapes for the public jargon API, shared by the routes that produce them
 * and the overlay that renders them.
 *
 * The overlay renders these fields verbatim and has no code path that writes an
 * explanation of its own (spec §4.1) — so the type is the contract: an
 * explanation only ever arrives alongside the citation that grounds it.
 */

export type Citation = { title: string; url: string; quote: string };

export type ExplainResponse =
  | { grounded: true; language: string; explanation: string; citation: Citation; formHint?: string }
  | { grounded: false; language: string; reason: string; message: string; formHint?: string };

export type EscalateResponse = { ok: true; escalationId: string };
