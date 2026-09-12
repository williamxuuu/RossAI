"use client";
import { useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";
import { ExternalIcon } from "@/components/ui/icons";

type ExplainResponse =
  | { grounded: true; language: string; explanation: string; citation: { title: string; url: string; quote: string }; formHint?: string }
  | { grounded: false; language: string; reason: string; message: string; formHint?: string };

const EXAMPLES = [
  "Adjustment of status",
  "Have you EVER been a member of, involved in, or in any way associated with any Communist or other totalitarian party?",
  "A-Number",
  "Affidavit of Support",
];

export function JargonDemo() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);

  async function explain() {
    setBusy(true);
    setError(null);
    setResult(null);
    setEscalated(false);
    try {
      const res = await fetch("/api/jargon/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, language, pageUrl: "https://www.uscis.gov/i-485" }),
      });
      const body = (await res.json()) as ExplainResponse & { error?: string; message?: string };
      if (!res.ok) setError(body.message ?? body.error ?? `HTTP ${res.status}`);
      else setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    setBusy(true);
    try {
      const res = await fetch("/api/jargon/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, language, pageUrl: "https://www.uscis.gov/i-485" }),
      });
      setEscalated(res.ok);
      if (!res.ok) setError("Could not file the escalation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="panel flex flex-col gap-3 p-6">
        <label className="section-label" htmlFor="jargon-text">
          Selected text
        </label>
        <Textarea id="jargon-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setText(e)}
              className="max-w-full truncate rounded-full bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-ink"
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <span className="flex flex-col gap-1">
            <label className="section-label" htmlFor="jargon-language">
              Explain in
            </label>
            <select
              id="jargon-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-[var(--radius-tile)] border border-border bg-surface px-3 py-2 text-sm text-ink"
            >
              {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </span>
          <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={explain}>
            Explain
          </Button>
        </div>
      </section>

      {error ? <p className="panel p-5 text-sm text-error">{error}</p> : null}

      {result ? (
        <section className="panel flex flex-col gap-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={result.grounded ? "ok" : "warn"}>{result.grounded ? "Grounded" : `Not grounded · ${result.reason}`}</Chip>
            {result.formHint ? <Chip tone="neutral">{result.formHint}</Chip> : null}
          </div>

          <p className="text-sm leading-relaxed text-ink">{result.grounded ? result.explanation : result.message}</p>

          {result.grounded ? (
            <figure className="rounded-[var(--radius-tile)] bg-surface p-4">
              <blockquote className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted">
                &ldquo;{result.citation.quote}&rdquo;
              </blockquote>
              <a
                href={result.citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
              >
                {result.citation.title}
                <ExternalIcon size={12} />
              </a>
            </figure>
          ) : null}

          <p className="text-xs leading-relaxed text-muted">
            This explains what the words mean. It is not legal advice and it does not say what anyone should do.
          </p>

          {escalated ? (
            <p className="text-xs text-ok">Sent. It is now in the clinic queue as an escalation.</p>
          ) : (
            <Button size="sm" busy={busy} onClick={escalate}>
              {result.grounded ? "Still confused — ask the clinic" : "Ask the clinic"}
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}
