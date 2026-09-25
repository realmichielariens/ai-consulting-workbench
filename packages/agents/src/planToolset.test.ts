// Tests for createPlanToolset (I2-PLAN §4.2): the tool list per session kind,
// the propose_ops error path (ok:false must come back as a tool ERROR, per
// ports.ts "the human never sees an invalid proposal"), and a dry run
// verifying the SDK accepts PlanOp's nested discriminated union directly as
// a tool's Zod input shape (no JSON-string workaround needed).
import { describe, expect, test } from "vitest";
import { z } from "zod";
import type {
  AnswerRequestInput,
  ApproachPort,
  ApproachSessionKind,
  DeclineSuggestionInput,
  EscalateInput,
  GetItemInput,
  ItemDigest,
  JournalAppendInput,
  NotifyHumanInput,
  PlanDigest,
  PlanToolAck,
  ProposeOpsInput,
  ProposeOpsResult,
  PublishAssetResult,
  PublishEngagementAssetInput,
} from "@workbench/core";
import { WorkPortError } from "@workbench/core";
import { createPlanToolset } from "./planToolset.js";

function makePort(kind: ApproachSessionKind, overrides: Partial<ApproachPort> = {}): ApproachPort {
  const base: ApproachPort = {
    runId: "R-0001",
    kind,
    threadId: kind === "conversation" ? "T-0001" : null,
    requestId: kind === "conversation" ? null : "RQ-0001",
    getPlan: async (): Promise<PlanDigest> => ({ planVersion: 1, text: "# Plan\n\n- ENG", suggestedNextIds: ["PH-1"] }),
    getItem: async (_input: GetItemInput): Promise<ItemDigest> => {
      throw new Error("not exercised");
    },
    proposeOps: async (_input: ProposeOpsInput): Promise<ProposeOpsResult> => {
      throw new Error("not exercised");
    },
    answerRequest: async (_input: AnswerRequestInput): Promise<PlanToolAck> => ({ instruction: "ok" }),
    escalate: async (_input: EscalateInput): Promise<PlanToolAck> => ({ instruction: "ok" }),
    declineSuggestion: async (_input: DeclineSuggestionInput): Promise<PlanToolAck> => ({ instruction: "ok" }),
    publishEngagementAsset: async (_input: PublishEngagementAssetInput): Promise<PublishAssetResult> => {
      throw new Error("not exercised");
    },
    journalAppend: async (_input: JournalAppendInput): Promise<void> => {},
    notifyHuman: async (_input: NotifyHumanInput): Promise<void> => {},
  };
  return { ...base, ...overrides };
}

function toolNames(server: ReturnType<typeof createPlanToolset>["server"]): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registered = (server.instance as any)._registeredTools as Record<string, unknown>;
  return Object.keys(registered);
}

describe("createPlanToolset: tool list per session kind", () => {
  test("conversation: only the six base tools, no answer/escalate/decline", () => {
    const { server } = createPlanToolset(makePort("conversation"));
    const names = toolNames(server);
    expect(names.sort()).toEqual(
      ["get_plan", "get_item", "propose_ops", "publish_engagement_asset", "journal_append", "notify_human"].sort(),
    );
  });

  test("question: base tools plus answer_request and escalate, no decline_suggestion", () => {
    const { server } = createPlanToolset(makePort("question"));
    const names = toolNames(server);
    expect(names).toContain("answer_request");
    expect(names).toContain("escalate");
    expect(names).not.toContain("decline_suggestion");
  });

  test("suggestion: base tools plus decline_suggestion, no answer_request/escalate", () => {
    const { server } = createPlanToolset(makePort("suggestion"));
    const names = toolNames(server);
    expect(names).toContain("decline_suggestion");
    expect(names).not.toContain("answer_request");
    expect(names).not.toContain("escalate");
  });
});

describe("createPlanToolset: propose_ops error path", () => {
  test("ok:false comes back as a tool error, with the fix-and-retry instruction, and does not set tracker.decided", async () => {
    const port = makePort("conversation", {
      proposeOps: async () => ({
        ok: false,
        proposalId: null,
        superseded: null,
        errors: ["op 1 (add_item WI-900): parent PH-9 does not exist"],
        instruction: "unused when ok is false",
      }),
    });
    const { server, tracker } = createPlanToolset(port);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server.instance as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }>;
    const result = await registered.propose_ops!.handler({
      ops: [{ op: "cancel_item", itemId: "WI-900", reason: "test" }],
      rationale: "test",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("parent PH-9 does not exist");
    expect(result.content[0]!.text).toContain("Fix these and call propose_ops again");
    expect(tracker.decided).toBe(false);
  });

  test("ok:true sets tracker.decided and returns the proposal id in the (non-error) result text", async () => {
    const port = makePort("conversation", {
      proposeOps: async () => ({ ok: true, proposalId: "P-0002", superseded: null, errors: [], instruction: "Recorded, awaiting approval." }),
    });
    const { server, tracker } = createPlanToolset(port);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server.instance as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }>;
    const result = await registered.propose_ops!.handler({ ops: [{ op: "cancel_item", itemId: "WI-900", reason: "test" }], rationale: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("P-0002");
    expect(tracker.decided).toBe(true);
  });

  test("a WorkPortError from the port comes back as a tool error", async () => {
    const port = makePort("question", {
      answerRequest: async () => {
        throw new WorkPortError("not_allowed", "answer_request used outside its session's own request");
      },
    });
    const { server } = createPlanToolset(port);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server.instance as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }>;
    const result = await registered.answer_request!.handler({ requestId: "RQ-0001", mode: "approve", text: "ok" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("answer_request used outside its session's own request");
  });
});

describe("SDK schema dry run: PlanOp's nested discriminated union as a tool input shape", () => {
  test("the real MCP server accepts ProposeOpsInput.shape directly and converts it to JSON Schema without a workaround", () => {
    const { server } = createPlanToolset(makePort("conversation"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server.instance as any)._registeredTools as Record<string, { inputSchema: unknown }>;
    const zodShape = registered.propose_ops!.inputSchema; // the ZodObject the SDK actually registered
    expect(zodShape).toBeDefined();

    // Same conversion path the MCP server's ListTools handler uses internally (Zod v4 native toJSONSchema).
    const jsonSchema = z.toJSONSchema(zodShape as z.ZodType) as unknown as {
      properties: { ops: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } };
    };
    const opsUnion = jsonSchema.properties.ops.items.oneOf ?? jsonSchema.properties.ops.items.anyOf;
    expect(Array.isArray(opsUnion)).toBe(true);
    expect((opsUnion as unknown[]).length).toBe(7); // the 7 PlanOp variants (domain.ts)
  });
});
