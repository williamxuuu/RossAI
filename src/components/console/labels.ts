import type { CaseStatus, FlagSeverity, FlagStatus } from "@/db/schema";
import type { ChipTone } from "@/components/ui/Chip";

/** Display strings and tones shared by the console components. */

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  intake: "Intake",
  collecting_docs: "Collecting documents",
  scanning: "Scanning",
  awaiting_review: "Awaiting review",
  replied: "Replied",
  closed: "Closed",
};

export function caseStatusTone(status: CaseStatus): ChipTone {
  if (status === "awaiting_review") return "accent";
  if (status === "replied") return "ok";
  return "neutral";
}

export const SEVERITY_ORDER: readonly FlagSeverity[] = ["high", "medium", "low"];

export const SEVERITY_LABEL: Record<FlagSeverity, string> = { high: "High", medium: "Medium", low: "Low" };

export function severityTone(severity: FlagSeverity): ChipTone {
  return severity === "high" ? "error" : severity === "medium" ? "warn" : "neutral";
}

/** Tailwind text color class per severity — the only place severity colors are applied. */
export const SEVERITY_TEXT: Record<FlagSeverity, string> = {
  high: "text-error",
  medium: "text-warn",
  low: "text-muted",
};

export const SEVERITY_BAR: Record<FlagSeverity, string> = {
  high: "bg-error",
  medium: "bg-warn",
  low: "bg-muted/60",
};

export const FLAG_STATUS_LABEL: Record<FlagStatus, string> = {
  open: "Open",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};

export function flagStatusTone(status: FlagStatus): ChipTone {
  if (status === "approved") return "ok";
  if (status === "edited") return "accent";
  return "neutral";
}

export const ESCALATION_REASON_LABEL: Record<string, string> = {
  judgment: "Needs legal judgment",
  ungrounded: "No USCIS source found",
  grounded_pending_approval: "Grounded draft, needs approval",
  client_requested: "Client asked for a person",
};

export function escalationReasonLabel(reason: string): string {
  return ESCALATION_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

export const ESCALATION_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  replied: "Replied",
  dismissed: "Dismissed",
};

/** Last four digits only — the console never needs the full number on screen. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `···${digits.slice(-4)}` : "···";
}

/** "agent" | paralegal id → short display name for the audit trail. */
export function actorLabel(actor: string, paralegalNames: Record<string, string> = {}): string {
  if (actor === "agent") return "Agent";
  return paralegalNames[actor] ?? actor.replace(/^auth0\||^dev\|/, "");
}
