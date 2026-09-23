// S4 — the `work` in-process MCP toolset (M0-SPIKE-PLAN.md §4 S4,
// ARCHITECTURE.md §8.2/§8.6). A minimal version of the real `work`
// toolset: get_brief, publish_asset, raise_question, submit_outputs.
//
// One instance is created per (itemId, runId) via workToolset(...). The
// handlers close over itemId/runId — nothing about which item/run they
// belong to is passed by the model. This file exists to prove that
// closure-bound identity survives concurrent query() calls (S4 step 4).

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { isInside, hasTraversal, normalize } from "../../src/lib/paths.js";

export type WorkToolsetPaths = {
  /** items/<id>/work — the item's own locus. Publish sources are read from here. */
  workDir: string;
  /** items/<id>/assets — server-owned; publish_asset writes here. */
  assetsDir: string;
  /** A server-owned area for logs, e.g. <fixture>/.workbench. */
  logDir: string;
};

type ToolLogEntry = {
  ts: string;
  itemId: string;
  runId: string;
  tool: string;
  input: unknown;
  ok: boolean;
  /** Present when ok===false: a short reason, never a raw exception object. */
  error?: string;
  /** Present when ok===true and relevant, e.g. the computed version for publish_asset. */
  result?: unknown;
  /** Wall-clock ms spent inside this handler (excludes MCP/transport overhead). */
  handlerMs: number;
};

const KIND_ENUM = z.enum(["minor", "material"]);

/**
 * Computes the next version for a slot given the files already published
 * there. First publish -> v1.0. minor -> vX.(Y+1). material -> v(X+1).0.
 * Versions are read off existing `vX.Y.md` filenames in the slot dir; if
 * none exist yet, this is the first publish regardless of `kind`.
 */
function computeNextVersion(slotDir: string, kind: "minor" | "material"): { major: number; minor: number } {
  let maxMajor = 0;
  let maxMinorForMaxMajor = 0;
  let any = false;

  if (fs.existsSync(slotDir)) {
    for (const name of fs.readdirSync(slotDir)) {
      const m = /^v(\d+)\.(\d+)\.md$/.exec(name);
      if (!m) continue;
      any = true;
      const major = Number(m[1]);
      const minor = Number(m[2]);
      if (major > maxMajor || (major === maxMajor && minor > maxMinorForMaxMajor)) {
        maxMajor = major;
        maxMinorForMaxMajor = minor;
      }
    }
  }

  if (!any) {
    return { major: 1, minor: 0 };
  }
  if (kind === "material") {
    return { major: maxMajor + 1, minor: 0 };
  }
  return { major: maxMajor, minor: maxMinorForMaxMajor + 1 };
}

