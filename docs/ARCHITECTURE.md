# RossAI — Architecture (MVP)

This document records the decisions behind the MVP build of the
[build spec](../rossAI-build-spec.md). Read it before changing the pipeline,
the guardrails, or the data model.

## 1. Shape of the system

```
                     ┌──────────────────────────────────────────────────────┐
  client phone/email │  Channel provider (Ambiguous / Mock simulator)        │
  ───────────────────▶  POST /api/webhooks/channel/{sms,email}               │
                     └───────────────┬──────────────────────────────────────┘
                                     ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  Pipeline services  (src/lib/pipeline/*)  — plain TypeScript, no UI     │
   │  intake → checklist → document verify → scanning → escalation → reply   │
   │        ▲ LLM (OpenRouter)      ▲ grounding (Exa, uscis.gov only)         │
   │        └──── every factual output must carry a citation or escalate ────┘
   └───────────────┬──────────────────────────────────────┬──────────────────┘
                   ▼                                      ▼
     Postgres (Drizzle; PGlite locally, Neon in prod)   Jobs (Trigger.dev, in-process fallback)
                   ▲
   ┌───────────────┴──────────────────────────────────────────────────────────┐
   │  Paralegal console  (Next.js App Router + CopilotKit)                    │
   │  /            queue (only checklist-complete cases)                       │
   │  /cases/[id]  flag review stack + evidence panel + escalations + copilot  │
   │  /api/copilotkit  CopilotRuntime → OpenRouter                             │
   └──────────────────────────────────────────────────────────────────────────┘
                   ▲
   Chrome extension (extension/) → POST /api/jargon/explain, /api/jargon/escalate
```

Two surfaces, one backend:

* **Console** — `src/app` (pages) + `src/app/api` (route handlers). Auth0-protected.
* **Extension** — `extension/` (Chrome MV3, no bundler). Anonymous; talks only to
  the two public `/api/jargon/*` routes.

The agent "brain" is **not** inside CopilotKit. CopilotKit powers the paralegal's
copilot in the console (generative UI, human-in-the-loop gates, shared state).
The intake/checklist/scan pipeline is deterministic TypeScript in
`src/lib/pipeline`, calling the LLM and Exa at well-defined points. This keeps
the guardrails enforceable in code instead of in prompts.

## 2. Repository layout

```
src/app/                    Next.js App Router
  page.tsx                  queue (left rail) + empty state
  cases/[id]/page.tsx       review view (rail | flag stack | evidence)
  dev/phone/page.tsx        client-side simulator: play the client (SMS + email + attachments)
  api/copilotkit/route.ts   CopilotRuntime, OpenAI-compatible adapter → OpenRouter
  api/webhooks/channel/     inbound SMS / email from the channel provider
  api/jargon/               explain + escalate (public, CORS for chrome-extension://)
  api/cases/...             console data + actions (approve/edit/reject/reply)
  api/jobs/...              job entrypoints (used by Trigger.dev tasks and the fallback runner)
src/db/                     schema.ts, client.ts (driver picker), migrate.ts, seed.ts
src/lib/llm/                openrouter client, model routing (cheap vs strong), json helpers
src/lib/grounding/          Exa search over uscis.gov, citation type, `ground()` gate
src/lib/pipeline/           intake, checklist, verifyDocument, scan, escalation, reply
src/lib/channel/            ChannelProvider interface, ambiguous + mock providers
src/lib/storage/            DocumentStore interface, local-fs + GCS
src/lib/guardrails/         legal-advice classifier, outbound gate, citation validator
src/lib/audit.ts            writeAudit()
src/lib/jobs/               enqueue() → Trigger.dev or in-process
src/trigger/                Trigger.dev task definitions (thin wrappers over src/lib/jobs)
src/components/             console UI (Rail, FlagCard, EvidencePanel, EscalationCard, …)
extension/                  manifest.json, content.js, background.js, popup.*
docs/                       this file, DEMO.md, DEPLOY.md
Dockerfile, .dockerignore   Cloud Run image (Next standalone)
```

## 3. Data model

Matches spec §2 with three additions, all marked ▲.

| Table | Columns |
|---|---|
| clients | id, phone, email, preferred_language, created_at |
| cases | id, client_id, case_type, status, assigned_paralegal_id, ▲intake_state (jsonb), created_at, updated_at |
| checklist_items | id, case_id, doc_name, description, status, ▲source_citation (jsonb), ▲rejection_reason, updated_at |
| documents | id, case_id, checklist_item_id, storage_url, received_via, legibility_ok, verified_type, ▲original_filename, ▲mime_type, ▲extracted (jsonb), created_at |
| flags | id, case_id, field_ref, severity, description, ▲proposed_fix, source_citation (jsonb), status, ▲edited_text, ▲resolved_by, ▲resolved_at, created_at |
| messages | id, case_id, direction, channel, body, language, approved_by, ▲external_id, ▲subject, created_at |
| ▲escalations | id, case_id, question, ▲source_message_id, draft_reply, draft_citation (jsonb), status (open\|replied\|dismissed), reply_message_id, created_at |
| audit_entries | id, case_id, actor, action, payload (jsonb), timestamp |

