# Build Specification — Pro Bono Immigration Intake & Prep Agent

## 0. What we're building

A tool that pro bono immigration clinics install so their paralegals can clear more cases per hour. The agent handles intake, jargon explanation, document collection, and error scanning. A licensed human reviews and approves everything before it reaches the client. The agent never gives legal advice — it explains, collects, checks, and escalates.

Two surfaces:
1. **Chrome extension** — jargon explanation overlay on government sites and forms (client-facing)
2. **Paralegal console** — web app, CopilotKit-powered case review (clinic-facing)

The client never logs into a web app. All client interaction is Chrome extension + SMS + email.

---

## 1. Software stack

| Layer | Technology | Role |
|---|---|---|
| Console frontend | Next.js 15 (App Router), TypeScript, Tailwind | Paralegal review UI |
| Agent UI | CopilotKit (`@copilotkit/react-core`, `@copilotkit/react-ui`) | Generative UI, shared state, human-in-the-loop |
| Extension | Chrome MV3 (content script + service worker) | Jargon overlay |
| Backend | Next.js API routes + `CopilotRuntime` | Agent orchestration |
| Hosting | Google Cloud Run (containerized) | Deployment |
| Models | OpenAI via OpenRouter | Routed: cheap model for translation/extraction, strong model for scanning |
| Grounding | Exa | Semantic search over USCIS form instructions + Policy Manual |
| Client channel | Ambiguous AI coworker | Owns a phone number + inbox; handles SMS and email intake |
| Jobs | Trigger.dev | Document nudges, reminder cadence, queue processing |
| Auth | Auth0 | Paralegal accounts only; clients are anonymous |
| Data | Postgres (Neon or Supabase) + object storage for documents | Cases, documents, flags, audit log |

**CopilotKit note:** use v2 hooks — `useFrontendTool`, `useHumanInTheLoop`, `useRenderToolCall`, `useCopilotReadable`, `useCoAgent`. `useCopilotAction` is deprecated. Install the `copilotkit` agent skill so the coding agent reads current docs instead of training data.

**CopilotKit does not do SMS or WhatsApp.** All SMS and email runs through Ambiguous.

---

## 2. Data model

```
Client      id, phone, email, preferred_language, created_at
Case        id, client_id, case_type, status, assigned_paralegal_id
Document    id, case_id, checklist_item_id, storage_url, received_via, legibility_ok, verified_type
ChecklistItem  id, case_id, doc_name, description, status (pending|received|rejected|accepted)
Flag        id, case_id, field_ref, severity, description, source_citation, status (open|approved|edited|rejected)
Message     id, case_id, direction, channel (sms|email), body, language, approved_by
AuditEntry  id, case_id, actor (agent|paralegal_id), action, payload, timestamp
```

`Case.status`: `intake → collecting_docs → scanning → awaiting_review → replied → closed`

---

## 3. Workflows

### 3.1 Intake
Client texts the Ambiguous coworker's number in any language. The agent detects language, stores it on the Client record, creates a Case, and asks case-type questions conversationally. No account, no login, no portal.

### 3.2 Jargon (Chrome extension)
Content script watches for text selection on any page. On selection, inject a floating overlay anchored next to the selected paragraph containing:
- Plain-language explanation in the client's chosen language
- The Exa-retrieved source citation (form instruction line or Policy Manual paragraph)
- A "still confused — ask the clinic" button that opens an escalation

Language selector lives in the extension popup and persists to `chrome.storage.sync`.

**Hard rule:** the overlay explains what a term or field *means*. It never says what the client *should* do, whether they qualify, or how to answer. If the model can't ground an explanation in a retrieved source, it says so and offers escalation instead.

### 3.3 Checklist
On case creation, the agent generates the required-document list for that case type. It texts the list to the client with instructions to **email** documents to the coworker's inbox.

The loop, driven by Trigger.dev:
1. Agent polls the inbox for new attachments
2. For each attachment: verify it's the right document type, check legibility
3. Accept → mark ChecklistItem `received`. Reject → text the client what's wrong and re-request
4. Nudge on a scheduled cadence for anything still `pending`
5. Repeat until every item is `received`

