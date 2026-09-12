import { getInProgress, type QueueCase } from "@/lib/queries";
import type { CaseStatus } from "@/db/schema";
import { TopBar } from "@/components/console/TopBar";
import { InProgressRow } from "@/components/console/InProgressPanel";
import { CASE_STATUS_LABEL } from "@/components/console/labels";
import { FileIcon, InboxIcon, SparkIcon } from "@/components/ui/icons";

/**
 * Everything the agent is still working on, grouped by stage (spec §3.3). None of
 * these cases are in the queue — that is the product's promise — but a paralegal
 * still needs to see where a client is stuck and, for anyone still collecting
 * documents, be able to send the clinic's reminder text.
 */
export const dynamic = "force-dynamic";

type Stage = { status: CaseStatus; icon: React.ReactNode; body: string };

const STAGES: Stage[] = [
  { status: "intake", icon: <InboxIcon />, body: "The client has texted but not yet chosen a case type. Anything they send meanwhile is held until the checklist exists." },
  { status: "collecting_docs", icon: <FileIcon />, body: "The checklist has been sent. The agent accepts, re-requests and reminds on its own." },
  { status: "scanning", icon: <SparkIcon />, body: "Every document is in. The packet is being checked for blank fields, contradictions and rejection triggers." },
];

export default async function InProgressPage() {
  const cases = await getInProgress();
  const byStatus = new Map<CaseStatus, QueueCase[]>();
  for (const c of cases) byStatus.set(c.status, [...(byStatus.get(c.status) ?? []), c]);
  const stuck = cases.filter((c) => c.openEscalations > 0).length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col">
      <TopBar />
      <main className="flex flex-1 flex-col gap-5 px-5 pb-10">
        <section className="panel p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">In progress</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
            {cases.length === 0
              ? "Nothing is being collected right now. New cases appear here the moment a client texts the clinic."
              : `${cases.length} case${cases.length === 1 ? "" : "s"} the agent is still working on.` +
                (stuck > 0 ? ` ${stuck} ${stuck === 1 ? "has" : "have"} an open escalation and need${stuck === 1 ? "s" : ""} a person.` : "")}
          </p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {STAGES.map((stage) => {
              const n = byStatus.get(stage.status)?.length ?? 0;
              return (
                <li key={stage.status} className="flex gap-3">
                  <span className="tile shrink-0 text-muted">{stage.icon}</span>
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      {CASE_STATUS_LABEL[stage.status]} <span className="font-normal text-muted">· {n}</span>
                    </span>
                    <span className="block text-xs leading-relaxed text-muted">{stage.body}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {STAGES.map((stage) => {
          const rows = byStatus.get(stage.status) ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={stage.status} aria-labelledby={`stage-${stage.status}`} className="panel p-5">
              <div className="flex items-baseline justify-between">
                <h2 id={`stage-${stage.status}`} className="section-label">
                  {CASE_STATUS_LABEL[stage.status]}
                </h2>
                <span className="text-xs text-muted">{rows.length}</span>
              </div>
              <ul className="mt-4 flex flex-col gap-2">
                {rows.map((c) => (
                  <li key={c.id}>
                    <InProgressRow kase={c} withActions />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
