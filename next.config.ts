import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run image copies .next/standalone — see Dockerfile
  output: "standalone",
  // Native / Node-only packages must not be bundled by Turbopack
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdf-parse", "@google-cloud/storage"],
  // Migrations run at boot from ./drizzle; make sure the folder ships in .next/standalone
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
  typedRoutes: false,
};

export default nextConfig;
