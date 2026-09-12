import { notFound } from "next/navigation";
import { getCaseDetail, getInProgress, getQueue } from "@/lib/queries";
import { TopBar } from "@/components/console/TopBar";
import { QueueRail } from "@/components/console/QueueRail";
import { CaseReview } from "@/components/console/CaseReview";
import { RossCopilotProvider } from "@/components/copilot/provider";
import { isLlmConfigured } from "@/lib/llm/client";

/**
 * One case (spec §3.6): left rail queue, center flag review stack, right evidence
 * panel. The page is a server component so the whole review — flags, citations,
 * messages, audit trail — is read from the database on every load; the interactive
 * part lives in <CaseReview>.
 */
export const dynamic = "force-dynamic";

export default async function CasePage({ params }: PageProps<"/cases/[caseId]">) {
  const { caseId } = await params;
  const [detail, queue, inProgress] = await Promise.all([getCaseDetail(caseId), getQueue(), getInProgress()]);
  if (!detail) notFound();
  const copilotEnabled = isLlmConfigured();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col">
      <TopBar />
      <main className="grid flex-1 items-start gap-5 px-5 pb-10 lg:grid-cols-[300px_minmax(0,1fr)]">
        <QueueRail cases={queue} currentId={caseId} inProgressCount={inProgress.length} />
        <RossCopilotProvider enabled={copilotEnabled}>
          <CaseReview detail={detail} copilotEnabled={copilotEnabled} />
        </RossCopilotProvider>
      </main>
    </div>
  );
}
