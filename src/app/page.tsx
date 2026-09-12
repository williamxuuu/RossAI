import { getInProgress, getQueue } from "@/lib/queries";
import { TopBar } from "@/components/console/TopBar";
import { QueueRail } from "@/components/console/QueueRail";
import { QueueEmptyState } from "@/components/console/QueueEmptyState";
import { InProgressPanel } from "@/components/console/InProgressPanel";
import { SettingsPanel } from "@/components/console/SettingsPanel";

/**
 * The queue (spec §3.6). Only cases whose checklist is complete and which have been
 * scanned appear in the rail — that is the product's promise, so the page shows the
 * in-progress cases separately and visibly muted rather than hiding them entirely.
 */
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const [queue, inProgress] = await Promise.all([getQueue(), getInProgress()]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col">
      <TopBar />
      <main className="grid flex-1 items-start gap-5 px-5 pb-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <QueueRail cases={queue} inProgressCount={inProgress.length} />
        <div className="flex flex-col gap-5">
          <QueueEmptyState queueCount={queue.length} />
          <InProgressPanel cases={inProgress} />
          <SettingsPanel />
        </div>
      </main>
    </div>
  );
}
