import Link from "next/link";
import { headers } from "next/headers";
import { isAuthDisabled } from "@/lib/auth";
import { isLlmConfigured } from "@/lib/llm/client";
import { isExaConfigured } from "@/lib/grounding/exa";
import { isTriggerConfigured } from "@/lib/jobs";
import { getChannelProvider } from "@/lib/channel";
import { Chip } from "@/components/ui/Chip";

/**
 * What the console is actually running on, in plain words.
 *
 * This is deliberately on the main screen rather than behind a settings dialog. When
 * grounding is unavailable the agent stops producing explanations and the scan stops
 * producing model findings, and a paralegal who does not know that will read an empty
 * flag list as "nothing wrong with this packet".
 */
export async function SettingsPanel() {
  await headers(); // keep this out of the static shell: it reports live process state
  const channel = await getChannelProvider().then((p) => p.name).catch(() => "unavailable");
  const rows: { label: string; ok: boolean; value: string; note?: string }[] = [
    {
      label: "Grounding (Exa → uscis.gov)",
      ok: isExaConfigured(),
      value: isExaConfigured() ? "live" : "not configured",
      note: isExaConfigured() ? undefined : "Explanations refuse to answer; the scan uses its deterministic rules and their curated sources only.",
    },
    {
      label: "Language model (OpenRouter)",
      ok: isLlmConfigured(),
      value: isLlmConfigured() ? "live" : "not configured",
      note: isLlmConfigured() ? undefined : "No translation beyond the clinic's language packs, no vision verification, no model scan pass.",
    },
    { label: "Client channel", ok: channel !== "unavailable", value: channel },
    {
      label: "Background jobs",
      ok: true,
      value: isTriggerConfigured() ? "Trigger.dev" : "in-process",
      note: isTriggerConfigured() ? undefined : "Jobs run inside the request that queued them. Fine locally; set TRIGGER_SECRET_KEY in production.",
    },
    {
      label: "Paralegal sign-in",
      ok: !isAuthDisabled(),
      value: isAuthDisabled() ? "disabled (dev user)" : "Auth0",
      note: isAuthDisabled() ? "Every action is attributed to the dev paralegal." : undefined,
    },
  ];

  return (
    <section id="settings" className="panel p-6">
      <h2 className="section-label">What this console is running on</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="min-w-56 text-sm text-ink">{row.label}</span>
            <Chip tone={row.ok ? "ok" : "warn"}>{row.value}</Chip>
            {row.note ? <span className="basis-full text-xs leading-relaxed text-muted sm:basis-auto sm:flex-1">{row.note}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs leading-relaxed text-muted">
        The agent never sends a client anything a paralegal has not approved, apart from the clinic&apos;s own fixed
        operational texts. Play the client at{" "}
        <Link href="/dev/phone" className="text-accent underline underline-offset-2">
          /dev/phone
        </Link>
        .
      </p>
    </section>
  );
}
