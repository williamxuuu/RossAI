import { CheckIcon, FileIcon, SparkIcon } from "@/components/ui/icons";

/** Center panel on the queue page: explains what the queue is and isn't. */
export function QueueEmptyState({ queueCount }: { queueCount: number }) {
  return (
    <section className="panel p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {queueCount === 0 ? "The queue is clear" : "Pick a case from the rail"}
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
        Only cases whose document checklist is complete and that have been scanned show up here. The agent keeps collecting
        and re-requesting documents on its own; you only see finished packets.
      </p>
      <ol className="mt-6 grid gap-4 sm:grid-cols-3">
        <Step icon={<FileIcon />} title="Checklist completes" body="Every required document received and legible." />
        <Step icon={<SparkIcon />} title="Scan runs" body="Blank fields, contradictions and rejection triggers become cited flags." />
        <Step icon={<CheckIcon />} title="You review" body="Approve, edit or reject each flag; approved text goes to the client." />
      </ol>
    </section>
  );
}

function Step({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="tile shrink-0 text-muted">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs leading-relaxed text-muted">{body}</span>
      </span>
    </li>
  );
}
