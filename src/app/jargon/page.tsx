import { JargonWorkspace } from "@/components/jargon/JargonWorkspace";

/**
 * The client-facing page (spec §3.2, and the §6 cut line: "the Chrome extension can
 * demo as jargon explanation inside the console").
 *
 * A reader with the overlay attached: open a form — the practice one, or a PDF from
 * your own device — select a term, and a card appears next to it with a plain-language
 * explanation and the USCIS passage it came from. It calls the same public
 * /api/jargon/explain and /api/jargon/escalate routes the extension's service worker
 * calls, so what a client sees here is what they see on a USCIS page.
 *
 * No account, no login: clients never authenticate (spec §4.5).
 */
export const metadata = { title: "RossAI — jargon overlay" };

const SAMPLE_URL = "/samples/practice-i-485-instructions.pdf";
const SAMPLE_LABEL = "Practice form instructions (I-485)";

export default function JargonPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-ink">What does this mean?</h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
          Select any word or sentence in a form and we will explain what it means, in your language, with the official USCIS passage it came
          from. If no USCIS source supports an explanation, we say so and offer to reach a person — we never fill the gap ourselves. This
          explains words; it is not legal advice, and it does not say what you should do.
        </p>
      </header>
      <JargonWorkspace sampleUrl={SAMPLE_URL} sampleLabel={SAMPLE_LABEL} />
    </div>
  );
}
