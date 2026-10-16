// The Source Catalog, the mock source server's search/get text, and the
// resolver, against the real workbench-sources/ folder (it is the demo
// marketplace, so a broken listing should fail here first).
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSourceCatalog, loadSourceDataset, renderSourceCatalog } from "./sourceCatalog.js";
import { getResultText, searchRecords, searchResultText } from "./sourceServer.js";
import { resolveSources } from "./sourceResolver.js";
import { sourceToolActivity } from "./activity.js";

const catalogDir = path.resolve(import.meta.dirname, "../../../workbench-sources");
const catalog = loadSourceCatalog({ catalogDir });
const byId = (id: string) => catalog.sources.find((s) => s.id === id)!;

describe("loadSourceCatalog (real catalog)", () => {
  test("every listing validates, and every mock dataset loads", () => {
    expect(catalog.invalid).toEqual([]);
    expect(catalog.sources.map((s) => s.id).sort()).toEqual(["analyst-briefs", "mfg-it-benchmarks", "open-web", "workbench-library"]);
    for (const s of catalog.sources) {
      if (s.connection.type === "mock") expect(loadSourceDataset(catalogDir, s.connection.dataset).length).toBeGreaterThan(0);
    }
  });

  test("a malformed listing is reported, not fatal", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-catalog-"));
    fs.writeFileSync(path.join(dir, "bad.yaml"), "id: Bad Id\ntitle: x\n", "utf8");
    const result = loadSourceCatalog({ catalogDir: dir });
    expect(result.sources).toEqual([]);
    expect(result.invalid).toEqual([expect.stringMatching(/^bad\.yaml: /)]);
  });

  test("a dataset name cannot leave the data/ folder", () => {
    expect(() => loadSourceDataset(catalogDir, "../open-web.yaml")).toThrow(/outside/);
  });

  test("renderSourceCatalog shows freshness and offer, not connection details", () => {
    const md = renderSourceCatalog(catalog.sources);
    expect(md).toContain("`open-web` **Open Web**");
    expect(md).toContain("fixed edition 2026.1");
    expect(md).toContain("live — changes over time");
    expect(md).not.toContain("builtin-web");
  });
});

describe("mock source server text", () => {
  const source = byId("mfg-it-benchmarks");
  const records = loadSourceDataset(catalogDir, "mfg-it-benchmarks.yaml");

  test("search ranks title/tag matches first and lists ids with links", () => {
    expect(searchRecords(records, "OEM visibility", 3)[0]!.id).toBe("MB-112");
    const text = searchResultText(source, records, "erp phased");
    expect(text).toMatch(/^\d+ records in Manufacturing IT Benchmarks:/);
    expect(text).toContain("- MB-104: ERP replacement duration by approach (2026-03) https://example.com/northfield/2026.1/MB-104");
  });

  test("get returns the record with a citation, or an error for an unknown id", () => {
    const ok = getResultText(source, records, "mb-104");
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('Cite as: Northfield Industry Research (demo) 2026.1, MB-104 "ERP replacement duration by approach", 2026-03 — https://');
    expect(getResultText(source, records, "MB-999").isError).toBe(true);
  });

  test("the activity mapper reads both result shapes back into lines with links", () => {
    const search = sourceToolActivity(source.title, "search", { query: "erp phased" }, false, searchResultText(source, records, "erp phased"));
    expect(search.summary).toMatch(/^Searched Manufacturing IT Benchmarks: "erp phased" — \d+ records$/);
    expect(search.links?.[0]).toEqual({ url: expect.stringContaining("example.com/northfield"), title: expect.stringMatching(/^MB-\d+: /) });
    const get = sourceToolActivity(source.title, "get", { id: "MB-104" }, false, getResultText(source, records, "MB-104").text);
    expect(get.summary).toBe("Read from Manufacturing IT Benchmarks: MB-104: ERP replacement duration by approach");
    expect(get.links).toEqual([{ url: "https://example.com/northfield/2026.1/MB-104", title: "MB-104: ERP replacement duration by approach" }]);
  });
});

describe("resolveSources", () => {
  test("nothing attached: no extra tools, no prompt section", () => {
    const r = resolveSources(catalog, []);
    expect(r).toMatchObject({ tools: [], allowedTools: [], mcpServers: {}, promptSection: "", unknown: [] });
  });

  test("Open Web adds the web tools; a mock source adds its MCP server and allow rule", () => {
    const r = resolveSources(catalog, [
      { id: "open-web", purpose: "public cases" },
      { id: "mfg-it-benchmarks", purpose: "peer figures" },
      { id: "nope", purpose: "x" },
    ]);
    expect(r.tools).toEqual(["WebSearch", "WebFetch"]);
    expect(r.allowedTools).toEqual(["WebSearch", "WebFetch", "mcp__source_mfg_it_benchmarks__*"]);
    expect(Object.keys(r.mcpServers)).toEqual(["source_mfg_it_benchmarks"]);
    expect(r.toolMap).toEqual({
      web: { id: "open-web", title: "Open Web" },
      servers: { source_mfg_it_benchmarks: { id: "mfg-it-benchmarks", title: "Manufacturing IT Benchmarks" } },
    });
    expect(r.unknown).toEqual(["nope"]);
    expect(r.promptSection).toContain("## Sources attached to this task");
    expect(r.promptSection).toContain("- Why it is attached to this task: peer figures");
    expect(r.promptSection).toContain("`mcp__source_mfg_it_benchmarks__*`");
  });
});