`Case.status`: `intake → collecting_docs → scanning → awaiting_review → replied → closed`.

A case only becomes visible in the queue when `status ∈ {awaiting_review, replied}`.
The transition `collecting_docs → scanning` happens exactly when every checklist
item is `received` or `accepted` — enforced in `src/lib/pipeline/checklist.ts`.

`Citation` (jsonb everywhere): `{ title, url, quote, retrievedAt }`. `quote` is the
Exa highlight actually shown to the model; it is what the paralegal sees.

## 4. Guardrails — where each one lives in code

| Rule | Enforcement |
|---|---|
| No grounding, no output | `ground()` in `src/lib/grounding/ground.ts` returns `null` when Exa returns nothing usable; every explain/answer path returns `{ grounded: false }` and the caller escalates. The LLM sees only retrieved passages and must return a `citationIndex`; `validateCitation()` rejects an answer whose index doesn't point at a passage. |
| No legal advice | `classifyClientQuestion()` (cheap model) sorts inbound questions into `explain / status / judgment / other`; `judgment` always escalates. `outboundAdviceCheck()` blocks drafts containing eligibility/strategy language before they can be queued. Prompts say it too, but the code is the gate. |
| Human gate | The only function that can call a channel provider's `send*` is `sendApproved()` in `src/lib/pipeline/reply.ts`, and its signature requires an `approvedBy` paralegal id; it writes the audit entry before sending. Operational templates (checklist list, "resend, illegible", "a human is reviewing") are clinic-owned fixed text, translated, and logged as `template:<name>` — not model-authored content. Grounded SMS answers are drafted, never auto-sent (`AUTO_SEND_GROUNDED_ANSWERS` exists but defaults to `false`). |
| Client anonymity | Clients are keyed by phone. No name is required to open a case. Auth0 guards only console routes. |

## 5. Model routing (OpenRouter)

* `cheap` — language detection, translation, classification, field extraction, template rendering.
* `strong` — cross-document contradiction scan and rejection-trigger scan.
* `vision` — legibility + type verification of uploaded images/PDFs.

Model ids are env-configurable (`OPENROUTER_MODEL_CHEAP`, `_STRONG`, `_VISION`) with
defaults set in `src/lib/llm/models.ts`.

## 6. Jobs

`enqueue(job, payload)` in `src/lib/jobs/index.ts` dispatches to Trigger.dev when
`TRIGGER_SECRET_KEY` is set, otherwise runs the job in-process (awaited). Jobs:

* `process-inbound-attachment` — verify + accept/reject one attachment
* `nudge-pending` — scheduled; texts a reminder for every `pending` item
* `scan-case` — runs the scan and moves the case to `awaiting_review`

The nudge cadence can also be triggered by hand from the console (spec cut line).

## 7. Dev / demo without external accounts

* No `DATABASE_URL` → PGlite in `./.data/pglite` (auto-migrated on boot).
* No channel provider credentials → `MockChannelProvider`; `/dev/phone` plays the client.
* No `AUTH0_*` → `AUTH_DISABLED=true` seeds a dev paralegal.
* `OPENROUTER_API_KEY` and `EXA_API_KEY` **are required** for real output. Without
  them, the pipeline refuses to fabricate: explanations return "not grounded" and
  the scan produces zero flags. This is deliberate — see §4.

## 8. Channel decision: Ambiguous for email, Twilio for SMS

The spec routes all SMS and email through the Ambiguous AI coworker. Research on
2026-09-12 (docs/research/ambiguous.*.json) found that Ambiguous has a real public API
for **email** — agent inboxes, `email.received` webhooks signed with HMAC-SHA256,
`GET /api/mail/{id}` + attachment downloads, `POST /api/mail/send` — but **no SMS,
WhatsApp, or phone-number capability** anywhere in its 939-path OpenAPI spec, MCP tool
catalog, or product pages.

So the channel layer is a `CompositeChannelProvider`:

| Channel | Provider | Adapter |
|---|---|---|
| email (document intake, checklist copy) | Ambiguous coworker inbox | `src/lib/channel/ambiguous.ts` |
| sms (intake conversation, nudges, approved replies) | Twilio Programmable Messaging | `src/lib/channel/twilio.ts` |
| both, locally | Mock + `/dev/phone` simulator | `src/lib/channel/mock.ts` |

Everything above the adapter (intake, checklist, human gate) is unchanged. If Ambiguous
ships SMS, only `composite.ts` changes. Compliance note for the clinic: Ambiguous has no
HIPAA BAA and its SOC 2 audit is in progress; Twilio US numbers need A2P 10DLC registration.
