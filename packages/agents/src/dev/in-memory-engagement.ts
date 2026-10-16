// A minimal, self-contained, in-memory engagement + WorkPort for the dev CLI
// (agents:try) and for fast tests. It is intentionally NOT the real store
// (W4 owns that in packages/store) — this exists only so W1 can drive one
// item's runtime end to end without a server, matching the seed format
// (seed.ts) closely enough to load demo/seeds/acme-discovery directly.

import fs from "node:fs";
import path from "node:path";
import {
  agentActor,
  formatVersion,
  itemKindOf,
  parseVersion,
  slotRef as toSlotRef,
  WorkPortError,
  type Actor,
  type AnswerRequestInput,
  type AppendWorklogInput,
  type ApproachPort,
  type ApproachSessionKind,
  type BriefView,
  type DeclineSuggestionInput,
  type EscalateInput,
  type GetItemInput,
  type ItemDef,
  type ItemDigest,
  type ItemId,
  type JournalAppendInput,
  type NotifyHumanInput,
  type PlanDigest,
  type PlanToolAck,
  type ProposeOpsInput,
  type ProposeOpsResult,
  type PublishAssetInput,
  type PublishAssetResult,
  type PublishEngagementAssetInput,
  type ProposePlanChangeResult,
  type RaiseQuestionInput,
  type RaiseQuestionResult,
  type ReportProgressInput,
  type RequestId,
  type RunId,
  type SlotRef,
  type SubmitOutputsInput,
  type SubmitOutputsResult,
  type ThreadId,
  type Version,
  type VersionKind,
  type WorkPort,
} from "@workbench/core";
import { engagementPaths, isInside, type EngagementPaths } from "@workbench/core/node";

export interface PublishedVersion {
  version: Version;
  major: number;
  minor: number;
  kind: VersionKind;
  author: Actor;
  at: string;
  note: string;
  /** Absolute path of the immutable version file. */
  path: string;
}

export interface RecordedQuestion {
  requestId: RequestId;
  itemId: ItemId;
  question: string;
  hypothesis: string;
  alternatives: string[];
  blocking: boolean;
}

/** Everything the in-memory WorkPort needs to know across the whole (single-engagement) run: the plan and published versions. */
export class InMemoryEngagement {
  readonly paths: EngagementPaths;
  readonly items = new Map<ItemId, ItemDef>();
  readonly versions = new Map<SlotRef, PublishedVersion[]>();
  readonly questions: RecordedQuestion[] = [];
  readonly worklog = new Map<ItemId, string[]>();
  readonly journal: string[] = [];
  private requestSeq = 0;
  private proposalSeq = 0;

  constructor(engagementRoot: string, items: ItemDef[]) {
    this.paths = engagementPaths(engagementRoot);
    for (const item of items) this.items.set(item.id, item);
  }

  latest(slot: SlotRef): PublishedVersion | undefined {
    const list = this.versions.get(slot);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  /** Copies `sourceAbsPath` to the next immutable version file for `slot` and records it. */
  publish(slot: SlotRef, sourceAbsPath: string, kind: VersionKind, note: string, author: Actor): PublishedVersion {
    const existing = this.versions.get(slot) ?? [];
    const prev = existing.at(-1);
    const { major, minor } = prev == null ? { major: 1, minor: 0 } : nextVersion(prev, kind);
    const version = formatVersion(major, minor);
    const format = (path.extname(sourceAbsPath).slice(1) || "md").toLowerCase();
    const dest = this.paths.versionFile(slot, version, format);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(sourceAbsPath, dest);
    const entry: PublishedVersion = { version, major, minor, kind, author, at: new Date().toISOString(), note, path: dest };
    existing.push(entry);
    this.versions.set(slot, existing);
    return entry;
  }

  nextRequestId(): RequestId {
    this.requestSeq += 1;
    return `RQ-${String(this.requestSeq).padStart(4, "0")}` as RequestId;
  }

  nextProposalId(): string {
    this.proposalSeq += 1;
    return `P-${String(this.proposalSeq).padStart(4, "0")}`;
  }
}

function nextVersion(prev: PublishedVersion, kind: VersionKind): { major: number; minor: number } {
  const { major, minor } = parseVersion(prev.version);
  return kind === "material" ? { major: major + 1, minor: 0 } : { major, minor: minor + 1 };
}

/** Publishes a seed/notes file as v1.0, authored "human (seed)" or "human" — for pre-loading the fixture (seed-fixture.ts). */
export function seedPublish(eng: InMemoryEngagement, slot: SlotRef, sourceAbsPath: string, author: Actor, note: string): PublishedVersion {
  return eng.publish(slot, sourceAbsPath, "material", note, author);
}

export class InMemoryWorkPort implements WorkPort {
  constructor(
    private readonly eng: InMemoryEngagement,
    readonly itemId: ItemId,
    readonly runId: string,
  ) {}

