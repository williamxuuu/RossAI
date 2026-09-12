import { describe, expect, it, vi, beforeEach } from "vitest";
import type { JobName, JobPayloads } from "@/lib/jobs";

/**
 * Trigger.dev task ids must equal the JobName strings enqueue() passes to
 * tasks.trigger(); otherwise production jobs would silently vanish.
 * Checked twice: at the type level (compile error if the sets drift) and at
 * runtime (importing the real task modules with the SDK mocked).
 */

// ---- type level -----------------------------------------------------------

const TASK_IDS = ["process-inbound-attachment", "process-inbound-message", "scan-case", "nudge-pending"] as const satisfies readonly JobName[];

type Covered = (typeof TASK_IDS)[number];
type Missing = Exclude<JobName, Covered>;
// Fails to compile when a JobName has no Trigger.dev task.
const everyJobHasATask: [Missing] extends [never] ? true : false = true;

// ---- runtime --------------------------------------------------------------

type Registered = { id: string; cron?: string; retry?: { maxAttempts?: number }; run: (payload: unknown) => Promise<unknown> };

const registered: Registered[] = [];

vi.mock("@trigger.dev/sdk", () => {
  const register = (opts: Registered) => {
    registered.push(opts);
    return opts;
  };
  return { task: register, schedules: { task: register } };
});

const runJob = vi.fn(async () => undefined);
vi.mock("@/lib/jobs/handlers", () => ({ runJob }));

describe("src/trigger task definitions", () => {
  beforeEach(() => {
    runJob.mockClear();
  });

  it("registers exactly one task per JobName, with matching ids", async () => {
    await import("./tasks");
    await import("./schedules");
    const ids = registered.map((r) => r.id).sort();
    expect(ids).toEqual([...TASK_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(everyJobHasATask).toBe(true);
  });

  it("plain tasks retry up to 3 attempts and delegate to runJob with the same payload", async () => {
    const cases: { id: JobName; payload: JobPayloads[JobName] }[] = [
      { id: "process-inbound-attachment", payload: { documentId: "doc_1" } },
      { id: "process-inbound-message", payload: { messageId: "msg_1" } },
      { id: "scan-case", payload: { caseId: "case_1" } },
    ];
    for (const c of cases) {
      const t = registered.find((r) => r.id === c.id);
      expect(t, c.id).toBeDefined();
      expect(t?.retry?.maxAttempts).toBe(3);
      await t?.run(c.payload);
      expect(runJob).toHaveBeenLastCalledWith(c.id, c.payload);
    }
  });

  it("nudge-pending is a daily 15:00 UTC schedule that sweeps every case on cron runs", async () => {
    const t = registered.find((r) => r.id === "nudge-pending");
    expect(t?.cron).toBe("0 15 * * *");
    await t?.run({ timestamp: new Date(), lastTimestamp: undefined, timezone: "UTC", scheduleId: "sched_1", upcoming: [] });
    expect(runJob).toHaveBeenLastCalledWith("nudge-pending", {});
  });

  it("nudge-pending honours a manual per-case trigger from the console", async () => {
    const t = registered.find((r) => r.id === "nudge-pending");
    await t?.run({ caseId: "case_9" });
    expect(runJob).toHaveBeenLastCalledWith("nudge-pending", { caseId: "case_9" });
  });
});
