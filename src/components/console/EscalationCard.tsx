"use client";
import { useState } from "react";
import type { Escalation } from "@/db/schema";
import type { Iso } from "@/lib/queries";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";
import { CitationBlock } from "./CitationBlock";
import { ESCALATION_STATUS_LABEL, escalationReasonLabel } from "./labels";
import { relativeTime } from "@/components/ui/time";

/**
 * A question the agent refused to answer (spec §3.5, §3.6 "any open client
 * escalations, with a draft reply the paralegal approves or rewrites").
 *
 * When the agent found a grounded answer it is shown as a DRAFT with its source, and
 * the paralegal still has to press send. When it found nothing, the box starts empty
 * — there is no "suggested" text to nudge them into approving something unchecked.
 */

export type EscalationCardProps = {
  escalation: Iso<Escalation>;
  busy: boolean;
  error?: string;
  onReply: (englishText: string) => void;
  onDismiss: () => void;
};

export function EscalationCard({ escalation, busy, error, onReply, onDismiss }: EscalationCardProps) {
  const [text, setText] = useState(escalation.draftReply ?? "");
  const open = escalation.status === "open";

  return (
    <article className="rounded-[var(--radius-panel)] bg-panel p-5 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={open ? "accent" : "neutral"}>{escalationReasonLabel(escalation.reason)}</Chip>
          {!open ? <Chip tone="neutral">{ESCALATION_STATUS_LABEL[escalation.status] ?? escalation.status}</Chip> : null}
        </div>
        <span className="text-[0.72rem] text-muted" suppressHydrationWarning>
          {relativeTime(escalation.createdAt)}
        </span>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{escalation.question}</p>

      {escalation.draftCitation ? (
        <div className="mt-3">
          <p className="section-label mb-2">Source the draft is based on</p>
          <CitationBlock citation={escalation.draftCitation} compact />
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 flex flex-col gap-2">
          <label className="section-label" htmlFor={`reply-${escalation.id}`}>
            {escalation.draftReply ? "Agent draft — edit before sending" : "Your reply"}
          </label>
          <Textarea
            id={`reply-${escalation.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Write in English. It is translated into the client's language and sent under your name."
          />
          {error ? <p className="text-xs text-error">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" busy={busy} disabled={!text.trim()} onClick={() => onReply(text)}>
              Approve &amp; send
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
