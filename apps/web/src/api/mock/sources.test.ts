// The mock backend's user listings behave like the real server will: origin
// tags, literal secrets refused with the same wording, curated ids protected,
// and a test connection that fails on demand.

import { afterEach, describe, expect, test } from "vitest";
import { SourceCatalogEntry, UserSourceView } from "@workbench/core";
import { mockBackend, __resetMockBackend } from "./backend.js";

afterEach(() => __resetMockBackend());

const input = {
  title: "Echo Fixture",
  summary: "Echo and lookup.",
  description: "",
  usage: "",
  freshness: "live" as const,
  connection: { type: "stdio" as const, command: "node", args: ["echo-mcp-server.mjs"], env: { ECHO_TOKEN: "${env:ECHO_TOKEN}" } },
};

describe("mock backend: user sources", () => {
  test("create, list with origin, update, delete", async () => {
    const { id: eid } = await mockBackend.createEngagement({ seedId: "acme-discovery", name: "Sources" });
    const created = await mockBackend.createSource(input);
    expect(() => UserSourceView.parse(created)).not.toThrow();
    expect(created.id).toBe("echo-fixture");

    const list = await mockBackend.listSources(eid);
    for (const e of list) expect(() => SourceCatalogEntry.parse(e)).not.toThrow();
    expect(list.find((s) => s.id === "open-web")?.origin).toBe("catalog");
    expect(list.find((s) => s.id === "echo-fixture")).toMatchObject({ origin: "user", connectionType: "stdio", publisher: "You" });

    const updated = await mockBackend.updateSource("echo-fixture", { ...input, title: "Echo v2" });
    expect(updated.title).toBe("Echo v2");
    await expect(mockBackend.updateSource("open-web", input)).rejects.toMatchObject({ code: "invalid" });

    await mockBackend.deleteSource("echo-fixture");
    await expect(mockBackend.getSource("echo-fixture")).rejects.toMatchObject({ code: "not_found" });
  });

  test("a literal secret is refused with the server's wording", async () => {
    const leaky = { ...input, connection: { ...input.connection, env: { API_KEY: "sk-123" } } };
    await expect(mockBackend.createSource(leaky)).rejects.toMatchObject({
      code: "invalid",
      message: "env.API_KEY looks like a secret; use ${env:NAME} instead",
    });
  });

  test("test connection: two tools, or a failure when asked for", async () => {
    const ok = await mockBackend.testSource({ connection: input.connection });
    expect(ok.status).toBe("connected");
    expect(ok.tools.map((t) => t.name)).toEqual(["echo", "lookup"]);
    const bad = await mockBackend.testSource({ connection: { type: "http", url: "https://fail.example.com/mcp" } });
    expect(bad).toMatchObject({ status: "failed", tools: [] });
    expect(bad.error).toBeTruthy();
  });
});
