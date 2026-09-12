"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { QueueCase } from "@/lib/queries";
import { languageName } from "@/lib/i18n";
import { Chip } from "@/components/ui/Chip";
import { relativeTime } from "@/components/ui/time";
import { CASE_STATUS_LABEL } from "./labels";
import { NudgeButton } from "./NudgeButton";

/**
 * Muted, collapsed-by-default list of cases still in intake / collecting documents /
 * scanning. These are deliberately NOT in the queue (spec §3.3). The full view with
 * per-stage grouping and actions lives at /in-progress.
 */
export function InProgressPanel({ cases, defaultOpen = false }: { cases: QueueCase[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const revealWhenLinked = () => {
      if (window.location.hash === "#in-progress") setOpen(true);
    };
    revealWhenLinked();
    window.addEventListener("hashchange", revealWhenLinked);
    return () => window.removeEventListener("hashchange", revealWhenLinked);
  }, []);

  return (
    <details id="in-progress" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="panel group p-5 opacity-90">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <span className="flex items-baseline gap-3">
          <span className="section-label">In progress</span>
          <span className="text-sm text-muted">
            {cases.length} case{cases.length === 1 ? "" : "s"} still collecting or scanning
          </span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      {cases.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No cases in progress.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {cases.map((c) => (
            <li key={c.id}>
              <InProgressRow kase={c} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/in-progress" className="mt-4 inline-block text-xs text-accent underline underline-offset-2">
        Open the full in-progress view
      </Link>
    </details>
  );
}

/**
 * One in-progress case. Before the client has chosen a case type there is no
 * checklist, so the meter would read 0/0 even when documents have already arrived;
 * the row says how many files are in and that the list has not been built yet.
 */
export function InProgressRow({ kase, withActions = false }: { kase: QueueCase; withActions?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-[var(--radius-tile)] bg-surface/60 px-4 py-3 text-sm transition-colors hover:bg-surface">
      <Link
        href={`/cases/${kase.id}`}
        className="flex flex-wrap items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="font-medium text-ink">{kase.caseType ?? "Intake"}</span>
        <span className="text-xs text-muted">{languageName(kase.language)}</span>
        <Chip tone="neutral">{CASE_STATUS_LABEL[kase.status]}</Chip>
        {kase.openEscalations > 0 ? (
          <Chip tone="warn">
            {kase.openEscalations} escalation{kase.openEscalations === 1 ? "" : "s"}
          </Chip>
        ) : null}
      </Link>
      <span className="flex items-center gap-3">
        {withActions && kase.status === "collecting_docs" && !kase.checklist.complete ? <NudgeButton caseId={kase.id} /> : null}
        <span className="text-[0.72rem] text-muted" suppressHydrationWarning>
          {relativeTime(kase.updatedAt)}
        </span>
      </span>
      <span className="col-span-2">
        <ChecklistMeter checklist={kase.checklist} documents={kase.documents} />
      </span>
    </div>
  );
}

/** Progress bar plus a sentence a paralegal can read at a glance. */
export function ChecklistMeter({ checklist, documents }: { checklist: QueueCase["checklist"]; documents: number }) {
  const files = `${documents} file${documents === 1 ? "" : "s"} received`;
  if (checklist.total === 0) {
    return (
      <span className="flex items-center gap-3">
        <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-border" />
        <span className="text-xs text-muted">{documents > 0 ? `${files} · checklist not built yet` : "No documents yet · checklist not built yet"}</span>
      </span>
    );
  }
  const pct = Math.round((checklist.done / checklist.total) * 100);
  // Files that did not satisfy an item (rejected, duplicate, unrequested) are still
  // worth a mention: they explain why "3 files" and "1/4" can both be true.
  const extra = documents > checklist.done ? ` · ${files}` : "";
  return (
    <span className="flex items-center gap-3">
      <span
        role="progressbar"
        aria-label="Checklist progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
      >
        <span className="block h-full rounded-full bg-ok/70" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted">
        {checklist.done}/{checklist.total} on the checklist{extra}
      </span>
    </span>
  );
}
