# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Every page is prerendered here. Without a database secret the build reads
# data/wikipedia/museum.json; to prerender from Neon instead:
#   docker build --secret id=db,env=DATABASE_URL .
# (the secret is never written to an image layer)
RUN --mount=type=secret,id=db \
    if [ -s /run/secrets/db ]; then export DATABASE_URL="$(cat /run/secrets/db)"; fi; \
    npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone output already contains data/wikipedia/museum.json (traced from
# src/lib/data.ts), the JSON fallback used when DATABASE_URL is absent.
# Owned by `node` so ISR can write regenerated pages under .next/.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
