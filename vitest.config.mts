import { defineConfig } from "vitest/config";
import path from "node:path";

// `import.meta.dirname` rather than `__dirname`: Vite's native config loader (soon the
// default) does not provide the CommonJS globals.
const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(root, "src"), "server-only": path.resolve(root, "src/test/server-only-stub.ts") },
  },
});
