# Deploying RossAI

Target: Google Cloud Run, Neon (or any Postgres), GCS for documents, Trigger.dev for
jobs, Auth0 for paralegal accounts.

## What must be true before you deploy

The app refuses to start on Cloud Run without these, rather than quietly losing data:

| | Why it is refused |
|---|---|
| `DATABASE_URL` | Cloud Run's filesystem is ephemeral. The embedded PGlite database would silently lose every case on the next revision. `src/db/client.ts` throws. |
| `GCS_BUCKET` (or `STORAGE_PROVIDER=gcs`) | Same reason for the documents clients email in. `src/lib/storage/index.ts` throws. |

`/api/health` reports the rest as warnings instead of failures: `pglite in production`,
`local document storage on Cloud Run`, `jobs run inline in production`.

## Build and deploy

```bash
gcloud builds submit --tag gcr.io/$PROJECT/rossai
gcloud run deploy rossai \
  --image gcr.io/$PROJECT/rossai \
  --region us-central1 \
  --port 8080 \
  --min-instances 1 \
  --set-env-vars NODE_ENV=production,APP_BASE_URL=https://rossai.example.org \
  --set-secrets DATABASE_URL=rossai-db:latest,OPENROUTER_API_KEY=openrouter:latest,EXA_API_KEY=exa:latest,AUTH0_CLIENT_SECRET=auth0-secret:latest,AUTH0_SECRET=auth0-session:latest,TWILIO_AUTH_TOKEN=twilio:latest,AMBIGUOUS_API_KEY=ambiguous:latest,AMBIGUOUS_WEBHOOK_SECRET=ambiguous-hmac:latest
```

`--min-instances 1` is not only about latency. Without Trigger.dev, jobs run in-process,
and the per-instance rate limiter on the public jargon endpoints resets with the
instance.

Migrations run on first database use. Once you run them from CI instead, set
`DB_MIGRATE_ON_BOOT=false` so concurrent revisions do not race.

## Auth0

Paralegals only. Clients never authenticate (spec §4).

- Application type: **Regular Web Application**
- Allowed callback URLs: `https://rossai.example.org/auth/callback`
- Allowed logout URLs: `https://rossai.example.org`
- Env: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`
  (32+ random bytes), `APP_BASE_URL`

`src/proxy.ts` gates everything except `/api/webhooks/*`, `/api/jargon/*`,
`/api/health` and `/auth/*`. **Set `AUTH_DISABLED` to nothing in production** — leaving
it `true` attributes every approval to a fake dev paralegal, which makes the audit log
worthless.

Also set `DEV_TOOLS=false`, or leave it unset: `/dev/phone` can open cases and send the
clinic's texts with no paralegal, and it is off by default when `NODE_ENV=production`.

## Trigger.dev

Deployed tasks run on Trigger.dev's infrastructure, **not** on Cloud Run, so they need
their own copy of `DATABASE_URL`, `OPENROUTER_API_KEY`, `EXA_API_KEY`, the storage and
the channel variables (dashboard → Environment Variables).

```bash
npx trigger.dev@latest deploy
```

`trigger.config.ts` pins `runtime: "node-24"` (the bare `node` runtime is 21.x, and
`@google-cloud/storage` 8.x needs 22+), keeps the native packages external, and ships
`drizzle/**` alongside the bundle so a fresh task container can migrate. Every module
under `src/lib/**` starts with `import "server-only"`, whose default export throws at
import time; an esbuild plugin in the same file resolves it to an empty module.

Without `TRIGGER_SECRET_KEY` the same job bodies run inline inside the request that
queued them. That is correct locally and wrong in production: a client emailing six
documents would hold a webhook open through six verifications.

## Channels

`docs/CHANNELS.md`. In short: `CHANNEL_PROVIDER=live`, point Twilio's inbound webhook at
`/api/webhooks/channel/sms` and set `TWILIO_WEBHOOK_URL` to that exact URL (the request
signature is computed over it), and register the Ambiguous `email.received` webhook
against `/api/webhooks/channel/email`.

## The Chrome extension

```bash
npm run ext:zip
```

Upload `rossai-extension.zip` to the Chrome Web Store. Then set `EXTENSION_IDS` to the
published extension id so `/api/jargon/*` stops accepting any `chrome-extension://`
origin, and tell clients the clinic's server URL for the popup's *Clinic server* field.

## Compliance notes for the clinic

These are the clinic's decisions to make, not the software's, but they should be on the
table before a real client's documents go through:

- **Ambiguous has no HIPAA BAA** and its SOC 2 audit is in progress (checked
  2026-09-12). Immigration case files are not HIPAA-covered by default, but Form I-693
  medical records are.
- **Twilio US numbers need A2P 10DLC registration** before the clinic can text clients
  reliably.
- **OpenRouter and Exa see what is sent to them.** Document text goes to OpenRouter for
  vision verification and to nobody else; Exa only ever receives the search query, never
  a client's documents.
- **`AUTO_SEND_GROUNDED_ANSWERS` should stay `false`** unless the clinic has decided
  otherwise in writing. It is the one switch that lets model-authored text reach a
  client without a person.
