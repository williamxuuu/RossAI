import "server-only";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z, type ZodType, type ZodTypeDef } from "zod";
import { modelFor, reasoningEffortFor, OPENROUTER_BASE_URL, openRouterHeaders, type ModelTier } from "./models";
import { log } from "@/lib/log";

/**
 * The only place the app talks to a language model (outside the CopilotKit agent,
 * which uses the AI SDK provider in src/lib/llm/copilot-model.ts).
 *
 * - `isLlmConfigured()` lets callers degrade honestly instead of fabricating.
 * - `completeJson()` asks for JSON, validates with zod, and returns null on any
 *   failure. Callers must treat null as "no output" (spec §4: no grounding, no output).
 */

const logger = log.scope("llm");

let client: OpenAI | null = null;

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function getClient(): OpenAI {
  if (!client) {
    if (!isLlmConfigured()) throw new Error("OPENROUTER_API_KEY is not set");
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: openRouterHeaders(),
    });
  }
  return client;
}

export type ImageInput = { mimeType: string; base64: string };
/** PDFs go to OpenRouter as a `file` content part (parsed server-side). */
export type FileInput = { filename: string; mimeType: "application/pdf"; base64: string };

export type CompleteOptions = {
  tier: ModelTier;
  system: string;
  user: string;
  images?: ImageInput[];
  files?: FileInput[];
  temperature?: number;
  maxTokens?: number;
};

/** Plain text completion. Returns null if the model is unavailable or errors. */
export async function completeText(opts: CompleteOptions): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  try {
    const model = modelFor(opts.tier);
    const res = await getClient().chat.completions.create({
      model,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
      messages: buildMessages(opts),
      ...openRouterExtras(opts.tier, model),
    });
    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.error("completeText failed", { tier: opts.tier, err: String(err) });
    return null;
  }
}

/**
 * JSON completion validated with zod. The schema is described to the model in the
 * system prompt by the caller; we additionally request JSON mode. Any parse or
 * validation failure returns null.
 */
export async function completeJson<T>(
  opts: CompleteOptions & { schema: ZodType<T, ZodTypeDef, unknown> },
): Promise<T | null> {
  if (!isLlmConfigured()) return null;
  try {
    const model = modelFor(opts.tier);
    const res = await getClient().chat.completions.create({
      model,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 2048,
      response_format: { type: "json_object" },
      ...openRouterExtras(opts.tier, model),
      messages: buildMessages({
        ...opts,
        system: `${opts.system}\n\nRespond with a single JSON object and nothing else.`,
      }),
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = safeParseJson(raw);
    if (parsed === undefined) {
      logger.warn("completeJson: model returned non-JSON", { tier: opts.tier, head: raw.slice(0, 120) });
      return null;
    }
    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      logger.warn("completeJson: schema mismatch", { tier: opts.tier, issues: result.error.issues.slice(0, 3) });
      return null;
    }
    return result.data;
  } catch (err) {
    logger.error("completeJson failed", { tier: opts.tier, err: String(err) });
    return null;
  }
}

/**
 * OpenRouter-only request fields. They are not in the openai SDK types, so they are
 * built as a loosely typed object and spread into the request (the SDK forwards
 * unknown fields as-is).
 */
function openRouterExtras(tier: ModelTier, model: string): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    // some fallback endpoints lack response_format / structured outputs; refuse those
    provider: { require_parameters: true },
  };
  const effort = reasoningEffortFor(tier, model);
  if (effort) extras.reasoning = { effort };
  return extras;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "high" | "low" | "auto" } }
  | { type: "file"; file: { filename: string; file_data: string } };

function buildMessages(opts: CompleteOptions): ChatCompletionMessageParam[] {
  const hasMedia = (opts.images?.length ?? 0) + (opts.files?.length ?? 0) > 0;
  if (!hasMedia) {
    return [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ];
  }
  const parts: ContentPart[] = [{ type: "text", text: opts.user }];
  for (const img of opts.images ?? []) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" } });
  }
  for (const f of opts.files ?? []) {
    parts.push({ type: "file", file: { filename: f.filename, file_data: `data:${f.mimeType};base64,${f.base64}` } });
  }
  // `file` parts are an OpenRouter extension; cast through unknown to satisfy the SDK types.
  const userContent = { role: "user", content: parts } as unknown as ChatCompletionMessageParam;
  return [{ role: "system", content: opts.system }, userContent];
}

function safeParseJson(raw: string): unknown | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export { z };
