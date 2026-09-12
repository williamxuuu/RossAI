import { schedules } from "@trigger.dev/sdk";
import { runJob } from "@/lib/jobs/handlers";
import type { JobPayloads } from "@/lib/jobs";

/**
 * Scheduled nudge cadence (spec §3.3 step 4; docs/ARCHITECTURE.md §6).
 *
 * Declarative cron: every day at 15:00 UTC, text a reminder for every checklist
 * item still `pending`. The id equals the "nudge-pending" JobName so the console's
 * manual nudge (enqueue("nudge-pending", { caseId })) reaches the same task.
 *
 * Trigger.dev passes a ScheduledTaskPayload on cron runs and passes whatever the
 * caller supplied on manual triggers; `readNudgePayload` accepts both shapes.
 */

export const NUDGE_CRON = "0 15 * * *"; // daily 15:00 UTC

/** Narrow an untyped payload to the optional caseId the job understands. */
export function readNudgePayload(payload: unknown): JobPayloads["nudge-pending"] {
  if (payload && typeof payload === "object" && "caseId" in payload) {
    const { caseId } = payload as { caseId?: unknown };
    if (typeof caseId === "string" && caseId.length > 0) return { caseId };
  }
  return {};
}

export const nudgePending = schedules.task({
  id: "nudge-pending",
  cron: NUDGE_CRON,
  run: async (payload) => {
    await runJob("nudge-pending", readNudgePayload(payload));
  },
});
