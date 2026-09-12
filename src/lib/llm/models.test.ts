import { afterEach, describe, expect, it } from "vitest";
import { modelFor, reasoningEffortFor, supportsTemperature } from "./models";

/**
 * These two helpers decide which knobs go on an OpenRouter request. Getting them
 * wrong is not a soft failure: every request also sends
 * `provider: { require_parameters: true }`, so one unsupported field makes OpenRouter
 * answer "404 No endpoints found that can handle the requested parameters" and the
 * caller sees `llm_unavailable` — the app then refuses to answer anything at all.
 */

const ENV_KEYS = ["OPENROUTER_MODEL_CHEAP", "OPENROUTER_REASONING_CHEAP"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("supportsTemperature", () => {
  it("is false for the GPT-5.x reasoning models: they do not list temperature", () => {
    expect(supportsTemperature("openai/gpt-5.6-luna")).toBe(false);
    expect(supportsTemperature("openai/gpt-5.6-sol")).toBe(false);
    expect(supportsTemperature("openai/gpt-5")).toBe(false);
  });

  it("is true for models that do take a sampling temperature", () => {
    expect(supportsTemperature("openai/gpt-4.1-mini")).toBe(true);
    expect(supportsTemperature("anthropic/claude-sonnet-5")).toBe(true);
    expect(supportsTemperature("meta-llama/llama-3.3-70b-instruct")).toBe(true);
  });
});

describe("reasoningEffortFor", () => {
  it("sends effort only to the model family that accepts it", () => {
    expect(reasoningEffortFor("cheap", "openai/gpt-5.6-luna")).toBe("low");
    expect(reasoningEffortFor("strong", "openai/gpt-5.6-sol")).toBe("medium");
    expect(reasoningEffortFor("strong", "anthropic/claude-sonnet-5")).toBeUndefined();
  });

  it("lets an operator override per tier", () => {
    process.env.OPENROUTER_REASONING_CHEAP = "minimal";
    expect(reasoningEffortFor("cheap", "openai/gpt-5.6-luna")).toBe("minimal");
  });
});

describe("modelFor", () => {
  it("prefers the env override, trimmed", () => {
    process.env.OPENROUTER_MODEL_CHEAP = "  openai/gpt-4.1-mini  ";
    expect(modelFor("cheap")).toBe("openai/gpt-4.1-mini");
  });

  it("falls back to the default when the override is blank", () => {
    process.env.OPENROUTER_MODEL_CHEAP = "   ";
    expect(modelFor("cheap")).toBe("openai/gpt-5.6-luna");
  });
});
