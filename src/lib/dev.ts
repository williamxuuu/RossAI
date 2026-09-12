import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The /dev surface: the client simulator and the endpoints it calls.
 *
 * It is a real client, not a bypass. `/dev/phone` builds the same `InboundMessage` a
 * channel provider would and hands it to the same `processInbound()` the webhooks use,
 * so the intake state machine, the document loop, the scan and the human gate all run
 * exactly as they do in production. Nothing here writes to the database directly.
 *
 * It is off unless the deployment is explicitly a demo one (see `devEnabled`), because
 * it can open cases and send the clinic's texts without a paralegal.
 */

export const FIXTURES_DIR = path.join(process.cwd(), "src", "db", "fixtures");

/** On in local development, and in production only with DEV_TOOLS=true. */
export function devEnabled(): boolean {
  if (process.env.DEV_TOOLS === "true") return true;
  if (process.env.DEV_TOOLS === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export type FixtureFile = { filename: string; mimeType: string; bytes: number; label: string };

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** What each fixture is for, so the simulator can say it on the button. */
const LABELS: Record<string, string> = {
  "acta-de-nacimiento.pdf": "Birth certificate (Spanish — no translation in the packet)",
  "passport.pdf": "Passport (expires in under six months)",
  "i-797-notice.pdf": "USCIS notice (different name and date of birth, two blank fields)",
  "marriage-certificate.pdf": "Marriage certificate (consistent with the birth certificate)",
  "photo-id.png": "Photo ID — a readable copy",
  "photo-id-blurry.png": "Photo ID — too small to read, gets re-requested",
};

export async function listFixtures(): Promise<FixtureFile[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true }).catch(() => []);
  const files: FixtureFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType) continue;
    const bytes = (await readFile(path.join(FIXTURES_DIR, entry.name))).byteLength;
    files.push({ filename: entry.name, mimeType, bytes, label: LABELS[entry.name] ?? entry.name });
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Read one fixture. Rejects anything that is not a plain name in the fixtures folder. */
export async function readFixture(filename: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  const mimeType = MIME[path.extname(filename).toLowerCase()];
  if (!mimeType) return null;
  try {
    return { bytes: await readFile(path.join(FIXTURES_DIR, filename)), mimeType };
  } catch {
    return null;
  }
}
