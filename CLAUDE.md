@AGENTS.md

# RossAI — working conventions

Pro bono immigration intake & prep agent. Spec: `rossAI-build-spec.md`. Decisions: `docs/ARCHITECTURE.md`. Read both before touching the pipeline, guardrails, or schema.

## Toolchain
- Node 24 at `/opt/homebrew/opt/node@24/bin` — if `node` is not found, `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- Next.js 16 (App Router, Turbopack), React 19, Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`, no tailwind.config), TypeScript strict.
- CopilotKit 1.71 (`@copilotkit/react-core`, `react-ui`, `runtime`). Use `useFrontendTool`, `useHumanInTheLoop`, `useRenderToolCall`, `useCopilotReadable`, `useCoAgent`. **Never** `useCopilotAction` (deprecated).
- Drizzle ORM (`src/db/schema.ts` is the single source of truth). PGlite locally, `pg` in prod.
- `npm run typecheck` (tsc --noEmit), `npm run lint`, `npm test` (vitest) must pass before you report done.

## Non-negotiable product rules (spec §4)
1. **No grounding, no output.** Any factual explanation must carry a `Citation` from Exa (uscis.gov). If `ground()` returns null, return `{ grounded: false }` and escalate. Never fabricate a citation.
2. **No legal advice.** Explain what a term/field *means*. Never say what the client *should* do, whether they qualify, or how to answer.
3. **Human gate.** Only `sendApproved()` in `src/lib/pipeline/reply.ts` may send free-text to a client, and it requires a paralegal `approvedBy` id plus an audit entry. Operational templates go through `sendTemplate()` and are logged as `template:<name>`.
4. **Audit everything.** Every state change calls `writeAudit()`.
5. **Client anonymity.** Store no PII beyond what the case needs. Clients never authenticate.

## Code style
- Server-only code in `src/lib/**` and `src/db/**` — add `import "server-only"` at the top of modules that touch secrets or the DB.
- Route handlers in `src/app/api/**/route.ts`; validate bodies with zod; return `NextResponse.json`.
- Prefer small pure functions; put LLM prompts next to the function that uses them; every LLM call goes through `src/lib/llm/client.ts` and picks a tier from `src/lib/llm/models.ts`.
- Structured LLM output: ask for JSON, parse with zod, and treat parse failure as "no output" (never partially trust).
- UI: warm palette tokens only (`bg-panel`, `text-ink`, `text-muted`, `bg-accent`, `text-warn`, `text-error`, `text-ok`, `rounded-[var(--radius-panel)]`, `.panel`, `.tile`, `.pill-nav`, `.section-label`). One accent color; flags carry the color weight.
- No `any`. No console.log in library code (use `src/lib/log.ts`).
- Don't add dependencies without a reason in the commit message.
