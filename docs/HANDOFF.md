<<<<<<< HEAD
# RossAI — Build Handoff (as of 2026-09-12, ~13:05 local)

Read this first if you are picking up the build. Companion docs: `rossAI-build-spec.md`
(the spec), `docs/ARCHITECTURE.md` (decisions), `docs/COPILOTKIT_V2_API.md` (verified
CopilotKit v2 API), `CLAUDE.md` (working conventions for agents).

## 1. Where the build is

| Phase | Status |
|---|---|
| 0. Environment | **Done.** Node 24.21 installed via Homebrew (`/opt/homebrew/opt/node@24/bin`, added to `~/.zshrc`). No docker/psql/gcloud on this Mac. |
| 1. Dependency research (22 agents, web + npm + node_modules) | **Done.** Results in `docs/research/*.raw.json` and `*.verified.json` (gitignored). |
| 2. Scaffold + foundation | **Done, typechecked, tested.** See §3. |
| 3. Nine module implementations (parallel agents) | **RUNNING** — workflow task `wfcyr9gkl`, run id `wf_6143cab3-a1a`. Started ~12:55. 8 of 9 agents active; `channel-adapters` queued. A seam-check agent runs after them and only reports. |
| 4. Integration (build, seed, drive demo flow end-to-end, headless Chrome screenshots) | Not started. |
| 5. Adversarial review of guardrails + code review + fixes | Not started. |
| 6. Commit | Nothing committed yet (user did not ask). Foundation is **staged** in the index as a diff baseline (49 files). |

**Interrupted action:** my last command (a Python patch to five foundation files + a
typecheck) was interrupted by the user. The file edits DID land (verified by grep and
`git diff --stat`), the typecheck did NOT run. First thing to do on resume:
`npx tsc --noEmit` and fix anything in `next.config.ts`, `drizzle.config.ts`,
`src/db/client.ts`, `src/lib/storage/index.ts`.

## 2. How to resume

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
cd /Users/vedanshmannem/Desktop/RossAI

# is the implementation workflow still running? (one line per agent; 'result' = done)
python3 - <<'PY'
import json
J='/Users/vedanshmannem/.claude/projects/-Users-vedanshmannem-Desktop-RossAI/6332d145-8031-4d88-8b40-bee1826d969e/subagents/workflows/wf_6143cab3-a1a/journal.jsonl'
s={};d=set()
for l in open(J):
    try:e=json.loads(l)
    except:continue
    if e.get('type')=='started':s[e['agentId']]=e.get('label')
    if e.get('type')=='result':d.add(e['agentId'])
for a,l in s.items():print('DONE' if a in d else 'RUNNING',l)
PY

# In Claude Code: /workflows shows live progress. If the session died, resume with:
#   Workflow({ scriptPath: "/Users/vedanshmannem/.claude/projects/-Users-vedanshmannem-Desktop-RossAI/6332d145-8031-4d88-8b40-bee1826d969e/workflows/scripts/rossai-implement-modules-wf_6143cab3-a1a.js",
#              resumeFromRunId: "wf_6143cab3-a1a" })
# Completed agents replay from cache; only unfinished ones re-run.

# Verify the merged tree
npx tsc --noEmit && npx eslint src && npx vitest run
git status --short | grep -v '^A '     # what the agents added on top of the staged baseline
```

## 3. What exists and is verified (foundation, written by the orchestrator)

All under `/Users/vedanshmannem/Desktop/RossAI`. `npm run typecheck` was clean and
`npm test` passed 14 tests immediately before the module fan-out.

| Area | Files | Notes |
|---|---|---|
| Next.js 16.3.5 app (App Router, Turbopack, Tailwind v4, React 19.2) | `src/app/layout.tsx`, `page.tsx`, `globals.css` | Palette from spec §5 as CSS tokens + `.panel/.tile/.pill-nav/.section-label` helpers. `next.config.ts`: `output: "standalone"`, `serverExternalPackages` for pglite/pg/pdf-parse/gcs, `outputFileTracingIncludes` for `./drizzle`. |
| Data model | `src/db/schema.ts` | Spec §2 tables + `escalations` + jsonb `Citation`/`ExtractedDocument`/`IntakeState`. Migration `drizzle/0000_lethal_elektra.sql` generated. |
| DB client | `src/db/client.ts` | `getDb()` picks `pg` when `DATABASE_URL` set, else embedded PGlite in `./.data/pglite` (`PGLITE_DATA_DIR=memory://` for tests). Auto-migrates on first use. Throws on Cloud Run without `DATABASE_URL`. Verified end-to-end (insert + relational query). |
| LLM | `src/lib/llm/{models,client,copilot-model}.ts` | OpenRouter via `openai` SDK. Tiers: cheap `openai/gpt-5.6-luna`, strong `openai/gpt-5.6-sol`, vision luna (env-overridable). `completeJson()` validates with zod and returns `null` on any failure. Sends `reasoning.effort` (low/medium) and `provider.require_parameters`. Supports image and PDF (`file`) parts. `copilotLanguageModel()` = `createOpenAI({baseURL}).chat(id)` for CopilotKit. |
| Grounding gate | `src/lib/grounding/{exa,ground}.ts` + tests | Exa `searchAndContents` restricted to `uscis.gov` with highlights → passages. `ground()` returns `{grounded:false, reason}` unless the model cites a real passage index; advice-language regex backstop (EN/ES). 14 tests pass. |
| Audit | `src/lib/audit.ts` | `writeAudit()` with a typed `AuditAction` union. |
| Storage | `src/lib/storage/index.ts` | Local FS (`./.data/documents`) or GCS; refuses local on Cloud Run. |
| Auth | `src/lib/auth.ts`, `src/proxy.ts` | Auth0 v4 (`Auth0Client`), `AUTH_DISABLED=true` → dev paralegal. Next 16 `proxy.ts` (middleware was renamed). Public: `/api/webhooks`, `/api/jargon`, `/api/health`, `/auth`. |
| Jobs | `src/lib/jobs/{index,handlers}.ts` | `enqueue()` → Trigger.dev when `TRIGGER_SECRET_KEY` set, else runs inline. |
| Channel | `src/lib/channel/{types,mock,index,ambiguous}.ts` | Provider interface; `MockChannelProvider` parses JSON or multipart from the simulator; `ambiguous.ts` is a stub being replaced by the channel-adapters agent. |
| Contracts | `src/lib/pipeline/*.ts`, `src/lib/casetypes/index.ts`, `src/lib/i18n.ts`, `src/components/copilot/{provider,CaseCopilot}.tsx` | "CONTRACT STUB" files defining signatures the modules implement. |
| Tests | `vitest.config.mts`, `src/test/*` | `@/` alias, `server-only` aliased to a stub. |

