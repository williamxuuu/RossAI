import Link from "next/link";
import type { QueueCase } from "@/lib/queries";
import { CASE_TYPE_LABELS, isCaseType } from "@/lib/casetypes";
import { languageName } from "@/lib/i18n";
import { Chip, Dot } from "@/components/ui/Chip";
import { CheckIcon, InboxIcon } from "@/components/ui/icons";
import { relativeTime } from "@/components/ui/time";
import { SEVERITY_LABEL, SEVERITY_ORDER, severityTone } from "./labels";

/**
 * Left rail: "Ready for review". Only checklist-complete, scanned cases appear here
 * (spec §3.3 core promise). Pure component — safe in server and client trees.
 */
export function QueueRail({ cases, currentId, inProgressCount = 0 }: { cases: QueueCase[]; currentId?: string; inProgressCount?: number }) {
  return (
    <aside aria-label="Ready for review" className="panel flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="section-label">Ready for review</h2>
        <span className="text-xs text-muted">{cases.length}</span>
      </div>
      {cases.length === 0 ? (
        <p className="rounded-[var(--radius-tile)] bg-surface px-4 py-6 text-center text-sm leading-relaxed text-muted">
          Nothing waiting. Cases appear here once every checklist item is in and the scan has run.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {cases.map((c) => (
            <li key={c.id}>
              <QueueRow kase={c} current={c.id === currentId} />
            </li>
          ))}
        </ol>
      )}
      {inProgressCount > 0 ? (
        <Link href="/#in-progress" className="mt-1 flex items-center gap-2 text-xs text-muted hover:text-ink">
          <InboxIcon size={14} />
          {inProgressCount} in progress (not yet ready)
        </Link>
      ) : null}
    </aside>
  );
}

function QueueRow({ kase, current }: { kase: QueueCase; current: boolean }) {
  const typeLabel = kase.caseType && isCaseType(kase.caseType) ? CASE_TYPE_LABELS[kase.caseType] : null;
  const openFlagTotal = SEVERITY_ORDER.reduce((n, s) => n + kase.openFlags[s], 0);
  return (
    <Link
      href={`/cases/${kase.id}`}
      aria-current={current ? "page" : undefined}
      className={
        "block rounded-[var(--radius-tile)] border px-4 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
        (current ? "border-accent/50 bg-surface shadow-sm" : "border-transparent bg-surface/60 hover:bg-surface")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{kase.caseType ?? "Case"}</span>
        <span className="text-[0.72rem] text-muted" suppressHydrationWarning>
          {relativeTime(kase.updatedAt)}
        </span>
      </div>
      {typeLabel ? <div className="truncate text-xs text-muted">{typeLabel}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{languageName(kase.language)}</span>
        {openFlagTotal > 0 ? (
          <span className="flex items-center gap-1.5" title="Open flags by severity">
            {SEVERITY_ORDER.filter((s) => kase.openFlags[s] > 0).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <Dot tone={severityTone(s)} label={`${kase.openFlags[s]} ${SEVERITY_LABEL[s].toLowerCase()}`} />
                {kase.openFlags[s]}
              </span>
            ))}
          </span>
        ) : (
          <span>No open flags</span>
        )}
        {kase.openEscalations > 0 ? <span>{kase.openEscalations} escalation{kase.openEscalations === 1 ? "" : "s"}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {kase.checklist.complete ? (
          <Chip tone="ok">
            <CheckIcon size={12} /> Checklist complete
          </Chip>
        ) : (
          <Chip tone="neutral">
            Checklist {kase.checklist.done}/{kase.checklist.total}
          </Chip>
        )}
        {kase.status === "replied" ? <Chip tone="neutral">Replied</Chip> : null}
      </div>
    </Link>
  );
}
