import { notFound } from "next/navigation";
import { devEnabled, listFixtures } from "@/lib/dev";
import { PhoneSimulator } from "@/components/dev/PhoneSimulator";

/**
 * Play the client (docs/DEMO.md).
 *
 * The client never logs into a web app — they text and email (spec §0). This page is
 * the stand-in for their phone during a demo: it posts to /api/dev/send, which builds
 * the same InboundMessage a channel provider would and runs the real pipeline.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "RossAI — Messages" };

export default async function PhonePage() {
  if (!devEnabled()) notFound();
  return <PhoneSimulator fixtures={await listFixtures()} />;
}
