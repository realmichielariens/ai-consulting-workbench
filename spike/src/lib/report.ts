// Machine-readable check results per experiment: spike/results/<exp>/summary.json.
// Each experiment's run.ts calls check() once per assertion it makes; this
// module upserts by name and rewrites the file. summarize() reads it back.

import fs from "node:fs";
import path from "node:path";
import { resultsDir, config } from "./env.js";

export type CheckStatus = boolean | "partial" | "skip";

export type CheckEntry = {
  name: string;
  pass: CheckStatus;
  evidence: string;
  extra?: unknown;
  ts: string;
};

export type Summary = {
  exp: string;
  updatedAt: string;
  sdkVersion: string;
  model: string;
  costUsd: number;
  checks: CheckEntry[];
};

function summaryPath(exp: string): string {
  return path.join(resultsDir, exp, "summary.json");
}

function sdkVersion(): string {
  try {
    const pkgPath = path.resolve(
      resultsDir,
      "..",
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "package.json",
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function ledgerCostForExp(exp: string): number {
  const ledgerPath = path.join(resultsDir, "cost-ledger.jsonl");
  if (!fs.existsSync(ledgerPath)) return 0;
  const prefix = exp.slice(0, 3);
  let sum = 0;
  for (const line of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (typeof entry.exp === "string" && entry.exp.slice(0, 3) === prefix) {
        sum += Number(entry.costUsd) || 0;
      }
    } catch {
      // skip malformed lines
    }
  }
  return sum;
}

function loadSummary(exp: string): Summary {
  const p = summaryPath(exp);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      // fall through to a fresh summary
    }
  }
  return {
    exp,
    updatedAt: new Date().toISOString(),
    sdkVersion: sdkVersion(),
    model: config.model,
    costUsd: 0,
    checks: [],
  };
}

/** Upserts a check result (by name) into results/<exp>/summary.json and rewrites it. */
export function check(
  exp: string,
  name: string,
  pass: CheckStatus,
  evidence: string,
  extra?: unknown,
): CheckEntry {
  const summary = loadSummary(exp);
  const entry: CheckEntry = { name, pass, evidence, extra, ts: new Date().toISOString() };

  const idx = summary.checks.findIndex((c) => c.name === name);
  if (idx >= 0) {
    summary.checks[idx] = entry;
  } else {
    summary.checks.push(entry);
  }
  summary.updatedAt = new Date().toISOString();
  summary.sdkVersion = sdkVersion();
  summary.model = config.model;
  summary.costUsd = ledgerCostForExp(exp);

  const dir = path.join(resultsDir, exp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(summaryPath(exp), JSON.stringify(summary, null, 2) + "\n", "utf8");

  return entry;
}

/** Reads back results/<exp>/summary.json (or an empty summary if none exists yet). */
export function summarize(exp: string): Summary {
  return loadSummary(exp);
}
