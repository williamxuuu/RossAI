import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { copilotLanguageModel } from "@/lib/llm/copilot-model";
import { COPILOT_SYSTEM_PROMPT, copilotTools } from "@/lib/copilot/tools";
import { isLlmConfigured } from "@/lib/llm/client";
import { requireParalegal } from "@/lib/auth";
import { log } from "@/lib/log";

/**
 * CopilotKit runtime for the paralegal console (spec §1, §3.6).
 *
 * The agent brain for intake/checklist/scan is NOT here — that is deterministic
 * TypeScript in src/lib/pipeline so the guardrails are enforced in code rather than
 * in a prompt (docs/ARCHITECTURE.md §1). This runtime powers only the copilot a
 * paralegal talks to while reviewing, and its server tools are read-only.
 *
 * The route is a catch-all because `createCopilotRuntimeHandler` is multi-route:
 * POST /agent/:agentId/run, GET /info, and friends all live under /api/copilotkit.
 */

const logger = log.scope("copilotkit");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Safe at module scope: the v2 handler clones the registered agent per request, so
 * one instance does not leak conversation state between paralegals.
 */
const agent = new BuiltInAgent({
  model: copilotLanguageModel("cheap"),
  prompt: COPILOT_SYSTEM_PROMPT,
  maxSteps: 5,
  tools: copilotTools,
});

const copilotRuntime = new CopilotRuntime({ agents: { default: agent } });
const copilotHandler = createCopilotRuntimeHandler({ runtime: copilotRuntime, basePath: "/api/copilotkit" });

/**
 * The console's proxy already requires a session for /api/copilotkit, but this route
 * can reach the model and the case database, so it checks again rather than trusting
 * a single layer.
 */
async function handle(req: Request): Promise<Response> {
  try {
    await requireParalegal();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "copilot_unavailable", message: "OPENROUTER_API_KEY is not set, so the console copilot is switched off." },
      { status: 503 },
    );
  }
  try {
    return await copilotHandler(req);
  } catch (err) {
    logger.error("runtime error", { err: String(err) });
    return Response.json({ error: "copilot_error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
