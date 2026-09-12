"use client";
import { useState } from "react";
import type { Flag } from "@/db/schema";
import type { Iso } from "@/lib/queries";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";
import { CitationBlock } from "./CitationBlock";
import { FLAG_STATUS_LABEL, SEVERITY_BAR, SEVERITY_LABEL, flagStatusTone, severityTone } from "./labels";
import type { FlagDecisionBody } from "./api";

/**
 * One finding, with its gate (spec §3.6: "each a card with Approve / Edit / Request
 * more info").
 *
 * The card states the problem in one line, the proposed fix in one line, and the
 * source under both. Nothing is pre-selected and nothing happens on hover: the
 * paralegal's click is the only thing that resolves a flag, and "Request more info"
 * is the only button on this card that sends a client anything.
 */

export type FlagCardProps = {
  flag: Iso<Flag>;
  selected: boolean;
  busy: boolean;
  error?: string;
  documentLabels: Record<string, string>;
  onSelect: () => void;
  onDecide: (body: FlagDecisionBody) => void;
};

type Mode = "idle" | "edit" | "request";

export function FlagCard({ flag, selected, busy, error, documentLabels, onSelect, onDecide }: FlagCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [editedText, setEditedText] = useState(flag.editedText ?? flag.proposedFix);
  const [requestText, setRequestText] = useState("");
  const resolved = flag.status !== "open";

  return (
    <article
      id={`flag-${flag.id}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={
        "relative overflow-hidden rounded-[var(--radius-panel)] bg-panel p-5 transition-shadow " +
        (selected ? "shadow-[var(--shadow-panel)] ring-1 ring-accent/40" : "shadow-sm hover:shadow-[var(--shadow-panel)]")
      }
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_BAR[flag.severity]}`} />

      <header className="flex flex-wrap items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={severityTone(flag.severity)}>{SEVERITY_LABEL[flag.severity]}</Chip>
            {resolved ? <Chip tone={flagStatusTone(flag.status)}>{FLAG_STATUS_LABEL[flag.status]}</Chip> : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-ink">{flag.fieldRef}</h3>
        </div>
      </header>

      <div className="mt-3 flex flex-col gap-3 pl-2">
        <p className="text-sm leading-relaxed text-ink">{flag.description}</p>
        <p className="text-sm leading-relaxed text-muted">
          <span className="section-label mr-2">Proposed fix</span>
          {flag.editedText ?? flag.proposedFix}
        </p>

        {flag.evidenceDocumentIds.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="section-label">Evidence</span>
            {flag.evidenceDocumentIds.map((id) => (
              <Chip key={id} tone="neutral">
                {documentLabels[id] ?? "document"}
              </Chip>
            ))}
          </p>
        ) : null}

        <CitationBlock citation={flag.sourceCitation} compact />

        {error ? <p className="text-xs text-error">{error}</p> : null}

        {resolved ? (
          <p className="text-xs text-muted">
            {FLAG_STATUS_LABEL[flag.status]}
            {flag.resolvedBy ? ` by ${flag.resolvedBy.replace(/^auth0\||^dev\|/, "")}` : ""}.
          </p>
        ) : mode === "idle" ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" busy={busy} onClick={() => onDecide({ decision: "approve" })}>
              Approve
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setMode("request")}>
              Request more info
            </Button>
            <Button variant="ghost" size="sm" busy={busy} onClick={() => onDecide({ decision: "reject" })}>
              Not a problem
            </Button>
          </div>
        ) : mode === "edit" ? (
          <Composer
            label="Rewrite the fix in your own words"
            hint="This replaces the agent's wording on the flag. It is not sent to the client."
            value={editedText}
            onChange={setEditedText}
            confirmLabel="Save edit"
            busy={busy}
            onCancel={() => setMode("idle")}
            onConfirm={() => onDecide({ decision: "edit", editedText })}
          />
        ) : (
          <Composer
            label="What should the client be asked for?"
            hint="Write it in English. It is translated into the client's language and sent as your approved message."
            value={requestText}
            onChange={setRequestText}
            confirmLabel="Send to client"
            busy={busy}
            onCancel={() => setMode("idle")}
            onConfirm={() => onDecide({ decision: "request_more_info", requestText })}
          />
        )}
      </div>
    </article>
  );
}

function Composer({
  label,
  hint,
  value,
  onChange,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <label className="section-label" htmlFor={`composer-${label}`}>
        {label}
      </label>
      <Textarea id={`composer-${label}`} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      <p className="text-xs text-muted">{hint}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" busy={busy} disabled={!value.trim()} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
