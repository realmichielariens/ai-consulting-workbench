// Thin, evidence-producing wrapper around the SDK's query(). Every
// experiment MUST call runQuery() rather than query() directly, so
// transcripts, cost accounting and the cost cap are always applied.
// See spike/README.md "Harness API" and M0-SPIKE-PLAN.md §3.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  query as sdkQuery,
  type Options,
  type Query,
  type SDKMessage,
  type SDKSystemMessage,
  type SDKResultMessage,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKPermissionDenial,
  type ModelUsage,
  type NonNullableUsage,
} from "@anthropic-ai/claude-agent-sdk";
import { config, assertKey, redact, childEnv, rawDir, resultsDir } from "./env.js";

export class CostCapExceededError extends Error {
  constructor(
    public readonly exp: string,
    public readonly kind: "experiment" | "global",
    public readonly capUsd: number,
    public readonly spentUsd: number,
  ) {
    super(
      `Cost cap exceeded for ${kind === "experiment" ? `experiment "${exp}"` : "the spike (global)"}: ` +
        `spent $${spentUsd.toFixed(4)} >= cap $${capUsd.toFixed(2)}. Refusing to start a new run.`,
    );
    this.name = "CostCapExceededError";
  }
}

/** Per-experiment-prefix cost caps in USD (M0-SPIKE-PLAN.md §4/§5). */
export const EXPERIMENT_CAPS_USD: Record<string, number> = {
  s00: 0.2,
  s01: 0.5,
  s02: 0.5,
  s03: 1.0,
  s04: 1.0,
  s05: 1.0,
  s06: 2.5,
  s07: 1.0,
  s08: 0,
  s09: 0.75,
};

const LEDGER_PATH = path.join(resultsDir, "cost-ledger.jsonl");

type LedgerEntry = {
  ts: string;
  exp: string;
  label: string;
  runId: string;
  sessionId: string | undefined;
  costUsd: number;
  model: string;
};

function expPrefix(exp: string): string {
  return exp.slice(0, 3);
}

function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const text = fs.readFileSync(LEDGER_PATH, "utf8");
  const out: LedgerEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines rather than fail the whole read
    }
  }
  return out;
}

function sumCost(entries: LedgerEntry[], predicate: (e: LedgerEntry) => boolean): number {
  return entries.reduce((sum, e) => (predicate(e) ? sum + (e.costUsd || 0) : sum), 0);
}

function appendLedger(entry: LedgerEntry): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", "utf8");
}

function assertUnderCap(exp: string, capUsd: number): void {
  const entries = readLedger();
  const spentForExp = sumCost(entries, (e) => expPrefix(e.exp) === expPrefix(exp));
  if (spentForExp >= capUsd) {
    throw new CostCapExceededError(exp, "experiment", capUsd, spentForExp);
  }
  const spentGlobal = sumCost(entries, () => true);
  if (spentGlobal >= config.totalCapUsd) {
    throw new CostCapExceededError(exp, "global", config.totalCapUsd, spentGlobal);
  }
}

function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const rand = crypto.randomBytes(3).toString("hex");
  return `${ts}-${rand}`;
}

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  parentToolUseId: string | null;
};

export type ToolResult = {
  toolUseId: string;
  isError: boolean;
  text: string;
};

export type RunResult = {
  runId: string;
  transcriptPath: string;
  sessionId: string | undefined;
  init: SDKSystemMessage | undefined;
  subtype: string | undefined;
  isError: boolean;
  resultText: string | undefined;
  costUsd: number;
  turns: number | undefined;
  usage: NonNullableUsage | undefined;
  modelUsage: Record<string, ModelUsage> | undefined;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  denials: SDKPermissionDenial[];
  durationMs: number;
  messages: SDKMessage[];
  retries: number;
  timedOut: boolean;
};

export type RunQueryArgs = {
  exp: string;
  label: string;
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Partial<Options>;
  capUsd?: number;
  onMessage?: (m: SDKMessage) => void;
  onQuery?: (q: Query) => void;
  timeoutMs?: number;
};

const RETRYABLE_ERRORS = new Set(["rate_limit", "overloaded"]);

function isRetryableFailure(messages: SDKMessage[], thrown: unknown): boolean {
  if (thrown) {
    const msg = String((thrown as Error)?.message ?? thrown);
    if (/\b429\b|\b529\b|rate.?limit|overloaded/i.test(msg)) return true;
  }
  for (const m of messages) {
    if (m.type === "assistant") {
      const err = (m as SDKAssistantMessage).error;
      if (err && RETRYABLE_ERRORS.has(err)) return true;
    }
    if (m.type === "result" && (m as SDKResultMessage).is_error) {
      const r = m as SDKResultMessage;
      if ("stop_reason" in r && /rate.?limit|overloaded|429|529/i.test(String(r.stop_reason))) {
        return true;
      }
    }
  }
  return false;
}

function extractToolCalls(messages: SDKMessage[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const m of messages) {
    if (m.type !== "assistant") continue;
    const am = m as SDKAssistantMessage;
    const content = (am.message as any)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use") {
        out.push({
          id: block.id,
          name: block.name,
          input: block.input,
          parentToolUseId: am.parent_tool_use_id ?? null,
        });
      }
    }
  }
  return out;
}

