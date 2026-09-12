"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FixtureFile } from "@/lib/dev";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";

/**
 * The client's phone.
 *
 * Left: the SMS thread, which is the whole client-side experience — there is no
 * portal, no login, no account. Right: the email the clinic asked them to send their
 * documents to, with the demo files to attach.
 *
 * Everything posts to /api/dev/send and then re-reads /api/dev/inbox, so the thread
 * shows exactly what the database says was sent, including who approved it.
 */

type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  channel: "sms" | "email";
  body: string;
  subject: string | null;
  language: string;
  approvedBy: string | null;
  createdAt: string;
};

type Inbox = {
  client: { id: string; phone: string | null; email: string | null; preferredLanguage: string } | null;
  case: { id: string; caseType: string | null; status: string } | null;
  messages: InboxMessage[];
  checklist: { id: string; docName: string; status: string; rejectionReason: string | null }[];
};

const EMPTY: Inbox = { client: null, case: null, messages: [], checklist: [] };

const OPENERS = [
  "Hola, necesito ayuda con mis papeles de residencia",
  "Hello, I need help with my citizenship application",
  "Bonjour, j'ai besoin d'aide avec mes documents",
];

const QUESTIONS = [
  { label: "Ask what a term means", text: "¿Qué significa adjustment of status?" },
  { label: "Ask for legal judgment", text: "¿Debo marcar que sí estuve fuera del país más de seis meses?" },
  { label: "Ask about progress", text: "¿Qué documentos les faltan de mi caso?" },
];

export function PhoneSimulator({ fixtures }: { fixtures: FixtureFile[] }) {
  const [phone, setPhone] = useState("+15551230001");
  const [draft, setDraft] = useState(OPENERS[0]);
  const [selected, setSelected] = useState<string[]>([]);
  const [inbox, setInbox] = useState<Inbox>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLOListElement>(null);

  const email = `${phone.replace(/\D/g, "")}@client.demo`;

  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  /**
   * Read the thread whenever the phone number changes or something was sent. The
   * abort guard matters: switching numbers mid-request must not let the previous
   * client's thread land on top of the new one.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dev/inbox?from=${encodeURIComponent(phone)}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<Inbox>) : EMPTY))
      .then((next) => setInbox(next))
      .catch(() => {
        /* the page is still usable without the thread */
      });
    return () => controller.abort();
  }, [phone, reloads]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [inbox.messages.length]);

  async function send(payload: { channel: "sms" | "email"; body: string; subject?: string; fixtures?: string[] }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, from: payload.channel === "sms" ? phone : email }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) setError(json.message ?? json.error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function reset() {
    setBusy(true);
    await fetch("/api/dev/reset", { method: "POST" });
    setBusy(false);
    setSelected([]);
    refresh();
  }

  const pending = inbox.checklist.filter((c) => c.status !== "received" && c.status !== "accepted");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col gap-5 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Client simulator</h1>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
            You are the client. Text the clinic, then email your documents to the address it gives you. Everything you
            send here goes through the same pipeline a real message would.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm text-accent underline underline-offset-2">
            Open the console
          </Link>
          <Button size="sm" variant="ghost" busy={busy} onClick={reset}>
            Reset demo
          </Button>
        </div>
      </header>

      {error ? <p className="panel p-4 text-sm text-error">{error}</p> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-label">Text messages</h2>
            <label className="flex items-center gap-2 text-xs text-muted">
              from
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-40 rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink"
              />
            </label>
          </div>

          {inbox.case ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Chip tone="accent">{inbox.case.caseType ?? "intake"}</Chip>
              <Chip tone="neutral">{inbox.case.status.replace(/_/g, " ")}</Chip>
              <Chip tone="neutral">{inbox.client?.preferredLanguage}</Chip>
              <Link href={`/cases/${inbox.case.id}`} className="ml-auto text-accent underline underline-offset-2">
                this case in the console
              </Link>
            </div>
          ) : null}

          <ol ref={threadRef} className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
            {inbox.messages.length === 0 ? (
              <li className="rounded-[var(--radius-tile)] bg-surface px-4 py-6 text-center text-sm text-muted">
                Nothing yet. Send the first message.
              </li>
            ) : null}
            {inbox.messages.map((m) => (
              <li
                key={m.id}
                className={
                  "max-w-[85%] rounded-2xl px-4 py-2.5 " +
                  (m.direction === "inbound" ? "ml-auto bg-accent text-accent-ink" : "bg-surface text-ink")
                }
              >
                {m.channel === "email" ? (
                  <p className={"text-[0.68rem] " + (m.direction === "inbound" ? "text-accent-ink/70" : "text-muted")}>
                    email{m.subject ? ` · ${m.subject}` : ""}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                {m.direction === "outbound" && m.approvedBy ? (
                  <p className="mt-1 text-[0.66rem] text-muted">sent as {m.approvedBy}</p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2">
            <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {[...OPENERS, ...QUESTIONS.map((q) => q.text)].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDraft(t)}
                  className="max-w-full truncate rounded-full bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-ink"
                  title={t}
                >
                  {t.length > 40 ? `${t.slice(0, 40)}…` : t}
                </button>
              ))}
            </div>
            <Button
              variant="primary"
              size="sm"
              busy={busy}
              disabled={!draft.trim()}
              onClick={() => send({ channel: "sms", body: draft })}
            >
              Send text
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="section-label">Email your documents</h2>
            <p className="text-xs leading-relaxed text-muted">
              From <span className="text-ink">{email}</span>. Pick the files to attach, then send. The agent verifies
              each one and texts you back.
            </p>
            <ul className="flex flex-col gap-1.5">
              {fixtures.map((f) => (
                <li key={f.filename}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-tile)] bg-surface p-3 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.includes(f.filename)}
                      onChange={(e) =>
                        setSelected((prev) => (e.target.checked ? [...prev, f.filename] : prev.filter((x) => x !== f.filename)))
                      }
                    />
                    <span>
                      <span className="block font-medium text-ink">{f.filename}</span>
                      <span className="block leading-relaxed text-muted">{f.label}</span>
                    </span>
                  </label>
                </li>
              ))}
              {fixtures.length === 0 ? (
                <li className="text-xs text-muted">No fixtures. Run <code>npm run fixtures</code>.</li>
              ) : null}
            </ul>
            <Button
              variant="primary"
              size="sm"
              busy={busy}
              disabled={selected.length === 0}
              onClick={async () => {
                await send({ channel: "email", body: "Aquí están mis documentos.", subject: "Mis documentos", fixtures: selected });
                setSelected([]);
              }}
            >
              Email {selected.length || ""} document{selected.length === 1 ? "" : "s"}
            </Button>
          </section>

          {inbox.checklist.length > 0 ? (
            <section className="panel flex flex-col gap-2 p-5">
              <h2 className="section-label">What the clinic is waiting for</h2>
              <ul className="flex flex-col gap-1.5 text-xs">
                {inbox.checklist.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2">
                    <span className="text-ink">{c.docName}</span>
                    <Chip tone={c.status === "received" || c.status === "accepted" ? "ok" : c.status === "rejected" ? "error" : "neutral"}>
                      {c.status}
                    </Chip>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">
                {pending.length === 0
                  ? "Everything is in — the case has moved into the paralegal queue."
                  : `${pending.length} still to send.`}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
