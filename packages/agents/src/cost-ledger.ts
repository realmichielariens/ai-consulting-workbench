// The dev cost guard (I1-PLAN §9, CLAUDE.md rule 9): one ledger line per
// completed query() call, and a refusal to start a new one once the running
// total reaches the configured cap. Deliberately dumb (append-only JSONL,
// summed on read) — this only needs to survive a handful of dev/test runs,
// not concurrent production load.

import fs from "node:fs";
import path from "node:path";
import type { ItemId, RunId } from "@workbench/core";
import type { WorkspacePaths } from "@workbench/core/node";

export interface DevCostLedgerEntry {
  runId: RunId;
  itemId: ItemId;
  costUsd: number;
  at: string;
}

export class CostCapExceededError extends Error {
  constructor(
    public readonly capUsd: number,
    public readonly spentUsd: number,
  ) {
    super(`Dev cost guard: ledger total $${spentUsd.toFixed(4)} is already >= the $${capUsd.toFixed(2)} cap. Refusing to start a new query.`);
    this.name = "CostCapExceededError";
  }
}

export function readDevCostTotal(workspace: WorkspacePaths): number {
  if (!fs.existsSync(workspace.devCostLedger)) return 0;
  let total = 0;
  for (const line of fs.readFileSync(workspace.devCostLedger, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as Partial<DevCostLedgerEntry>;
      if (typeof entry.costUsd === "number") total += entry.costUsd;
    } catch {
      // skip a malformed line rather than fail the whole read
    }
  }
  return total;
}

/** Throws CostCapExceededError when the ledger total is already at or over `capUsd`. Call before every query(). */
export function checkDevCostGuard(workspace: WorkspacePaths, capUsd: number): void {
  const spent = readDevCostTotal(workspace);
  if (spent >= capUsd) throw new CostCapExceededError(capUsd, spent);
}

export function recordDevCost(workspace: WorkspacePaths, entry: DevCostLedgerEntry): void {
  fs.mkdirSync(path.dirname(workspace.devCostLedger), { recursive: true });
  fs.appendFileSync(workspace.devCostLedger, `${JSON.stringify(entry)}\n`, "utf8");
}
