import "server-only";
import { isAuthDisabled } from "@/lib/auth";
import { getChannelProvider } from "@/lib/channel";
import { isExaConfigured } from "@/lib/grounding/exa";
import { isTriggerConfigured } from "@/lib/jobs";
import { isLlmConfigured } from "@/lib/llm/client";
import { modelFor } from "@/lib/llm/models";
import { isAutoSendEnabled } from "@/lib/pipeline/reply";
import { devEnabled } from "@/lib/dev";
import { log } from "@/lib/log";

/**
 * What the console is actually running on, as data (spec §4: a paralegal who does not
 * know grounding is off will read an empty flag list as "nothing wrong with this
 * packet"). The settings page renders all of it; the queue shows the degraded rows.
 *
 * Names of environment variables leave this module; **values never do**. Everything
 * here is a boolean, an enum string, or a model id — the same rule /api/health follows.
 */

const logger = log.scope("settings");

/** `ok` — working as intended. `degraded` — running, but refusing work. `off` — disabled. */
export type StatusLevel = "ok" | "degraded" | "off";

export type StatusRow = {
  key: string;
  label: string;
  level: StatusLevel;
  /** Short state, e.g. "live" / "not configured". */
  value: string;
  /** What it means for the work, shown under the row. */
  note?: string;
  /** Environment variables that switch this on. Names only. */
  env?: string[];
};

export type StatusGroup = { title: string; blurb: string; rows: StatusRow[] };

export type RuntimeStatus = {
  groups: StatusGroup[];
  /** Rows that are not fully live, so the queue can say so in one line. */
  degraded: StatusRow[];
  clinic: { name: string; phone?: string; email?: string; channel: string };
};

