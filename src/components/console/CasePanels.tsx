import type { AuditEntry, ChecklistItem, Message } from "@/db/schema";
import type { Iso } from "@/lib/queries";
import { Chip } from "@/components/ui/Chip";
import { CitationBlock } from "./CitationBlock";
import { actorLabel } from "./labels";
import { formatDateTime, relativeTime } from "@/components/ui/time";

/**
 * The supporting panels under the flag stack: what was asked for, what was said, and
 * what happened. All three are plain server-rendered lists — nothing here is
 * interactive, and nothing here can send a client anything.
 */

const CHECKLIST_TONE = {
  pending: "neutral",
  received: "ok",
  accepted: "ok",
  rejected: "error",
} as const;

export function ChecklistPanel({ items }: { items: Iso<ChecklistItem>[] }) {
  const done = items.filter((i) => i.status === "received" || i.status === "accepted").length;
  return (
    <details className="panel group p-5" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-baseline gap-3">
          <span className="section-label">Document checklist</span>
          <span className="text-sm text-muted">
            {done}/{items.length} received
          </span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-[var(--radius-tile)] bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{item.docName}</span>
              <Chip tone={CHECKLIST_TONE[item.status]}>{item.status}</Chip>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{item.description}</p>
            {item.rejectionReason ? (
              <p className="mt-2 text-xs leading-relaxed text-error">Re-requested: {item.rejectionReason}</p>
            ) : null}
            {item.sourceCitation ? (
              <div className="mt-3">
                <CitationBlock citation={item.sourceCitation} compact />
              </div>
            ) : null}
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-muted">No checklist yet — intake has not finished.</li> : null}
      </ul>
    </details>
  );
}

/**
 * The full thread. `approvedBy` is shown on every outbound message, because "who let
 * this reach the client" is the question the audit trail exists to answer:
 * a paralegal id, `template:<name>` for the clinic's own fixed text, or `auto:grounded`.
 */
export function MessageThread({ messages }: { messages: Iso<Message>[] }) {
  return (
    <details className="panel group p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-baseline gap-3">
          <span className="section-label">Messages</span>
          <span className="text-sm text-muted">{messages.length}</span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <ol className="mt-4 flex flex-col gap-3">
        {messages.map((m) => (
          <li
            key={m.id}
            className={
              "max-w-[85%] rounded-[var(--radius-tile)] px-4 py-3 " +
              (m.direction === "inbound" ? "bg-surface" : "ml-auto bg-accent/10")
            }
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.7rem] text-muted">
              <span>{m.direction === "inbound" ? "Client" : "Clinic"}</span>
              <span>· {m.channel}</span>
              <span>· {m.language}</span>
              {m.approvedBy ? <span>· approved by {m.approvedBy}</span> : null}
              <span className="ml-auto" suppressHydrationWarning>
                {relativeTime(m.createdAt)}
              </span>
            </div>
            {m.subject ? <p className="mt-1 text-xs font-medium text-ink">{m.subject}</p> : null}
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.body}</p>
          </li>
        ))}
        {messages.length === 0 ? <li className="text-sm text-muted">No messages yet.</li> : null}
      </ol>
    </details>
  );
}

export function AuditTrail({ entries }: { entries: Iso<AuditEntry>[] }) {
  return (
    <details className="panel group p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-baseline gap-3">
          <span className="section-label">Audit trail</span>
          <span className="text-sm text-muted">{entries.length} entries</span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <ol className="mt-4 flex flex-col gap-1.5">
        {entries.map((e) => (
          <li key={e.id} className="grid grid-cols-[7rem_9rem_1fr] items-baseline gap-3 text-xs">
            <span className="text-muted" suppressHydrationWarning>
              {formatDateTime(e.timestamp)}
            </span>
            <span className="truncate text-muted">{actorLabel(e.actor)}</span>
            <span className="text-ink">
              {e.action}
              <PayloadSummary payload={e.payload} />
            </span>
          </li>
        ))}
        {entries.length === 0 ? <li className="text-sm text-muted">Nothing recorded yet.</li> : null}
      </ol>
    </details>
  );
}

/** A few keys from the payload — enough to tell two entries apart without a JSON dump. */
function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const interesting = ["from", "to", "docName", "fieldRef", "severity", "reason", "template", "mode", "flags", "citationVia"];
  const parts = interesting
    .filter((k) => payload[k] !== undefined && payload[k] !== null)
    .slice(0, 3)
    .map((k) => `${k}: ${String(payload[k])}`);
  if (parts.length === 0) return null;
  return <span className="text-muted"> — {parts.join(", ")}</span>;
}