  async proposePlanChange(): Promise<ProposePlanChangeResult> {
    return { requestId: "RQ-9999", instruction: "Suggestion recorded (in-memory engagement: not routed anywhere). Continue your work." };
  }

  private get item(): ItemDef {
    const item = this.eng.items.get(this.itemId);
    if (!item) throw new Error(`InMemoryWorkPort: unknown item ${this.itemId}`);
    return item;
  }

  async getBrief(): Promise<BriefView> {
    const item = this.item;
    const workDir = this.eng.paths.itemWork(item.id);
    const inputs = item.inputs.map((ref) => {
      const latest = this.eng.latest(ref.slot);
      const [producerId, slotName] = ref.slot.split("/") as [ItemId, string];
      const producer = this.eng.items.get(producerId);
      const description = producer?.outputs.find((o) => o.slot === slotName)?.description ?? "";
      return { slot: ref.slot, required: ref.required, description, version: latest?.version ?? null, path: latest?.path ?? null };
    });
    const outputs = item.outputs.map((o) => ({ ...o, latestVersion: this.eng.latest(toSlotRef(item.id, o.slot))?.version ?? null }));
    const contextLatest = this.eng.latest(toSlotRef("ENG", "context"));
    return {
      itemId: item.id,
      title: item.title,
      brief: item.brief,
      acceptance: item.acceptance,
      inputs,
      outputs,
      gate: item.gate,
      workDir,
      engagementContextPath: contextLatest?.path ?? null,
    };
  }

  async publishAsset(input: PublishAssetInput): Promise<PublishAssetResult> {
    const item = this.item;
    const outputDef = item.outputs.find((o) => o.slot === input.slot);
    if (!outputDef) throw new WorkPortError("unknown_slot", `"${input.slot}" is not one of ${item.id}'s output slots.`);

    const workDir = this.eng.paths.itemWork(item.id);
    const sourceAbs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(workDir, input.sourcePath);
    if (!isInside(sourceAbs, workDir)) {
      throw new WorkPortError("outside_work", `sourcePath must be inside your own work/ folder. Denied: ${input.sourcePath}`);
    }
    if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
      throw new WorkPortError("not_found", `Source file not found: ${input.sourcePath}`);
    }

    const slot = toSlotRef(item.id, input.slot);
    const entry = this.eng.publish(slot, sourceAbs, input.kind, input.note, agentActor(item.id));
    return { slot, version: entry.version, path: entry.path };
  }

  async appendWorklog(input: AppendWorklogInput): Promise<void> {
    const item = this.item;
    const list = this.eng.worklog.get(item.id) ?? [];
    list.push(input.entry);
    this.eng.worklog.set(item.id, list);

    const p = this.eng.paths.worklog(item.id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `- ${new Date().toISOString()} agent:${item.id}: ${input.entry}\n`, "utf8");
  }

  async raiseQuestion(input: RaiseQuestionInput): Promise<RaiseQuestionResult> {
    const requestId = this.eng.nextRequestId();
    this.eng.questions.push({ requestId, itemId: this.itemId, ...input });
    const instruction = input.blocking
      ? `Recorded ${requestId}. This question is blocking: end your turn now.`
      : `Recorded ${requestId}. This question is non-blocking: proceed on your stated hypothesis.`;
    return { requestId, instruction };
  }

  async reportProgress(_input: ReportProgressInput): Promise<void> {
    // No UI to update in the in-memory harness; the activity stream already carries it.
  }

  async submitOutputs(input: SubmitOutputsInput): Promise<SubmitOutputsResult> {
    const item = this.item;
    const missing = item.outputs
      .filter((o) => o.required)
      .map((o) => o.slot)
      .filter((slot) => this.eng.latest(toSlotRef(item.id, slot)) == null);

    if (missing.length > 0) {
      return { accepted: false, missing, instruction: `Missing required output(s): ${missing.join(", ")}. Publish them before submitting.` };
    }
    // The full completion report (input.summary/selfCheck/openIssues) isn't persisted by this minimal
    // harness — the activity stream already carries it (ActivityBuilder's "submit" kind).
    return { accepted: true, missing: [], instruction: "Submitted for human review. End your turn now." };
  }
}

/**
 * Minimal in-memory ApproachPort for the dev CLI (agents:try-approach). Like
 * InMemoryWorkPort, this is NOT the real store — proposeOps only validates
 * `input` against the Zod schema (ProposeOpsInput/PlanOp, already done by the
 * MCP tool layer before this is called) and prints the ops rather than
 * actually applying them to the plan; there is no real engine here to run
 * planOps.ts against.
 */
export class InMemoryApproachPort implements ApproachPort {
  constructor(
    private readonly eng: InMemoryEngagement,
    readonly runId: RunId,
    readonly kind: ApproachSessionKind = "conversation",
    readonly threadId: ThreadId | null = null,
    readonly requestId: RequestId | null = null,
  ) {}

