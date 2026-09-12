import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { modelFor, OPENROUTER_BASE_URL, openRouterHeaders, type ModelTier } from "./models";

/**
 * AI SDK LanguageModel for CopilotKit's BuiltInAgent, routed through OpenRouter.
 * The console copilot only explains/navigates, so it uses the cheap tier.
 */
export function copilotLanguageModel(tier: ModelTier = "cheap") {
  const provider = createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing",
    headers: openRouterHeaders(),
  });
  return provider.chat(modelFor(tier));
}
