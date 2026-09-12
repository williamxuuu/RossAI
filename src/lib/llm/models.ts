/**
 * Model routing — build spec §1: "cheap model for translation/extraction, strong
 * model for scanning". All ids are OpenRouter ids and env-overridable.
 */
export type ModelTier = "cheap" | "strong" | "vision";

const DEFAULTS: Record<ModelTier, string> = {
  // Verified against the live OpenRouter model feed on 2026-09-12 (docs/research/openrouter.json).
  cheap: "openai/gpt-5.6-luna", // $0.20/$1.20 per M, vision + PDF input; translation, classification, extraction
  strong: "openai/gpt-5.6-sol", // $2/$10 per M; cross-document scanning, contradiction detection
  vision: "openai/gpt-5.6-luna", // legibility + document type checks on images/PDFs
};

export function modelFor(tier: ModelTier): string {
  const env = {
    cheap: process.env.OPENROUTER_MODEL_CHEAP,
    strong: process.env.OPENROUTER_MODEL_STRONG,
    vision: process.env.OPENROUTER_MODEL_VISION,
  }[tier];
  return env && env.trim().length > 0 ? env.trim() : DEFAULTS[tier];
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.APP_BASE_URL ?? "http://localhost:3000",
    "X-OpenRouter-Title": "RossAI",
    "X-Title": "RossAI", // legacy name, still accepted
  };
}

/**
 * GPT-5.6 models reason at "medium" effort by default, which is slow and costly for
 * translation/extraction. Cheap-tier calls default to "low"; strong-tier to "medium".
 * Override per tier with OPENROUTER_REASONING_<TIER>. Values differ per model family;
 * an unsupported value returns HTTP 400, so this is only sent for openai/gpt-5.x ids.
 */
export function reasoningEffortFor(tier: ModelTier, model: string): string | undefined {
  const env = process.env[`OPENROUTER_REASONING_${tier.toUpperCase()}`];
  if (env) return env;
  if (!/^openai\/gpt-5/.test(model)) return undefined;
  return tier === "strong" ? "medium" : "low";
}

/**
 * Whether the model takes a sampling temperature.
 *
 * GPT-5.x are reasoning models: `temperature` is absent from their
 * `supported_parameters` on OpenRouter. Because every request here also sends
 * `provider: { require_parameters: true }` — which is what guarantees the endpoint
 * actually honours `response_format` instead of quietly returning prose —
 * sending temperature makes OpenRouter find no eligible endpoint and answer
 * "404 No endpoints found that can handle the requested parameters".
 * Reasoning effort (above) is the knob these models take instead.
 */
export function supportsTemperature(model: string): boolean {
  return !/^openai\/gpt-5/.test(model);
}
