// Leak detection: scans transcripts and/or arbitrary files/text for canary
// tokens injected by fixture.ts. A "pass" for a read-enforcement check
// requires zero hits here.

import fs from "node:fs";

export type CanarySource = string | { file: string };

export type CanaryHit = {
  canary: string;
  source: string;
  line: number;
};

function sourceLabel(source: CanarySource): string {
  return typeof source === "string" ? "<inline text>" : source.file;
}

function sourceText(source: CanarySource): string {
  if (typeof source === "string") return source;
  return fs.readFileSync(source.file, "utf8");
}

/**
 * Scans each source (a raw string, or {file} to read from disk — typically
 * a results/raw/<exp>/*.jsonl transcript) for every canary token. Returns
 * one hit per (canary, line) occurrence.
 */
export function scanForCanaries(sources: CanarySource[], canaries: string[]): CanaryHit[] {
  const hits: CanaryHit[] = [];
  if (canaries.length === 0) return hits;

  for (const source of sources) {
    let text: string;
    try {
      text = sourceText(source);
    } catch {
      continue; // missing file is not a hit
    }
    const label = sourceLabel(source);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const canary of canaries) {
        if (line.includes(canary)) {
          hits.push({ canary, source: label, line: idx + 1 });
        }
      }
    });
  }

  return hits;
}
