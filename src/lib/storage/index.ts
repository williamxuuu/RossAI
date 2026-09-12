import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Object storage for client documents. `storageUrl` on a Document row is an opaque
 * key understood only by this module, so the provider can change without a migration.
 *
 *   STORAGE_PROVIDER=local (default) → ./.data/documents/<key>
 *   STORAGE_PROVIDER=gcs             → gs://$GCS_BUCKET/<key>
 */
export interface DocumentStore {
  put(input: { bytes: Buffer; mimeType: string; filename?: string }): Promise<{ key: string }>;
  get(key: string): Promise<{ bytes: Buffer; mimeType: string } | null>;
}

function safeExt(filename?: string, mimeType?: string): string {
  const fromName = filename ? path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  if (fromName) return fromName;
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
  };
  return (mimeType && map[mimeType]) || ".bin";
}

class LocalStore implements DocumentStore {
  private root = process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), ".data", "documents");
  async put({ bytes, mimeType, filename }: { bytes: Buffer; mimeType: string; filename?: string }) {
    await fs.mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}${safeExt(filename, mimeType)}`;
    await fs.writeFile(path.join(this.root, key), bytes);
    await fs.writeFile(path.join(this.root, `${key}.meta.json`), JSON.stringify({ mimeType, filename }));
    return { key };
  }
  async get(key: string) {
    if (key.includes("/") || key.includes("..")) return null;
    try {
      const bytes = await fs.readFile(path.join(this.root, key));
      let mimeType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.readFile(path.join(this.root, `${key}.meta.json`), "utf8"));
        mimeType = meta.mimeType ?? mimeType;
      } catch {
        /* no meta */
      }
      return { bytes, mimeType };
    } catch {
      return null;
    }
  }
}

class GcsStore implements DocumentStore {
  private bucketName = process.env.GCS_BUCKET ?? "";
  private async bucket() {
    const { Storage } = await import("@google-cloud/storage");
    if (!this.bucketName) throw new Error("GCS_BUCKET is not set");
    return new Storage().bucket(this.bucketName);
  }
  async put({ bytes, mimeType, filename }: { bytes: Buffer; mimeType: string; filename?: string }) {
    const key = `documents/${randomUUID()}${safeExt(filename, mimeType)}`;
    const b = await this.bucket();
    await b.file(key).save(bytes, { contentType: mimeType, resumable: false });
    return { key };
  }
  async get(key: string) {
    const b = await this.bucket();
    const file = b.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [bytes] = await file.download();
    const [meta] = await file.getMetadata();
    return { bytes, mimeType: meta.contentType ?? "application/octet-stream" };
  }
}

let store: DocumentStore | null = null;

/** STORAGE_PROVIDER if set; otherwise gcs when GCS_BUCKET is set; otherwise local. */
export function resolveStorageProvider(): "gcs" | "local" {
  const explicit = process.env.STORAGE_PROVIDER?.toLowerCase();
  if (explicit === "gcs" || explicit === "local") return explicit;
  return process.env.GCS_BUCKET ? "gcs" : "local";
}

export function getDocumentStore(): DocumentStore {
  if (!store) {
    const provider = resolveStorageProvider();
    if (provider === "local" && process.env.K_SERVICE) {
      throw new Error("Local document storage cannot be used on Cloud Run; set GCS_BUCKET (STORAGE_PROVIDER=gcs)");
    }
    store = provider === "gcs" ? new GcsStore() : new LocalStore();
  }
  return store;
}
