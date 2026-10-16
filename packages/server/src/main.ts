// Workbench server (I1-PLAN.md §6 W5): Fastify + WebSocket implementing
// packages/core/src/api.ts exactly. Routes are thin; the services and views
// modules hold everything else. WORKBENCH_RUNTIME=fake switches the agent
// runtime to the scripted fake agent (packages/agents); otherwise every
// engagement runs on the real Claude Agent SDK runtime.

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { createServerContext, openEngagement, type RuntimeKind } from "./engagementContext.js";
import { reconcileEngagement } from "./startup.js";
import { listEngagementIds } from "./services.js";
import { registerRoutes } from "./routes.js";
import { describeAuth } from "@workbench/core/node";
import { registerPasswordGate, registerWebApp } from "./hosting.js";

const runtimeKind: RuntimeKind = process.env.WORKBENCH_RUNTIME === "fake" ? "fake" : "real";
const server = createServerContext(runtimeKind);

// Eagerly open + reconcile every engagement that already exists on disk
// (R1/R2): a lazily-opened *context* per engagement, but reconciliation must
// run before any request can see stale leases or orphaned children.
for (const id of listEngagementIds(server)) {
  reconcileEngagement(openEngagement(server, id));
}

// Hosted deploys (docs/DEPLOY-FLY.md) set these; locally none is set and the server stays on 127.0.0.1.
const host = process.env.WORKBENCH_HOST || "127.0.0.1";
const port = process.env.PORT ? Number(process.env.PORT) : server.config.server.port;
const password = process.env.WORKBENCH_PASSWORD;
const webDist = process.env.WORKBENCH_WEB_DIST;
if (host !== "127.0.0.1" && host !== "localhost" && !password) {
  throw new Error(`refusing to listen on ${host} without WORKBENCH_PASSWORD: the workbench has no other access control`);
}

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(multipart);
if (password) registerPasswordGate(app, password, server.hosted ?? false);
registerRoutes(app, server);
if (webDist) registerWebApp(app, webDist);

const address = await app.listen({ port, host });
app.log.info(`workbench server (runtime=${runtimeKind}${server.hosted ? ", hosted" : ""}) listening on ${address}`);
app.log.info(`workspace home: ${server.workspace.home}`);
if (password) app.log.info("password gate: on");
if (webDist) app.log.info(`serving web app from ${webDist}`);
if (runtimeKind === "real") app.log.info(`agent auth: ${describeAuth(server.repoRoot)}`);

async function shutdown(): Promise<void> {
  app.log.info("shutting down: interrupting active runs");
  for (const ctx of server.engagements.values()) {
    for (const [, active] of ctx.activeRuns) {
      try {
        await active.handle.interrupt();
      } catch {
        /* best effort */
      }
    }
  }
  for (const ctx of server.engagements.values()) ctx.dbCtx.close();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
