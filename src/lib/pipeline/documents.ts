import "server-only";
<<<<<<< HEAD
import type { InboundMessage } from "@/lib/channel/types";

/**
 * CONTRACT STUB — implemented by the checklist/documents module.
 * Stores each attachment, creates Document rows, and enqueues verification.
 * Returns the created document ids.
 */
export async function ingestInboundAttachments(_caseId: string, _message: InboundMessage): Promise<string[]> {
  throw new Error("not implemented: ingestInboundAttachments");
=======
import { getDb, schema } from "@/db/client";
import type { InboundAttachment, InboundMessage } from "@/lib/channel/types";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { getDocumentStore } from "@/lib/storage";
import { log } from "@/lib/log";

/**
 * Storing what a client sent (spec §3.3 step 1).
 *
 * Bytes go to the document store, one Document row per attachment, then one
 * `process-inbound-attachment` job each. Verification is deliberately NOT done here:
 * a webhook must answer the provider quickly, and a slow vision call in the request
 * path turns into provider retries and duplicate documents.
 */

const logger = log.scope("documents");

/** Anything bigger is refused: a client's phone photo is ~2-8 MB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
];

export function isAcceptedAttachment(mimeType: string): boolean {
  const t = mimeType.toLowerCase().split(";")[0].trim();
  return ACCEPTED_TYPES.includes(t);
}

export async function ingestInboundAttachments(caseId: string, message: InboundMessage): Promise<string[]> {
  const ids: string[] = [];
  for (const attachment of message.attachments) {
    const id = await ingestOne(caseId, message, attachment);
    if (id) ids.push(id);
  }
  for (const documentId of ids) {
    await enqueue("process-inbound-attachment", { documentId });
  }
  return ids;
}

async function ingestOne(caseId: string, message: InboundMessage, attachment: InboundAttachment): Promise<string | null> {
  if (!isAcceptedAttachment(attachment.mimeType)) {
    logger.info("attachment type refused", { caseId, mimeType: attachment.mimeType, filename: attachment.filename });
    await writeAudit({
      caseId,
      actor: AGENT_ACTOR,
      action: "document.rejected",
      payload: { filename: attachment.filename, mimeType: attachment.mimeType, reason: "unsupported_type", stored: false },
    });
    return null;
  }

  let bytes: Buffer;
  try {
    bytes = await attachment.bytes();
  } catch (err) {
    logger.error("attachment download failed", { caseId, filename: attachment.filename, err: String(err) });
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    await writeAudit({
      caseId,
      actor: AGENT_ACTOR,
      action: "document.rejected",
      payload: { filename: attachment.filename, bytes: bytes.byteLength, reason: "size", stored: false },
    });
    return null;
  }

  const { key } = await getDocumentStore().put({ bytes, mimeType: attachment.mimeType, filename: attachment.filename });
  const db = await getDb();
  const [row] = await db
    .insert(schema.documents)
    .values({
      caseId,
      storageUrl: key,
      receivedVia: message.channel,
      originalFilename: attachment.filename,
      mimeType: attachment.mimeType,
    })
    .returning({ id: schema.documents.id });

  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "document.received",
    payload: { documentId: row.id, filename: attachment.filename, mimeType: attachment.mimeType, bytes: bytes.byteLength, via: message.channel },
  });
  return row.id;
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
}
