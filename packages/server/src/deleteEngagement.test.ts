// DELETE /api/engagements/:eid through the real routes on the fake runtime:
// the folder leaves the workspace, the context leaves the registry, and a
// delete is refused (409) while an agent run is active.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import type { EngagementId, ItemId, RunHandle, RunId } from "@workbench/core";
import { loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import type { ServerContext } from "./engagementContext.js";
import { registerRoutes } from "./routes.js";

process.env.WORKBENCH_RUNTIME = "fake";
process.env.WORKBENCH_FAKE_DELAY_MS = "0";

const REPO_ROOT = repoRoot();

describe("deleteEngagement", () => {
  let tmpHome: string;
  let server: ServerContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-delete-"));
    server = { repoRoot: REPO_ROOT, config: loadConfig(REPO_ROOT), workspace: workspacePaths(tmpHome), runtimeKind: "fake", engagements: new Map() };
    app = Fastify({ logger: false });
    await app.register(websocket);
    await app.register(multipart);
    registerRoutes(app, server);
  });

  afterEach(async () => {
    for (const ctx of server.engagements.values()) ctx.dbCtx.close();
    await app.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  async function create(name: string): Promise<EngagementId> {
    const res = await app.inject({ method: "POST", url: "/api/engagements", payload: { seedId: "blank", name } });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: EngagementId }).id;
  }

  it("removes the folder, the registry entry and the listing entry", async () => {
    const keep = await create("Keep me");
    const drop = await create("Drop me");
    const dropDir = server.workspace.engagement(drop);
    expect(fs.existsSync(path.join(dropDir, ".git"))).toBe(true);

    const res = await app.inject({ method: "DELETE", url: `/api/engagements/${drop}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(fs.existsSync(dropDir)).toBe(false);
    expect(server.engagements.has(drop)).toBe(false);
    expect(fs.readdirSync(server.workspace.trashDir)).toEqual([]);
    const list = (await app.inject({ method: "GET", url: "/api/engagements" })).json() as { id: string }[];
    expect(list.map((e) => e.id)).toEqual([keep]);
    expect((await app.inject({ method: "GET", url: `/api/engagements/${drop}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/engagements/${drop}` })).statusCode).toBe(404);
  });

  it("refuses while an agent run is active and deletes once it is gone", async () => {
    const eid = await create("Busy");
    const ctx = server.engagements.get(eid)!;
    ctx.activeRuns.set("WI-001" as ItemId, { runId: "R-0001" as RunId, handle: {} as RunHandle });

    const refused = await app.inject({ method: "DELETE", url: `/api/engagements/${eid}` });
    expect(refused.statusCode).toBe(409);
    expect(fs.existsSync(server.workspace.engagement(eid))).toBe(true);
    expect(server.engagements.get(eid)).toBe(ctx);

    ctx.activeRuns.clear();
    expect((await app.inject({ method: "DELETE", url: `/api/engagements/${eid}` })).statusCode).toBe(200);
    expect(fs.existsSync(server.workspace.engagement(eid))).toBe(false);
  });

  it("rejects an id that is not a valid engagement id", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/engagements/..%2F..%2Fetc` });
    expect(res.statusCode).toBe(400);
  });
});
