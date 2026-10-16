# Source Catalog

The content marketplace the Approach Agent picks from when it links live or
external context to a task (`packages/core/src/sources.ts`).

- One listing per `*.yaml` file in this folder (`SourceDef`).
- `data/*.yaml`: the canned records behind `connection: { type: mock }`
  listings. An in-process MCP server serves them with `search` and `get`
  tools, so demos are deterministic, offline and free.
- Real MCP servers can be listed with `connection: { type: stdio | http }`.

Publishers marked "(demo)" are fictional, and their records are illustrative
(example.com URLs). They are not real research.
