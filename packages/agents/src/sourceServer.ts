// The in-process MCP server behind a `mock` Source listing: `search` and `get`
// over a canned dataset. It stands in for a real provider's MCP server, so a
// demo of the marketplace is deterministic, offline and free; a real listing
// (stdio/http) exposes whatever tools its provider defines instead.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sourceServerName, type SourceDef, type SourceRecord } from "@workbench/core";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Keyword overlap over title, tags and body; titles and tags count double. Ties keep dataset order. */
export function searchRecords(records: readonly SourceRecord[], query: string, limit: number): SourceRecord[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  if (terms.length === 0) return records.slice(0, limit);
  const scored = records.map((r, idx) => {
    const head = `${r.title} ${r.tags.join(" ")}`.toLowerCase();
    const body = r.body.toLowerCase();
    const score = terms.reduce((n, t) => n + (head.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0), 0);
    return { r, idx, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map((s) => s.r);
}

/** How to cite a record from this source; the Work Agent is told to use it verbatim. */
export function citationFor(source: SourceDef, record: SourceRecord): string {
  const edition = source.edition ? ` ${source.edition}` : "";
  const date = record.date ? `, ${record.date}` : "";
  return `${source.publisher}${edition}, ${record.id} "${record.title}"${date}${record.url ? ` — ${record.url}` : ""}`;
}

/** The `search` tool's result text. Shared with the fake runtime, so scripted runs read like real ones. */
export function searchResultText(source: SourceDef, records: readonly SourceRecord[], query: string, limit = 5): string {
  const hits = searchRecords(records, query, limit);
  if (hits.length === 0) return `No records in ${source.title} match "${query}". Try fewer or broader keywords.`;
  const lines = hits.map((r) => `- ${r.id}: ${r.title}${r.date ? ` (${r.date})` : ""}${r.url ? ` ${r.url}` : ""}`);
  return `${hits.length} record${hits.length === 1 ? "" : "s"} in ${source.title}:\n${lines.join("\n")}`;
}

/** The `get` tool's result: the full record plus its citation, or an error when the id is unknown. */
export function getResultText(source: SourceDef, records: readonly SourceRecord[], id: string): { text: string; isError: boolean } {
  const record = records.find((r) => r.id.toLowerCase() === id.toLowerCase());
  if (!record) return { text: `No record ${id} in ${source.title}. Use search to find record ids.`, isError: true };
  return { text: `# ${record.id}: ${record.title}\n\n${record.body}\n\nCite as: ${citationFor(source, record)}`, isError: false };
}

export function createMockSourceServer(source: SourceDef, records: readonly SourceRecord[]): McpSdkServerConfigWithInstance {
  const search = tool(
    "search",
    `Searches ${source.title} (${source.publisher}). Returns matching record ids, titles and links; call get for the full record before citing it.`,
    { query: z.string().min(1), limit: z.number().int().min(1).max(10).optional() },
    async ({ query, limit }) => textResult(searchResultText(source, records, query, limit ?? 5)),
  );

  const get = tool(
    "get",
    `Reads one record from ${source.title} in full, with the citation to use.`,
    { id: z.string().min(1) },
    async ({ id }) => {
      const r = getResultText(source, records, id);
      return textResult(r.text, r.isError);
    },
  );

  return createSdkMcpServer({ name: sourceServerName(source.id), version: "1.0.0", tools: [search, get] });
}