## 4. Decisions that differ from the spec (all documented in ARCHITECTURE.md)

1. **CopilotKit "v2 hooks" live at `/v2` entry points.** `@copilotkit/*` is at 1.71.1; the v1 SDK is deprecated since 1.68.2. `useCopilotReadable` → `useAgentContext`, `useCoAgent` → `useAgent`, `useRenderToolCall` → `useRenderTool`, UI components come from `@copilotkit/react-core/v2` (not react-ui). Backend: `BuiltInAgent` + `createCopilotRuntimeHandler` at `api/copilotkit/[[...path]]`. HITL via `useHumanInTheLoop` (documented); `interrupt:true` tools are experimental.
2. **Ambiguous has no SMS.** Verified against its live OpenAPI spec (939 paths). Email via Ambiguous (webhooks + `/api/mail/*`), SMS via Twilio, both behind `CompositeChannelProvider`. `CHANNEL_PROVIDER=mock|live`.
3. **Human gate vs. automated texts.** Operational templates (checklist list, "illegible, resend", "a human is reviewing") are clinic-owned fixed text sent via `sendTemplate()` and logged as `template:<name>`. Model-generated text goes only through `sendApproved()` with a paralegal id. Grounded SMS answers are drafted as escalations, never auto-sent, unless `AUTO_SEND_GROUNDED_ANSWERS=true`.
4. **Next.js 16, not 15.** Spec said 15; 16.3.5 is current and CopilotKit has no Next constraint.
5. **Pipeline logic is plain TypeScript**, not inside CopilotKit. CopilotKit powers the paralegal's copilot only, so guardrails are enforced in code.
6. **PGlite locally, Neon/pg in prod.** No Postgres/docker on this machine.
7. **npm pins:** `zod@^3.25`, `openai@^5`, `@ai-sdk/openai@^3` (4.x breaks BuiltInAgent at runtime), `@types/node@^24`. npm 11 OOMs on this tree without `NODE_OPTIONS=--max-old-space-size=8192`.

## 5. The nine modules in flight (owner → owned paths)

