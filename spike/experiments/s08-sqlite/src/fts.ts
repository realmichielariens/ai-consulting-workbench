// S8 §4 step 2: FTS5 virtual table, 3 indexed Markdown docs, ranked (bm25)
// queries with snippet(). Runs against both drivers so we can compare.

export const DOCS: { slotRef: string; title: string; body: string }[] = [
  {
    slotRef: "ENG/assets/context/v1.0",
    title: "Acme IT Strategy — Engagement Context",
    body: `# Engagement Context

Acme Corp is running an IT strategy refresh. The CIO wants a roadmap that
balances cost reduction with modernization. Key themes: cloud migration,
vendor consolidation, and reducing technical debt in the ERP estate.
The steering committee meets monthly and expects a prioritized initiative
roadmap by the end of the quarter.`,
  },
  {
    slotRef: "WI-002/assets/notes/v1.0",
    title: "Stakeholder Interview Notes — CFO",
    body: `# CFO Interview Notes

The CFO flagged budget pressure on the ERP renewal and wants a clear
business case before any vendor commitment. Cost reduction is the top
priority this year, ahead of new capability. Cloud migration is
acceptable only if it shows payback within 18 months.`,
  },
  {
    slotRef: "WI-004/assets/themes/v1.0",
    title: "Initiative Themes — Draft",
    body: `# Draft Initiative Themes

Three candidate themes emerged from the interviews: (1) ERP modernization
and vendor consolidation, (2) cloud migration for the data center, and
(3) a technical debt reduction program. Each theme needs a cost estimate
and a roadmap slot before the steering committee review.`,
  },
];

export type FtsRow = { slotRef: string; title: string; snippet: string; rank: number };

/**
 * Runs the FTS5 setup + ranked query against a driver-agnostic thin
 * interface (`exec`, `all`) so the same logic exercises better-sqlite3 and
 * node:sqlite identically.
 */
export interface SyncSql {
  exec(sql: string): void;
  all(sql: string, ...params: unknown[]): any[];
}

export function runFtsCheck(sql: SyncSql, driverName: string): {
  createOk: boolean;
  indexedCount: number;
  query: string;
  results: FtsRow[];
} {
  sql.exec(`
    CREATE VIRTUAL TABLE asset_fts USING fts5(slot_ref, title, body);
  `);

  for (const doc of DOCS) {
    sql.exec(
      `INSERT INTO asset_fts (slot_ref, title, body) VALUES ('${doc.slotRef.replace(/'/g, "''")}', '${doc.title.replace(/'/g, "''")}', '${doc.body.replace(/'/g, "''")}')`,
    );
  }

  const countRow = sql.all(`SELECT count(*) as n FROM asset_fts`)[0];

  const query = "cloud migration";
  // bm25() is more negative for a better match; ORDER BY rank ascending.
  const rows = sql.all(
    `SELECT slot_ref as slotRef, title,
            snippet(asset_fts, 2, '[', ']', '...', 8) as snippet,
            bm25(asset_fts) as rank
     FROM asset_fts
     WHERE asset_fts MATCH ?
     ORDER BY rank`,
    query,
  );

  return {
    createOk: true,
    indexedCount: countRow.n,
    query,
    results: rows,
  };
}
