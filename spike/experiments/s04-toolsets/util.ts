// Shared helpers for the S4 scripts (run.ts, parallel-binding.ts). Local to
// this experiment folder — not part of the shared harness.

import fs from "node:fs";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ToolLogEntry = {
  ts: string;
  itemId: string;
  runId: string;
  tool: string;
  input: unknown;
  ok: boolean;
  error?: string;
  result?: unknown;
  handlerMs: number;
};

/** Reads back a tool-log-<itemId>.jsonl file written by workToolset(). */
export function readToolLog(logDir: string, itemId: string): ToolLogEntry[] {
  const p = path.join(logDir, `tool-log-${itemId}.jsonl`);
  if (!fs.existsSync(p)) return [];
  const out: ToolLogEntry[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

export type ToolTiming = {
  toolUseId: string;
  name: string;
  /** Wall-clock ms between the message carrying the tool_use block being received and the message carrying its tool_result being received. Approximate: granularity is per-streamed-message, not per-byte. */
  e2eMs: number | undefined;
};

/**
 * Correlates each tool_use block with its tool_result by tool_use_id,
 * using receipt timestamps captured by an onMessage callback (parallel
 * array, same length/order as `messages`). Gives an approximate
 * end-to-end latency per tool call: from the moment the SDK reports the
 * model asked for the tool to the moment it reports the result came back.
 */
export function measureE2ELatency(messages: SDKMessage[], receiptTimes: number[]): ToolTiming[] {
  const useTimes = new Map<string, { name: string; t: number }>();
  const out: ToolTiming[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const t = receiptTimes[i];
    if (m.type === "assistant") {
      const content = (m as any).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_use") {
            useTimes.set(block.id, { name: block.name, t });
          }
        }
      }
    }
    if (m.type === "user") {
      const content = (m as any).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result") {
            const started = useTimes.get(block.tool_use_id);
            if (started) {
              out.push({
                toolUseId: block.tool_use_id,
                name: started.name,
                e2eMs: t - started.t,
              });
            }
          }
        }
      }
    }
  }
  return out;
}
