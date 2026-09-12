"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CaseDetail } from "@/lib/queries";
import { caseTypeLabel } from "@/lib/casetypes";
import { languageName } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CaseCopilot } from "@/components/copilot/CaseCopilot";
import { FlagCard } from "./FlagCard";
import { EscalationCard } from "./EscalationCard";
import { EvidencePanel } from "./EvidencePanel";
import { AuditTrail, ChecklistPanel, MessageThread } from "./CasePanels";
import { CASE_STATUS_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, caseStatusTone, maskPhone, severityTone } from "./labels";
import {
  caseActionRequest,
  decideFlagRequest,
  dismissEscalationRequest,
  replyEscalationRequest,
  sendClientMessageRequest,
  type CaseAction,
  type FlagDecisionBody,
} from "./api";

/**
 * The review view (spec §3.6). Center column is the flag stack grouped by severity;
 * the right column follows whichever flag is selected.
 *
 * Every action posts to /api/cases/... and then re-reads the server's copy via
 * `router.refresh()` rather than patching local state, so what the screen shows is
 * always what the database and the audit log say — a paralegal must never be looking
 * at an optimistic guess about whether a client was texted.
 */

export function CaseReview({ detail, copilotEnabled }: { detail: CaseDetail; copilotEnabled: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(detail.flags.find((f) => f.status === "open")?.id ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");

  const caseId = detail.case.id;
  const openFlags = detail.flags.filter((f) => f.status === "open");
  const resolvedFlags = detail.flags.filter((f) => f.status !== "open");
  const openEscalations = detail.escalations.filter((e) => e.status === "open");
  const selectedFlag = detail.flags.find((f) => f.id === selectedFlagId) ?? null;

  const documentLabels = useMemo(() => {
    const byItem = new Map(detail.checklistItems.map((i) => [i.id, i.docName]));
    return Object.fromEntries(
      detail.documents.map((d) => [
        d.id,
        (d.checklistItemId ? byItem.get(d.checklistItemId) : null) ?? d.originalFilename ?? d.verifiedType ?? "document",
      ]),
    );
  }, [detail.documents, detail.checklistItems]);

  const refresh = () => startTransition(() => router.refresh());

  // The client workspace and this review page read the same local message history.
  // Refreshing lightly keeps a newly received client message or sent reminder visible
  // on both sides during active review.
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [router]);

  function setError(key: string, message?: string) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  async function decideFlag(flagId: string, body: FlagDecisionBody) {
    setBusyId(flagId);
    setError(flagId);
    const result = await decideFlagRequest(caseId, flagId, body);
    setBusyId(null);
    if (!result.ok) {
      setError(flagId, result.error);
      return;
    }
    // request_more_info records the decision even when the text could not be delivered.
    if (result.data.sendError) setError(flagId, `Saved, but the message was not delivered: ${result.data.sendError}`);
    else if (body.decision === "request_more_info") setNotice("Message sent to the client.");
    refresh();
  }

  async function replyEscalation(escalationId: string, englishText: string) {
    setBusyId(escalationId);
    setError(escalationId);
    const result = await replyEscalationRequest(caseId, escalationId, englishText);
    setBusyId(null);
    if (!result.ok) {
      setError(escalationId, result.error);
      return;
    }
    setNotice("Reply sent to the client in their language.");
    refresh();
  }

  async function dismissEscalation(escalationId: string) {
    setBusyId(escalationId);
    const result = await dismissEscalationRequest(caseId, escalationId);
    setBusyId(null);
    if (!result.ok) setError(escalationId, result.error);
    refresh();
  }

  async function runCaseAction(action: CaseAction) {
    setBusyId(action);
    setError(action);
    const result = await caseActionRequest(caseId, action);
    setBusyId(null);
    if (!result.ok) {
      setError(action, result.error);
      return;
    }
    setNotice(
      action === "nudge" ? "Reminder sent for anything still pending." : action === "scan" ? "Re-scan queued." : "Case closed.",
    );
    refresh();
  }

  async function sendClientMessage() {
    const text = messageDraft.trim();
    if (!text) return;
    setBusyId("message");
    setError("message");
    const result = await sendClientMessageRequest(caseId, text);
    setBusyId(null);
    if (!result.ok) {
      setError("message", result.error);
      return;
    }
    setMessageDraft("");
    setNotice("Message sent to the client.");
    refresh();
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-5">
        <section className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-ink">{caseTypeLabel(detail.case.caseType)}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{languageName(detail.client.preferredLanguage)}</span>
                {detail.client.phone ? <span>· {maskPhone(detail.client.phone)}</span> : null}
                {detail.client.email ? <span>· {detail.client.email}</span> : null}
                <span>· opened {new Date(detail.case.createdAt).toLocaleDateString("en-US")}</span>
              </p>
            </div>
            <Chip tone={caseStatusTone(detail.case.status)}>{CASE_STATUS_LABEL[detail.case.status]}</Chip>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.filter((s) => openFlags.some((f) => f.severity === s)).map((s) => (
              <Chip key={s} tone={severityTone(s)}>
                {openFlags.filter((f) => f.severity === s).length} {SEVERITY_LABEL[s].toLowerCase()}
              </Chip>
            ))}
            {openFlags.length === 0 ? <Chip tone="ok">No open flags</Chip> : null}
            <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" busy={busyId === "nudge"} onClick={() => runCaseAction("nudge")}>
                Nudge for documents
              </Button>
              <Button size="sm" busy={busyId === "scan"} onClick={() => runCaseAction("scan")}>
                Re-scan packet
              </Button>
              <Button size="sm" variant="ghost" busy={busyId === "close"} onClick={() => runCaseAction("close")}>
                Close case
              </Button>
            </span>
          </div>
          {notice ? <p className="mt-3 text-xs text-ok">{notice}</p> : null}
          {["nudge", "scan", "close"].map((a) => (errors[a] ? <p key={a} className="mt-2 text-xs text-error">{errors[a]}</p> : null))}
          <div className="mt-4 flex gap-2 border-t border-border pt-4">
            <input
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendClientMessage();
                }
              }}
              placeholder="Message the client"
              className="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
            />
            <Button size="sm" busy={busyId === "message"} disabled={!messageDraft.trim()} onClick={() => void sendClientMessage()}>
              Send
            </Button>
          </div>
          {errors.message ? <p className="mt-2 text-xs text-error">{errors.message}</p> : null}
        </section>

        {openEscalations.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="section-label">Client questions waiting for a person</h2>
            {openEscalations.map((e) => (
              <EscalationCard
                key={e.id}
                escalation={e}
                busy={busyId === e.id}
                error={errors[e.id]}
                onReply={(text) => replyEscalation(e.id, text)}
                onDismiss={() => dismissEscalation(e.id)}
              />
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="section-label">Flags</h2>
          {openFlags.length === 0 && resolvedFlags.length === 0 ? (
            <p className="panel px-5 py-8 text-center text-sm leading-relaxed text-muted">
              The scan produced no flags for this packet.
            </p>
          ) : null}
          {SEVERITY_ORDER.map((severity) => {
            const group = openFlags.filter((f) => f.severity === severity);
            if (group.length === 0) return null;
            return (
              <div key={severity} className="flex flex-col gap-3">
                {group.map((flag) => (
                  <FlagCard
                    key={flag.id}
                    flag={flag}
                    selected={flag.id === selectedFlagId}
                    busy={busyId === flag.id}
                    error={errors[flag.id]}
                    documentLabels={documentLabels}
                    onSelect={() => setSelectedFlagId(flag.id)}
                    onDecide={(body) => decideFlag(flag.id, body)}
                  />
                ))}
              </div>
            );
          })}

          {resolvedFlags.length > 0 ? (
            <details className="panel group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="section-label">Decided ({resolvedFlags.length})</span>
                <span className="text-xs text-muted group-open:hidden">Show</span>
                <span className="hidden text-xs text-muted group-open:inline">Hide</span>
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                {resolvedFlags.map((flag) => (
                  <FlagCard
                    key={flag.id}
                    flag={flag}
                    selected={flag.id === selectedFlagId}
                    busy={false}
                    documentLabels={documentLabels}
                    onSelect={() => setSelectedFlagId(flag.id)}
                    onDecide={() => undefined}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <ChecklistPanel items={detail.checklistItems} />
        <MessageThread messages={detail.messages} />
        <AuditTrail entries={detail.auditEntries} />
      </div>

      <div className="flex flex-col gap-5 xl:sticky xl:top-5">
        <EvidencePanel documents={detail.documents} selectedFlag={selectedFlag} />
      </div>

      {copilotEnabled ? <CaseCopilot caseId={caseId} detail={detail} onSelectFlag={setSelectedFlagId} /> : null}
    </div>
  );
}
