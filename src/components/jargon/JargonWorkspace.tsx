"use client";
import { useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { PdfReader } from "./PdfReader";
import { JargonDemo } from "./JargonDemo";

/**
 * The client-facing surface for the overlay (spec §3.2): a reader with the jargon
 * card attached, plus the paste-a-term box for someone who has no document open.
 *
 * The language lives here because it is the client's choice for the whole page, the
 * way `chrome.storage.sync` holds it for the extension — the reader and the paste box
 * both explain in it.
 */

export type JargonWorkspaceProps = { sampleUrl: string; sampleLabel: string };

export function JargonWorkspace({ sampleUrl, sampleLabel }: JargonWorkspaceProps) {
  const [language, setLanguage] = useState("en");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="section-label" htmlFor="jargon-language-picker">
          Explain in
        </label>
        <select
          id="jargon-language-picker"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-[var(--radius-tile)] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
        >
          {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-muted">Select any term in the document below to see what it means.</p>
      </div>

      <PdfReader sampleUrl={sampleUrl} sampleLabel={sampleLabel} language={language} />

      <details className="panel p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">No document open? Paste a term instead</summary>
        <div className="mt-4">
          <JargonDemo language={language} />
        </div>
      </details>
    </div>
  );
}