export function workToolset(
  itemId: string,
  runId: string,
  paths: WorkToolsetPaths,
): McpSdkServerConfigWithInstance {
  const logPath = path.join(paths.logDir, `tool-log-${itemId}.jsonl`);

  const appendLog = (entry: Omit<ToolLogEntry, "ts" | "itemId" | "runId" | "handlerMs"> & { handlerMs: number }) => {
    fs.mkdirSync(paths.logDir, { recursive: true });
    const full: ToolLogEntry = { ts: new Date().toISOString(), itemId, runId, ...entry };
    fs.appendFileSync(logPath, JSON.stringify(full) + "\n", "utf8");
  };

  const textResult = (text: string, isError = false) => ({
    content: [{ type: "text" as const, text }],
    isError,
  });

  const getBrief = tool(
    "get_brief",
    "Returns this work item's brief: what to produce and the output slot to publish to.",
    {},
    async () => {
      const __t0 = Date.now();
      const text =
        `Item: ${itemId}\n` +
        `Task: write a short draft (2-4 sentences) about item ${itemId} in your work/ folder, ` +
        `then publish it to the "draft" slot, first with kind=minor and then again with kind=material.\n` +
        `Output slot: draft\n` +
        `When done, call submit_outputs with a short summary and a self_check list.`;
      appendLog({ tool: "get_brief", input: {}, ok: true, handlerMs: Date.now() - __t0 });
      return textResult(text);
    },
  );

  const publishAsset = tool(
    "publish_asset",
    "Publishes a file from your work/ folder as a new immutable version under the given asset slot. " +
      "kind must be 'minor' (a small revision) or 'material' (a substantial change) and decides the next version number.",
    {
      slot: z.string().min(1).describe("Asset slot name, e.g. 'draft'."),
      source_path: z
        .string()
        .min(1)
        .describe("Path to the source file, relative to your own work/ folder. Must not escape work/."),
      kind: KIND_ENUM.describe("'minor' or 'material' — decides the next version number."),
      note: z.string().min(1).describe("A short note describing what changed."),
    },
    async (args) => {
      const __t0 = Date.now();
      const { slot, source_path: sourcePath, kind, note } = args;

      if (hasTraversal(sourcePath) || path.isAbsolute(sourcePath)) {
        const msg = `publish_asset: source_path "${sourcePath}" must be a relative path inside work/ (no ".." segments, not absolute).`;
        appendLog({ tool: "publish_asset", input: args, ok: false, error: msg, handlerMs: Date.now() - __t0 });
        return textResult(msg, true);
      }

      const resolvedSource = path.resolve(paths.workDir, sourcePath);
      if (!isInside(resolvedSource, paths.workDir)) {
        const msg = `publish_asset: source_path "${sourcePath}" resolves outside your work/ folder (${normalize(paths.workDir)}). Denied.`;
        appendLog({ tool: "publish_asset", input: args, ok: false, error: msg, handlerMs: Date.now() - __t0 });
        return textResult(msg, true);
      }

      if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
        const msg = `publish_asset: source file not found: ${sourcePath}`;
        appendLog({ tool: "publish_asset", input: args, ok: false, error: msg, handlerMs: Date.now() - __t0 });
        return textResult(msg, true);
      }

      const slotDir = path.join(paths.assetsDir, slot);
      fs.mkdirSync(slotDir, { recursive: true });
      const { major, minor } = computeNextVersion(slotDir, kind);
      const versionName = `v${major}.${minor}.md`;
      const destPath = path.join(slotDir, versionName);

      fs.copyFileSync(resolvedSource, destPath);

      const resultInfo = { slot, version: `${major}.${minor}`, destPath, note };
      appendLog({ tool: "publish_asset", input: args, ok: true, result: resultInfo, handlerMs: Date.now() - __t0 });

      return textResult(
        `Published ${sourcePath} to slot "${slot}" as v${major}.${minor} (kind=${kind}). Note: ${note}`,
      );
    },
  );

  const raiseQuestion = tool(
    "raise_question",
    "Raises a question for the Approach Agent/human. Always include a hypothesis — your best-guess answer — and " +
      "alternatives you considered. Set blocking=true only if you cannot proceed without an answer.",
    {
      question: z.string().min(1),
      hypothesis: z.string().min(1).describe("Your best-guess answer, so work can proceed or be checked."),
      alternatives: z.array(z.string()).describe("Other answers you considered."),
      blocking: z.boolean().describe("true if you cannot proceed without an answer."),
    },
    async (args) => {
      const __t0 = Date.now();
      appendLog({ tool: "raise_question", input: args, ok: true, handlerMs: Date.now() - __t0 });
      const text = args.blocking
        ? "Question recorded (blocking). End your turn now; do not call any more tools."
        : "Question recorded (non-blocking). Proceed on your stated hypothesis.";
      return textResult(text);
    },
  );

  const submitOutputs = tool(
    "submit_outputs",
    "Submits your completed outputs for this run. Call this only after publishing everything required.",
    {
      summary: z.string().min(1),
      self_check: z.array(z.string()).describe("A short checklist confirming you did what the brief asked."),
    },
    async (args) => {
      const __t0 = Date.now();
      appendLog({ tool: "submit_outputs", input: args, ok: true, handlerMs: Date.now() - __t0 });
      return textResult("Submitted. End your turn now; do not call any more tools.");
    },
  );

  return createSdkMcpServer({
    name: "work",
    version: "0.1.0",
    tools: [getBrief, publishAsset, raiseQuestion, submitOutputs],
  });
}

export { computeNextVersion };
