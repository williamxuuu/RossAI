# RossAI on Cloud Run (docs/DEPLOY.md).
#
# next.config.ts sets `output: "standalone"`, so the runtime image carries only the
# server and the traced dependencies. `drizzle/` ships alongside it because
# src/db/client.ts runs migrations from `<cwd>/drizzle` on first use.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm 11 runs out of memory on this dependency tree with the default heap.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
# Cloud Run's filesystem is ephemeral, so the app refuses to start on PGlite or local
# document storage there (src/db/client.ts, src/lib/storage/index.ts). Give it
# DATABASE_URL and GCS_BUCKET.
ENV REQUIRE_DATABASE_URL=true

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
