# RossAI — Build Handoff (2026-09-12)

Read this first if you are picking up the build. Companion docs: `rossAI-build-spec.md`
(the spec), `docs/ARCHITECTURE.md` (decisions), `docs/DEMO.md` (the 90-second
walkthrough), `docs/DEPLOY.md`, `docs/CHANNELS.md`, `CLAUDE.md` (conventions).

## 1. Where the build is

**The MVP is complete and runs end to end with no API keys, no database and no
accounts.** Every numbered workflow in spec §3 is implemented, and the 90-second demo in
spec §7 runs start to finish.

```bash
npm install && npm run fixtures && npm run db:seed && npm run dev
```

| Spec | Status |
|---|---|
| §3.1 Intake — SMS, language detected not asked, case type, no portal | Done |
| §3.2 Jargon — Chrome MV3 overlay + `/jargon` console fallback | Done |
| §3.3 Checklist — curated cited lists, email ingest, verify, accept/reject, nudges, the gate | Done |
| §3.4 Scanning — 7 deterministic rules + a cited strong-model pass | Done |
| §3.5 Escalation — classification, grounded drafts, judgment always to a human | Done |
| §3.6 Review — queue, flag stack, evidence panel, escalations, audit trail, CopilotKit copilot | Done |
| §3.7 Reply — approved-only, translated, logged with the approver | Done |
| §4 Guardrails | Done, and tested — see §3 below |
| §5 UI direction — warm palette, floating panels, pill nav, one accent | Done |
| §7 Demo | Done, offline |

Checks: `npm run typecheck && npm run lint && npm test && npm run build` — clean;
102 tests.

## 2. What was built on top of the foundation this session

The foundation (scaffold, schema, DB driver, LLM client, `ground()`, audit, storage,
auth, jobs, `scan-rules.ts`, `reply.ts`, the console API routes, the jargon API,
`queries.ts`, the UI primitives) already existed. Added:

* **Guardrails** — `src/lib/guardrails/classify.ts`: question classification (patterns
  first, model only to narrow, unclassifiable ⇒ judgment) and the outbound advice check.
* **Pipeline** — `cases.ts`, `language.ts`, `intake.ts`, `checklist.ts`, `documents.ts`,
  `extract.ts`, `verify.ts`, `rejections.ts`, `casecode.ts`, `scan.ts`,
  `scan-grounding.ts`, `escalation.ts`; language packs in `templates.ts`.
* **Curated USCIS sources** — `src/lib/grounding/catalog.ts`, every quote copied verbatim
  from uscis.gov on 2026-09-12. See ARCHITECTURE §4a for why this exists and what it may
  and may not be used for.
* **Checklists** — `src/lib/casetypes/checklists.ts`, five case types, each item cited.
* **Webhooks** — `/api/webhooks/channel/{sms,email}` with de-duplication by `externalId`.
* **Channels** — real `twilio.ts` and `ambiguous.ts` adapters behind `composite.ts`.
* **Console** — `layout.tsx`, the queue page, `/cases/[caseId]`, `FlagCard`,
  `EscalationCard`, `EvidencePanel`, `CitationBlock`, `CasePanels`, `CaseReview`,
  `SettingsPanel`.
* **Copilot** — `/api/copilotkit/[[...path]]`, read-only server tools, provider,
  `CaseCopilot` with context / generative flag cards / a frontend tool / a HITL gate.
* **Extension** — `extension/` (MV3, closed shadow root, service-worker fetch, popup)
  plus `/api/jargon/languages` and the `/jargon` fallback page.
* **Demo** — `scripts/make-fixtures.ts`, `/dev/phone`, `/api/dev/*`, `src/db/seed.ts`.
* **Ops** — `Dockerfile`, `.dockerignore`, `.env.example`, `README.md`, `docs/DEMO.md`,
  `docs/DEPLOY.md`, `docs/CHANNELS.md`.

## 3. Bugs found and fixed while integrating

Worth knowing about, because each was found by running the thing rather than by reading it:

| | |
|---|---|
| `normalizeName` split on apostrophes | "O'Brien" vs "OBrien" raised a high-severity name mismatch. Apostrophes are now deleted, not spaced. |
| `normalizeAddress` missed state names and `#` | "412 W Main St Apt 3, Houston, TX" vs "…#3, Houston, Texas" flagged as different. |
| `ruleDobMismatch` listed agreeing documents as conflicting | It compared each date against a running list instead of grouping. Now groups, and names one document per distinct date. |
| The scan saw superseded documents | A rejected copy replaced by a good one still produced an "illegible" flag. `buildPacket()` now passes only the current document per checklist item. |
| Email opened a second, empty case | Nothing linked a client's email address to their SMS case. Fixed with the case code — ARCHITECTURE §4d. |
| "Here are my documents" escalated | Unclassifiable text defaults to judgment (correct), so every document email created an escalation. Cover notes on messages with attachments are no longer treated as questions. |
| English leaking into Spanish messages | Rejection reasons and the clinic-name fallback were English strings interpolated into translated templates. Both are now keyed and translated. |
| Match hints could never match | `"i-797"` was compared against a haystack with hyphens already stripped. Both sides are flattened now. |
| `/api/health` test consumed the body twice | Pre-existing failure. Fixed. |

## 4. Known gaps

1. **No API keys were available on this machine.** Every path that needs OpenRouter or
   Exa is written and typechecked but has never run against the live services: the
   grounded explanation path, vision verification, the scan's model pass, translation of
   paralegal free text, and the console copilot. The refusal paths — which is what runs
   without keys — are tested and demonstrated. **Getting a key and walking the demo again
   is the first thing to do.**
2. **Ambiguous's `email.received` payload shape is undocumented.** `parseInbound` is
   defensive about it (tested against four plausible shapes) but has never seen a real
   delivery. Validate with `GET /api/webhooks/{id}/deliveries` and fix the key names.
3. **CopilotKit v2 has not been exercised against a running runtime.** The API is
   verified from the shipped type declarations (`docs/COPILOTKIT_V2_API.md`) and it
   typechecks and builds, but no conversation has ever gone through it.
4. **`POST /api/dev/reset` deletes rows, not stored bytes.** Documents are keyed by uuid
   and orphaned; `npm run db:reset` clears `.data` properly.
5. **The rate limiter is per instance.** Fine for the MVP (see `src/lib/ratelimit.ts`);
   needs shared state if the console ever scales past one Cloud Run instance.
6. **The curated catalog needs a review date.** Its quotes were verbatim on 2026-09-12.
   USCIS re-words its pages; someone should re-check them on a schedule and bump
   `RETRIEVED_AT`.
7. **Nothing is committed.** No git history was created — the repo sits inside the home
   directory's git tree, so `git init` here is probably the first step.

## 5. Handy commands

```bash
npm run dev            # / (queue), /cases/<id>, /dev/phone, /jargon, /api/health
npm run fixtures       # rebuild the demo document packet
npm run db:seed        # replay the demo client through the real pipeline (idempotent)
npm run db:reset       # wipe ./.data, re-migrate, re-seed
npm run typecheck && npm run lint && npm test && npm run build
npm run ext:zip        # package the Chrome extension
npx next typegen       # regenerate PageProps/LayoutProps globals if tsc complains
```

Env: copy `.env.example` → `.env`. An empty file runs fully offline.
