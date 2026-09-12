import "server-only";
import type { JobName, JobPayloads } from "./index";

/**
 * Job bodies. Filled in by the pipeline modules; each handler is a thin call into
 * src/lib/pipeline so Trigger.dev tasks and the inline runner stay identical.
 */
export async function runJob<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
  switch (name) {
    case "process-inbound-attachment": {
      const { processInboundAttachment } = await import("@/lib/pipeline/checklist");
      await processInboundAttachment((payload as JobPayloads["process-inbound-attachment"]).documentId);
      return;
    }
    case "process-inbound-message": {
      const { processInboundMessage } = await import("@/lib/pipeline/intake");
<<<<<<< HEAD
      await processInboundMessage((payload as JobPayloads["process-inbound-message"]).messageId);
=======
      const p = payload as JobPayloads["process-inbound-message"];
      await processInboundMessage(p.messageId, { hasAttachments: p.hasAttachments ?? false });
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
      return;
    }
    case "nudge-pending": {
      const { nudgePending } = await import("@/lib/pipeline/checklist");
      await nudgePending((payload as JobPayloads["nudge-pending"]).caseId);
      return;
    }
    case "scan-case": {
      const { scanCase } = await import("@/lib/pipeline/scan");
      await scanCase((payload as JobPayloads["scan-case"]).caseId);
      return;
    }
    default: {
      const never: never = name;
      throw new Error(`unknown job ${String(never)}`);
    }
  }
}
