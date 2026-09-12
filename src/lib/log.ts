/**
 * Tiny structured logger. Library code must use this instead of console.*
 * so log lines are greppable in Cloud Run and quiet in tests.
 */
type Level = "debug" | "info" | "warn" | "error";

const quiet = process.env.NODE_ENV === "test";

function emit(level: Level, scope: string, msg: string, data?: Record<string, unknown>) {
  if (quiet && level !== "error") return;
  const line = { level, scope, msg, ...(data ?? {}), ts: new Date().toISOString() };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  scope(scope: string) {
    return {
      debug: (msg: string, data?: Record<string, unknown>) => emit("debug", scope, msg, data),
      info: (msg: string, data?: Record<string, unknown>) => emit("info", scope, msg, data),
      warn: (msg: string, data?: Record<string, unknown>) => emit("warn", scope, msg, data),
      error: (msg: string, data?: Record<string, unknown>) => emit("error", scope, msg, data),
    };
  },
};
