// The Source Catalog (the "content marketplace"): listings of live or external
// context a task can be linked to — the open web, an MCP server, a dataset,
// the Library. A listing is one YAML file in the catalog folder
// (config.sourcesCatalog); the Approach Agent attaches listings to tasks with
// SourceBinding (domain.ts), and the agent runtime turns those bindings into
// tools. Skills say *how* to work; Sources say *where context comes from*.

import { z } from "zod";
import { ItemId, SourceId } from "./domain.js";

export const SourceKind = z.enum(["web", "mcp", "library"]);
export type SourceKind = z.infer<typeof SourceKind>;

/**
 * How the runtime connects to a source.
 * SECURITY (rollout): stdio/http listings run third-party code or send data to
 * third-party hosts with the agent's queries; a real marketplace needs vetting,
 * per-source egress rules, and secrets kept out of listing files.
 */
export const SourceConnection = z.discriminatedUnion("type", [
  /** Claude's own WebSearch/WebFetch tools. */
  z.object({ type: z.literal("builtin-web") }),
  /** Canned records (a YAML file under the catalog's data/ folder) served by an in-process MCP server. Deterministic, offline. */
  z.object({ type: z.literal("mock"), dataset: z.string().min(1) }),
  /** A real MCP server started as a child process. */
  z.object({ type: z.literal("stdio"), command: z.string().min(1), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional() }),
  /** A real remote MCP server. */
  z.object({ type: z.literal("http"), url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }),
]);
export type SourceConnection = z.infer<typeof SourceConnection>;

export const SourceDef = z.object({
  id: SourceId,
  title: z.string().min(1),
  publisher: z.string().min(1),
  kind: SourceKind,
  /** One line for the catalog card and the Approach Agent's catalog. */
  summary: z.string().min(1),
  description: z.string().default(""),
  /**
   * "live": content changes over time, so a re-run may see different facts (not reproducible).
   * "snapshot": a fixed edition, so a re-run sees the same facts (cite the edition).
   */
  freshness: z.enum(["live", "snapshot"]),
  /** For a snapshot source, e.g. "2026.1". */
  edition: z.string().optional(),
  /** "free" sources the Approach Agent attaches readily; "licensed" ones it justifies in the rationale (mock pricing). */
  offer: z.object({ tier: z.enum(["free", "licensed"]), label: z.string().min(1) }),
  /** Notes for the Work Agent on how to use this source well. */
  usage: z.string().default(""),
  connection: SourceConnection,
});
export type SourceDef = z.infer<typeof SourceDef>;

/** Where a listing lives: the curated catalog folder (read-only in the UI) or the user's own folder (WorkspacePaths.userSourcesDir). */
export const SourceOrigin = z.enum(["catalog", "user"]);
export type SourceOrigin = z.infer<typeof SourceOrigin>;

/** A listing as the UI sees it: no connection details (they can hold commands or headers), plus who uses it here. */
export const SourceCatalogEntry = SourceDef.omit({ connection: true }).extend({
  connectionType: z.enum(["builtin-web", "mock", "stdio", "http"]),
  origin: SourceOrigin,
  usedBy: z.array(z.object({ itemId: ItemId, title: z.string(), purpose: z.string() })),
});
export type SourceCatalogEntry = z.infer<typeof SourceCatalogEntry>;

/** One record in a mock dataset (connection.type "mock"). */
export const SourceRecord = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Where a human can read the original (illustrative URLs in the demo datasets). */
  url: z.string().optional(),
  date: z.string().optional(),
  tags: z.array(z.string()).default([]),
  body: z.string(),
});
export type SourceRecord = z.infer<typeof SourceRecord>;

export const SourceDataset = z.object({ records: z.array(SourceRecord) });
export type SourceDataset = z.infer<typeof SourceDataset>;

/** The MCP server name a source's tools live under: tool names read mcp__source_<id>__<tool>. */
export function sourceServerName(id: string): string {
  return `source_${id.replace(/-/g, "_")}`;
}

// ---------------------------------------------------------------------------
// User-defined listings (docs/USER-MCP-SOURCES-PLAN.md)
// ---------------------------------------------------------------------------

/** The connections a user may define: real MCP servers only (mock and builtin-web are curated). */
export const UserSourceConnection = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdio"), command: z.string().min(1), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal("http"), url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }),
]);
export type UserSourceConnection = z.infer<typeof UserSourceConnection>;

/**
 * What the user edits; the server fills kind "mcp", publisher "You" and a free
 * offer. `id` is optional on create (slugged from the title) and ignored on update.
 */
export const UserSourceInput = z.object({
  id: SourceId.optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().default(""),
  usage: z.string().default(""),
  freshness: z.enum(["live", "snapshot"]).default("live"),
  edition: z.string().optional(),
  connection: UserSourceConnection,
});
export type UserSourceInput = z.infer<typeof UserSourceInput>;

/** A user listing in full, for the edit form (getSource). Secret values are ${env:NAME} references, never literals. */
export const UserSourceView = SourceDef.extend({ origin: z.literal("user") });
export type UserSourceView = z.infer<typeof UserSourceView>;

/** Result of a test connection: the MCP server started (or not) and the tools it offers. No model call is made. */
export const SourceTestResult = z.object({
  status: z.enum(["connected", "failed", "needs-auth", "timeout"]),
  error: z.string().nullable(),
  serverInfo: z.object({ name: z.string(), version: z.string() }).nullable(),
  tools: z.array(z.object({ name: z.string(), description: z.string().optional() })),
  /** ${env:NAME} references that could not be resolved; the test does not start the server when any are missing. */
  missingSecrets: z.array(z.string()).default([]),
});
export type SourceTestResult = z.infer<typeof SourceTestResult>;

/** A secret reference inside an env or header value: ${env:NAME}. */
export const SECRET_REF_RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

const SECRET_ENV_KEY_RE = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i;
const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|.*-key|.*-token)$/i;

/**
 * Env keys / header names that look secret but hold a literal value instead of
 * a ${env:NAME} reference. The server rejects such a listing on save, so no
 * credential ever lands in a listing file.
 */
export function findLiteralSecrets(connection: UserSourceConnection): string[] {
  const hasRef = (v: string) => new RegExp(SECRET_REF_RE.source).test(v);
  if (connection.type === "stdio") {
    return Object.entries(connection.env ?? {})
      .filter(([k, v]) => SECRET_ENV_KEY_RE.test(k) && v.length > 0 && !hasRef(v))
      .map(([k]) => `env.${k}`);
  }
  return Object.entries(connection.headers ?? {})
    .filter(([k, v]) => SECRET_HEADER_RE.test(k) && v.length > 0 && !hasRef(v))
    .map(([k]) => `headers.${k}`);
}
