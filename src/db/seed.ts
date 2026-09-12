/**
 * `npm run db:seed` — one demo case, built by running the real pipeline.
 *
 * The seed does NOT insert flags, messages or checklist items directly. It plays a
 * client: a text in Spanish, a reply choosing the case type, an email with an
 * unreadable photo, then an email with the real documents. Intake, verification, the
 * checklist gate and the scan all run, so the seeded case is a case the system
 * actually produced — if a rule breaks, `npm run db:seed` breaks with it.
 *
 * Idempotent: it clears the demo client first, so running it twice is safe.
 */
import { eq, or } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { InboundMessage } from "@/lib/channel/types";
import { readFixture } from "@/lib/dev";
import { caseCode } from "@/lib/pipeline/casecode";
import { processInbound } from "@/app/api/webhooks/_lib/inbound";

const PHONE = "+15551230001";
const EMAIL = "15551230001@client.demo";

async function say(channel: "sms" | "email", body: string, fixtures: string[] = [], subject?: string) {
  const attachments = [];
  for (const filename of fixtures) {
    const file = await readFixture(filename);
    if (!file) throw new Error(`missing fixture ${filename} — run: npm run fixtures`);
    attachments.push({ filename, mimeType: file.mimeType, bytes: async () => file.bytes });
  }
  const message: InboundMessage = {
    channel,
    from: channel === "sms" ? PHONE : EMAIL,
    body,
    subject,
    externalId: `seed-${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date(),
    attachments,
  };
  const outcome = await processInbound(message);
  return outcome;
}

async function clearDemoClient() {
  const db = await getDb();
  const existing = await db.query.clients.findMany({
    where: or(eq(schema.clients.phone, PHONE), eq(schema.clients.email, EMAIL)),
  });
  for (const client of existing) {
    await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
  }
}

async function main() {
  await clearDemoClient();

  console.log("1/4  client texts in Spanish");
  const first = await say("sms", "Hola, necesito ayuda con mis papeles de residencia");

  console.log("2/4  client picks a case type");
  await say("sms", "1");

  // The checklist text gave the client this code and asked them to keep it in the
  // subject line; it is what links their email address to the case opened by SMS.
  const code = caseCode(first.caseId);

  console.log("3/4  client emails a photo that cannot be read");
  await say("email", "Aqui esta mi identificacion.", ["photo-id-blurry.png"], `Mi identificacion ${code}`);

  console.log("4/4  client emails the rest of the packet");
  const { caseId } = await say(
    "email",
    "Aqui estan mis documentos.",
    ["photo-id.png", "acta-de-nacimiento.pdf", "passport.pdf", "i-797-notice.pdf", "marriage-certificate.pdf"],
    `Mis documentos ${code}`,
  );

  const db = await getDb();
  const kase = await db.query.cases.findFirst({
    where: eq(schema.cases.id, caseId),
    with: { flags: true, checklistItems: true, messages: true, documents: true },
  });
  if (!kase) throw new Error("seed produced no case");

  console.log("");
  console.log(`case        ${kase.id}`);
  console.log(`type        ${kase.caseType}`);
  console.log(`status      ${kase.status}`);
  console.log(`checklist   ${kase.checklistItems.filter((i) => i.status === "received").length}/${kase.checklistItems.length} received`);
  console.log(`documents   ${kase.documents.length}`);
  console.log(`messages    ${kase.messages.length}`);
  console.log(`flags       ${kase.flags.length}`);
  for (const f of kase.flags) console.log(`  [${f.severity}] ${f.fieldRef}`);
  console.log("");
  console.log(`open http://localhost:3000/cases/${kase.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
