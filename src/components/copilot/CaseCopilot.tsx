"use client";
<<<<<<< HEAD
/**
 * CONTRACT STUB — implemented by the copilot module.
 * Renders the CopilotKit sidebar for one case and registers the case context,
 * HITL gates, and generative flag cards. Mounted by the case review page.
 */
export type CaseCopilotProps = { caseId: string; onSelectFlag?: (flagId: string) => void };
export function CaseCopilot(_props: CaseCopilotProps) {
=======
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  CopilotSidebar,
  ToolCallStatus,
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import type { CaseDetail } from "@/lib/queries";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SEVERITY_LABEL, severityTone } from "@/components/console/labels";
import { decideFlagRequest } from "@/components/console/api";

/**
 * The paralegal's copilot on a case (spec §3.6).
 *
 * Four CopilotKit v2 pieces, each doing one job:
 *   useAgentContext    — puts this case's summary in the agent's context so it does
 *                        not have to ask which case it is looking at
 *   useRenderTool      — renders `listFlags` results as flag cards instead of JSON
 *   useFrontendTool    — lets the agent scroll the review stack to a flag
 *   useHumanInTheLoop  — the gate: the agent can PROPOSE a decision on a flag, and
 *                        nothing happens until the paralegal presses the button
 *
 * The human-in-the-loop tool is the important one. The agent cannot resolve a flag;
 * it can only put the same Approve / Edit / Reject choice in front of a person, and
 * the decision still travels through PATCH /api/cases/:id/flags/:id, which records
 * the paralegal as the actor in the audit log (spec §4 human gate).
 */

export type CaseCopilotProps = { caseId: string; onSelectFlag?: (flagId: string) => void; detail?: CaseDetail };

export function CaseCopilot({ caseId, onSelectFlag, detail }: CaseCopilotProps) {
  const router = useRouter();

  useAgentContext({
    description: "The case the paralegal currently has open in the console",
    value: detail
      ? {
          caseId,
          caseType: detail.case.caseType,
          status: detail.case.status,
          clientLanguage: detail.client.preferredLanguage,
          openFlagCount: detail.flags.filter((f) => f.status === "open").length,
          openEscalationCount: detail.escalations.filter((e) => e.status === "open").length,
        }
      : { caseId },
  });

  useRenderTool({
    name: "listFlags",
    parameters: z.object({ caseId: z.string(), status: z.enum(["open", "all"]).optional() }),
    render: ({ status, result }) => {
      if (status !== ToolCallStatus.Complete) return <Skeleton label="Reading the flags…" />;
      return <FlagSummary result={result} onSelect={onSelectFlag} />;
    },
  });

  useFrontendTool(
    {
      name: "focusFlag",
      description: "Scroll the review stack to one flag and select it, so the paralegal is looking at what you are describing.",
      parameters: z.object({ flagId: z.string() }),
      handler: async ({ flagId }) => {
        onSelectFlag?.(flagId);
        document.getElementById(`flag-${flagId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return { focused: flagId };
      },
    },
    [onSelectFlag],
  );

  useHumanInTheLoop(
    {
      name: "proposeFlagDecision",
      description:
        "Put a decision on a flag in front of the paralegal. You never decide: the paralegal presses the button. Use this when they ask you to act on a flag.",
      parameters: z.object({
        flagId: z.string(),
        decision: z.enum(["approve", "edit", "reject"]),
        editedText: z.string().optional().describe("Required for edit: the rewritten fix"),
        why: z.string().describe("One sentence on why you are proposing this"),
      }),
      render: ({ args, status, respond, result }) => {
        if (status === ToolCallStatus.Complete) {
          return <Resolved result={result} />;
        }
        if (!respond) return <Skeleton label="Preparing…" />;
        return (
          <DecisionGate
            args={args}
            onConfirm={async () => {
              const body =
                args.decision === "edit"
                  ? ({ decision: "edit", editedText: args.editedText ?? "" } as const)
                  : ({ decision: args.decision } as const);
              const res = await decideFlagRequest(caseId, args.flagId ?? "", body);
              router.refresh();
              await respond(res.ok ? { applied: true, decision: args.decision } : { applied: false, error: res.error });
            }}
            onCancel={() => respond({ applied: false, reason: "the paralegal declined" })}
          />
        );
      },
    },
    [caseId, router],
  );

  return (
    <CopilotSidebar
      defaultOpen={false}
      labels={{ chatInputPlaceholder: "Ask about this packet…" }}
    />
  );
}

// ---------------------------------------------------------------------------

function Skeleton({ label }: { label: string }) {
  return <p className="px-1 py-2 text-xs text-muted">{label}</p>;
}

type FlagResult = {
  flags?: { flagId: string; severity: "high" | "medium" | "low"; fieldRef: string; description: string; citation?: { url: string; title: string } }[];
};

function FlagSummary({ result, onSelect }: { result: unknown; onSelect?: (id: string) => void }) {
  const parsed = parseResult<FlagResult>(result);
  const flags = parsed?.flags ?? [];
  if (flags.length === 0) return <p className="px-1 py-2 text-xs text-muted">No open flags on this case.</p>;
  return (
    <ul className="flex flex-col gap-2 py-1">
      {flags.map((f) => (
        <li key={f.flagId}>
          <button
            type="button"
            onClick={() => {
              onSelect?.(f.flagId);
              document.getElementById(`flag-${f.flagId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            className="w-full rounded-[var(--radius-tile)] bg-surface p-3 text-left transition-colors hover:bg-bg"
          >
            <span className="flex items-center gap-2">
              <Chip tone={severityTone(f.severity)}>{SEVERITY_LABEL[f.severity]}</Chip>
              <span className="truncate text-xs font-medium text-ink">{f.fieldRef}</span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{f.description}</span>
            {f.citation ? (
              <span className="mt-1 block truncate text-[0.68rem] text-accent">{f.citation.title}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DecisionGate({
  args,
  onConfirm,
  onCancel,
}: {
  args: Partial<{ flagId: string; decision: "approve" | "edit" | "reject"; editedText: string; why: string }>;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[var(--radius-tile)] bg-surface p-3">
      <p className="text-xs font-medium text-ink">
        Proposed: <span className="uppercase">{args.decision}</span>
      </p>
      {args.why ? <p className="mt-1 text-xs leading-relaxed text-muted">{args.why}</p> : null}
      {args.editedText ? <p className="mt-2 text-xs leading-relaxed text-ink">&ldquo;{args.editedText}&rdquo;</p> : null}
      <p className="mt-2 text-[0.68rem] text-muted">Nothing is recorded until you press the button.</p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
          }}
        >
          Do it
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          No
        </Button>
      </div>
    </div>
  );
}

function Resolved({ result }: { result: unknown }) {
  const parsed = parseResult<{ applied?: boolean; decision?: string; error?: string; reason?: string }>(result);
  if (parsed?.applied) return <p className="px-1 py-2 text-xs text-ok">Recorded: {parsed.decision}.</p>;
  return <p className="px-1 py-2 text-xs text-muted">Not applied{parsed?.error ? ` — ${parsed.error}` : parsed?.reason ? ` — ${parsed.reason}` : ""}.</p>;
}

/** Tool results arrive either as an object or as a JSON string, depending on the transport. */
function parseResult<T>(result: unknown): T | null {
  if (!result) return null;
  if (typeof result === "object") return result as T;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T;
    } catch {
      return null;
    }
  }
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  return null;
}
