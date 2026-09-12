import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={
        "w-full min-h-24 resize-y rounded-[var(--radius-tile)] border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink " +
        "placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
        className
      }
      {...rest}
    />
  );
}
