// Placeholder server (P0b — SCAFFOLD). W5 replaces this with Fastify + the
// event bus, services, scheduler and reconciliation (ARCHITECTURE.md §12).
// This placeholder only proves the workspace boots end to end: GET
// /api/health and a WebSocket that sends `hello` on connect, exactly as
// packages/core/src/api.ts defines them, so apps/web has something real to
// talk to during SCAFFOLD's boot check and W6's early development.

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { loadConfig, repoRoot } from "@workbench/core/node";
import { routes, WS_PATH, type WsServerMessage } from "@workbench/core";

const root = repoRoot(import.meta.dirname);
const config = loadConfig(root);

const runtime: "real" | "fake" = process.env.WORKBENCH_RUNTIME === "fake" ? "fake" : "real";

const app = Fastify({ logger: true });
await app.register(websocket);

app.get(routes.health.path, async () => {
  return routes.health.response.parse({ ok: true, runtime });
});

// WS_PATH = "/api/engagements/:eid/ws" — Fastify's ":param" syntax matches
// the contract's path directly.
app.get(WS_PATH, { websocket: true }, (socket, request) => {
  const { eid } = request.params as { eid: string };
  const hello: WsServerMessage = { type: "hello", engagementId: eid, lastSeq: 0 };
  socket.send(JSON.stringify(hello));
});

const address = await app.listen({ port: config.server.port, host: "127.0.0.1" });
app.log.info(`workbench server (placeholder, runtime=${runtime}) listening on ${address}`);

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
