// User-defined MCP sources over the HTTP API (docs/USER-MCP-SOURCES-PLAN.md):
// create (id slugged from the title) -> listed with origin "user" -> a
// literal secret is rejected per field -> collision and curated listings are
// refused -> update -> test connection (injected tester, no CLI) -> delete.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import type { SourceCatalogEntry, SourceConnection, SourceTestResult, UserSourceView } from "@workbench/core";
import { loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import type { TestSourceConnectionOptions } from "@workbench/agents";
import type { ServerContext } from "./engagementContext.js";
import { registerRoutes } from "./routes.js";

process.env.WORKBENCH_RUNTIME = "fake";
process.env.WORKBENCH_FAKE_DELAY_MS = "0";

const REPO_ROOT = repoRoot();
const FIXTURE = path.join(REPO_ROOT, "packages", "agents", "src", "dev", "fixtures", "echo-mcp-server.mjs");

const input = {
  title: "Echo Fixture",
  summary: "A local echo server for trying sources.",
  usage: "Call lookup with id acme-erp.",
  connection: { type: "stdio", command: "node", args: [FIXTURE], env: { API_KEY: "${env:ECHO_API_KEY}", MODE: "demo" } },
};

describe("User sources over the API", () => {
  let app: FastifyInstance;
  let server: ServerContext;
  let tmpHome: string;
  const tested: Array<{ connection: SourceConnection; opts: TestSourceConnectionOptions }> = [];

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-user-sources-"));
    tested.length = 0;
    server = {
      repoRoot: REPO_ROOT,
      config: loadConfig(REPO_ROOT),
      workspace: workspacePaths(tmpHome),
      runtimeKind: "fake",
      engagements: new Map(),
      testSource: async (connection, opts): Promise<SourceTestResult> => {
        tested.push({ connection, opts });
        return { status: "connected", error: null, serverInfo: { name: "echo-mcp-server", version: "1.0.0" }, tools: [{ name: "echo" }, { name: "lookup" }], missingSecrets: [] };
      },
    };
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

  it("creates, lists, rejects secrets and collisions, updates, tests and deletes", async () => {
    // create: id from the title, Decision 7 defaults, file in <home>/sources
    const created = await app.inject({ method: "POST", url: "/api/sources", payload: input });
    expect(created.statusCode).toBe(201);
    const view = created.json() as UserSourceView;
    expect(view).toMatchObject({ id: "echo-fixture", origin: "user", kind: "mcp", publisher: "You", offer: { tier: "free", label: "Your own source" }, freshness: "live" });
    const file = path.join(server.workspace.userSourcesDir, "echo-fixture.yaml");
    expect(fs.readFileSync(file, "utf8")).toContain("${env:ECHO_API_KEY}");

    // listed next to the curated catalog, with origin
    const eid = ((await app.inject({ method: "POST", url: "/api/engagements", payload: { seedId: "blank", name: "User sources" } })).json() as { id: string }).id;
    const list = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/sources` })).json() as SourceCatalogEntry[];
    expect(list.find((s) => s.id === "echo-fixture")).toMatchObject({ origin: "user", connectionType: "stdio", usedBy: [] });
    expect(list.find((s) => s.id === "open-web")).toMatchObject({ origin: "catalog" });
    expect(JSON.stringify(list)).not.toContain(FIXTURE.replace(/\\/g, "\\\\"));

    // a literal secret is refused per field, in the format the web form parses
    const secret = await app.inject({
      method: "POST",
      url: "/api/sources",
      payload: { ...input, title: "Leaky", connection: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer abc", "X-Api-Key": "k" } } },
    });
    expect(secret.statusCode).toBe(400);
    expect((secret.json() as { error: { message: string } }).error.message).toBe(
      "headers.Authorization looks like a secret; use ${env:NAME} instead; headers.X-Api-Key looks like a secret; use ${env:NAME} instead",
    );
    expect(fs.existsSync(path.join(server.workspace.userSourcesDir, "leaky.yaml"))).toBe(false);

    // collisions: same title again, or a curated id
    expect((await app.inject({ method: "POST", url: "/api/sources", payload: input })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/sources", payload: { ...input, id: "open-web" } })).statusCode).toBe(409);

    // curated listings are read-only; unknown ids are 404
    expect((await app.inject({ method: "PATCH", url: "/api/sources/open-web", payload: input })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: "/api/sources/open-web" })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/sources/nope" })).statusCode).toBe(404);

    // get returns the full listing, connection included
    const got = (await app.inject({ method: "GET", url: "/api/sources/echo-fixture" })).json() as UserSourceView;
    expect(got.connection).toEqual(input.connection);

    // update: the id stays, even if the body names another
    const updated = await app.inject({ method: "PATCH", url: "/api/sources/echo-fixture", payload: { ...input, id: "renamed", title: "Echo (edited)", freshness: "snapshot", edition: "1" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: "echo-fixture", title: "Echo (edited)", freshness: "snapshot", edition: "1" });
    expect(fs.readFileSync(file, "utf8")).toContain("Echo (edited)");
    const leakyUpdate = await app.inject({ method: "PATCH", url: "/api/sources/echo-fixture", payload: { ...input, connection: { ...input.connection, env: { DB_PASSWORD: "hunter2" } } } });
    expect((leakyUpdate.json() as { error: { message: string } }).error.message).toBe("env.DB_PASSWORD looks like a secret; use ${env:NAME} instead");

    // test connection: passes the connection through, starts in the workspace home
    const test = await app.inject({ method: "POST", url: "/api/sources/test", payload: { connection: input.connection } });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ status: "connected", tools: [{ name: "echo" }, { name: "lookup" }] });
    expect(tested).toHaveLength(1);
    expect(tested[0]!.connection).toEqual(input.connection);
    expect(tested[0]!.opts.cwd).toBe(server.workspace.home);
    expect((await app.inject({ method: "POST", url: "/api/sources/test", payload: { connection: { type: "mock", dataset: "x" } } })).statusCode).toBe(400);

    // delete
    expect((await app.inject({ method: "DELETE", url: "/api/sources/echo-fixture" })).json()).toEqual({ ok: true });
    expect(fs.existsSync(file)).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/sources/echo-fixture" })).statusCode).toBe(404);
  });
});
