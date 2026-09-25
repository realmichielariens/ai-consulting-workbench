// The `plan` in-process MCP toolset (I2-PLAN §4.2), bound to one ApproachPort
// per Approach Agent run. Mirrors workToolset.ts's shape: guarded() turns a
// WorkPortError (or any other error) into a tool error result, and the
// toolset exposes a small tracker the runtime can read after the run.
//
// get_plan/get_item/propose_ops/publish_engagement_asset/journal_append/
// notify_human are always present; answer_request/escalate are added only
// for a "question" session, decline_suggestion only for a "suggestion"
// session (ports.ts ApproachPort docstring) — a conversation session gets
// none of the three, since there is no single request to resolve.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance, type SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import {
  AnswerRequestInput,
  DeclineSuggestionInput,
  EscalateInput,
  GetItemInput,
  JournalAppendInput,
  NotifyHumanInput,
  ProposeOpsInput,
  PublishEngagementAssetInput,
  WorkPortError,
  type ApproachPort,
  type PlanToolAck,
} from "@workbench/core";

export interface PlanToolsetTracker {
  /** Set once answer_request, escalate or decline_suggestion succeeds, or propose_ops returns ok:true. */
  decided: boolean;
}

export interface PlanToolset {
  server: McpSdkServerConfigWithInstance;
  tracker: PlanToolsetTracker;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Runs an ApproachPort call and turns a WorkPortError (or any other error) into a tool error result. */
async function guarded<T>(fn: () => Promise<T>, format: (result: T) => string) {
  try {
    const result = await fn();
    return textResult(format(result));
  } catch (err) {
    if (err instanceof WorkPortError) return textResult(err.message, true);
    return textResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

function formatAck(r: PlanToolAck): string {
  return r.instruction;
}

/** Builds the bound `plan` MCP server for one Approach Agent run, plus the termination tracker. */
export function createPlanToolset(port: ApproachPort): PlanToolset {
  const tracker: PlanToolsetTracker = { decided: false };

  const getPlan = tool(
    "get_plan",
    "Reads the current plan: every item with its status, executor, inputs, outputs (latest versions) and gate, " +
      "plus open requests and pending proposals, as readable text. Call this first before proposing changes, to " +
      "see the ids already in use and the next free id per prefix.",
    {},
    async () =>
      guarded(
        () => port.getPlan(),
        (d) =>
          `${d.text}\n\n(planVersion: ${d.planVersion}; suggested next ids: ${d.suggestedNextIds.length > 0 ? d.suggestedNextIds.join(", ") : "(none)"})`,
      ),
  );

  const getItem = tool(
    "get_item",
    "Reads one item's full definition, status, output versions and open requests. Use this when get_plan's " +
      "summary isn't enough detail for a specific item.",
    GetItemInput.shape,
    async (args) => guarded(() => port.getItem(args), (d) => JSON.stringify(d, null, 2)),
  );

  const proposeOps = tool(
    "propose_ops",
    "Proposes a set of plan operations (add_item, update_brief, rewire, add_slot, remove_slot, set_gate, " +
      "cancel_item) as one change the human approves or rejects as a whole. Always include a rationale. If the " +
      "result reports ok:false, nothing was created — fix the listed errors and call propose_ops again; the human " +
      "never sees an invalid proposal.",
    ProposeOpsInput.shape,
    async (args) => {
      try {
        const result = await port.proposeOps(args);
        if (!result.ok) {
          return textResult(`${result.errors.join("\n")}\n\nFix these and call propose_ops again.`, true);
        }
        tracker.decided = true;
        // "Proposed <id>: ..." is a stable, machine-parseable prefix — activity.ts extracts the
        // proposal id from it the same way it extracts publish_asset's "Published <slot> v<version> at ...".
        return textResult(`Proposed ${result.proposalId}: ${result.instruction}`);
      } catch (err) {
        if (err instanceof WorkPortError) return textResult(err.message, true);
        return textResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  const publishEngagementAsset = tool(
    "publish_engagement_asset",
    "Publishes a file from ENG/work/ as a new immutable version of an engagement slot (context, stakeholders, " +
      "…). kind is 'minor' or 'material' and decides the next version number; it is ignored on a slot's first " +
      "publish, which is always v1.0. Always include a short note.",
    PublishEngagementAssetInput.shape,
    async (args) =>
      guarded(() => port.publishEngagementAsset(args), (r) => `Published ${r.slot} v${r.version} at ${r.path}`),
  );

  const journalAppend = tool(
    "journal_append",
    "Appends one entry to the engagement journal: a hypothesis, a rationale for a plan decision, or something " +
      "worth a human reviewer seeing later without redoing your reasoning.",
    JournalAppendInput.shape,
    async (args) => guarded(() => port.journalAppend(args), () => "Journal entry recorded."),
  );

  const notifyHuman = tool(
    "notify_human",
    "Sends the human a short FYI that doesn't need a decision (it shows up in their inbox, dismissible). Not for " +
      "anything that needs an answer — use answer_request/escalate/propose_ops/decline_suggestion for those.",
    NotifyHumanInput.shape,
    async (args) => guarded(() => port.notifyHuman(args), () => "Notification sent."),
  );

  // Annotated broadly: each tool()'s specific Zod shape would otherwise narrow this array's
  // inferred element type, and the question/suggestion-only tools pushed below have different shapes.
  const tools: SdkMcpToolDefinition<any>[] = [getPlan, getItem, proposeOps, publishEngagementAsset, journalAppend, notifyHuman];

  if (port.kind === "question") {
    const answerRequest = tool(
      "answer_request",
      "Answers the routed question. mode 'approve' means the Work Agent's own hypothesis stands (your text may " +
        "add a note); mode 'replace' gives a different answer. Call this only for this session's own request, " +
        "then end your turn.",
      AnswerRequestInput.shape,
      async (args) =>
        guarded(async () => {
          const result = await port.answerRequest(args);
          tracker.decided = true;
          return result;
        }, formatAck),
    );
    const escalate = tool(
      "escalate",
      "Hands the question to the human with your own view attached, when the context and the plan aren't enough " +
        "to decide it yourself. Call this only for this session's own request, then end your turn.",
      EscalateInput.shape,
      async (args) =>
        guarded(async () => {
          const result = await port.escalate(args);
          tracker.decided = true;
          return result;
        }, formatAck),
    );
    tools.push(answerRequest, escalate);
  } else if (port.kind === "suggestion") {
    const declineSuggestion = tool(
      "decline_suggestion",
      "Declines this Work Agent suggestion, with a reason the human and the Work Agent can see. Use propose_ops " +
        "instead if the suggestion should become a real plan change. Call this only for this session's own " +
        "request, then end your turn.",
      DeclineSuggestionInput.shape,
      async (args) =>
        guarded(async () => {
          const result = await port.declineSuggestion(args);
          tracker.decided = true;
          return result;
        }, formatAck),
    );
    tools.push(declineSuggestion);
  }

  const server = createSdkMcpServer({ name: "plan", version: "0.1.0", tools });

  return { server, tracker };
}
