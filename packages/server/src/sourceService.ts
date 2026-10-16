// The Source Catalog as the server uses it: the ids plan operations may
// attach (validateOps), the catalog view with "used by" for the UI, and the
// user's own listings (docs/USER-MCP-SOURCES-PLAN.md): create, read, update,
// delete and "Test connection". Read fresh per call, like the agent runtime
// does, so an added listing shows up without a restart. User listings are
// workspace-wide YAML files in WorkspacePaths.userSourcesDir; there is no DB
// row and no event for them, so the file write is the whole change.

import fs from "node:fs";
import path from "node:path";
import {
  findLiteralSecrets,
  SourceDef,
  UserSourceConnection,
  UserSourceInput,
  type ItemDef,
  type SourceCatalogEntry,
  type SourceTestResult,
  type UserSourceView,
} from "@workbench/core";
import { sdkEnv } from "@workbench/core/node";
import { loadSourceCatalog, testSourceConnection, writeSourceListing, type CatalogSource, type SourceCatalog } from "@workbench/agents";
import { itemsRepo } from "@workbench/db";
import { readItemMd } from "@workbench/store";
import type { EngagementContext, ServerContext } from "./engagementContext.js";
import { conflict, invalid, notFound } from "./errors.js";

function loadCatalog(server: ServerContext): SourceCatalog {
  return loadSourceCatalog({ catalogDir: server.config.resolved.sourcesCatalog, userDir: server.workspace.userSourcesDir });
}

export function knownSourceIds(ctx: EngagementContext): Set<string> {
  return new Set(loadCatalog(ctx.server).sources.map((s) => s.id));
}

export function listSourcesView(ctx: EngagementContext): SourceCatalogEntry[] {
  const defs: ItemDef[] = itemsRepo.listItems(ctx.dbCtx).map((r) => readItemMd(ctx.paths.itemMd(r.id)));
  return loadCatalog(ctx.server).sources.map(({ connection, file: _file, ...listing }) => ({
    ...listing,
    connectionType: connection.type,
    usedBy: defs.flatMap((d) => d.sources.filter((b) => b.id === listing.id).map((b) => ({ itemId: d.id, title: d.title, purpose: b.purpose }))),
  }));
}

// ---------------------------------------------------------------------------
// User listings
// ---------------------------------------------------------------------------

/** "Acme ERP (staging)" -> "acme-erp-staging"; always a valid SourceId. */
export function slugifySourceId(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "source";
}

function toView(source: CatalogSource): UserSourceView {
  const { origin: _origin, file: _file, ...def } = source;
  return { ...SourceDef.parse(def), origin: "user" };
}

/** The user listing with this id, or a 404 / a 409 for a curated (read-only) listing. */
function requireUserListing(catalog: SourceCatalog, sid: string, action: string): CatalogSource {
  const source = catalog.sources.find((s) => s.id === sid);
  if (!source) throw notFound(`no source listing "${sid}"`);
  if (source.origin !== "user") throw conflict(`"${sid}" is a curated catalog listing; only your own listings can be ${action}`);
  return source;
}

/** On a hosted server a stdio listing would let anyone with the password run commands on the host. */
function rejectStdioWhenHosted(server: ServerContext, connection: UserSourceConnection): void {
  if (server.hosted && connection.type === "stdio") throw invalid("stdio sources are disabled on this hosted server; use an http MCP server");
}

/** Secrets never land in a listing file (Decision 2). The message format is parsed by the web form to mark the row. */
function rejectLiteralSecrets(connection: UserSourceConnection): void {
  const hits = findLiteralSecrets(connection);
  if (hits.length > 0) throw invalid(hits.map((field) => `${field} looks like a secret; use \${env:NAME} instead`).join("; "));
}

function listingFrom(input: UserSourceInput, id: string, base?: SourceDef): SourceDef {
  return SourceDef.parse({
    id,
    title: input.title,
    // Decision 7 defaults; an existing listing keeps what its file says.
    publisher: base?.publisher ?? "You",
    kind: base?.kind ?? "mcp",
    offer: base?.offer ?? { tier: "free", label: "Your own source" },
    summary: input.summary,
    description: input.description,
    usage: input.usage,
    freshness: input.freshness,
    edition: input.freshness === "snapshot" ? input.edition : undefined,
    connection: input.connection,
  });
}

export function getUserSource(server: ServerContext, sid: string): UserSourceView {
  return toView(requireUserListing(loadCatalog(server), sid, "opened"));
}

export function createUserSource(server: ServerContext, body: unknown): UserSourceView {
  const input = UserSourceInput.parse(body);
  rejectStdioWhenHosted(server, input.connection);
  rejectLiteralSecrets(input.connection);
  const id = input.id ?? slugifySourceId(input.title);
  const catalog = loadCatalog(server);
  const file = path.join(server.workspace.userSourcesDir, `${id}.yaml`);
  // An invalid file with this name still counts: overwriting it would silently lose what the user wrote there.
  if (catalog.sources.some((s) => s.id === id) || fs.existsSync(file)) {
    throw conflict(`a source with id "${id}" already exists; choose another ${input.id ? "id" : "title"}`);
  }
  const def = listingFrom(input, id);
  writeSourceListing(file, def);
  return { ...def, origin: "user" };
}

/** The id never changes on update (bindings in item.md refer to it); `body.id` is ignored. */
export function updateUserSource(server: ServerContext, sid: string, body: unknown): UserSourceView {
  const input = UserSourceInput.parse(body);
  const existing = requireUserListing(loadCatalog(server), sid, "changed");
  rejectStdioWhenHosted(server, input.connection);
  rejectLiteralSecrets(input.connection);
  const def = listingFrom(input, existing.id, existing);
  writeSourceListing(existing.file, def);
  return { ...def, origin: "user" };
}

/** Allowed while tasks still name it (Decision 6): their bindings show up as unknown at run time, which is non-fatal. */
export function deleteUserSource(server: ServerContext, sid: string): void {
  const existing = requireUserListing(loadCatalog(server), sid, "deleted");
  fs.rmSync(existing.file, { force: true });
}

/** Starts the server once through the CLI and lists its tools; no model call. */
export async function testUserSource(server: ServerContext, body: unknown): Promise<SourceTestResult> {
  const connection = UserSourceConnection.parse((body as { connection?: unknown } | null)?.connection);
  rejectStdioWhenHosted(server, connection);
  const test = server.testSource ?? testSourceConnection;
  // The CLI starts in the workspace home, the same for every test, never inside an engagement.
  fs.mkdirSync(server.workspace.home, { recursive: true });
  return test(connection, {
    repoRoot: server.repoRoot,
    cwd: server.workspace.home,
    buildEnv: () => sdkEnv(server.repoRoot, server.workspace, { requireAuth: false }),
  });
}
