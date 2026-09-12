import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { serverOnlyShim } from "../../trigger.config";
import triggerConfig from "../../trigger.config";

/**
 * The Trigger.dev bundle must survive `import "server-only"` (which throws under
 * esbuild's default export condition). Bundle a tiny entry with the same shim the
 * config registers and execute it.
 */
describe("trigger.config.ts", () => {
  it("shims `server-only` so bundled task code does not throw at import", async () => {
    const result = await build({
      stdin: { contents: 'import "server-only"; export const ok = true;', resolveDir: process.cwd(), loader: "ts" },
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      plugins: [serverOnlyShim],
      logLevel: "silent",
    });
    const code = result.outputFiles[0]?.text ?? "";
    expect(code).not.toContain("This module cannot be imported from a Client Component");
    const moduleShim = { exports: {} as { ok?: boolean } };
    new Function("module", "exports", code)(moduleShim, moduleShim.exports);
    expect(moduleShim.exports.ok).toBe(true);
  });

  it("points at src/trigger, pins Node 24 and registers the shim first", () => {
    expect(triggerConfig.dirs).toEqual(["./src/trigger"]);
    expect(triggerConfig.runtime).toBe("node-24");
    expect(triggerConfig.maxDuration).toBe(300);
    expect(triggerConfig.build?.extensions?.[0]?.name).toBe("rossai-server-only-shim");
    expect(triggerConfig.build?.external).toContain("@electric-sql/pglite");
  });
});
