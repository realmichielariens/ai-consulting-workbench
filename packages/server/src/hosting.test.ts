// The hosted-deploy layer (docs/DEPLOY-FLY.md): the password gate in front of
// the API and pages, the built web app with its SPA fallback, and stdio
// sources refused when WORKBENCH_HOSTED is on.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import type { ServerContext } from "./engagementContext.js";
import { registerRoutes } from "./routes.js";
import { registerPasswordGate, registerWebApp } from "./hosting.js";

process.env.WORKBENCH_RUNTIME = "fake";

const REPO_ROOT = repoRoot();

describe("hosted server", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-hosting-"));
    const dist = path.join(tmp, "dist");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>app</title>");
    fs.writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1)");
    const server: ServerContext = {
      repoRoot: REPO_ROOT,
      config: loadConfig(REPO_ROOT),
      workspace: workspacePaths(path.join(tmp, "home")),
      runtimeKind: "fake",
      hosted: true,
      engagements: new Map(),
      testSource: async () => ({ status: "connected", error: null, serverInfo: null, tools: [], missingSecrets: [] }),
    };
    app = Fastify({ logger: false });
    await app.register(websocket);
    await app.register(multipart);
    registerPasswordGate(app, "s3cret-demo", true);
    registerRoutes(app, server);
    registerWebApp(app, dist);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function login(): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/login", payload: { password: "s3cret-demo" } });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).not.toContain("s3cret-demo");
    return setCookie.split(";")[0]!;
  }

  it("lets the health check through, and reports hosted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, hosted: true });
  });

  it("refuses the API and shows the login page without the cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/engagements" })).statusCode).toBe(401);
    const page = await app.inject({ method: "GET", url: "/engagements/x/plan" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('type="password"');
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/login", payload: { password: "nope" } });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("after login serves the API, assets and the SPA fallback", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "GET", url: "/api/engagements", headers: { cookie } })).statusCode).toBe(200);
    const asset = await app.inject({ method: "GET", url: "/assets/app-abc123.js", headers: { cookie } });
    expect(asset.headers["content-type"]).toMatch(/javascript/);
    expect(asset.headers["cache-control"]).toMatch(/immutable/);
    const deep = await app.inject({ method: "GET", url: "/engagements/x/plan", headers: { cookie } });
    expect(deep.body).toContain("<title>app</title>");
    expect((await app.inject({ method: "GET", url: "/../../package.json", headers: { cookie } })).body).toContain("<title>app</title>");
    expect((await app.inject({ method: "GET", url: "/api/nope", headers: { cookie } })).statusCode).toBe(404);
  });

  it("refuses stdio sources (create and test) but accepts http", async () => {
    const cookie = await login();
    const stdio = { type: "stdio", command: "node", args: ["x.mjs"] };
    const base = { title: "Mine", summary: "s" };
    const created = await app.inject({ method: "POST", url: "/api/sources", headers: { cookie }, payload: { ...base, connection: stdio } });
    expect(created.statusCode).toBe(400);
    expect(created.body).toContain("stdio sources are disabled");
    const tested = await app.inject({ method: "POST", url: "/api/sources/test", headers: { cookie }, payload: { connection: stdio } });
    expect(tested.statusCode).toBe(400);
    const http = await app.inject({ method: "POST", url: "/api/sources", headers: { cookie }, payload: { ...base, connection: { type: "http", url: "https://example.com/mcp" } } });
    expect(http.statusCode).toBe(201);
  });
});
