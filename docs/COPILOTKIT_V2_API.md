# CopilotKit 1.71 — the `/v2` API we use (verified from node_modules, 2026-09-12)

**The classic v1 SDK (`@copilotkit/react-core`, `@copilotkit/runtime` root imports) is
deprecated since 1.68.2.** Everything below is imported from the `/v2` entry points.
Do not use `useCopilotAction`, `useCopilotReadable`, `useCoAgent`, `OpenAIAdapter`,
`copilotRuntimeNextJSAppRouterEndpoint` — they are the old API.

| Spec name (v1) | What we use (v2) |
|---|---|
| `useCopilotReadable` | `useAgentContext({ description, value })` |
| `useCoAgent` | `useAgent({ agentId })` → `{ agent, isReady }`; `agent.state`, `agent.setState()`, `agent.subscribe()` |
| `useRenderToolCall` | `useRenderTool({ name, parameters, render })` or `defineToolCallRenderer` + `renderToolCalls` prop |
| `useHumanInTheLoop` | `useHumanInTheLoop({ name, description, parameters, render })` (same name) |
| `useFrontendTool` | `useFrontendTool({ name, description, parameters, handler, render? })` (same name) |
| `<CopilotKit>` | `<CopilotKitProvider runtimeUrl agentId>` |
| `CopilotSidebar` from react-ui | `CopilotSidebar` / `CopilotChat` / `CopilotPopup` from `@copilotkit/react-core/v2` |
| styles | `import "@copilotkit/react-core/v2/styles.css"` |

## Backend — `src/app/api/copilotkit/[[...path]]/route.ts`

```ts
import { CopilotRuntime, BuiltInAgent, defineTool, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: { "HTTP-Referer": "https://rossai.local", "X-Title": "RossAI" },
});

const agent = new BuiltInAgent({
  model: openrouter.chat(process.env.OPENROUTER_MODEL_CHEAP ?? "openai/gpt-4.1-mini"), // LanguageModel (AI SDK v6)
  prompt: "...system prompt...",
  maxSteps: 5,               // NOTE: interrupt (HITL) tools require maxSteps 1 — see below
  tools: [
    defineTool({
      name: "listFlags",
      description: "...",
      parameters: z.object({ caseId: z.string() }),
      execute: async ({ caseId }) => { /* server-side */ },
    }),
  ],
});

const runtime = new CopilotRuntime({ agents: { default: agent } });
const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" }); // (Request) => Promise<Response>
export const GET = handler;
export const POST = handler;
```

`createCopilotRuntimeHandler` is multi-route by default (`POST /agent/:agentId/run`,
`GET /info`, …) so the Next route must be a catch-all: `api/copilotkit/[[...path]]/route.ts`.

`BuiltInAgentClassicConfig` fields: `model`, `apiKey?`, `maxSteps?` (default 1), `toolChoice?`,
`maxOutputTokens?`, `temperature?`, `prompt?`, `tools?: ToolDefinition[]`, `mcpServers?`,
`forwardSystemMessages?`, `providerOptions?`.

`defineTool({ name, description, parameters, execute?, interrupt?, interruptReason?, interruptMessage? })`.
Interrupt tools (`interrupt: true`, no `execute`) pause the run and are answered by a
frontend `useHumanInTheLoop` renderer with the same `name`. **Interrupt tools require
`maxSteps: 1`.** Frontend tools registered with `useFrontendTool` / `useHumanInTheLoop` are
sent to the runtime with each run and do not need to be declared server-side.

## Frontend

```tsx
"use client";
import { CopilotKitProvider, CopilotSidebar, useAgentContext, useFrontendTool, useHumanInTheLoop, useRenderTool, useAgent } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { z } from "zod";

// expose state (was useCopilotReadable)
useAgentContext({ description: "The case under review", value: caseSummaryJson });

// generative UI for a backend tool call (was useRenderToolCall)
useRenderTool({
  name: "listFlags",
  parameters: z.object({ caseId: z.string() }),
  render: ({ args, status, result }) => <FlagCards result={result} status={status} />,
});

// human-in-the-loop gate
useHumanInTheLoop({
  name: "approveFlag",
  description: "Ask the paralegal to approve, edit, or reject a flag",
  parameters: z.object({ flagId: z.string(), proposedText: z.string() }),
  render: ({ args, status, respond, result }) => {
    if (status === "executing" && respond) {
      return <ApproveEditReject onDecision={(d) => respond(d)} />;   // respond: (result: unknown) => Promise<void>
    }
    if (status === "complete") return <Done result={result} />;
    return <Skeleton />;
  },
});

// frontend tool (runs in the browser)
useFrontendTool({
  name: "focusFlag",
  description: "Scroll the review stack to a flag",
  parameters: z.object({ flagId: z.string() }),
  handler: async ({ flagId }) => { setSelected(flagId); return "ok"; },
});

// shared state (was useCoAgent)
const { agent, isReady } = useAgent({ agentId: "default" });
```

`status` values are the `ToolCallStatus` enum: `"inProgress" | "executing" | "complete"`
(import `ToolCallStatus` from `@copilotkit/core`, re-exported by `@copilotkit/react-core/v2`).

Provider props: `runtimeUrl`, `agentId` (default "default"), `headers`, `credentials`,
`properties`, `frontendTools`, `humanInTheLoop`, `renderToolCalls`, `enableInspector`.

## Verified corrections (research pass, 2026-09-12)

- A module-scope `new BuiltInAgent(...)` is safe: the v2 handler clones the registered agent per request. Use the `agents: ({ request }) => ({ default: ... })` factory only when you need per-request config.
- HITL: prefer `useHumanInTheLoop` (documented, works with any `maxSteps`). Server `defineTool({ interrupt: true })` + client `useInterrupt` works in code but is undocumented in 1.71.1 — treat as experimental.
- `respond(value)` is JSON-stringified into the tool result; always respond with an object (`respond({ approved: true })`). Same for `useFrontendTool` handler return values.
- `useFrontendTool` / `useHumanInTheLoop` accept `available?: boolean` (false hides the tool from the agent; pass it in deps).
- `useAgentContext({ description, value })` entries are appended to the system prompt under "## Context from the application" — that is how per-screen instructions reach the agent; keep the base prompt server-side.
- `@ai-sdk/openai` must stay on 3.x (ai-v6 line). `@ai-sdk/openai@4` throws `AI_UnsupportedModelVersionError` inside BuiltInAgent at runtime. Never install `ai@7`.
- Never pass an OpenRouter model as a string to BuiltInAgent (`resolveModel` mangles the slash). Always pass the LanguageModel from `createOpenAI({ baseURL }).chat(id)`.
- `@copilotkit/react-core/v2/headless` exports the hooks without UI components if a UI-free import is ever needed.
