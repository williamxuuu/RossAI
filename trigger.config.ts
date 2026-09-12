import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

/**
 * Trigger.dev v4 project config (spec §1 Jobs; docs/ARCHITECTURE.md §6).
 *
 * Tasks live in src/trigger/*.ts and are thin wrappers over runJob() in
 * src/lib/jobs/handlers.ts, so the Trigger.dev path and the in-process fallback
 * (enqueue() without TRIGGER_SECRET_KEY) execute identical code.
 *
 * Deployed tasks run on Trigger.dev infrastructure, NOT on Cloud Run: they need
 * their own DATABASE_URL, OPENROUTER_API_KEY, EXA_API_KEY, storage and channel
 * env vars (dashboard → Environment Variables). See docs/DEPLOY.md.
 */

type EsbuildPlugin = Parameters<typeof esbuildPlugin>[0];

/**
 * `server-only` shim for the Trigger.dev esbuild bundle.
 *
 * Every module under src/lib/** and src/db/** starts with `import "server-only"`.
 * That package's default export (index.js) throws at import time; only the
 * `react-server` export condition resolves it to an empty module. Trigger.dev
 * bundles with esbuild under the conditions ["trigger.dev", "module", "node"],
 * so without help every task would crash on boot.
 *
 * This plugin resolves the bare specifier to an empty virtual module. It is
 * registered through `esbuildPlugin()` from @trigger.dev/build (verified against
 * node_modules/@trigger.dev/core/dist/commonjs/v3/build/extensions.d.ts:
 * `esbuildPlugin(plugin: Plugin, options?: { target?, placement? }): BuildExtension`).
 *
 * Alternative (also supported by TriggerConfig.build.conditions): add the
 * "react-server" resolve condition, which is what `npm run db:seed` does with
 * `tsx --conditions=react-server`. The plugin is preferred because it touches
 * only `server-only`, whereas the condition also re-points react/react-dom/next
 * to their RSC builds inside the task bundle.
 */
export const serverOnlyShim: EsbuildPlugin = {
  name: "rossai-server-only-shim",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, (args) => ({ path: args.path, namespace: "rossai-server-only" }));
    build.onLoad({ filter: /.*/, namespace: "rossai-server-only" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

export default defineConfig({
  // Project ref from the Trigger.dev dashboard (Project settings). The placeholder
  // keeps `tsc`/CI happy; `trigger dev`/`deploy` need the real value.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_placeholder",
  dirs: ["./src/trigger"],
  // package.json engines is node >=22.12 and @google-cloud/storage 8.x needs Node 22+;
  // the bare "node" runtime is 21.x, so pin the deployed runtime to our local major.
  runtime: "node-24",
  // Seconds of compute per run. Attachment verification and scans are single LLM calls.
  maxDuration: 300,
  logLevel: "info",
  retries: {
    enabledInDev: false,
    // Used by any task without its own `retry`; src/trigger/tasks.ts sets maxAttempts: 3 explicitly.
    default: { maxAttempts: 3, minTimeoutInMs: 1_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  },
  build: {
    // Mirrors next.config.ts serverExternalPackages: native / WASM / dynamic-require
    // packages must not be bundled; Trigger installs them from package.json instead.
    external: ["@electric-sql/pglite", "pg", "pdf-parse", "@google-cloud/storage"],
    extensions: [
      esbuildPlugin(serverOnlyShim, { placement: "first" }),
      // getDb() runs Drizzle migrations from `<cwd>/drizzle` on first use; ship the
      // SQL files next to the bundle so a fresh task container can migrate too.
      additionalFiles({ files: ["drizzle/**"] }),
    ],
  },
});
