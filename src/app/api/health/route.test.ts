import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Health route: correct shape for every backend combination, 503 when the DB is
 * down, and — most importantly — no environment value ever leaks into the body.
 */

const execute = vi.fn(async () => [{ "?column?": 1 }]);
const getDb = vi.fn(async () => ({ execute }));
vi.mock("@/db/client", () => ({ getDb }));

const getChannelProvider = vi.fn(async () => ({ name: "mock" }));
vi.mock("@/lib/channel", () => ({ getChannelProvider }));

const ENV_KEYS = [
  "DATABASE_URL",
  "OPENROUTER_API_KEY",
  "EXA_API_KEY",
  "TRIGGER_SECRET_KEY",
  "AUTH_DISABLED",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "STORAGE_PROVIDER",
  "CHANNEL_PROVIDER",
  "K_SERVICE",
  "NODE_ENV",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
}

async function callHealth() {
  vi.resetModules();
  const { GET } = await import("./route");
  const res = await GET();
  return { status: res.status, body: await res.json(), text: JSON.stringify(await res.clone().json()) };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    execute.mockClear();
    getDb.mockClear();
    getChannelProvider.mockResolvedValue({ name: "mock" });
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports the zero-config local shape", async () => {
    setEnv({ NODE_ENV: "test", AUTH_DISABLED: "true" });
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      db: "pglite",
      llm: false,
      exa: false,
      channel: "mock",
      jobs: "inline",
      auth: "disabled",
      storage: "local",
      warnings: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reports the fully configured production shape without leaking any value", async () => {
    const secrets = {
      DATABASE_URL: "postgres://user:hunter2@ep-neon.example/db",
      OPENROUTER_API_KEY: "sk-or-v1-supersecret",
      EXA_API_KEY: "exa-supersecret",
      TRIGGER_SECRET_KEY: "tr_prod_sk_supersecret",
      AUTH0_DOMAIN: "clinic.us.auth0.com",
      AUTH0_CLIENT_ID: "client-id-value",
      AUTH0_CLIENT_SECRET: "client-secret-value",
    };
    setEnv({ ...secrets, NODE_ENV: "production", STORAGE_PROVIDER: "gcs", K_SERVICE: "rossai" });
    getChannelProvider.mockResolvedValue({ name: "ambiguous" });
    const { status, body, text } = await callHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, db: "pg", llm: true, exa: true, channel: "ambiguous", jobs: "trigger", auth: "auth0", storage: "gcs", warnings: [] });
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);
    expect(text).not.toContain("hunter2");
  });

  it("warns loudly when production runs without DATABASE_URL, storage or Trigger.dev", async () => {
    setEnv({ NODE_ENV: "production", AUTH_DISABLED: "true", K_SERVICE: "rossai" });
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body.db).toBe("pglite");
    expect(body.warnings).toEqual(["pglite in production", "local document storage on Cloud Run", "jobs run inline in production"]);
  });

  it("returns 503 with ok:false when the database is unreachable", async () => {
    setEnv({ NODE_ENV: "test", AUTH_DISABLED: "true", DATABASE_URL: "postgres://user:hunter2@down.example/db" });
    getDb.mockRejectedValueOnce(new Error("connect ECONNREFUSED hunter2"));
    const { status, body, text } = await callHealth();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.db).toBe("pg");
    expect(body.error).toBe("db unreachable");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("falls back to the configured provider name when the channel adapter cannot initialise", async () => {
    setEnv({ NODE_ENV: "test", AUTH_DISABLED: "true", CHANNEL_PROVIDER: "ambiguous" });
    getChannelProvider.mockRejectedValueOnce(new Error("AMBIGUOUS_AGENT_KEY missing"));
    const { body } = await callHealth();
    expect(body.channel).toBe("ambiguous");
  });
});
