// User-defined MCP sources (docs/USER-MCP-SOURCES-PLAN.md): the user folder in
// the catalog, ${env:NAME} resolution and the Windows wrap in the resolver,
// the connection test with an injected probe (no CLI), and the echo fixture
// spoken to directly over stdio (no CLI either).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { redact, resolveSecretRefs } from "@workbench/core/node";
import { loadSourceCatalog, renderSourceCatalog, writeSourceListing } from "./sourceCatalog.js";
import { resolveSources, wrapStdioCommand } from "./sourceResolver.js";
import { testSourceConnection, type ProbeFn } from "./sourceTest.js";
import type { ProbeMcpServerArgs } from "./sdk.js";

const catalogDir = path.resolve(import.meta.dirname, "../../../workbench-sources");
const FIXTURE = path.resolve(import.meta.dirname, "dev/fixtures/echo-mcp-server.mjs");

function userListing(id: string, connection: unknown, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Mine ${id}`,
    publisher: "You",
    kind: "mcp",
    summary: "A user source.",
    freshness: "live",
    offer: { tier: "free", label: "Your own source" },
    connection,
    ...extra,
  };
}

let userDir: string;
beforeEach(() => {
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-sources-"));
});
afterEach(() => {
  fs.rmSync(userDir, { recursive: true, force: true });
});

function write(name: string, listing: unknown): void {
  fs.writeFileSync(path.join(userDir, name), stringifyYaml(listing), "utf8");
}

describe("loadSourceCatalog with a user folder", () => {
  test("tags origin; rejects a reused id, a duplicate user id and the curated connection types", () => {
    write("a-mine.yaml", userListing("echo", { type: "stdio", command: "node", args: ["x.mjs"] }));
    write("b-dup.yaml", userListing("echo", { type: "stdio", command: "node" }));
    write("c-shadow.yaml", userListing("open-web", { type: "http", url: "https://example.com/mcp" }));
    write("d-mock.yaml", userListing("my-mock", { type: "mock", dataset: "mfg-it-benchmarks.yaml" }));
    write("e-web.yaml", userListing("my-web", { type: "builtin-web" }));

    const catalog = loadSourceCatalog({ catalogDir, userDir });
    expect(catalog.sources.filter((s) => s.origin === "user").map((s) => s.id)).toEqual(["echo"]);
    expect(catalog.sources.find((s) => s.id === "open-web")!.origin).toBe("catalog");
    expect(catalog.invalid).toEqual([
      expect.stringMatching(/^sources\/b-dup\.yaml: id "echo" is already used/),
      expect.stringMatching(/^sources\/c-shadow\.yaml: id "open-web" is already used/),
      expect.stringMatching(/^sources\/d-mock\.yaml: connection type "mock" is reserved/),
      expect.stringMatching(/^sources\/e-web\.yaml: connection type "builtin-web" is reserved/),
    ]);
  });

  test("a missing user folder is simply empty", () => {
    const catalog = loadSourceCatalog({ catalogDir, userDir: path.join(userDir, "nope") });
    expect(catalog.invalid).toEqual([]);
    expect(catalog.sources.every((s) => s.origin === "catalog")).toBe(true);
  });

  test("writeSourceListing round-trips, and the Approach catalog marks user listings", () => {
    writeSourceListing(path.join(userDir, "echo.yaml"), userListing("echo", { type: "stdio", command: "node", args: [] }) as never);
    const catalog = loadSourceCatalog({ catalogDir, userDir });
    const md = renderSourceCatalog(catalog.sources);
    expect(md).toContain("`echo` **Mine echo** (added by you) (You; live");
    expect(md).toContain("`open-web` **Open Web** (");
  });
});

describe("resolveSecretRefs (env.ts)", () => {
  test("resolves every reference inside a value, or names the missing ones", () => {
    const lookup = (n: string) => ({ TOKEN_A: "abcd-secret-1" })[n];
    expect(resolveSecretRefs("C:/x", { Authorization: "Bearer ${env:TOKEN_A}", Plain: "x" }, lookup)).toEqual({
      ok: true,
      value: { Authorization: "Bearer abcd-secret-1", Plain: "x" },
    });
    expect(resolveSecretRefs("C:/x", { A: "${env:NOPE_1}", B: "${env:TOKEN_A}/${env:NOPE_2}" }, lookup)).toEqual({ ok: false, missing: ["NOPE_1", "NOPE_2"] });
  });

  test("a resolved reference is registered with redact()", () => {
    const name = "WORKBENCH_TEST_SOURCE_SECRET";
    process.env[name] = "user-source-secret-value-42";
    try {
      expect(resolveSecretRefs(process.cwd(), { K: `\${env:${name}}` })).toMatchObject({ ok: true });
      expect(redact("header was user-source-secret-value-42")).toBe("header was [REDACTED]");
    } finally {
      delete process.env[name];
    }
  });
});

describe("resolveSources with user listings", () => {
  test("resolves env refs and wraps a bare Windows command; an unresolvable one is unavailable, not fatal", () => {
    write("ok.yaml", userListing("echo", { type: "stdio", command: "node", args: ["s.mjs"], env: { API_KEY: "${env:GOOD}" } }));
    write("bad.yaml", userListing("remote", { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${env:MISSING}" } }));
    const catalog = loadSourceCatalog({ catalogDir, userDir });
    const r = resolveSources(
      catalog,
      [
        { id: "echo", purpose: "p" },
        { id: "remote", purpose: "p" },
      ],
      { resolveRef: (n) => (n === "GOOD" ? "good-value" : undefined), platform: "win32" },
    );
    expect(r.mcpServers).toEqual({ source_echo: { type: "stdio", command: "cmd", args: ["/c", "node", "s.mjs"], env: { API_KEY: "good-value" } } });
    expect(r.allowedTools).toEqual(["mcp__source_echo__*"]);
    expect(r.unavailable).toEqual([{ id: "remote", reason: "missing ${env:MISSING}" }]);
    expect(r.attached.map((a) => a.source.id)).toEqual(["echo"]);
    expect(r.toolMap.servers).toEqual({ source_echo: { id: "echo", title: "Mine echo" } });
  });

  test("allowStdio false (hosted server): stdio listings are unavailable, http ones still resolve", () => {
    write("ok.yaml", userListing("echo", { type: "stdio", command: "node", args: ["s.mjs"] }));
    write("web.yaml", userListing("remote", { type: "http", url: "https://example.com/mcp" }));
    const r = resolveSources(
      loadSourceCatalog({ catalogDir, userDir }),
      [
        { id: "echo", purpose: "p" },
        { id: "remote", purpose: "p" },
      ],
      { allowStdio: false },
    );
    expect(r.unavailable).toEqual([{ id: "echo", reason: "stdio sources are disabled on this server" }]);
    expect(Object.keys(r.mcpServers)).toEqual(["source_remote"]);
  });

  test("wrapStdioCommand: only an absolute .exe/.com runs directly on Windows; other platforms never wrap", () => {
    expect(wrapStdioCommand("npx", ["-y", "pkg"], "win32")).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "pkg"] });
    expect(wrapStdioCommand("C:\\Program Files\\nodejs\\node.exe", ["a"], "win32")).toEqual({ command: "C:\\Program Files\\nodejs\\node.exe", args: ["a"] });
    expect(wrapStdioCommand("node.exe", [], "win32")).toEqual({ command: "cmd", args: ["/c", "node.exe"] });
    expect(wrapStdioCommand("npx", ["pkg"], "linux")).toEqual({ command: "npx", args: ["pkg"] });
  });
});

describe("testSourceConnection (injected probe)", () => {
  const base = { cwd: "C:/ws", buildEnv: () => ({ CLAUDE_CONFIG_DIR: "C:/ws/cfg" }) };

  test("curated types answer without a probe", async () => {
    const probe: ProbeFn = async () => {
      throw new Error("must not probe");
    };
    expect((await testSourceConnection({ type: "builtin-web" }, { ...base, probe })).tools.map((t) => t.name)).toEqual(["WebSearch", "WebFetch"]);
    expect((await testSourceConnection({ type: "mock", dataset: "x.yaml" }, { ...base, probe })).tools.map((t) => t.name)).toEqual(["search", "get"]);
  });

  test("a missing secret fails before anything starts", async () => {
    let probed = false;
    const result = await testSourceConnection(
      { type: "http", url: "https://example.com/mcp", headers: { Authorization: "${env:NOPE_X}" } },
      { ...base, resolveRef: () => undefined, probe: async () => ((probed = true), { status: "connected", error: null, serverInfo: null, tools: [] }) },
    );
    expect(probed).toBe(false);
    expect(result).toMatchObject({ status: "failed", missingSecrets: ["NOPE_X"] });
  });

  test("passes the wrapped, resolved server to the probe and maps its result", async () => {
    let seen: ProbeMcpServerArgs | undefined;
    const result = await testSourceConnection(
      { type: "stdio", command: "node", args: ["s.mjs"], env: { TOKEN: "${env:T}" } },
      {
        ...base,
        platform: "win32",
        resolveRef: () => "tok-value",
        timeoutMs: 1234,
        probe: async (args) => {
          seen = args;
          return { status: "disabled", error: "off", serverInfo: null, tools: [] };
        },
      },
    );
    expect(seen).toMatchObject({ config: { type: "stdio", command: "cmd", args: ["/c", "node", "s.mjs"], env: { TOKEN: "tok-value" } }, cwd: "C:/ws", timeoutMs: 1234 });
    expect(seen!.env).toEqual({ CLAUDE_CONFIG_DIR: "C:/ws/cfg" });
    expect(result).toEqual({ status: "failed", error: "off", serverInfo: null, tools: [], missingSecrets: [] });
  });
});

describe("echo-mcp-server.mjs fixture (direct stdio, no CLI)", () => {
  test("initialize, tools/list, tools/call echo and lookup; exits when stdin closes", async () => {
    const child = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
    const replies = new Map<number, unknown>();
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buffer.slice(0, nl)) as { id: number };
        buffer = buffer.slice(nl + 1);
        replies.set(msg.id, msg);
      }
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "lookup", arguments: { id: "acme-erp" } } });
    send({ jsonrpc: "2.0", id: 5, method: "nope" });
    const deadline = Date.now() + 5000;
    while (replies.size < 5 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    child.stdin.end();

    expect(replies.get(1)).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "echo-mcp-server" }, capabilities: { tools: {} } } });
    expect((replies.get(2) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toEqual(["echo", "lookup"]);
    expect(replies.get(3)).toMatchObject({ result: { content: [{ type: "text", text: "hi" }], isError: false } });
    expect(JSON.stringify(replies.get(4))).toContain("Acme ERP landscape");
    expect(replies.get(5)).toMatchObject({ error: { code: -32601 } });
    expect(await exited).toBe(0);
  });
});
