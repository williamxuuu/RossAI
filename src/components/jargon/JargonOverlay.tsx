"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { anchorCard, type Frame, type SelectionRect } from "@/lib/jargon/selection";
import type { EscalateResponse, ExplainResponse } from "@/lib/jargon/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ExternalIcon } from "@/components/ui/icons";

/**
 * The card that appears next to selected text (spec §5: "compact floating card,
 * anchored to selection, max 360px wide"). The in-page twin of extension/content.js,
 * and it keeps the same three rules:
 *
 * 1. NEVER GUESS. Everything the client reads here came from the server. When the
 *    server says `grounded: false` this renders the server's message and the escalate
 *    button — there is no branch that writes an explanation of its own, and an
 *    explanation cannot be rendered apart from the citation that grounds it.
 * 2. NEVER ADVISE. The disclaimer ships with every grounded answer.
 * 3. The selected text may be PII. It is sent to the clinic's own API and nowhere
 *    else, and it is never put in the URL.
 */

export type JargonSelection = {
  /** Normalized selection text (see `classifySelection`). */
  text: string;
  /** Where it sits in the scrolling document, in that document's coordinates. */
  rect: SelectionRect;
  /** Past the API's length limit: say so rather than sending a whole page. */
  tooLong: boolean;
};

export type JargonOverlayProps = {
  selection: JargonSelection;
  frame: Frame;
  language: string;
  pageUrl: string;
  onClose: () => void;
};

const CARD_WIDTH = 340;
/** The header echoes the selection back; past this it is a sentence, not a label. */
const HEADER_CHARS = 60;

type Phase =
  | { state: "loading" }
  | { state: "too_long" }
  | { state: "answer"; body: ExplainResponse }
  | { state: "error"; message: string };

export function JargonOverlay({ selection, frame, language, pageUrl, onClose }: JargonOverlayProps) {
  const { text, rect, tooLong } = selection;
  const [phase, setPhase] = useState<Phase>(tooLong ? { state: "too_long" } : { state: "loading" });
  const cardRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: rect.left, top: rect.bottom + 10 });

  // One card per selection: the reader keys this component on the selected text, so
  // the phase starts correct at mount and only ever moves forward from the response.
  useEffect(() => {
    if (tooLong) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/jargon/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, language, pageUrl }),
          signal: abort.signal,
        });
        if (res.status === 429) {
          setPhase({ state: "error", message: "Too many lookups in a row. Please wait a moment and select it again." });
          return;
        }
        if (!res.ok) {
          setPhase({ state: "error", message: "We could not reach the clinic's server. Please try again in a moment." });
          return;
        }
        setPhase({ state: "answer", body: (await res.json()) as ExplainResponse });
      } catch {
        if (abort.signal.aborted) return;
        setPhase({ state: "error", message: "We could not reach the clinic's server. Please try again in a moment." });
      }
    })();
    return () => abort.abort();
  }, [text, language, pageUrl, tooLong]);

  // Re-anchor once the card has a real height: the answer is taller than the
  // "looking this up" line, which can turn a card that fit below into one that does not.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const placed = anchorCard(rect, { width: el.offsetWidth, height: el.offsetHeight }, frame);
    setAt({ left: placed.left, top: placed.top });
  }, [rect, frame, phase]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Explanation of the selected text"
      style={{ left: at.left, top: at.top, width: CARD_WIDTH }}
      // A real explanation plus its passage can outgrow the reader's viewport. Capping
      // the card keeps the escalate button reachable and keeps `anchorCard` honest —
      // it places the card off the height measured here.
      className="panel absolute z-20 flex max-h-[min(26rem,60vh)] max-w-[calc(100%-1.5rem)] flex-col p-5"
      // The card lives inside the reader, where a mousedown clears the selection.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="section-label min-w-0 flex-1 truncate" title={text.length > HEADER_CHARS ? undefined : text}>
          {text.length > HEADER_CHARS ? `${text.slice(0, HEADER_CHARS)}…` : text}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mt-1 shrink-0 text-lg leading-none text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PhaseBody phase={phase} />
      </div>

      {/* Outside the scroll area on purpose: a long passage must never push the
          no-advice line or "ask the clinic" out of reach — the first is a promise the
          product makes with every answer, the second is the one thing the client can
          always do. */}
      {phase.state === "answer" ? (
        <div className="mt-3 flex shrink-0 flex-col gap-2">
          {phase.body.grounded ? (
            <p className="text-[0.6875rem] leading-relaxed text-muted">
              This explains what the words mean. It is not legal advice and it does not say what you should do.
            </p>
          ) : null}
          <EscalateAction
            text={text}
            language={language}
            pageUrl={pageUrl}
            label={phase.body.grounded ? "Still confused — ask the clinic" : "Ask the clinic"}
          />
        </div>
      ) : null}
    </div>
  );
}

function PhaseBody({ phase }: { phase: Phase }) {
  if (phase.state === "loading") {
    return <p className="text-[0.8125rem] leading-relaxed text-muted">Looking this up in the official USCIS material…</p>;
  }

  if (phase.state === "too_long") {
    return (
      <p className="text-sm leading-relaxed text-ink">That is a lot of text at once. Select a sentence or a single term and try again.</p>
    );
  }

  if (phase.state === "error") {
    return <p className="text-sm leading-relaxed text-error">{phase.message}</p>;
  }

  const body = phase.body;
  return (
    <div className="flex flex-col gap-3">
      {body.formHint ? (
        <div>
          <Chip tone="neutral">{body.formHint}</Chip>
        </div>
      ) : null}

      <p className="text-sm leading-relaxed text-ink">{body.grounded ? body.explanation : body.message}</p>

      {body.grounded ? (
        <figure className="rounded-[var(--radius-tile)] bg-surface p-3">
          {/* Exa highlights off a form-instructions PDF can run to thousands of characters.
              The passage is shown so the client can check the explanation against it, not
              read the form here — so it is clamped, with the source one tap below. */}
          <blockquote className="line-clamp-3 border-l-2 border-border pl-2.5 text-xs leading-relaxed whitespace-pre-line text-muted">
            &ldquo;{body.citation.quote}&rdquo;
          </blockquote>
          <a
            href={body.citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            {body.citation.title}
            <ExternalIcon size={12} />
          </a>
        </figure>
      ) : null}

    </div>
  );
}

/** "Still confused — ask the clinic" → an escalation a paralegal picks up in the console. */
function EscalateAction({ text, language, pageUrl, label }: { text: string; language: string; pageUrl: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  if (status === "sent") {
    return <p className="text-xs leading-relaxed text-ok">Sent. Someone from the clinic will look at this and reply to you.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="sm"
        variant="primary"
        busy={status === "busy"}
        onClick={async () => {
          setStatus("busy");
          try {
            const res = await fetch("/api/jargon/escalate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text, language, pageUrl }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            (await res.json()) as EscalateResponse;
            setStatus("sent");
          } catch {
            setStatus("failed");
          }
        }}
      >
        {label}
      </Button>
      {status === "failed" ? <p className="text-xs leading-relaxed text-error">We could not reach the clinic. Please try again in a moment.</p> : null}
    </div>
  );
}
