import type { Citation } from "@/db/schema";
import { ExternalIcon } from "@/components/ui/icons";
import { formatDate } from "@/components/ui/time";

/**
 * The source behind a claim (spec §4 "no grounding, no output").
 *
 * The quote is the retrieved passage the model was actually shown, not a summary of
 * it — that is the whole point: a paralegal can read the sentence and the link and
 * decide for themselves, without trusting the agent's paraphrase.
 */
export function CitationBlock({ citation, compact = false }: { citation: Citation; compact?: boolean }) {
  return (
    <figure className={`rounded-[var(--radius-tile)] bg-surface ${compact ? "p-3" : "p-4"}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <a
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          {citation.title}
          <ExternalIcon size={12} />
        </a>
        <span className="text-[0.7rem] text-muted" title={citation.retrievedAt}>
          retrieved {formatDate(citation.retrievedAt)}
        </span>
      </figcaption>
      <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted">
        &ldquo;{citation.quote}&rdquo;
      </blockquote>
    </figure>
  );
}