**The case does not enter the paralegal queue until the checklist is complete.** This is the core promise — paralegals never see half-finished cases.

### 3.4 Scanning
Once documents are complete, the agent scans the packet for:
- Missing or blank required fields
- Internal contradictions across documents (dates, names, addresses)
- Common rejection triggers per USCIS instructions

Each finding becomes a Flag with a severity and an Exa source citation. Findings are formatted for paralegal consumption: grouped by severity, each with the field reference, the problem stated in one line, the proposed fix, and the citation. No prose essays.

### 3.5 Escalation
Clients can text questions at any time. The agent answers only if it can ground the answer in a retrieved source. Anything requiring judgment — eligibility, strategy, "what should I do" — creates an escalation attached to the Case and routes to the clinic queue. The client is told a human is reviewing.

### 3.6 Review (CopilotKit console)
Paralegal opens a case. CopilotKit renders a generated review view from the flag set:
- Flags grouped by severity, each a card with **Approve / Edit / Request more info**
- Evidence panel showing the relevant document beside the flag
- Any open client escalations, with a draft reply the paralegal approves or rewrites
- Every action writes an AuditEntry

Use `useCopilotReadable` to expose case state to the agent, `useHumanInTheLoop` for the approve/edit/reject gates, `useRenderToolCall` for flag cards, `useCoAgent` for shared state between console and client thread.

### 3.7 Reply
On approval, the agent translates the paralegal's approved English into the client's language and sends via SMS. Only approved content is ever sent. The translation is logged with the approver's id.

---

## 4. Guardrails (build these in, don't bolt them on)

- **No grounding, no output.** Every factual statement carries an Exa citation or the agent escalates instead.
- **No legal advice.** The agent explains, collects, checks, flags. It never states eligibility, strategy, or recommended action.
- **Human gate.** Nothing generated by the model reaches a client without a paralegal approval recorded in the audit log.
- **Client anonymity.** Clients have no account. Auth0 protects paralegal accounts only. Don't store more PII than the case requires.

---

## 5. UI direction

Reference: a floating rounded overlay panel with a pill-shaped nav row, icon tiles in rounded squares, and a docked action button at lower right. Same structure, warm instead of dark.

**Palette**
```
--bg:        #EDE8E0   warm beige, page background
--panel:     #F6F3ED   raised card surface
--surface:   #FFFFFF   input and tile surfaces
--border:    #D9D3C9
--ink:       #2A2724   primary text
--muted:     #6B6560   secondary text
--accent:    #3F5B4C   slate green, primary actions
--warn:      #B5802B   medium-severity flags
--error:     #A6453B   high-severity flags
--ok:        #4F7355   approved / received
```

**Form**
- Floating panels, 20–24px corner radius, soft shadow, no hard borders on outer containers
- Pill-shaped tab nav at top left; settings gear at top right
- Icon tiles: 56px rounded squares with 12px radius
- Generous internal padding (20–24px), roomy line height
- One accent color only — flags carry the color weight, chrome stays neutral
- Typography: Inter or system sans; section labels in small caps, muted

**Two views to build**
1. **Extension overlay** — compact floating card, anchored to selection, max 360px wide
2. **Console** — left rail case queue, center flag review stack, right evidence panel

---

## 6. Build order

1. Console shell + CopilotKit runtime wired to OpenRouter — prove the loop
2. Scanning + flag generation with Exa grounding
3. Review UI with human-in-the-loop gates
4. Ambiguous coworker: SMS intake + email document ingest
5. Checklist loop + Trigger.dev nudges
6. Chrome extension overlay
7. Auth0, audit log, Cloud Run deploy

**Cut lines if time runs short:** the Chrome extension can demo as jargon explanation inside the console instead. Auth0 can be a stub. The checklist nudge cadence can be manually triggered. Do not cut the grounding rule or the human approval gate — they are the product.

---

## 7. Demo flow (90 seconds)

Client texts a photo of a form in Spanish → agent replies in Spanish with the document checklist → client emails two documents, agent rejects one as illegible and re-requests → checklist completes, case enters queue → paralegal opens console, sees four cited flags, approves three and edits one → client's phone buzzes with the approved answer in Spanish.