| Agent | Owns | Delivers |
|---|---|---|
| intake-escalation-reply | `src/lib/pipeline/{intake,escalation,reply,templates}.ts`, `src/lib/guardrails/**`, `src/app/api/webhooks/**` | SMS/email webhooks, intake state machine, question classification, escalations, **the human gate** (`sendApproved`/`sendTemplate`/`translateText`). |
| checklist-documents | `src/lib/pipeline/{checklist,documents,verify}.ts`, `src/lib/casetypes/checklists.ts` | Curated per-form checklists with real USCIS citations, attachment ingest, vision verification, accept/reject, nudges, checklist-complete → scan. |
| scan | `src/lib/pipeline/{scan,scan-rules,scan-grounding}.ts` | Deterministic cross-document rules + strong-model pass; every flag cited or dropped; case → `awaiting_review`. |
| console-ui | `src/app/{layout,page}.tsx`, `src/app/cases/**`, `src/app/api/cases/**`, `src/app/api/documents/**`, `src/components/console/**`, `src/lib/{queries,console-actions}.ts` | Queue rail, flag review stack (Approve/Edit/Request more info/Reject), evidence panel, escalation replies, audit trail. HTTP API contract in the workflow script. |
| copilot | `src/app/api/copilotkit/**`, `src/app/api/copilot/**`, `src/components/copilot/**`, `src/lib/copilot/**` | Runtime route, read-only server tools, `RossCopilotProvider`, `CaseCopilot` with context/HITL/generative flag cards/suggestions. |
| extension | `extension/**`, `src/app/api/jargon/**`, `src/app/jargon/**`, `src/lib/{cors,ratelimit}.ts` | MV3 overlay (Shadow DOM, service-worker fetch, popup language selector), public explain/escalate API, console fallback page. |
| simulator-seed-demo | `src/app/dev/**`, `src/app/api/dev/**`, `src/db/seed.ts`, `src/db/fixtures/**`, `scripts/make-fixtures.ts`, `docs/DEMO.md` | `/dev/phone` client simulator, PDF/PNG fixtures (pdf-lib), seeded demo case with 4 cited flags, reset endpoint, 90-second demo script. |
| ops | `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`, `deploy/**`, `trigger.config.ts`, `src/trigger/**`, `src/app/api/health/**`, `.github/**`, `README.md`, `docs/DEPLOY.md` | Cloud Run image + deploy script, Trigger.dev tasks (ids = job names; `server-only` shim via build extension), health route, CI, README. |
| channel-adapters | `src/lib/channel/{ambiguous,twilio,composite}.ts`, `index.ts`, `scripts/register-ambiguous-webhook.ts`, `docs/CHANNELS.md` | Ambiguous email (HMAC-verified webhooks, mail fetch, attachment download, send with idempotency), Twilio SMS (signature validation, media), composite routing. |

Rules they were given: disjoint paths only; no `npm install`; no `next build`/`next dev`;
verify with `tsc`/`eslint`/`vitest`; keep contract signatures; mock LLM/Exa in tests.
Each returns a structured report (files, exports, tests, open issues, notes for
integration). The final workflow result includes all reports plus the seam check.

## 6. Planned next steps (not started)

1. **Read the module reports** from the workflow result (or `journal.jsonl` for run `wf_6143cab3-a1a`).
2. **Integration workflow:** one agent runs `npm run typecheck && npm run lint && npm test && npm run build`, `npm run db:seed`, starts `next dev`, drives the demo flow with the mock channel via curl against `/api/webhooks/channel/*` (Spanish intake → checklist SMS → email two fixture docs → one rejected as illegible → checklist completes → scan → case in queue → approve 3 / edit 1 → reply arrives translated), screenshots `/`, `/cases/[id]`, `/dev/phone`, `/jargon` with headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --screenshot`), and fixes seams. Expect it to run without API keys (templates + deterministic rules work; LLM/Exa steps report "unavailable" honestly) — no `OPENROUTER_API_KEY` / `EXA_API_KEY` exist on this machine.
3. **Review workflow:** parallel reviewers with distinct lenses — (a) grounding rule: can any path emit a factual claim without a real `Citation`? (b) human gate: can any path call a channel provider with model text without a paralegal id + audit entry? (c) no-legal-advice; (d) correctness/security of webhooks and public routes; (e) UI against spec §5 — then adversarial verification of each finding, then fixer agents, then re-run the full check.
4. **Trigger.dev config note** from research: set `runtime: "node-24"` in `trigger.config.ts`; pass DB ids in payloads (≤128 KB).
5. Ask the user before committing; suggested first commit = foundation + modules once green.

## 7. Known gaps / risks

- No API keys on this machine: real LLM/Exa output is untested; the demo relies on the seeded case and on honest "unavailable" paths.
- `AmbiguousChannelProvider`'s `email.received` webhook `data` shape is undocumented; the adapter must find the mail id defensively and be validated against a real delivery (`GET /api/webhooks/{id}/deliveries`).
- CopilotKit runtime behavior (frontend HITL tools with `maxSteps > 1`) is verified from type declarations, not from a running server yet.
- Trigger.dev `server-only` import problem is being handled by the ops agent via a build extension; verify with `npx trigger.dev@latest dev` once an account exists.
- A transient `undefined/pgtest` directory appeared once (PGlite scratch from drizzle-kit); it is gitignored.
- `docs/research/` is gitignored and session-specific; regenerate by re-running the research workflow script if needed.

## 8. Handy commands

```bash
npm run dev            # http://localhost:3000 (console), /dev/phone (client simulator), /jargon (fallback overlay)
npm run db:seed        # demo data (idempotent); npm run db:reset wipes ./.data first
npm run typecheck && npm run lint && npm test
npx next typegen       # regenerates LayoutProps/PageProps globals if tsc complains
```
Env: copy `.env.example` → `.env`; defaults run fully offline with `CHANNEL_PROVIDER=mock`, `AUTH_DISABLED=true`, no `DATABASE_URL`.

Memory notes for future sessions live in
`~/.claude/projects/-Users-vedanshmannem-Desktop-RossAI/memory/` (Node path, stack decisions).
=======
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
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
