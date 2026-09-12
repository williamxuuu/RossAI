import "server-only";
import { log } from "@/lib/log";

/**
 * Job dispatch (spec §1 Trigger.dev; §6 cut line "nudge cadence can be manually triggered").
 *
 *   TRIGGER_SECRET_KEY set → tasks.trigger() hands the job to Trigger.dev (src/trigger/*.ts)
 *   otherwise              → the job runs in-process right now (awaited)
 *
 * Job bodies live in src/lib/jobs/handlers.ts so both paths execute identical code.
 */

export type JobName = "process-inbound-attachment" | "nudge-pending" | "scan-case" | "process-inbound-message";

export type JobPayloads = {
  "process-inbound-attachment": { documentId: string };
  /** `hasAttachments` lets intake tell a question from a cover note on an email of documents. */
  "process-inbound-message": { messageId: string; hasAttachments?: boolean };
  "nudge-pending": { caseId?: string; paralegalId?: string };
  "scan-case": { caseId: string };
};

const logger = log.scope("jobs");

export function isTriggerConfigured(): boolean {
  return Boolean(process.env.TRIGGER_SECRET_KEY);
}

export async function enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<{ mode: "trigger" | "inline"; id?: string }> {
  if (isTriggerConfigured()) {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger(name, payload);
    logger.info("triggered", { name, id: handle.id });
    return { mode: "trigger", id: handle.id };
  }
  const { runJob } = await import("./handlers");
  logger.info("running inline", { name });
  await runJob(name, payload);
  return { mode: "inline" };
}