function extractToolResults(messages: SDKMessage[]): ToolResult[] {
  const out: ToolResult[] = [];
  for (const m of messages) {
    if (m.type !== "user") continue;
    const um = m as SDKUserMessage;
    const content = (um.message as any)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_result") {
        let text = "";
        if (typeof block.content === "string") {
          text = block.content;
        } else if (Array.isArray(block.content)) {
          text = block.content
            .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
            .join("");
        }
        out.push({
          toolUseId: block.tool_use_id,
          isError: Boolean(block.is_error),
          text,
        });
      }
    }
  }
  return out;
}

/**
 * Runs one query() call, streaming every (redacted) message to
 * results/raw/<exp>/<label>-<runId>.jsonl, enforcing the per-experiment and
 * global cost caps, and returning a normalized summary. See
 * spike/README.md "Harness API".
 */
export async function runQuery(args: RunQueryArgs): Promise<RunResult> {
  assertKey();

  const capUsd = args.capUsd ?? EXPERIMENT_CAPS_USD[expPrefix(args.exp)] ?? config.totalCapUsd;
  assertUnderCap(args.exp, capUsd);

  const runId = makeRunId();
  const expDir = path.join(rawDir, args.exp);
  fs.mkdirSync(expDir, { recursive: true });
  const transcriptPath = path.join(expDir, `${args.label}-${runId}.jsonl`);

  const timeoutMs = args.timeoutMs ?? 5 * 60 * 1000;

  const allMessages: SDKMessage[] = [];
  let init: SDKSystemMessage | undefined;
  let lastResult: SDKResultMessage | undefined;
  let sessionId: string | undefined;
  let retries = 0;
  let timedOut = false;
  const startedAt = Date.now();

  const appendTranscriptLine = (obj: unknown) => {
    const line = redact(JSON.stringify(obj)) + "\n";
    fs.appendFileSync(transcriptPath, line, "utf8");
  };

  const maxAttempts = 3;
  let attempt = 0;
  let thrownError: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    thrownError = undefined;
    const attemptMessages: SDKMessage[] = [];
    let hadAssistantOutput = false;

    const abortController = args.options?.abortController ?? new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);

    const mergedOptions: Options = {
      model: config.model,
      settingSources: [],
      env: childEnv(),
      stderr: (data: string) => {
        appendTranscriptLine({ type: "stderr", data: redact(data) });
      },
      ...args.options,
      abortController,
    };

    try {
      const q = sdkQuery({ prompt: args.prompt, options: mergedOptions });
      args.onQuery?.(q);

      for await (const message of q) {
        attemptMessages.push(message);
        allMessages.push(message);
        appendTranscriptLine(message);
        args.onMessage?.(message);

        if (message.type === "system" && message.subtype === "init") {
          init = message as SDKSystemMessage;
          sessionId = init.session_id;
        }
        if (message.type === "assistant") {
          hadAssistantOutput = true;
        }
        if (message.type === "result") {
          lastResult = message as SDKResultMessage;
          sessionId = sessionId ?? lastResult.session_id;
        }
      }
    } catch (err) {
      thrownError = err;
      appendTranscriptLine({
        type: "harness_error",
        attempt,
        message: redact(String((err as Error)?.message ?? err)),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!thrownError && !(lastResult?.is_error)) {
      // success
      break;
    }

    if (hadAssistantOutput) {
      // Not retryable per policy: only retry pre-first-assistant-output failures.
      break;
    }

    if (typeof args.prompt !== "string") {
      // A streaming prompt's iterable was consumed by this attempt; it can't be replayed.
      break;
    }

    if (!isRetryableFailure(attemptMessages, thrownError)) {
      break;
    }

    if (attempt < maxAttempts) {
      retries++;
      const backoffMs = 1000 * 2 ** (attempt - 1);
      appendTranscriptLine({
        type: "harness_retry",
        attempt,
        backoffMs,
        reason: "rate_limit_or_overloaded_before_assistant_output",
      });
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  const durationMs = Date.now() - startedAt;
  const costUsd = lastResult?.total_cost_usd ?? 0;

  appendLedger({
    ts: new Date().toISOString(),
    exp: args.exp,
    label: args.label,
    runId,
    sessionId,
    costUsd,
    model: mergedOptionsModel(args),
  });

  const isError = Boolean(lastResult?.is_error) || (Boolean(thrownError) && !lastResult);

  return {
    runId,
    transcriptPath,
    sessionId,
    init,
    subtype: lastResult?.subtype,
    isError,
    resultText: lastResult && lastResult.subtype === "success" ? lastResult.result : undefined,
    costUsd,
    turns: lastResult?.num_turns,
    usage: lastResult?.usage,
    modelUsage: lastResult?.modelUsage,
    toolCalls: extractToolCalls(allMessages),
    toolResults: extractToolResults(allMessages),
    denials: lastResult?.permission_denials ?? [],
    durationMs,
    messages: allMessages,
    retries,
    timedOut,
  };
}

function mergedOptionsModel(args: RunQueryArgs): string {
  return args.options?.model ?? config.model;
}
