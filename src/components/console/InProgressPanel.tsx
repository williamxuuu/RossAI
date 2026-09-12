"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { QueueCase } from "@/lib/queries";
import { languageName } from "@/lib/i18n";
import { Chip } from "@/components/ui/Chip";
import { relativeTime } from "@/components/ui/time";
import { CASE_STATUS_LABEL } from "./labels";

/**
 * Muted, collapsed-by-default list of cases still in intake / collecting documents /
 * scanning. These are deliberately NOT in the queue (spec §3.3).
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
    </details>
  );
}

function InProgressRow({ kase }: { kase: QueueCase }) {
  const pct = kase.checklist.total === 0 ? 0 : Math.round((kase.checklist.done / kase.checklist.total) * 100);
  return (
    <Link
      href={`/cases/${kase.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-[var(--radius-tile)] bg-surface/60 px-4 py-3 text-sm transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{kase.caseType ?? "Intake"}</span>
        <span className="text-xs text-muted">{languageName(kase.language)}</span>
        <Chip tone="neutral">{CASE_STATUS_LABEL[kase.status]}</Chip>
      </span>
      <span className="text-[0.72rem] text-muted" suppressHydrationWarning>
        {relativeTime(kase.updatedAt)}
      </span>
      <span className="col-span-2 flex items-center gap-3">
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
          {kase.checklist.done}/{kase.checklist.total} documents
        </span>
      </span>
    </Link>
  );
}
