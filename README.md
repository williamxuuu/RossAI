# RossAI

A pro bono immigration clinic installs this so its paralegals can clear more cases an
hour. The agent does intake, explains jargon, collects documents and scans the finished
packet for problems. **A licensed human reviews and approves everything before it
reaches a client.** The agent never gives legal advice — it explains, collects, checks
and escalates.

Two surfaces, one backend:

- **Chrome extension** — select text on a USCIS page and see what it means in your
  language, with the official passage it came from. Client-facing, anonymous.
- **Paralegal console** — the review queue, the flag stack, the evidence panel.
  Clinic-facing, behind Auth0.

Clients never log into anything. They text and they email.

---

## Run it

```bash
npm install
npm run fixtures      # build the demo document packet
npm run db:seed       # play the demo client through the real pipeline
npm run dev           # http://localhost:3000
```

No API keys, no database, no accounts. `npm run db:seed` prints the URL of the seeded
case. Then:

| | |
|---|---|
| `/` | the review queue |
| `/cases/<id>` | one case: flags, evidence, escalations, audit trail |
| `/dev/phone` | play the client — text the clinic, email documents |
| `/jargon` | the client-facing PDF reader: select a term, the overlay explains it |
| `/api/health` | which backends are live |

`docs/DEMO.md` is the 90-second walkthrough.

### Turning the models on

Grounded explanations need both halves — retrieval and wording. Put them in
`.env.local` (gitignored) and restart:

```
EXA_API_KEY=...            # dashboard.exa.ai — searches uscis.gov, returns the quoted passage
OPENROUTER_API_KEY=...     # openrouter.ai/keys — puts that passage into plain language
```

`curl localhost:3000/api/health` reports `"llm": true, "exa": true` when both are live.
Models are chosen in `src/lib/llm/models.ts` and every id is env-overridable
(`OPENROUTER_MODEL_CHEAP`, `..._STRONG`, `..._VISION`) — the defaults are GPT-5.x
reasoning models, which take `reasoning.effort` and reject `temperature`.

## What works without API keys, and what does not

This matters, because the difference is the product. With no `OPENROUTER_API_KEY` and
no `EXA_API_KEY`:

**Still works.** Intake and language detection, the curated per-form checklists with
their USCIS citations, document ingestion, the legibility floor and labelled-field
extraction, every deterministic scan rule, the whole human-gate and audit path, and the
Spanish message pack.

**Refuses, rather than guessing.** The jargon overlay answers "we couldn't find an
official USCIS source for this" and offers to reach a person. The scan's model pass does
not run. The console copilot is switched off. Documents are checked by measurement
(resolution, PDF text layer, labelled fields) rather than by a vision model. A
paralegal's free-text reply goes out in English, with `translation unavailable; sending
English` in the log — the clinic's own operational texts are still in the client's
language, because those are translated by a person, not per message by a model.

Nothing degrades into a plausible-sounding answer. That is the rule the whole design is
built around — see **Guardrails** below.

## Guardrails

| Rule | Where it lives |
|---|---|
| **No grounding, no output.** Every factual statement carries a citation or the agent escalates. | `src/lib/grounding/ground.ts` returns `{ grounded: false }` when Exa retrieves nothing usable or the model cites a passage that was not retrieved. `src/lib/pipeline/scan-grounding.ts` drops any model-discovered finding whose citation does not resolve. |
| **No legal advice.** The agent explains what a term means. It never says what to do, whether someone qualifies, or how to answer. | `classifyClientQuestion()` sends anything needing judgment to a person, and treats anything it cannot classify as judgment. `outboundAdviceCheck()` blocks eligibility and instruction language on the way out. `src/lib/guardrails/classify.test.ts` holds the line. |
| **Human gate.** Only a paralegal's approval sends model-authored text to a client. | `sendApproved()` in `src/lib/pipeline/reply.ts` requires a paralegal id and writes the audit entry before the provider is called. Clinic-owned operational texts go through `sendTemplate()` and are logged as `template:<name>`. `src/lib/pipeline/reply.test.ts`. |
| **Checklist gate.** A case reaches the queue only when every document is in. | `maybeCompleteChecklist()` in `src/lib/pipeline/checklist.ts` is the only place a case becomes `scanning`. |
| **Client anonymity.** No accounts, no PII beyond what the case needs. | Clients are a phone number and a language. The jargon API stores only a hash of the selected text. |

## Layout

```
src/app/            console pages, API routes, webhooks, the dev simulator
src/lib/pipeline/   intake → checklist → verify → scan → escalation → reply
src/lib/grounding/  Exa over uscis.gov, the ground() gate, the curated source catalog
src/lib/guardrails/ question classification and the outbound advice check
src/lib/channel/    Twilio (SMS) + Ambiguous (email) behind a composite provider
src/db/             schema, driver picker, seed, demo fixtures
src/components/     console UI, copilot, jargon overlay
extension/          Chrome MV3 — manifest, content script, service worker, popup
```

`docs/ARCHITECTURE.md` is the decision record. Read it before changing the pipeline,
the guardrails or the schema.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Deploy

`docs/DEPLOY.md` — Cloud Run image, Neon/Postgres, GCS, Trigger.dev, Auth0.
`docs/CHANNELS.md` — wiring Twilio and the Ambiguous inbox.