  async getPlan(): Promise<PlanDigest> {
    const items = [...this.eng.items.values()].sort((a, b) => a.order - b.order);
    const lines = items.map((item) => {
      const kind = itemKindOf(item);
      const outputs = item.outputs.map((o) => {
        const latest = this.eng.latest(toSlotRef(item.id, o.slot));
        return `${o.slot}${latest ? ` v${latest.version}` : " (unpublished)"}`;
      });
      const who = kind === "task" ? `, ${item.executor}` : "";
      const outPart = outputs.length > 0 ? ` — outputs: ${outputs.join(", ")}` : "";
      const parentPart = item.parent ? ` [under ${item.parent}]` : "";
      return `- ${item.id} (${kind}${who}): ${item.title}${parentPart}${outPart}`;
    });
    const text =
      `# Plan\n\n${lines.join("\n")}\n\n` +
      `Open questions recorded: ${this.eng.questions.length} (in-memory harness: not modeled as routable Request objects).`;

    const usedPrefixes = new Map<string, number>();
    for (const id of this.eng.items.keys()) {
      const m = /^([A-Z]{2,4})-(\d+)/.exec(id);
      if (m) usedPrefixes.set(m[1]!, Math.max(usedPrefixes.get(m[1]!) ?? 0, Number(m[2])));
    }
    const suggestedNextIds =
      usedPrefixes.size > 0 ? [...usedPrefixes.entries()].map(([prefix, n]) => `${prefix}-${n + 1}`) : ["PH-1", "WI-001"];

    return { planVersion: 1, text, suggestedNextIds };
  }

  async getItem(input: GetItemInput): Promise<ItemDigest> {
    const item = this.eng.items.get(input.itemId);
    if (!item) throw new WorkPortError("not_found", `No such item: ${input.itemId}`);
    const outputs = item.outputs.map((o) => ({
      slot: toSlotRef(item.id, o.slot),
      latestVersion: this.eng.latest(toSlotRef(item.id, o.slot))?.version ?? null,
    }));
    return { def: item, status: null, outputs, openRequests: [] };
  }

  async proposeOps(input: ProposeOpsInput): Promise<ProposeOpsResult> {
    // "proposeOps validates only with the Zod schema and prints the ops" (I2-PLAN §4, try-approach.ts).
    console.log(`\n[propose_ops] rationale: ${input.rationale}`);
    console.log(JSON.stringify(input.ops, null, 2));
    const proposalId = this.eng.nextProposalId();
    return {
      ok: true,
      proposalId,
      superseded: null,
      errors: [],
      instruction: `Recorded ${proposalId} (${input.ops.length} operation${input.ops.length === 1 ? "" : "s"}). In-memory harness: not applied to the plan. Awaiting human approval.`,
    };
  }

  async answerRequest(input: AnswerRequestInput): Promise<PlanToolAck> {
    console.log(`\n[answer_request] ${input.requestId} (${input.mode}): ${input.text}`);
    return { instruction: `Recorded the answer to ${input.requestId} (in-memory harness). End your turn now.` };
  }

  async escalate(input: EscalateInput): Promise<PlanToolAck> {
    console.log(`\n[escalate] ${input.requestId}: ${input.view}`);
    return { instruction: `Escalated ${input.requestId} to the human (in-memory harness). End your turn now.` };
  }

  async declineSuggestion(input: DeclineSuggestionInput): Promise<PlanToolAck> {
    console.log(`\n[decline_suggestion] ${input.requestId}: ${input.reason}`);
    return { instruction: `Declined ${input.requestId} (in-memory harness). End your turn now.` };
  }

  async publishEngagementAsset(input: PublishEngagementAssetInput): Promise<PublishAssetResult> {
    const workDir = this.eng.paths.itemWork("ENG");
    const sourceAbs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(workDir, input.sourcePath);
    if (!isInside(sourceAbs, workDir)) {
      throw new WorkPortError("outside_work", `sourcePath must be inside ENG/work/. Denied: ${input.sourcePath}`);
    }
    if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
      throw new WorkPortError("not_found", `Source file not found: ${input.sourcePath}`);
    }
    const slot = toSlotRef("ENG", input.slot);
    const entry = this.eng.publish(slot, sourceAbs, input.kind, input.note, "approach:in-memory" as Actor);
    return { slot, version: entry.version, path: entry.path };
  }

  async journalAppend(input: JournalAppendInput): Promise<void> {
    this.eng.journal.push(input.entry);
  }

  async notifyHuman(input: NotifyHumanInput): Promise<void> {
    console.log(`\n[notify_human]${input.itemId ? ` (${input.itemId})` : ""}: ${input.text}`);
  }
}
