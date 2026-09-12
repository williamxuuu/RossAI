import { task } from "@trigger.dev/sdk";
import { runJob } from "@/lib/jobs/handlers";
import type { JobPayloads } from "@/lib/jobs";

/**
 * Trigger.dev tasks (spec §1 Jobs, §3.3 checklist loop, §3.4 scanning).
 *
 * Each task id MUST equal the JobName that enqueue() in src/lib/jobs/index.ts
 * hands to `tasks.trigger(name, payload)`, and each payload type is the matching
 * JobPayloads entry. Bodies delegate to runJob() so Trigger.dev and the inline
 * fallback execute the same pipeline code. src/trigger/tasks.test.ts enforces
 * the id ⇄ JobName alignment at both type and runtime level.
 *
 * Payloads are record ids only (Trigger.dev payload limits; no PII in job queues).
 */

const RETRY = { maxAttempts: 3 } as const;

/** Verify + accept/reject one inbound attachment (checklist loop step 2-3). */
export const processInboundAttachment = task({
  id: "process-inbound-attachment",
  retry: RETRY,
  run: async (payload: JobPayloads["process-inbound-attachment"]) => {
    await runJob("process-inbound-attachment", payload);
  },
});

/** Intake / escalation handling for one stored inbound message. */
export const processInboundMessage = task({
  id: "process-inbound-message",
  retry: RETRY,
  run: async (payload: JobPayloads["process-inbound-message"]) => {
    await runJob("process-inbound-message", payload);
  },
});

/** Cross-document scan; moves the case to awaiting_review. */
export const scanCase = task({
  id: "scan-case",
  retry: RETRY,
  run: async (payload: JobPayloads["scan-case"]) => {
    await runJob("scan-case", payload);
  },
});
