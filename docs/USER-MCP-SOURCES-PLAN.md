# User-defined MCP sources: plan

Status: planned 2026-10-06 on `iteration/i2`. It extends the Source Catalog in [iterations/notes/SOURCES-AND-SKILLS.md](../iterations/notes/SOURCES-AND-SKILLS.md).

## Goal

From the Source Catalog page, the user adds, edits, tests and removes their own MCP servers, as `stdio` or `http` listings. From then on they behave exactly like curated listings:

- the Approach Agent sees them and attaches them;
- guards scope them;
- activity is tagged with them;
- the Work Agent gets their tools.

## What already works (no change needed)

- **The listing format.** `SourceConnection` already has `stdio` and `http` (`packages/core/src/sources.ts`).
- **Running them.** `resolveSources` (`packages/agents/src/sourceResolver.ts`) passes them to the SDK's `mcpServers` and allows `mcp__source_<id>__*`.
- **Freshness.** The catalog is reread on every run and every view, so a new listing needs no restart.
- **Environment.** The SDK child's env (`sdkEnv`) is a copy of `process.env` minus Claude session variables, so a stdio server keeps `PATH`.

## Decisions

1. **Two folders.**
   - The curated catalog stays in `workbench-sources/` and is read-only from the UI.
   - User listings live in `<home>/sources/*.yaml`, which is git-ignored with the rest of `workspace/`. The path comes from `WorkspacePaths.userSourcesDir`.
   - Every view entry carries `origin: "catalog" | "user"`, and only `user` listings can be edited or deleted.
   - A user listing may not reuse an id from either folder.
2. **No secrets in listing files.**
   - `env` and `headers` values may contain `${env:NAME}` references. They are resolved at run time in this order: process env, the repo-root `.env`, then `HKCU\Environment`, the same order `resolveAuth` uses.
   - Every resolved value is registered with `redact()`.
   - On save, a literal value is rejected when its key looks like a secret: an env key matching `/KEY|TOKEN|SECRET|PASSWORD|AUTH/i`, or an `Authorization` or `*-key` header. The error says to use `${env:NAME}` instead.
3. **An unresolvable reference is not fatal.** If a reference can't be resolved at run time, that source is left out of the run and reported as unavailable, the same way unknown ids are reported today. The run goes on without it.
4. **Windows.** On `win32`, a `stdio` command that is not an absolute path to an `.exe` or `.com` is wrapped as `cmd /c <command> ...args`. This is so `npx`, `uvx` and similar commands resolve. Rule 11 is about the workbench's own spawns; this one is the user's server.
5. **Test connection costs no tokens.**
   - It goes through `sdk.ts`. It opens a `query()` whose streaming prompt never yields a message, with no tools, `settingSources: []`, the clean env and the one server.
   - It polls `mcpServerStatus()` until the server is no longer `pending`, with a 20 s cap, then closes the query.
   - It returns the status, any error, the server info and the tool names and descriptions.
   - It makes no model call.
6. **Deleting a listing in use is allowed.** The UI confirms first and shows which tasks in this engagement use it. After deletion, existing bindings show up as unknown at run time; that is already non-fatal.
7. **Form defaults for user listings.**
   - `kind: mcp`, `publisher: "You"`, `offer: { tier: free, label: "Your own source" }`, `freshness: live`.
   - The user can edit title, summary, description, usage notes, freshness (and edition) and the connection.
   - The Approach Agent's catalog marks user listings "(added by you)".

## Contract changes (made by the main session before work starts)

- **`core/src/layout.ts`:** `WorkspacePaths.userSourcesDir = <home>/sources`.
- **`core/src/sources.ts`:**
  - `SourceCatalogEntry.origin`.
  - `UserSourceInput`: the editable fields plus the connection, restricted to `stdio` or `http`.
  - `SourceTestResult`.
  - `SECRET_REF_RE` and `findLiteralSecrets()`.
- **`core/src/api.ts`:**
  - `getSource GET /api/sources/:sid`: a user listing, including its connection.
  - `createSource POST /api/sources`.
  - `updateSource PATCH /api/sources/:sid`.
  - `deleteSource DELETE /api/sources/:sid`.
  - `testSource POST /api/sources/test`, which takes a connection and returns `SourceTestResult`.

## Work packages

### WP-A: backend (agents, server, core/node)

