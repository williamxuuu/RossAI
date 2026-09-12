"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { FixtureFile } from "@/lib/dev";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";

/**
 * Client message and document workspace. Inbound messages travel through the same
 * intake pipeline as a real text or email, while the page keeps the client-facing
 * interaction in one familiar, simple place.
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

export function PhoneSimulator({ fixtures }: { fixtures: FixtureFile[] }) {
  // A fresh demo identity keeps the recording view empty without deleting prior cases.
  const [phone] = useState("+15551230002");
  const [draft, setDraft] = useState("");
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
    const timer = window.setInterval(refresh, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phone, reloads, refresh]);

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

  const pending = inbox.checklist.filter((c) => c.status !== "received" && c.status !== "accepted");

  return (
    <div className="h-dvh overflow-hidden bg-[#eaf3ff] px-4 py-6 text-[#1c1c1e] sm:px-8 sm:py-10">
      <main className="mx-auto grid h-[calc(100dvh-3rem)] w-full max-w-[1100px] overflow-hidden rounded-[30px] bg-[#f5f5f7] shadow-[0_24px_70px_-30px_rgba(20,74,140,0.38)] sm:h-[calc(100dvh-5rem)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto border-b border-[#d9dce3] bg-white p-5 lg:border-r lg:border-b-0 sm:p-6">
          <div className="flex items-center gap-3">
            <Image src="/rossai-r-logo.svg" alt="RossAI" width={44} height={44} className="size-11" />
            <div>
              <h1 className="font-semibold tracking-tight">RossAI</h1>
              <p className="text-xs text-[#6e6e73]">Document center</p>
            </div>
          </div>

          <div className="mt-7">
            <h2 className="text-sm font-semibold">Your documents</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#6e6e73]">Choose the documents you would like to share with your care team.</p>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {fixtures.map((f) => (
              <li key={f.filename}>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e2e3e8] bg-[#f8f9fb] p-3 transition-colors hover:bg-[#eef5ff]">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#0a84ff]"
                    checked={selected.includes(f.filename)}
                    onChange={(e) =>
                      setSelected((prev) => (e.target.checked ? [...prev, f.filename] : prev.filter((x) => x !== f.filename)))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.displayName}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[#6e6e73]">{f.label}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <Button
            variant="primary"
            size="md"
            className="mt-4 w-full !bg-[#0a84ff] hover:!bg-[#0077ed]"
            busy={busy}
            disabled={selected.length === 0}
            onClick={async () => {
              await send({ channel: "sms", body: "Here are my documents.", fixtures: selected });
              setSelected([]);
            }}
          >
            Share {selected.length > 0 ? `${selected.length} ` : ""}document{selected.length === 1 ? "" : "s"}
          </Button>

          {inbox.checklist.length > 0 ? (
            <section className="mt-6 border-t border-[#e2e3e8] pt-5">
              <h2 className="text-sm font-semibold">Document status</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {inbox.checklist.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className="text-[#3a3a3c]">{c.docName}</span>
                    <Chip tone={c.status === "received" || c.status === "accepted" ? "ok" : c.status === "rejected" ? "error" : "neutral"}>
                      {c.status}
                    </Chip>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[#6e6e73]">
                {pending.length === 0 ? "Your documents have been received." : `${pending.length} document${pending.length === 1 ? "" : "s"} still needed.`}
              </p>
            </section>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-col bg-[#f5f5f7]">
          <header className="flex items-center justify-center border-b border-[#d9dce3] bg-white px-5 py-4">
            <div className="text-center">
              <h2 className="text-sm font-semibold">RossAI Care Team</h2>
              <p className="text-xs text-[#6e6e73]">Messages</p>
            </div>
          </header>

          {error ? <p className="mx-5 mt-4 rounded-xl bg-[#ffe8e6] px-4 py-3 text-sm text-[#b42318]">{error}</p> : null}

          <ol ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-5 sm:px-7">
            {inbox.messages.length === 0 ? (
              <li className="my-auto text-center text-sm text-[#6e6e73]">Send a message to get started.</li>
            ) : null}
            {inbox.messages.map((m) => (
              <li
                key={m.id}
                className={
                  "max-w-[85%] rounded-[20px] px-4 py-2.5 " +
                  (m.direction === "inbound" ? "ml-auto bg-[#0a84ff] text-white" : "bg-[#e5e5ea] text-[#1c1c1e]")
                }
              >
                {m.channel === "email" ? (
                  <p className={"text-[0.68rem] " + (m.direction === "inbound" ? "text-white/75" : "text-[#6e6e73]")}>
                    Documents{m.subject ? ` · ${m.subject}` : ""}
                  </p>
                ) : null}
                {m.direction === "outbound" ? (
                  <p className="mb-1 text-[0.68rem] font-medium text-[#6e6e73]">
                    {m.approvedBy?.startsWith("dev|") || m.approvedBy === "template:document.nudge" ? "Dev Paralegal" : "RossAI Care Team"}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                {m.direction === "outbound" && m.approvedBy ? (
                  <p className="mt-1 text-[0.66rem] text-[#6e6e73]">Sent by your care team</p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="border-t border-[#d9dce3] bg-white p-4 sm:p-5">
            <div className="flex items-end gap-2 rounded-[22px] bg-[#f0f1f4] p-2 pl-4">
              <Textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message"
                className="min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm shadow-none focus-visible:outline-none"
              />
            <Button
              variant="primary"
              size="sm"
              className="!bg-[#0a84ff] hover:!bg-[#0077ed]"
              busy={busy}
              disabled={!draft.trim()}
              onClick={async () => {
                await send({ channel: "sms", body: draft });
                setDraft("");
              }}
            >
              Send
            </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
