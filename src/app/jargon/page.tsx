import { JargonDemo } from "@/components/jargon/JargonDemo";

/**
 * The extension overlay, inside the console (spec §6 cut line: "the Chrome extension
 * can demo as jargon explanation inside the console").
 *
 * It calls the same public /api/jargon/explain and /api/jargon/escalate routes the
 * extension's service worker calls, so what you see here is exactly what a client
 * sees on a USCIS page — useful when demoing without loading an unpacked extension,
 * and useful to a clinic that wants to check what the overlay says before telling
 * clients to install it.
 */
export const metadata = { title: "RossAI — jargon overlay" };

export default function JargonPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-ink">Jargon overlay</h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
          The same thing the Chrome extension shows a client when they select text on a USCIS page. Paste a term or a
          form instruction below. If no USCIS source supports an explanation, it says so and offers to reach a person —
          it never fills the gap itself.
        </p>
      </header>
      <JargonDemo />
    </div>
  );
}
