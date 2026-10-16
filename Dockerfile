# Hosted showcase image for Fly.io (docs/DEPLOY-FLY.md). Not a release build:
# the server runs from TypeScript through tsx, exactly like `pnpm dev`.
FROM node:26-bookworm-slim

# git: every engagement is a git repo (packages/store/src/git.ts).
# python3/make/g++: fallback for better-sqlite3 if no prebuilt addon matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Node 25+ no longer ships corepack, so pnpm comes from npm, pinned to package.json's packageManager.
RUN npm install -g pnpm@11.5.1

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workbench/web run build

ENV WORKBENCH_HOST=0.0.0.0 \
    PORT=8080 \
    WORKBENCH_HOSTED=1 \
    WORKBENCH_HOME=/data/workspace \
    WORKBENCH_WEB_DIST=/app/apps/web/dist \
    WORKBENCH_AUTH=api-key

EXPOSE 8080
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/main.ts"]
