# The 90-second demo

Build spec §7. Everything below runs with no API keys, no database and no accounts.

```bash
npm install
npm run fixtures
npm run db:seed     # prints the seeded case URL
npm run dev
```

Open `/dev/phone` in one window and `/` in another.

---

## What to show

**0:00 — the client texts, in Spanish.** On `/dev/phone`, send
`Hola, necesito ayuda con mis papeles de residencia`.

The agent detects Spanish from the message itself — the client is never asked to pick a
language — and replies in Spanish with a five-option menu. Point at the last line of the
welcome: *"No puedo dar asesoría legal."* It says so on first contact, in their language.

**0:15 — the client picks a case type.** Send `1`.

The agent texts back the document checklist for an I-485 **in Spanish**, with the email
address to send them to and a case code (`RA-XXXXXX`) to keep in the subject line. That
code is what links an email address the clinic has never seen to the case that was
opened by phone.

**0:30 — the client emails a bad photo.** Tick `photo-id-blurry.png` and send.

The agent measures it — 240×160, below the floor for readable text — rejects it, and
texts back, in Spanish, what was wrong and what to send instead. No model was involved:
the measurement is the reason. The case does **not** move.

**0:45 — the client emails the rest.** Tick the other five files and send.

Each one is confirmed by name as it arrives. When the last item lands, the checklist
completes, the case moves to scanning, and the scan runs. Show the client's side: *"Ya
recibimos todos sus documentos."*

**1:00 — the paralegal opens the console.** Switch windows. The case is now in **Ready
for review**, and it was never there before — that is the promise: paralegals never see
half-finished packets. Open it.

Six flags, grouped by severity, each with the field, the problem in one line, the fix in
one line, and a USCIS passage you can read without trusting the agent:

| | |
|---|---|
| high | full name differs — birth certificate vs. USCIS notice |
| high | date of birth differs — 14/03/1988 vs. 03/04/1988 |
| high | Receipt Number blank on the notice |
| high | Priority Date blank on the notice |
| medium | passport expires in under six months |
| medium | birth certificate is in Spanish with no translation in the packet |

Click a flag: the right panel shows the documents it is about, with the fields that were
actually extracted from them. Nothing here was invented — the disagreements are printed
on the pages.

**1:15 — approve three, edit one.** Approve → the flag resolves and the audit trail
records who. Edit → rewrite the fix; it stays internal. **Request more info** → type a
sentence in English; that is the only button on the card that sends anything, and it
goes out translated, attributed to the paralegal.

**1:30 — the client's phone buzzes.** Back on `/dev/phone`: the approved message has
arrived, and under it, `sent as dev|paralegal`. Open the audit trail on the case to show
the same thing from the clinic's side.

One honest caveat to say out loud if anyone asks: the clinic's own texts above were in
Spanish because they are pre-translated by a person (`TEMPLATE_PACKS` in
`src/lib/pipeline/templates.ts`). A paralegal's free text is translated by the model, so
with no `OPENROUTER_API_KEY` this last message arrives in English and the log says
`translation unavailable; sending English`. Add the key and it arrives in Spanish.

---

## The other two things worth showing

**The overlay refuses.** Open `/jargon` (or load `extension/` unpacked at
`chrome://extensions` → Load unpacked). Select a term in the practice form — or open a
PDF of your own, which is read in the browser and never uploaded. Without `EXA_API_KEY`
it says *"We couldn't find an official USCIS source for this — ask the clinic"* and
offers to reach a person. That is the whole product in one screen: it would rather say
nothing than guess. Press the button and the question appears in the console queue as an
escalation.

**Ask it something that needs judgment.** Text
`¿Debo marcar que sí estuve fuera del país más de seis meses?`. The agent does not
answer. It creates an escalation, tells the client a person is reviewing, and puts the
question in front of a paralegal with a reply box — empty, because there is nothing
grounded to draft.

---

## Resetting

`Reset demo` on `/dev/phone`, or:

```bash
npm run db:reset     # wipes ./.data, re-migrates, re-seeds
```

## With API keys

Add `OPENROUTER_API_KEY` and `EXA_API_KEY` to `.env` and the same demo gains: live
citations fetched per finding instead of the curated ones, vision verification of each
document, a strong-model scan pass over the packet, translation into languages beyond
the Spanish pack, and the console copilot in the case sidebar. `/api/health` shows which
of these are live, and so does the panel at the bottom of the queue page.
