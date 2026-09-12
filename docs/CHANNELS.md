# Channels: how clients reach the clinic

The build spec routes all SMS and email through the Ambiguous AI coworker. Research on
2026-09-12 found that Ambiguous has a real public **email** API and **no SMS, WhatsApp
or phone-number capability anywhere** in its 939-path OpenAPI spec, MCP tool catalog or
product pages. So:

| Channel | Provider | Adapter |
|---|---|---|
| email — document intake | Ambiguous agent inbox | `src/lib/channel/ambiguous.ts` |
| sms — intake, nudges, approved replies | Twilio Programmable Messaging | `src/lib/channel/twilio.ts` |
| both, locally | mock + `/dev/phone` | `src/lib/channel/mock.ts` |

`CompositeChannelProvider` is the only place that knows this. If Ambiguous ships SMS,
delete the `sms` entry in `src/lib/channel/composite.ts` and nothing above the adapter
changes.

Set `CHANNEL_PROVIDER=live` to use both.

## The phone/email seam

Intake happens over SMS and is keyed by phone number. Documents arrive by email, from
whatever address the client has — one the clinic has never seen. Nothing links them.

So the checklist text gives the client a short code and asks them to keep it in the
subject line:

> Envíelos por correo electrónico a docs@clinic.local y deje **RA-903CDB** en el asunto
> para que sepamos que son suyos.

`src/lib/pipeline/casecode.ts` looks for it in the subject **and** the body, matches
case-insensitively, and tolerates `RA 903CDB`, `re:`/`fwd:` prefixes and surrounding
text. Once an address has matched once it is stored on the client, so later emails need
no code at all. An email with no code and an unknown address opens a new case, which is
the right outcome for a stranger emailing the clinic's inbox cold.

The code is the first six hex characters of the case id: no migration, cannot drift out
of sync, and a paralegal can check it by eye against the URL.

## Twilio

1. Buy a number, complete **A2P 10DLC** registration (US numbers will not deliver
   reliably without it).
2. Messaging → the number → *A message comes in* → `POST https://<host>/api/webhooks/channel/sms`.
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and
   `TWILIO_WEBHOOK_URL` to that **exact** URL. The `X-Twilio-Signature` is an HMAC over
   the URL plus the sorted POST parameters, so a proxy that rewrites the host makes
   every request fail verification.

The adapter rejects an unsigned or wrongly signed request with 401 before the pipeline
sees it, returns empty TwiML (Twilio logs error 12300 for anything else), parses status
callbacks to `null` so they are acknowledged but not processed, and fetches MMS media
lazily with the account's basic auth.

## Ambiguous

1. Create an agent inbox; its address is what clients are told to email
   (`AMBIGUOUS_INBOX_EMAIL`).
2. Register an `email.received` webhook against
   `POST https://<host>/api/webhooks/channel/email`.
3. Set `AMBIGUOUS_API_KEY` and `AMBIGUOUS_WEBHOOK_SECRET`.

The webhook signature is HMAC-SHA256 over the raw body, compared in constant time; a
missing `AMBIGUOUS_WEBHOOK_SECRET` makes the adapter refuse to accept anything rather
than trust an unverified caller.

**The `email.received` payload shape is undocumented.** `parseInbound` is written
defensively — it looks for the mail id and the sender under every plausible key, uses
the payload directly when it already carries the body, and fetches `GET /api/mail/{id}`
when it does not. Attachments are read from inline base64 when present, otherwise
downloaded from `url`/`download_url`, otherwise from
`/api/mail/attachments/{id}`. Anything it cannot understand returns `null` — acknowledged
but not processed — rather than 500ing and losing a client's documents to a retry loop.

**Validate this against a real delivery before trusting it**, via
`GET /api/webhooks/{id}/deliveries`, and fix the key names once you have seen one.

## Testing a webhook locally

```bash
# SMS, mock provider (no signature required)
curl -X POST localhost:3000/api/webhooks/channel/sms \
  -H 'content-type: application/json' \
  -d '{"channel":"sms","from":"+15551230001","body":"Hola, necesito ayuda"}'

# Email with an attachment, mock provider
curl -X POST localhost:3000/api/webhooks/channel/email \
  -F channel=email -F from=maria@example.com -F 'subject=Mis documentos RA-903CDB' \
  -F body='Aqui estan' -F files=@src/db/fixtures/passport.pdf
```

`/dev/phone` does the same thing with buttons.