function level(ok: boolean, offInstead = false): StatusLevel {
  return ok ? "ok" : offInstead ? "off" : "degraded";
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const provider = await getChannelProvider().catch((err) => {
    logger.warn("channel provider failed to initialise", { err: String(err) });
    return null;
  });
  const identity = provider?.identity() ?? {};
  const channel = provider?.name ?? "unavailable";
  const llm = isLlmConfigured();
  const exa = isExaConfigured();
  const auth = !isAuthDisabled();
  const trigger = isTriggerConfigured();
  const autoSend = isAutoSendEnabled();
  const live = channel !== "mock" && channel !== "unavailable";

  const groups: StatusGroup[] = [
    {
      title: "Grounding and models",
      blurb: "Without these the agent refuses to explain rather than guessing. Nothing degrades into a plausible-sounding answer.",
      rows: [
        {
          key: "exa",
          label: "Grounding (Exa → uscis.gov)",
          level: level(exa),
          value: exa ? "live" : "not configured",
          env: ["EXA_API_KEY"],
          note: exa
            ? "Explanations and model-found flags must cite a passage retrieved from uscis.gov."
            : "Explanations answer “we couldn’t find an official USCIS source”. The scan still runs its deterministic rules with their curated citations.",
        },
        {
          key: "llm",
          label: "Language model (OpenRouter)",
          level: level(llm),
          value: llm ? "live" : "not configured",
          env: ["OPENROUTER_API_KEY"],
          note: llm
            ? `Cheap ${modelFor("cheap")} · strong ${modelFor("strong")} · vision ${modelFor("vision")}.`
            : "No translation beyond the clinic’s language packs, no vision document checks, no model scan pass, and the case copilot is switched off.",
        },
      ],
    },
    {
      title: "Client channel",
      blurb: "How clients reach the clinic. SMS runs on Twilio, document email on the Ambiguous inbox (docs/CHANNELS.md).",
      rows: [
        {
          key: "channel",
          label: "Provider",
          level: channel === "unavailable" ? "degraded" : live ? "ok" : "off",
          value: channel,
          env: ["CHANNEL_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "AMBIGUOUS_API_KEY"],
          note: live
            ? "Messages reach real phones and inboxes."
            : "Nothing leaves the building. Outbound messages are kept in an in-memory outbox and /dev/phone plays the client.",
        },
        {
          key: "number",
          label: "Clinic number",
          level: identity.phone ? "ok" : "degraded",
          value: identity.phone ?? "not set",
          env: ["TWILIO_FROM_NUMBER", "CHANNEL_PHONE_NUMBER"],
        },
        {
          key: "inbox",
          label: "Document inbox",
          level: identity.email ? "ok" : "degraded",
          value: identity.email ?? "not set",
          env: ["AMBIGUOUS_INBOX_EMAIL", "CHANNEL_INBOX_EMAIL"],
          note: "Clients are told to email documents here with their case code in the subject.",
        },
      ],
    },
    {
      title: "Guardrails",
      blurb: "Spec §4. These are the product, not settings to tune away.",
      rows: [
        {
          key: "human-gate",
          label: "Human gate on free text",
          level: "ok",
          value: "always on",
          note: "Only a paralegal’s approval sends model-authored text to a client. The clinic’s own operational texts are logged as template:<name>.",
        },
        {
          key: "auto-send",
          label: "Auto-send grounded answers",
          level: autoSend ? "degraded" : "ok",
          value: autoSend ? "ON — cited answers go out without a person" : "off (recommended)",
          env: ["AUTO_SEND_GROUNDED_ANSWERS"],
          note: autoSend
            ? "A grounded, cited answer to a client’s question is sent without a paralegal, attributed to auto:grounded. Turn this off unless the clinic decided otherwise in writing."
            : "A grounded answer becomes an escalation draft for a paralegal to approve.",
        },
        {
          key: "auth",
          label: "Paralegal sign-in",
          level: level(auth),
          value: auth ? "Auth0" : "disabled (dev user)",
          env: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "AUTH_DISABLED"],
          note: auth ? "Clients never authenticate; paralegals always do." : "Every approval is attributed to a fake dev paralegal, which makes the audit log worthless in production.",
        },
      ],
    },
    {
      title: "Infrastructure",
      blurb: "Where the cases, the documents and the jobs live.",
      rows: [
        {
          key: "db",
          label: "Database",
          level: process.env.DATABASE_URL ? "ok" : "degraded",
          value: process.env.DATABASE_URL ? "Postgres" : "PGlite (local file)",
          env: ["DATABASE_URL"],
          note: process.env.DATABASE_URL ? undefined : "Fine locally. On Cloud Run the filesystem is ephemeral, so the app refuses to start without DATABASE_URL.",
        },
        {
          key: "storage",
          label: "Document storage",
          level: process.env.STORAGE_PROVIDER === "gcs" ? "ok" : "degraded",
          value: process.env.STORAGE_PROVIDER === "gcs" ? "Google Cloud Storage" : "local disk",
          env: ["STORAGE_PROVIDER", "GCS_BUCKET"],
        },
        {
          key: "jobs",
          label: "Background jobs",
          level: level(trigger),
          value: trigger ? "Trigger.dev" : "in-process",
          env: ["TRIGGER_SECRET_KEY"],
          note: trigger ? undefined : "Jobs run inside the request that queued them. Fine locally; a client emailing six documents would hold a webhook open through six verifications.",
        },
        {
          key: "dev",
          label: "Client simulator (/dev/phone)",
          level: devEnabled() ? "degraded" : "ok",
          value: devEnabled() ? "enabled" : "off",
          env: ["DEV_TOOLS"],
          note: devEnabled() ? "It can open cases and send the clinic’s texts with no paralegal. Set DEV_TOOLS=false in production." : undefined,
        },
      ],
    },
  ];

  return {
    groups,
    degraded: groups.flatMap((g) => g.rows).filter((r) => r.level === "degraded"),
    clinic: {
      name: process.env.CLINIC_NAME?.trim() || "your legal clinic",
      phone: identity.phone,
      email: identity.email,
      channel,
    },
  };
}
