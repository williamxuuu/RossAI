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
<<<<<<< HEAD
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
=======
  jargon/page.tsx           the extension overlay, inside the console (spec §6 cut line)
  api/copilotkit/[[...path]]/route.ts   CopilotRuntime (v2, multi-route) → OpenRouter
  api/webhooks/channel/     inbound SMS / email from the channel provider
  api/jargon/               explain + escalate (public, CORS for chrome-extension://)
  api/cases/...             console data + actions (approve/edit/reject/reply)
  api/dev/...               simulator endpoints: send, inbox, fixtures, reset (off in production)
src/db/                     schema.ts, client.ts (driver picker), migrate.ts, seed.ts, fixtures/
src/lib/llm/                openrouter client, model routing (cheap/strong/vision), json helpers
src/lib/grounding/          Exa over uscis.gov, `ground()` gate, catalog.ts (curated sources)
src/lib/pipeline/           cases, language, intake, checklist, documents, extract, verify,
                            scan (+ scan-rules, scan-grounding), escalation, reply,
                            templates, rejections, casecode
src/lib/casetypes/          case types, per-form checklists, localized labels
src/lib/channel/            provider interface; twilio (sms) + ambiguous (email) + composite + mock
src/lib/storage/            DocumentStore interface, local-fs + GCS
src/lib/guardrails/         question classification, outbound advice check
src/lib/copilot/            read-only server tools for the console copilot
src/lib/audit.ts            writeAudit()
src/lib/dev.ts              the /dev surface: fixtures, `devEnabled()`
src/lib/jobs/               enqueue() → Trigger.dev or in-process
src/trigger/                Trigger.dev task definitions (thin wrappers over src/lib/jobs)
src/components/             console UI, copilot, jargon overlay, /dev simulator
scripts/make-fixtures.ts    builds the demo document packet
extension/                  manifest.json, content.js, background.js, popup.*
docs/                       this file, DEMO.md, DEPLOY.md, CHANNELS.md, COPILOTKIT_V2_API.md
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
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
<<<<<<< HEAD
| No grounding, no output | `ground()` in `src/lib/grounding/ground.ts` returns `null` when Exa returns nothing usable; every explain/answer path returns `{ grounded: false }` and the caller escalates. The LLM sees only retrieved passages and must return a `citationIndex`; `validateCitation()` rejects an answer whose index doesn't point at a passage. |
=======
| No grounding, no output | `ground()` in `src/lib/grounding/ground.ts` returns `{ grounded: false }` when Exa returns nothing usable, when the model declines, or when it cites an index that does not point at a retrieved passage; every explain/answer path then escalates instead. `groundModelFinding()` in `src/lib/pipeline/scan-grounding.ts` drops any scan finding the model discovered whose citation does not resolve. |
| Curated sources (see §4a) | Two kinds of output are authored by the clinic, not a model — the per-form checklists and the deterministic scan rules — and they fall back to hand-verified USCIS passages in `src/lib/grounding/catalog.ts` when Exa is unavailable. `src/lib/grounding/catalog.test.ts` asserts every one points at uscis.gov, carries a real quote, and covers every rule and every checklist item. Model output never touches the catalog. |
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
| No legal advice | `classifyClientQuestion()` (cheap model) sorts inbound questions into `explain / status / judgment / other`; `judgment` always escalates. `outboundAdviceCheck()` blocks drafts containing eligibility/strategy language before they can be queued. Prompts say it too, but the code is the gate. |
| Human gate | The only function that can call a channel provider's `send*` is `sendApproved()` in `src/lib/pipeline/reply.ts`, and its signature requires an `approvedBy` paralegal id; it writes the audit entry before sending. Operational templates (checklist list, "resend, illegible", "a human is reviewing") are clinic-owned fixed text, translated, and logged as `template:<name>` — not model-authored content. Grounded SMS answers are drafted, never auto-sent (`AUTO_SEND_GROUNDED_ANSWERS` exists but defaults to `false`). |
| Client anonymity | Clients are keyed by phone. No name is required to open a case. Auth0 guards only console routes. |

<<<<<<< HEAD
=======
## 4a. Curated sources: where a citation may come from something other than Exa

Live retrieval is the primary path and the only one model output may use. But the
checklist the agent texts a client, and the deterministic rules in `scan-rules.ts`, are
written and reviewed by a person. Pinning each of them to a passage copied verbatim from
uscis.gov (`src/lib/grounding/catalog.ts`, retrieved 2026-09-12) means:

* the paralegal can still check the claim — URL plus the exact sentence, same shape as an
  Exa citation;
* the checklist and the deterministic flags keep working when Exa is down or unpaid for,
  which is the difference between a clinic that can demo this and one that cannot;
* nothing in the fallback path was written by a model.

`groundRuleFinding()` tries Exa first and records which path was used in the audit
payload (`citationVia: "exa" | "curated"`). `groundModelFinding()` has no fallback at
all: a model claim with a citation nobody retrieved is exactly the failure the grounding
rule exists to prevent.

## 4b. The deterministic floor: what works with no API keys

A demo that only works with keys is a demo of the keys. Everything below runs with none:

| Step | Without a model | With one |
|---|---|---|
| language detection | script detection (exact for Arabic, Cyrillic, CJK, Korean, Amharic) then a stop-word vote | cheap tier decides what the first two cannot |
| translation of clinic texts | human-written language packs (`TEMPLATE_PACKS`, `DOC_NAMES_BY_LANGUAGE`, `rejections.ts`, case-type labels) | unchanged — the packs still win |
| translation of paralegal free text | sent in English, with `translation unavailable; sending English` in the log | cheap tier |
| document legibility | measured: image dimensions against a floor, PDF text-layer length | vision model may overrule, except a deterministic "definitely unreadable" |
| document type + fields | phrases printed on the page, `Label: value` lines | vision model |
| scan | seven deterministic rules over the extracted fields | plus a strong-tier pass, every finding cited or dropped |
| jargon overlay | refuses: "no official USCIS source" + escalate | grounded explanation with its passage |
| console copilot | not mounted at all | sidebar with read-only tools |

The rule is the same everywhere: degrade to *less*, never to *plausible*.

## 4c. Documents: extraction, and what the scan is allowed to see

`extract.ts` is deliberately unable to guess. It reads PNG/JPEG headers for dimensions,
pdf-parse for a text layer, and `Label: value` lines for fields — an unlabelled date in a
paragraph is not a date of birth. Legibility is a three-state answer: `true`, `false`, or
`null` for "a model or a person has to look". Only `false` rejects a document.

`buildPacket()` narrows what the rules see to the **current** document per checklist item
plus anything unlinked. A client who re-sends after a rejection leaves an older copy on
the case, and feeding both to the rules produces findings about a copy nobody will file —
an illegible copy that was already replaced, or a "name mismatch" between two readings of
the same page. The console's evidence panel still shows every document.

## 4d. The phone/email seam

Intake is SMS, keyed by phone. Documents arrive by email, from an address the clinic has
never seen. Nothing links them, so the checklist text gives the client a short code
(`RA-903CDB`, the first six hex characters of the case id) and asks them to keep it in the
subject. `src/lib/pipeline/casecode.ts` looks in the subject and the body, matches
case-insensitively, and tolerates `re:`/`fwd:` and spacing. Once an address matches once
it is stored on the client and later emails need no code. An email with neither opens a
new case, which is the right answer for a stranger emailing the inbox cold.

The code is derived from the id rather than stored in a new column: no migration, it
cannot drift out of sync with the case, and a paralegal can check it by eye against the
URL. A prefix collision (1 in 16.7M) resolves to the open case.

>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
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
<<<<<<< HEAD
* `nudge-pending` — scheduled; texts a reminder for every `pending` item
=======
* `process-inbound-message` — intake step or question handling for one stored message
* `nudge-pending` — scheduled daily; texts a reminder for every `pending` item
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
* `scan-case` — runs the scan and moves the case to `awaiting_review`

The nudge cadence can also be triggered by hand from the console (spec cut line).

<<<<<<< HEAD
=======
Verification is deliberately NOT done inside the webhook: a provider needs a fast
answer, and a slow vision call in the request path turns into retries and duplicate
documents. Inline execution (no `TRIGGER_SECRET_KEY`) is correct locally — it is what
makes `/dev/phone` feel synchronous — and wrong in production, where a client emailing
six documents would hold a webhook open through six verifications.

>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
## 7. Dev / demo without external accounts

* No `DATABASE_URL` → PGlite in `./.data/pglite` (auto-migrated on boot).
* No channel provider credentials → `MockChannelProvider`; `/dev/phone` plays the client.
* No `AUTH0_*` → `AUTH_DISABLED=true` seeds a dev paralegal.
<<<<<<< HEAD
* `OPENROUTER_API_KEY` and `EXA_API_KEY` **are required** for real output. Without
  them, the pipeline refuses to fabricate: explanations return "not grounded" and
  the scan produces zero flags. This is deliberate — see §4.
=======
* `DEV_TOOLS` unset outside production → `/dev/phone` and `/api/dev/*`. They are not a
  bypass: the simulator builds the same `InboundMessage` a provider would and hands it to
  the same `processInbound()` the webhooks call.
* `npm run fixtures` builds the demo packet; `npm run db:seed` plays a client through the
  real pipeline rather than inserting rows, so a broken rule breaks the seed.
* Without `OPENROUTER_API_KEY` and `EXA_API_KEY` the pipeline refuses to fabricate:
  explanations return "not grounded", the copilot is not mounted, and the scan's model
  pass does not run. The deterministic half still works — see §4a and §4b for exactly
  what that covers and why the line falls where it does.
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b

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
