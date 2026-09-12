/**
 * Browser-side calls to the console API. Every call returns a discriminated result
 * instead of throwing so components can show the server's error message inline.
 */
import type { Flag } from "@/db/schema";
import type { Iso } from "@/lib/queries";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      credentials: "same-origin",
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const error = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
      return { ok: false, error };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

export type FlagDecisionBody = {
  decision: "approve" | "edit" | "reject" | "request_more_info";
  editedText?: string;
  requestText?: string;
};

export type FlagDecisionResponse = { flag: Iso<Flag>; messageId?: string; sendError?: string };

export function decideFlagRequest(caseId: string, flagId: string, body: FlagDecisionBody) {
  return call<FlagDecisionResponse>(`/api/cases/${caseId}/flags/${flagId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function replyEscalationRequest(caseId: string, escalationId: string, englishText: string) {
  return call<{ messageId: string }>(`/api/cases/${caseId}/escalations/${escalationId}/reply`, {
    method: "POST",
    body: JSON.stringify({ englishText }),
  });
}

export function dismissEscalationRequest(caseId: string, escalationId: string) {
  return call<{ ok: true }>(`/api/cases/${caseId}/escalations/${escalationId}/dismiss`, { method: "POST" });
}

export type CaseAction = "close" | "nudge" | "scan";

export function caseActionRequest(caseId: string, action: CaseAction) {
  return call<{ ok: true }>(`/api/cases/${caseId}/${action}`, { method: "POST" });
}
