import type { ReactNode } from "react";

/** Small pill label. `tone` colors only text/dot so the chrome stays neutral. */
export type ChipTone = "neutral" | "ok" | "warn" | "error" | "accent";

const tones: Record<ChipTone, string> = {
  neutral: "text-muted bg-ink/5",
  ok: "text-ok bg-ok/10",
  warn: "text-warn bg-warn/10",
  error: "text-error bg-error/10",
  accent: "text-accent bg-accent/10",
};

export function Chip({ tone = "neutral", children, className = "", title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.72rem] font-medium leading-5 whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A 7px colored dot with an accessible label, used for severity counts in the rail. */
export function Dot({ tone, label, className = "" }: { tone: ChipTone; label?: string; className?: string }) {
  const color: Record<ChipTone, string> = {
    neutral: "bg-muted",
    ok: "bg-ok",
    warn: "bg-warn",
    error: "bg-error",
    accent: "bg-accent",
  };
  return <span aria-label={label} role={label ? "img" : undefined} className={`inline-block size-[7px] rounded-full ${color[tone]} ${className}`} />;
}
