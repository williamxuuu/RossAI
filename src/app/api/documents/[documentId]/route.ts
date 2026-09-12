import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getDocumentStore } from "@/lib/storage";
import { json, withParalegal } from "@/app/api/cases/_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ documentId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFilename(name: string | null): string {
  const cleaned = (name ?? "document").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return cleaned || "document";
}

/** GET /api/documents/:documentId → raw bytes, inline, with the stored content-type. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async () => {
    const { documentId } = await ctx.params;
    if (!UUID_RE.test(documentId)) return json({ error: "document not found" }, 404);
    const db = await getDb();
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
    if (!doc) return json({ error: "document not found" }, 404);
    const stored = await getDocumentStore().get(doc.storageUrl);
    if (!stored) return json({ error: "document bytes missing" }, 404);
    const contentType = doc.mimeType ?? stored.mimeType ?? "application/octet-stream";
    return new Response(new Uint8Array(stored.bytes), {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(stored.bytes.byteLength),
        "content-disposition": `inline; filename="${safeFilename(doc.originalFilename)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