Paths:

- `packages/core/src/node/env.ts`
- `packages/agents/src/sourceCatalog.ts`, `sourceResolver.ts`, `sourceTest.ts` (new), `sdk.ts` (test-connection entry only), `approachRuntime.ts`, `runtime.ts`, `fake/runtime.ts`, `dev/try*.ts`, `index.ts`
- `packages/agents/src/dev/fixtures/echo-mcp-server.mjs` (new)
- `packages/server/src/sourceService.ts`, `routes.ts`, `engagementContext.ts`
- Tests next to each of these.

Tasks:

1. **`env.ts`:**
   - Export `resolveEnvRef(repoRoot, name)`, which reuses `resolveVar` and registers the value with redaction.
   - Export `resolveSecretRefs(repoRoot, record)`. It returns either the resolved record or the names it couldn't resolve.
2. **`loadSourceCatalog({ catalogDir, userDir? })`:**
   - Load both folders and tag each listing with its origin.
   - A user listing whose id is already in the catalog folder is reported invalid.
   - A user listing may not use `mock` or `builtin-web`.
   - Mock datasets still come only from `catalogDir/data`.
3. **Resolver:**
   - Resolve secret references and report unresolvable sources in `unavailable: {id, reason}[]`.
   - Apply the Windows `cmd /c` wrap.
   - Make sure `unavailable` shows up wherever `unknown` already does.
4. **`sourceTest.ts`: `testSourceConnection(connection, opts)`**, as described in Decision 5. A `mock` connection returns `search` and `get` without spawning anything; `builtin-web` returns `WebSearch` and `WebFetch`.
5. **Fixture.** `echo-mcp-server.mjs` is a dependency-free newline-delimited JSON-RPC stdio server with `initialize`, `tools/list` and `tools/call`. Its two tools are `echo` and `lookup` (a canned record).
6. **Server:**
   - `sourceService`: create, update, delete and get user listings. The file is written to `userSourcesDir` as YAML; the id is slugged from the title when it is missing.
   - The service validates with Zod and `findLiteralSecrets`.
   - The service passes test requests through.
   - Add the routes, which hold no business logic.
   - `listSourcesView` sets `origin`.
7. **Approach catalog.** `renderSourceCatalog` marks user listings.

### WP-B: web (`apps/web` only)

Tasks:

1. **API layer.** Add the new routes to `api/http.ts`, `api/types.ts`, `api/queryKeys.ts` and `api/mock/backend.ts`. The mock backend keeps user listings in memory, and its test returns two fake tools after a short delay.
2. **Source Catalog page:**
   - An "Add MCP server" action, and edit/delete on `origin: user` cards. Curated cards stay read-only.
   - The form has two connection types:
     - stdio: command, args one per line, env as key/value rows;
     - http: url, headers as key/value rows.
   - Helper text for `${env:NAME}`, and the server's "use `${env:NAME}`" error shown inline.
   - A **Test connection** button showing the status, the error, or the tool list. The tool list can be copied into the usage notes.
   - Warning copy: "A stdio server runs this command on your machine with your user rights."
3. **Delete** confirms in the page's own UI (not `window.confirm`) and lists "Used by" tasks.
4. **Style.** Follow `ux/EXHIBIT.md` and its tokens.

## Validation

- **Quick checks, done by each agent:**
  - typecheck, lint and unit tests;
  - the server flow test: create, list with origin, reject a literal secret, update, test against the fixture, delete;
  - one zero-cost test connection to `echo-mcp-server.mjs` through the real SDK, showing the CLI connecting and listing `echo` and `lookup`.
- **User look (fake agent):** `pnpm dev:fake`, then add the fixture as a stdio source, run Test connection, attach it in chat, approve, and watch the fake run.
- **After the user says "go":**
  - one real Work Agent run (Haiku, ≤ $0.10) with the fixture attached, showing a `mcp__source_<id>__lookup` call tagged in activity;
  - one real third-party server, e.g. an `npx` server on Windows, to prove the `cmd /c` wrap.

## Out of scope

- OAuth and `needs-auth` flows for remote servers.
- Sandboxing stdio servers.
- Per-tool allow and deny lists.
- Storing discovered tools on the listing.
- A catalog search tool for the Approach Agent.
- The other security items in SOURCES-AND-SKILLS.md, which stay open.
