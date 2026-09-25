// The `work` in-process MCP toolset (ARCHITECTURE.md §8.2/§8.6), bound to one
// WorkPort per run. Ported in shape from spike/experiments/s04-toolsets/workToolset.ts;
// the I1 version exposes the full six-tool surface (ports.ts) against the real
// WorkPort interface instead of a fixture, and tracks the two termination
// signals (`submitted`, `openBlockingQuestion`) the engine needs after each
// query() call (termination.ts).

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import {
  AppendWorklogInput,
  ProposePlanChangeInput,
  PublishAssetInput,
  RaiseQuestionInput,
  ReportProgressInput,
  SubmitOutputsInput,
  WorkPortError,
  type WorkPort,
} from "@workbench/core";

export interface WorkToolsetTracker {
  submitted: boolean;
  openBlockingQuestion: boolean;
}

export interface WorkToolset {
  server: McpSdkServerConfigWithInstance;
  tracker: WorkToolsetTracker;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Runs a WorkPort call and turns a WorkPortError (or any other error) into a tool error result. */
async function guarded<T>(fn: () => Promise<T>, format: (result: T) => string) {
  try {
    const result = await fn();
    return textResult(format(result));
  } catch (err) {
    if (err instanceof WorkPortError) return textResult(err.message, true);
    return textResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/** Builds the bound `work` MCP server for one run, plus the termination tracker. */
export function createWorkToolset(port: WorkPort): WorkToolset {
  const tracker: WorkToolsetTracker = { submitted: false, openBlockingQuestion: false };

  const getBrief = tool(
    "get_brief",
    "Re-reads this item's brief, acceptance criteria, gate, pinned input paths and output slots. " +
      "Use this mid-turn if you need to double-check something; you were already given this at the start of your turn.",
    {},
    async () => guarded(() => port.getBrief(), (b) => JSON.stringify(b, null, 2)),
  );

  const publishAsset = tool(
    "publish_asset",
    "Publishes a file from your own work/ folder as a new immutable version of an output slot you own. " +
      "kind is 'minor' (does not change meaning) or 'material' (a downstream-relevant change) and decides the " +
      "next version number; it is ignored on a slot's first publish, which is always v1.0. Always include a short note.",
    PublishAssetInput.shape,
    async (args) => guarded(() => port.publishAsset(args), (r) => `Published ${r.slot} v${r.version} at ${r.path}`),
  );

  const appendWorklog = tool(
    "append_worklog",
    "Appends one entry to this item's worklog: what you decided and what you assumed, in plain language a human " +
      "reviewer can read without redoing your work. Call this after publishing, not instead of it.",
    AppendWorklogInput.shape,
    async (args) => guarded(() => port.appendWorklog(args), () => "Worklog entry recorded."),
  );

  const raiseQuestion = tool(
    "raise_question",
    "Raises a genuine ambiguity for the human. Always include your own best-answer hypothesis (never leave it out) " +
      "and any real alternatives you considered. Set blocking=true only if you cannot produce a defensible output " +
      "without an answer; if blocking, end your turn immediately after this call and do not call any more tools.",
    RaiseQuestionInput.shape,
    async (args) =>
      guarded(async () => {
        const result = await port.raiseQuestion(args);
        if (args.blocking) tracker.openBlockingQuestion = true;
        return result;
      }, (r) => r.instruction),
  );

  const reportProgress = tool(
    "report_progress",
    "Gives the human a short status update during a longer run. Optional; use it for anything that takes more than a few tool calls.",
    ReportProgressInput.shape,
    async (args) => guarded(() => port.reportProgress(args), () => "Progress recorded."),
  );

  const submitOutputs = tool(
    "submit_outputs",
    "Submits your completion report once every required output slot has been published. Include a summary, a " +
      "self-check entry for each acceptance criterion (met: yes/partial/no, with a note), and any open issues. " +
      "This is what moves the item to its gate (or to done, if it has none). End your turn right after this call.",
    SubmitOutputsInput.shape,
    async (args) =>
      guarded(async () => {
        const result = await port.submitOutputs(args);
        if (result.accepted) tracker.submitted = true;
        return result;
      }, (r) => r.instruction),
  );

  const proposePlanChange = tool(
    "propose_plan_change",
    "Suggests a change to the plan itself (a new item, a rewire, a brief update, …) for the Approach Agent to " +
      "decide on. Non-blocking: this is not your call to make, so keep working (or submit) right after this call " +
      "— don't wait for a decision. Give suggestedOps in the propose_ops format if you have a concrete change in " +
      "mind; the Approach Agent decides what, if anything, to actually propose.",
    ProposePlanChangeInput.shape,
    async (args) => guarded(() => port.proposePlanChange(args), (r) => r.instruction),
  );

  const server = createSdkMcpServer({
    name: "work",
    version: "0.1.0",
    tools: [getBrief, publishAsset, appendWorklog, raiseQuestion, reportProgress, submitOutputs, proposePlanChange],
  });

  return { server, tracker };
}
