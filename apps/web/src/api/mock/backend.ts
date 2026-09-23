// The in-memory, stateful fake server behind WorkbenchApi (VITE_API_MOCK=1).
// Seeded from seedData.ts (condensed from demo/seeds/acme-discovery), it
// autoplays a scripted WI-002 -> WI-003 -> WI-004 run so every UI state in
// ITERATIONS.md §4.2-4.3 is reachable by clicking through: a nudge -> run
// issue (R3), a guard denial (R4), a blocking question with a hypothesis
// (J1.4), a gate round that gets "changes requested" then approved (J1.5),
// a human item with four upload slots (J1.6), and a self-interrupting run
// that needs Resume (R1/R5). Reuses the real engine rules from
// "@workbench/core" (lifecycle, readiness, actions, rollup, versioning) so
// the mock's status transitions agree with what the real server will do.
//
// Kept out of the real code path: only api/mock/index.ts is imported when
// VITE_API_MOCK=1 (see ../index.ts).

import {
  applyItemEvent,
  computeItemActions,
  computeReadiness,
  formatVersion,
  initialStatus,
  nextVersionParts,
  rollupFor,
  parseSlotRef,
  slotRef,
  type Actor,
  type ActivityItem,
  type ActivityKind,
  type AssetContentView,
  type AssetVersion,
  type AssetVersionsView,
  type CompletionReport,
  type EngagementId,
  type EngagementSummary,
  type EngagementView,
  type EventBody,
  type Executor,
  type InboxEntry,
  type InboxView,
  type ItemActions,
  type ItemDef,
  type ItemDetailView,
  type ItemEvent,
  type ItemId,
  type ItemNode,
  type ItemStatus,
  type PlanView,
  type Request,
  type RequestId,
  type Run,
  type RunActivityView,
  type RunId,
  type RunReason,
  type SeedSummary,
  type Settings,
  type SlotName,
  type SlotNode,
  type SlotRef,
  type Version,
  type VersionKind,
  type WorklogView,
  type WsServerMessage,
} from "@workbench/core";
import { ACME_CONTEXT_MD, ACME_ITEMS, ACME_STAKEHOLDERS_MD, SEED_SUMMARIES } from "./seedData.js";
import { ApiRequestError, type WsStatus } from "../types.js";

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const now = (): string => new Date().toISOString();
const pad = (n: number): string => String(n).padStart(4, "0");

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return /^[a-z0-9]/.test(base) ? base : `e-${base}`.slice(0, 64) || "engagement";
}

/** Cooperative cancellation for a scripted run's setTimeout chain (Stop, R5). */
class CancelToken {
  cancelled = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.cancelled) {
        resolve();
        return;
      }
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
    });
  }
  cancel(): void {
    this.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------
// scripted stages
// ---------------------------------------------------------------------------

type BurstStep =
  | { type: "activity"; kind: ActivityKind; summary: string; detail?: string; tool?: ActivityItem["tool"] }
  | { type: "publish"; slot: SlotName; kind: VersionKind; note: string; text: string };

type StageEnd =
  | { type: "submitted"; report: CompletionReport }
  | { type: "question"; question: string; hypothesis: string; alternatives: string[]; blocking: boolean }
  | { type: "run-issue"; reason: "no_submit" | "max_turns" | "error"; lastMessage: string; nudged: boolean };

interface StageDef {
  steps: BurstStep[];
  end: StageEnd;
  /** After this many emitted steps (0-based, inclusive), the FIRST attempt only, simulate a server restart (R1). */
  autoInterruptAfterStep?: number;
}

const DELAY_MS = 550;

const WI002_STAGES: StageDef[] = [
  // stage 0: start -> nudge -> run issue (R3)
  {
    steps: [
      { type: "activity", kind: "system", summary: "Run started (start), model claude-haiku-4-5." },
      { type: "activity", kind: "progress", summary: "Reading the brief and inputs." },
      { type: "activity", kind: "tool", summary: "Read ENG/context v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "tool", summary: "Read ENG/stakeholders v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "text", summary: "Drafting the interview guide structure: warm-up, remit-specific questions, then a closing question per executive." },
      {
        type: "activity",
        kind: "denial",
        summary: "Denied: write outside this item's locus (attempted items/WI-004/work/scratch.md)",
        detail: "Guard: the write-scope hook only permits items/WI-002/work/** for this run.",
        tool: { name: "Write", isError: true },
      },
      { type: "activity", kind: "text", summary: "Continuing inside work/ — still weighing how to frame the CIO section." },
    ],
    end: { type: "run-issue", reason: "no_submit", nudged: true, lastMessage: "Still weighing whether the CIO section should lean on her forming vision or the ERP history — haven't drafted it yet." },
  },
  // stage 1: resume (after Retry) -> raises the blocking question
  {
    steps: [
      { type: "activity", kind: "system", summary: "Run resumed (resume), same session." },
      { type: "activity", kind: "text", summary: "Before drafting the CIO section, checking which angle you want: her forming vision, or the ERP history she inherited." },
    ],
    end: {
      type: "question",
      question:
        "For Priya Raman's (CIO) interview section: should the 45-60 minute slot focus on the vision and priorities she's forming now, or on the ERP history and past attempts she inherited? A single slot can't do both justice.",
      hypothesis:
        "Lean on her forming vision and priorities, with one or two questions on the ERP history as context rather than the main focus — the strategy needs where IT goes next more than a full post-mortem of how it got here.",
      alternatives: [
        "Lean on the ERP history instead, since it explains the customization debt every other interview references.",
        "Split the time evenly between vision and history.",
      ],
      blocking: true,
    },
  },
  // stage 2: resume-answer -> publish v1.0 -> submit (first gate round)
  {
    steps: [
      { type: "activity", kind: "system", summary: "Run resumed (resume-answer), same session." },
      { type: "activity", kind: "text", summary: "Using your answer — the CIO section now leans on her forming vision, with two grounding questions on the ERP history." },
      { type: "activity", kind: "tool", summary: "Wrote work/draft-guide.md", tool: { name: "Write" } },
      {
        type: "publish",
        slot: "interview-guide",
        kind: "material",
        note: "First draft: CEO, CFO, COO and CIO sections, each with a warm-up, remit-specific questions and a closing question.",
        text:
          "# Interview Guide — Acme Manufacturing IT Strategy\n\n" +
          "Each interview: 45-60 minutes. Warm-up (5 min) -> remit-specific questions -> closing \"anything we haven't covered\".\n\n" +
          "## CEO — Frank Delgado\nWarm-up: What made this the right year to commission an IT strategy?\n" +
          "- The OEM contract renewal asks for real-time production visibility — what would it take for the board to feel confident committing to that?\n" +
          "- How much patience does the board have for a multi-year program, given the history here?\n" +
          "Closing: Anything about the fourth product line's IT needs we haven't covered?\n\n" +
          "## CFO — Grace Whitfield\nWarm-up: How well does today's finance/GL system serve you day to day?\n" +
          "- The GL doesn't share a customer or part master with the ERP — where does that bite hardest?\n" +
          "- What capital discipline do you want built into how IT investment is evaluated?\n" +
          "Closing: Anything about funding or governance we haven't covered?\n\n" +
          "## COO — Marta Ilić\nWarm-up: Walk me through a typical week keeping the three plants running.\n" +
          "- How exposed is harvest-season production to the plant-level spreadsheet workarounds?\n" +
          "- What would a plant manager need to trust a central system over their own spreadsheet?\n" +
          "Closing: Anything about plant operations we haven't covered?\n\n" +
          "## CIO — Priya Raman\nWarm-up: Three months in — what's your early read on the landscape?\n" +
          "- Where do you want IT to be in two years, and what's the first step toward that?\n" +
          "- (grounding) What do you most need to know about how the current ERP customizations came to be?\n" +
          "Closing: Anything about the landscape we haven't covered?\n",
      },
      { type: "activity", kind: "submit", summary: "Submitted for human review." },
    ],
    end: {
      type: "submitted",
      report: {
        summary: "Drafted a single interview guide covering all four executives, each with a distinct, remit-specific section.",
        selfCheck: [
          { criterion: "A distinct, targeted set of questions for each executive", met: "yes", note: "" },
          { criterion: "Warm-up and closing question in each section", met: "yes", note: "" },
          { criterion: "Questions surface pain points, not technology answers", met: "yes", note: "" },
          { criterion: "Suggested running order and 45-60 minute time budget", met: "yes", note: "" },
          { criterion: "Reflects a stakeholder-specific detail for each executive", met: "partial", note: "CFO section references the GL/ERP master-data gap but could cite the capital-discipline history more directly." },
        ],
        openIssues: ["CFO section may benefit from another pass referencing the CFO's past-overrun caution more directly."],
      },
    },
  },
  // stage 3: changes-requested -> publish v1.1 -> submit again
  {
    steps: [
      { type: "activity", kind: "system", summary: "Run resumed (changes-requested), same session." },
      { type: "activity", kind: "text", summary: "Applying your feedback: tightening the CFO section to reference the capital-discipline history directly." },
      { type: "activity", kind: "tool", summary: "Wrote work/draft-guide.md", tool: { name: "Write" } },
      {
        type: "publish",
        slot: "interview-guide",
        kind: "minor",
        note: "Revised the CFO section per review feedback: references past IT overruns and capital-discipline expectations directly.",
        text:
          "# Interview Guide — Acme Manufacturing IT Strategy (revised)\n\n" +
          "## CFO — Grace Whitfield\nWarm-up: How well does today's finance/GL system serve you day to day?\n" +
          "- The GL doesn't share a customer or part master with the ERP — where does that bite hardest?\n" +
          "- Past IT projects here have run over budget — what capital discipline do you want built into how this program is evaluated and gated?\n" +
          "Closing: Anything about funding or governance we haven't covered?\n\n" +
          "(CEO, COO and CIO sections unchanged from v1.0.)\n",
      },
      { type: "activity", kind: "submit", summary: "Submitted for human review." },
    ],
    end: {
      type: "submitted",
      report: {
        summary: "Revised the CFO section to reference the capital-discipline history directly, as requested.",
        selfCheck: [
          { criterion: "A distinct, targeted set of questions for each executive", met: "yes", note: "" },
          { criterion: "Warm-up and closing question in each section", met: "yes", note: "" },
          { criterion: "Questions surface pain points, not technology answers", met: "yes", note: "" },
          { criterion: "Suggested running order and 45-60 minute time budget", met: "yes", note: "" },
          { criterion: "Reflects a stakeholder-specific detail for each executive", met: "yes", note: "CFO section now references past overruns and capital discipline directly." },
        ],
        openIssues: [],
      },
    },
  },
];

const WI004_STAGES: StageDef[] = [
  // stage 0: start -> self-interrupts once (R1/R5), replays to completion on Resume
  {
    steps: [
      { type: "activity", kind: "system", summary: "Run started (start), model claude-haiku-4-5." },
      { type: "activity", kind: "tool", summary: "Read WI-003/notes-ceo v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "tool", summary: "Read WI-003/notes-cfo v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "tool", summary: "Read WI-003/notes-coo v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "tool", summary: "Read WI-003/notes-cio v1.0", tool: { name: "mcp__work__get_brief" } },
      { type: "activity", kind: "text", summary: "Identifying cross-cutting themes across the four interviews." },
      { type: "activity", kind: "tool", summary: "Wrote work/themes-draft.md", tool: { name: "Write" } },
      {
        type: "publish",
        slot: "themes",
        kind: "material",
        note: "5 cross-cutting themes with evidence quotes and source interviews.",
        text:
          "# IT Strategy Themes — Acme Manufacturing\n\n" +
          "## 1. Fourteen years of local fixes, one fragile whole\nEvery executive points at the same 14-year-old customized ERP from a different " +
          "angle: the CIO calls it \"a symptom, not the disease\" (CIO); the CFO flags the GL/ERP master-data gap; the COO points at plant spreadsheets " +
          "filling the gaps the ERP itself left. *Sources: CEO, CFO, COO, CIO.*\n\n" +
          "## 2. The board's patience is not unlimited\nThe CEO is explicit that the OEM renewal clock and the board's tolerance for another " +
          "multi-year program bound how ambitious Discovery can recommend being. *Sources: CEO, CIO.*\n\n" +
          "## 3. Capital discipline after past overruns\nThe CFO wants investment gated more tightly than the last program that ran over. " +
          "*Sources: CFO.*\n\n" +
          "## 4. Plant-level workarounds are valued and distrusted at once\nThe COO relies on the plants' own spreadsheets to hit harvest-season " +
          "peak, while flagging that they hide risk from the center — a genuine tension, not a simple 'replace them' story. *Sources: COO.*\n\n" +
          "## 5. Standard-over-customized is the CIO's emerging direction, not yet a decision\nPriya Raman leans cloud/SaaS for the ERP core " +
          "specifically to resist re-accumulating customization debt, but has asked Dev Anand to document why the last replacement attempt failed " +
          "before committing. *Sources: CIO.*\n",
      },
      { type: "activity", kind: "submit", summary: "Submitted for human review." },
    ],
    end: {
      type: "submitted",
      report: {
        summary: "Synthesized five cross-cutting themes from the four interviews, each backed by at least two sources where the topic recurred.",
        selfCheck: [
          { criterion: "Every theme is backed by at least two interviews", met: "partial", note: "Themes 3 and 5 currently cite a single interview each; could look for a second corroborating reference." },
          { criterion: "Contradictions between executives are called out explicitly", met: "yes", note: "" },
          { criterion: "Each theme has at least one direct quote and its source", met: "yes", note: "" },
          { criterion: "Themes are prioritised by business impact", met: "yes", note: "" },
        ],
        openIssues: ["Themes 3 and 5 could use a second corroborating source before the board deck stage."],
      },
    },
    autoInterruptAfterStep: 4, // after the four "read notes" tool calls, before drafting
  },
];

// ---------------------------------------------------------------------------
// engagement state
// ---------------------------------------------------------------------------

interface ItemRuntime {
  def: ItemDef;
  status: ItemStatus | null;
  activeRunId: RunId | null;
  resumable: boolean;
}

interface Eng {
  id: EngagementId;
  name: string;
  createdAt: string;
  seedId: string | null;
  planVersion: number;
  settings: Settings;
  items: Map<ItemId, ItemRuntime>;
  order: ItemId[];
  versions: Map<SlotRef, AssetVersion[]>;
  text: Map<string, string>;
  runs: Map<RunId, Run>;
  runsByItem: Map<ItemId, RunId[]>;
  activity: Map<RunId, ActivityItem[]>;
  requests: Map<RequestId, Request>;
  worklog: Map<ItemId, string[]>;
  lastReport: Map<ItemId, CompletionReport>;
  seq: number;
  runSeq: number;
  reqSeq: number;
  subs: Set<(m: WsServerMessage) => void>;
  costUsd: number;
  cancelTokens: Map<ItemId, CancelToken>;
  runProgress: Map<ItemId, { turns: number; costUsd: number; denials: number }>;
  stageIndex: Map<ItemId, number>;
  stageAttempt: Map<string, number>;
  sessionByItem: Map<ItemId, string>;
  blobUrls: Map<string, string>;
}

const engagements = new Map<EngagementId, Eng>();

function findEng(eid: EngagementId): Eng {
  const eng = engagements.get(eid);
  if (!eng) throw new ApiRequestError("not_found", `No engagement "${eid}".`);
  return eng;
}

function findItem(eng: Eng, itemId: ItemId): ItemRuntime {
  const item = eng.items.get(itemId);
  if (!item) throw new ApiRequestError("not_found", `No item "${itemId}" in engagement "${eng.id}".`);
  return item;
}

function emit(eng: Eng, msg: WsServerMessage): void {
  for (const cb of eng.subs) cb(msg);
}

const agentActorOf = (itemId: ItemId): Actor => `agent:${itemId}` as Actor;

function emitEvent(eng: Eng, actor: Actor, body: EventBody): void {
  eng.seq += 1;
  emit(eng, { type: "event", event: { seq: eng.seq, at: now(), actor, engagementId: eng.id, ...body } });
}

function emitActivity(eng: Eng, runId: RunId, itemId: ItemId, partial: Omit<ActivityItem, "idx" | "at">): ActivityItem {
  const list = eng.activity.get(runId) ?? [];
  const item: ActivityItem = { ...partial, idx: list.length, at: now() };
  list.push(item);
  eng.activity.set(runId, list);
  emit(eng, { type: "activity", runId, itemId, item });
  return item;
}

function leafRollupItems(eng: Eng): { id: ItemId; parent: ItemId | null; executor: Executor | null; status: ItemStatus | null }[] {
  return eng.order.map((id) => {
    const it = eng.items.get(id)!;
    return { id, parent: it.def.parent, executor: it.def.executor, status: it.status };
  });
}

function publish(eng: Eng, itemId: ItemId, actor: Actor, runId: RunId | null, slot: SlotName, kind: VersionKind, note: string, text: string, format = "md"): AssetVersion {
  const ref = slotRef(itemId, slot);
  const existing = eng.versions.get(ref) ?? [];
  const parts = nextVersionParts(existing, kind);
  const version: Version = formatVersion(parts.major, parts.minor);
  const av: AssetVersion = {
    slot: ref,
    version,
    major: parts.major,
    minor: parts.minor,
    kind: existing.length === 0 ? "material" : kind,
    author: actor,
    at: now(),
    note,
    runId,
    path: `items/${itemId}/assets/${slot}/v${version}.${format}`,
    format,
  };
  eng.versions.set(ref, [...existing, av]);
  eng.text.set(`${ref}@${version}`, text);
  emitEvent(eng, actor, { type: "AssetPublished", payload: { slot: ref, version, kind: av.kind, author: av.author, runId } });
  recomputeReadiness(eng, actor);
  return av;
}

function recomputeReadiness(eng: Eng, actor: Actor): void {
  const leaves = [...eng.items.values()].filter((it) => it.def.executor != null);
  const published = new Set<SlotRef>([...eng.versions.entries()].filter(([, vs]) => vs.length > 0).map(([ref]) => ref));
  const readiness = computeReadiness({
    items: leaves.map((it) => ({ id: it.def.id, executor: it.def.executor, status: it.status, inputs: it.def.inputs, sequencing: it.def.sequencing })),
    publishedSlots: published,
  });
  for (const it of leaves) {
    const r = readiness.get(it.def.id);
    if (!r) continue;
    if (it.status === "waiting" && r.ready) {
      it.status = "ready";
      emitEvent(eng, actor, { type: "ItemStatusChanged", payload: { itemId: it.def.id, from: "waiting", to: "ready" } });
      if (it.def.executor === "agent" && it.def.autostart && eng.settings.itemStart === "auto") {
        const token = new CancelToken();
        token.wait(300).then(() => {
          if (!token.cancelled) void runStage(eng, it.def.id, eng.stageIndex.get(it.def.id) ?? 0, { type: "start" });
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

function scriptsFor(itemId: ItemId): StageDef[] | null {
  if (itemId === "WI-002") return WI002_STAGES;
  if (itemId === "WI-004") return WI004_STAGES;
  return null;
}

async function runStage(eng: Eng, itemId: ItemId, stageIndex: number, fromEvent: ItemEvent): Promise<void> {
  const scripts = scriptsFor(itemId);
  const stage = scripts?.[stageIndex];
  const item = eng.items.get(itemId);
  if (!stage || !item || item.status == null) return;

  const t = applyItemEvent(item.status, fromEvent, { executor: item.def.executor! });
  if (!t.ok) return; // stale trigger (e.g. double click); silently ignore, the button was already disabled by actions
  const statusBefore = item.status;
  item.status = t.to;
  emitEvent(eng, "system", { type: "ItemStatusChanged", payload: { itemId, from: statusBefore, to: t.to } });

  const attemptKey = `${itemId}#${stageIndex}`;
  const attempt = (eng.stageAttempt.get(attemptKey) ?? 0) + 1;
  eng.stageAttempt.set(attemptKey, attempt);

  let sessionId = eng.sessionByItem.get(itemId);
  if (!sessionId) {
    sessionId = `sess-${itemId}-${eng.id}`;
    eng.sessionByItem.set(itemId, sessionId);
  }

  const reason: RunReason = fromEvent.type === "start" ? (attempt === 1 && stageIndex === 0 ? "start" : "resume") : fromEvent.type === "question_answered" ? "resume-answer" : fromEvent.type === "changes_requested" ? "changes-requested" : "resume";

  eng.runSeq += 1;
  const runId: RunId = `R-${pad(eng.runSeq)}` as RunId;
  const run: Run = {
    id: runId,
    itemId,
    sessionId,
    reason,
    outcome: null,
    model: "claude-haiku-4-5",
    costUsd: 0,
    turns: 0,
    promptHash: "mock-prompt-hash",
    startedAt: now(),
    endedAt: null,
    nudged: false,
    denials: 0,
    error: null,
  };
  eng.runs.set(runId, run);
  eng.runsByItem.set(itemId, [...(eng.runsByItem.get(itemId) ?? []), runId]);
  item.activeRunId = runId;
  item.resumable = false;
  eng.activity.set(runId, []);
  emitEvent(eng, agentActorOf(itemId), { type: "RunStarted", payload: { runId, itemId, reason, model: run.model } });

  const token = new CancelToken();
  eng.cancelTokens.set(itemId, token);
  eng.runProgress.set(itemId, { turns: 0, costUsd: 0, denials: 0 });

  for (let i = 0; i < stage.steps.length; i++) {
    await token.wait(DELAY_MS);
    if (token.cancelled) return; // stopItem() already finalized the run as interrupted

    const step = stage.steps[i]!;
    if (step.type === "activity") {
      emitActivity(eng, runId, itemId, { kind: step.kind, summary: step.summary, detail: step.detail, tool: step.tool, agentId: undefined });
      const progress = eng.runProgress.get(itemId)!;
      progress.turns += 1;
      progress.costUsd += 0.0015;
      if (step.kind === "denial") progress.denials += 1;
    } else {
      const av = publish(eng, itemId, agentActorOf(itemId), runId, step.slot, step.kind, step.note, step.text);
      emitActivity(eng, runId, itemId, { kind: "publish", summary: `Published ${step.slot} v${av.version} (${av.kind})`, agentId: undefined });
      const entries = eng.worklog.get(itemId) ?? [];
      entries.push(`**${now()}** — Published \`${step.slot}\` v${av.version}: ${step.note}`);
      eng.worklog.set(itemId, entries);
      emitEvent(eng, agentActorOf(itemId), { type: "WorklogAppended", payload: { itemId, entry: step.note } });
      const progress = eng.runProgress.get(itemId)!;
      progress.turns += 1;
      progress.costUsd += 0.003;
    }

    if (attempt === 1 && stage.autoInterruptAfterStep === i) {
      finalizeInterrupted(eng, itemId, runId);
      return;
    }
  }

  const progress = eng.runProgress.get(itemId)!;
  eng.cancelTokens.delete(itemId);
  eng.runProgress.delete(itemId);
  eng.stageIndex.set(itemId, stageIndex + 1);

  if (stage.end.type === "submitted") {
    run.turns = progress.turns;
    run.costUsd = progress.costUsd;
    run.denials = progress.denials;
    run.endedAt = now();
    run.outcome = "submitted";
    eng.costUsd += run.costUsd;
    item.activeRunId = null;
    const hasGateChain = item.def.gate.length > 0;
    const tr = applyItemEvent(item.status, { type: "run_ended", outcome: "submitted" }, { executor: item.def.executor!, hasGateChain });
    if (tr.ok) item.status = tr.to;
    eng.lastReport.set(itemId, stage.end.report);
    emitActivity(eng, runId, itemId, { kind: "result", summary: `Run ended: submitted after ${run.turns} turns ($${run.costUsd.toFixed(3)}).`, costUsd: eng.costUsd });
    emitEvent(eng, agentActorOf(itemId), { type: "RunEnded", payload: { runId, itemId, outcome: "submitted", costUsd: run.costUsd, turns: run.turns } });
    if (hasGateChain) {
      const versions = item.def.outputs.map((o) => {
        const vs = eng.versions.get(slotRef(itemId, o.slot)) ?? [];
        return { slot: slotRef(itemId, o.slot), version: vs.at(-1)!.version };
      });
      openRequest(eng, {
        type: "gate_request",
        from: agentActorOf(itemId),
        to: "human",
        itemId,
        runId,
        blocking: false,
        payload: { step: 0, gateType: "human-review", submitted: versions, report: stage.end.report },
      });
    }
  } else if (stage.end.type === "question") {
    run.turns = progress.turns;
    run.costUsd = progress.costUsd;
    run.denials = progress.denials;
    run.endedAt = now();
    run.outcome = "blocked";
    eng.costUsd += run.costUsd;
    item.activeRunId = null;
    const tr = applyItemEvent(item.status, { type: "run_ended", outcome: "blocked" }, { executor: item.def.executor! });
    if (tr.ok) item.status = tr.to;
    emitActivity(eng, runId, itemId, { kind: "question", summary: `Raised a ${stage.end.blocking ? "blocking" : "non-blocking"} question: ${stage.end.question}` });
    emitActivity(eng, runId, itemId, { kind: "result", summary: `Run ended: blocked on a question after ${run.turns} turns ($${run.costUsd.toFixed(3)}).`, costUsd: eng.costUsd });
    emitEvent(eng, agentActorOf(itemId), { type: "RunEnded", payload: { runId, itemId, outcome: "blocked", costUsd: run.costUsd, turns: run.turns } });
    openRequest(eng, {
      type: "question",
      from: agentActorOf(itemId),
      to: "human",
      itemId,
      runId,
      blocking: stage.end.blocking,
      payload: { question: stage.end.question, hypothesis: stage.end.hypothesis, alternatives: stage.end.alternatives },
    });
  } else {
    // run-issue: one nudge, then end (R3)
    if (stage.end.nudged) {
      emitActivity(eng, runId, itemId, { kind: "nudge", summary: "Nudged: the run ended without submit_outputs or a blocking question." });
      run.nudged = true;
    }
    run.turns = progress.turns;
    run.costUsd = progress.costUsd;
    run.denials = progress.denials;
    run.endedAt = now();
    run.outcome = stage.end.reason;
    run.error = stage.end.reason === "error" ? stage.end.lastMessage : null;
    eng.costUsd += run.costUsd;
    item.activeRunId = null;
    const tr = applyItemEvent(item.status, { type: "run_ended", outcome: stage.end.reason }, { executor: item.def.executor! });
    if (tr.ok) item.status = tr.to;
    emitActivity(eng, runId, itemId, { kind: "result", summary: `Run ended: ${stage.end.reason} after ${run.turns} turns ($${run.costUsd.toFixed(3)}).`, costUsd: eng.costUsd });
    emitEvent(eng, agentActorOf(itemId), { type: "RunEnded", payload: { runId, itemId, outcome: stage.end.reason, costUsd: run.costUsd, turns: run.turns } });
    openRequest(eng, {
      type: "run_issue",
      from: agentActorOf(itemId),
      to: "human",
      itemId,
      runId,
      blocking: true,
      payload: { runId, reason: stage.end.reason, lastMessage: stage.end.lastMessage },
    });
  }
}

function finalizeInterrupted(eng: Eng, itemId: ItemId, runId: RunId): void {
  const item = eng.items.get(itemId)!;
  const run = eng.runs.get(runId)!;
  const progress = eng.runProgress.get(itemId) ?? { turns: 0, costUsd: 0, denials: 0 };
  eng.cancelTokens.delete(itemId);
  eng.runProgress.delete(itemId);
  run.turns = progress.turns;
  run.costUsd = progress.costUsd;
  run.denials = progress.denials;
  run.endedAt = now();
  run.outcome = "interrupted";
  eng.costUsd += run.costUsd;
  item.activeRunId = null;
  const tr = applyItemEvent(item.status!, { type: "run_ended", outcome: "interrupted" }, { executor: item.def.executor! });
  if (tr.ok) item.status = tr.to;
  item.resumable = true;
  emitActivity(eng, runId, itemId, { kind: "system", summary: "Run interrupted (server restart simulated). Resumable — the session is kept." });
  emitEvent(eng, "system", { type: "RunEnded", payload: { runId, itemId, outcome: "interrupted", costUsd: run.costUsd, turns: run.turns } });
}

function openRequest(eng: Eng, req: Omit<Request, "id" | "status" | "response" | "createdAt" | "resolvedAt">): RequestId {
  eng.reqSeq += 1;
  const id: RequestId = `RQ-${pad(eng.reqSeq)}` as RequestId;
  const full = { ...req, id, status: "open", response: null, createdAt: now(), resolvedAt: null } as Request;
  eng.requests.set(id, full);
  emitEvent(eng, req.from, { type: "RequestOpened", payload: { requestId: id, type: req.type, itemId: req.itemId, to: req.to } });
  return id;
}

function resolveRequest(eng: Eng, rid: RequestId, response: NonNullable<Request["response"]>): Request {
  const req = eng.requests.get(rid);
  if (!req) throw new ApiRequestError("not_found", `No request "${rid}".`);
  if (req.status !== "open") throw new ApiRequestError("conflict", `Request "${rid}" is already ${req.status}.`);
  const resolved = { ...req, status: "answered", response, resolvedAt: now() } as Request;
  eng.requests.set(rid, resolved);
  emitEvent(eng, response.by, { type: "RequestResolved", payload: { requestId: rid, type: req.type, itemId: req.itemId, summary: response.kind } });
  return resolved;
}

// ---------------------------------------------------------------------------
// view builders
// ---------------------------------------------------------------------------

function toSummary(eng: Eng): EngagementSummary {
  return { id: eng.id, name: eng.name, createdAt: eng.createdAt, seedId: eng.seedId, planVersion: eng.planVersion, costUsd: eng.costUsd };
}

function itemActionState(eng: Eng, item: ItemRuntime) {
  const allRequired = item.def.outputs.filter((o) => o.required).every((o) => (eng.versions.get(slotRef(item.def.id, o.slot))?.length ?? 0) > 0);
  return computeItemActions({
    executor: item.def.executor,
    status: item.status,
    hasActiveRun: item.activeRunId != null,
    resumable: item.resumable,
    allRequiredOutputsPublished: allRequired,
  });
}

function buildItemNode(eng: Eng, id: ItemId): ItemNode {
  const item = findItem(eng, id);
  const isComposite = item.def.executor == null;
  let notReadyBecause: ItemNode["notReadyBecause"] = [];
  if (item.status === "waiting") {
    const leaves = [...eng.items.values()].filter((it) => it.def.executor != null);
    const published = new Set<SlotRef>([...eng.versions.entries()].filter(([, vs]) => vs.length > 0).map(([ref]) => ref));
    const r = computeReadiness({
      items: leaves.map((it) => ({ id: it.def.id, executor: it.def.executor, status: it.status, inputs: it.def.inputs, sequencing: it.def.sequencing })),
      publishedSlots: published,
    }).get(id);
    notReadyBecause = r?.blockers ?? [];
  }
  return {
    id,
    title: item.def.title,
    kind: id === "ENG" ? "engagement" : isComposite ? "composite" : "task",
    parent: item.def.parent,
    order: item.def.order,
    executor: item.def.executor,
    status: item.status,
    rollup: isComposite ? rollupFor(leafRollupItems(eng), id) : null,
    gate: item.def.gate,
    inputs: item.def.inputs,
    outputs: item.def.outputs.map((o) => slotRef(id, o.slot)),
    notReadyBecause,
    activeRunId: item.activeRunId,
    resumable: item.resumable,
  };
}

function buildSlotNode(eng: Eng, ownerId: ItemId, out: ItemDef["outputs"][number]): SlotNode {
  const ref = slotRef(ownerId, out.slot);
  const versions = eng.versions.get(ref) ?? [];
  const consumers = [...eng.items.values()].filter((it) => it.def.inputs.some((i) => i.slot === ref)).map((it) => it.def.id);
  return { ref, owner: ownerId, name: out.slot, format: out.format, scope: out.scope, description: out.description, required: out.required, latest: versions.at(-1) ?? null, versionCount: versions.length, consumers };
}

function buildPlan(eng: Eng): PlanView {
  const items = eng.order.map((id) => buildItemNode(eng, id));
  const slots: SlotNode[] = [];
  for (const id of eng.order) {
    const item = findItem(eng, id);
    for (const out of item.def.outputs) slots.push(buildSlotNode(eng, id, out));
  }
  return { engagementId: eng.id, planVersion: eng.planVersion, items, slots };
}

function buildItemDetail(eng: Eng, id: ItemId): ItemDetailView {
  const item = findItem(eng, id);
  const node = buildItemNode(eng, id);
  const inputs = item.def.inputs.map((inp) => {
    const { itemId: producer, slot } = parseSlotRef(inp.slot);
    const producerDef = eng.items.get(producer)?.def;
    const out = producerDef?.outputs.find((o) => o.slot === slot);
    const versions = eng.versions.get(inp.slot) ?? [];
    const available = inp.pin ? (versions.find((v) => v.version === inp.pin) ?? null) : (versions.at(-1) ?? null);
    return { slot: inp.slot, required: inp.required, producer, description: out?.description ?? "", available };
  });
  const outputs = item.def.outputs.map((o) => ({ ...o, slotRef: slotRef(id, o.slot), versions: eng.versions.get(slotRef(id, o.slot)) ?? [] }));
  const runIds = eng.runsByItem.get(id) ?? [];
  const runs = runIds.map((rid) => eng.runs.get(rid)!).slice().reverse();
  const activeRun = item.activeRunId ? (eng.runs.get(item.activeRunId) ?? null) : null;
  const openRequests = [...eng.requests.values()].filter((r) => r.itemId === id && r.status === "open");
  const lastReport = eng.lastReport.get(id) ?? null;
  const actions: ItemActions = itemActionState(eng, item);
  return { node, def: item.def, inputs, outputs, runs, activeRun, openRequests, lastReport, actions };
}

function buildInbox(eng: Eng): InboxView {
  const entries: InboxEntry[] = [];
  for (const req of eng.requests.values()) {
    if (req.status !== "open") continue;
    const item = eng.items.get(req.itemId)!;
    const ref = { id: req.itemId, title: item.def.title };
    if (req.type === "question") entries.push({ kind: "question", request: req, item: ref });
    else if (req.type === "gate_request") entries.push({ kind: "review", request: req, item: ref });
    else if (req.type === "run_issue") entries.push({ kind: "run_issue", request: req, item: ref });
  }
  for (const item of eng.items.values()) {
    if (item.def.executor !== "human") continue;
    if (item.status !== "ready" && item.status !== "in_progress") continue;
    const inputs = item.def.inputs.map((inp) => ({ slot: inp.slot, required: inp.required, available: (eng.versions.get(inp.slot) ?? []).at(-1) ?? null }));
    const outputs = item.def.outputs.map((o) => ({ slot: o.slot, slotRef: slotRef(item.def.id, o.slot), required: o.required, format: o.format, latest: (eng.versions.get(slotRef(item.def.id, o.slot)) ?? []).at(-1) ?? null }));
    const actions = itemActionState(eng, item);
    entries.push({ kind: "human_item", item: { id: item.def.id, title: item.def.title }, status: item.status, inputs, outputs, markDone: actions.markDone });
  }
  return { entries };
}

// ---------------------------------------------------------------------------
// engagement creation
// ---------------------------------------------------------------------------

function createEngagementInternal(seedId: string, name: string): EngagementSummary {
  const seed = SEED_SUMMARIES.find((s) => s.id === seedId);
  if (!seed) throw new ApiRequestError("not_found", `No seed "${seedId}".`);

  let id = slugify(name || seed.engagementName);
  let n = 2;
  while (engagements.has(id)) {
    id = `${slugify(name || seed.engagementName)}-${n}`;
    n += 1;
  }

  const items = new Map<ItemId, ItemRuntime>();
  const order: ItemId[] = [];
  for (const def of ACME_ITEMS) {
    items.set(def.id, { def, status: initialStatus(def), activeRunId: null, resumable: false });
    order.push(def.id);
  }

  const eng: Eng = {
    id,
    name: name || seed.engagementName,
    createdAt: now(),
    seedId,
    planVersion: 1,
    settings: { questionHandling: "always-human", itemStart: "auto", readPolicy: "project-with-tracking" },
    items,
    order,
    versions: new Map(),
    text: new Map(),
    runs: new Map(),
    runsByItem: new Map(),
    activity: new Map(),
    requests: new Map(),
    worklog: new Map(),
    lastReport: new Map(),
    seq: 0,
    runSeq: 0,
    reqSeq: 0,
    subs: new Set(),
    costUsd: 0,
    cancelTokens: new Map(),
    runProgress: new Map(),
    stageIndex: new Map(),
    stageAttempt: new Map(),
    sessionByItem: new Map(),
    blobUrls: new Map(),
  };
  engagements.set(id, eng);
  emitEvent(eng, "human", { type: "EngagementCreated", payload: { name: eng.name, seedId } });

  publish(eng, "ENG", "human", null, "context", "material", "From seed acme-discovery", ACME_CONTEXT_MD);
  publish(eng, "ENG", "human", null, "stakeholders", "material", "From seed acme-discovery", ACME_STAKEHOLDERS_MD);

  return toSummary(eng);
}

// ---------------------------------------------------------------------------
// the WorkbenchApi surface (see ../index.ts for the exported object)
// ---------------------------------------------------------------------------

export const mockBackend = {
  listSeeds: async (): Promise<SeedSummary[]> => SEED_SUMMARIES.map((s) => ({ ...s })),

  listEngagements: async (): Promise<EngagementSummary[]> => [...engagements.values()].map(toSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

  createEngagement: async (body: { seedId: string; name: string }): Promise<EngagementSummary> => createEngagementInternal(body.seedId, body.name),

  getEngagement: async (eid: EngagementId): Promise<EngagementView> => {
    const eng = findEng(eid);
    return { ...toSummary(eng), settings: eng.settings, folderPath: `workspace\\engagements\\${eng.id}`, runtime: "fake", profile: "test", workModel: "claude-haiku-4-5", inboxCount: buildInbox(eng).entries.length };
  },

  getPlan: async (eid: EngagementId): Promise<PlanView> => buildPlan(findEng(eid)),

  getItem: async (eid: EngagementId, itemId: ItemId): Promise<ItemDetailView> => buildItemDetail(findEng(eid), itemId),

  editItem: async (eid: EngagementId, itemId: ItemId, body: { brief?: string; acceptance?: string[] }): Promise<ItemDetailView> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.edit.allowed) throw new ApiRequestError("illegal_transition", actions.edit.reason ?? "Editing is not allowed right now.");
    const fields: string[] = [];
    if (body.brief !== undefined) {
      item.def = { ...item.def, brief: body.brief };
      fields.push("brief");
    }
    if (body.acceptance !== undefined) {
      item.def = { ...item.def, acceptance: body.acceptance };
      fields.push("acceptance");
    }
    emitEvent(eng, "human", { type: "ItemEdited", payload: { itemId, fields } });
    return buildItemDetail(eng, itemId);
  },

  startItem: async (eid: EngagementId, itemId: ItemId): Promise<Run> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.start.allowed) throw new ApiRequestError("illegal_transition", actions.start.reason ?? "Cannot start.");
    void runStage(eng, itemId, eng.stageIndex.get(itemId) ?? 0, { type: "start" });
    await new Promise((r) => setTimeout(r, 0));
    return eng.runs.get(item.activeRunId!)!;
  },

  stopItem: async (eid: EngagementId, itemId: ItemId): Promise<{ ok: true }> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.stop.allowed) throw new ApiRequestError("illegal_transition", actions.stop.reason ?? "Cannot stop.");
    const token = eng.cancelTokens.get(itemId);
    const runId = item.activeRunId!;
    token?.cancel();
    finalizeInterrupted(eng, itemId, runId);
    return { ok: true };
  },

  resumeItem: async (eid: EngagementId, itemId: ItemId): Promise<Run> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.resume.allowed) throw new ApiRequestError("illegal_transition", actions.resume.reason ?? "Cannot resume.");
    void runStage(eng, itemId, eng.stageIndex.get(itemId) ?? 0, { type: "start" });
    await new Promise((r) => setTimeout(r, 0));
    return eng.runs.get(item.activeRunId!)!;
  },

  getWorklog: async (eid: EngagementId, itemId: ItemId): Promise<WorklogView> => {
    const eng = findEng(eid);
    findItem(eng, itemId);
    return { itemId, markdown: (eng.worklog.get(itemId) ?? []).join("\n\n") || "_No worklog entries yet._" };
  },

  getRunActivity: async (eid: EngagementId, runId: RunId): Promise<RunActivityView> => {
    const eng = findEng(eid);
    const run = eng.runs.get(runId);
    if (!run) throw new ApiRequestError("not_found", `No run "${runId}".`);
    return { run, activity: eng.activity.get(runId) ?? [] };
  },

  uploadOutput: async (eid: EngagementId, itemId: ItemId, slot: SlotName, file: File): Promise<AssetVersion> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.upload.allowed) throw new ApiRequestError("illegal_transition", actions.upload.reason ?? "Cannot upload.");
    const out = item.def.outputs.find((o) => o.slot === slot);
    if (!out) throw new ApiRequestError("invalid", `"${slot}" is not an output slot of ${itemId}.`);
    if (!/\.md$/i.test(file.name)) throw new ApiRequestError("invalid", "Only Markdown (.md) files are accepted for this slot.");
    const text = await file.text();
    const av = publish(eng, itemId, "human", null, slot, "minor", `Uploaded ${file.name}`, text, out.format);
    const tr = applyItemEvent(item.status!, { type: "human_upload" }, { executor: "human" });
    if (tr.ok) item.status = tr.to;
    if (tr.ok) emitEvent(eng, "human", { type: "ItemStatusChanged", payload: { itemId, from: "ready", to: tr.to } });
    return av;
  },

  markDone: async (eid: EngagementId, itemId: ItemId): Promise<ItemDetailView> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const actions = itemActionState(eng, item);
    if (!actions.markDone.allowed) throw new ApiRequestError("illegal_transition", actions.markDone.reason ?? "Cannot mark done.");
    const tr = applyItemEvent(item.status!, { type: "mark_done" }, { executor: "human", allRequiredOutputsPublished: true });
    if (tr.ok) item.status = tr.to;
    emitEvent(eng, "human", { type: "ItemStatusChanged", payload: { itemId, from: "in_progress", to: "done" } });
    recomputeReadiness(eng, "human");
    return buildItemDetail(eng, itemId);
  },

  getAssetVersions: async (eid: EngagementId, itemId: ItemId, slot: SlotName): Promise<AssetVersionsView> => {
    const eng = findEng(eid);
    const item = findItem(eng, itemId);
    const out = item.def.outputs.find((o) => o.slot === slot);
    if (!out) throw new ApiRequestError("not_found", `No slot "${slot}" on ${itemId}.`);
    const ref = slotRef(itemId, slot);
    const versions = [...(eng.versions.get(ref) ?? [])].reverse();
    return { slot: ref, owner: itemId, format: out.format, scope: out.scope, description: out.description, versions };
  },

  getAssetVersion: async (eid: EngagementId, itemId: ItemId, slot: SlotName, version: Version): Promise<AssetContentView> => {
    const eng = findEng(eid);
    const ref = slotRef(itemId, slot);
    const versions = eng.versions.get(ref) ?? [];
    const v = versions.find((x) => x.version === version);
    if (!v) throw new ApiRequestError("not_found", `No version ${version} for ${ref}.`);
    return { version: v, text: eng.text.get(`${ref}@${version}`) ?? null };
  },

  getAssetRawUrl: (eid: EngagementId, itemId: ItemId, slot: SlotName, version: Version): string => {
    const eng = engagements.get(eid);
    if (!eng) return "#";
    const ref = slotRef(itemId, slot);
    const key = `${ref}@${version}`;
    const cached = eng.blobUrls.get(key);
    if (cached) return cached;
    const text = eng.text.get(key);
    if (text == null) return "#";
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    eng.blobUrls.set(key, url);
    return url;
  },

  getInbox: async (eid: EngagementId): Promise<InboxView> => buildInbox(findEng(eid)),

  answerQuestion: async (eid: EngagementId, rid: RequestId, body: { mode: "approve" | "amend" | "replace"; text: string }): Promise<Request> => {
    const eng = findEng(eid);
    const req = eng.requests.get(rid);
    if (!req || req.type !== "question") throw new ApiRequestError("not_found", `No open question "${rid}".`);
    const resolved = resolveRequest(eng, rid, { kind: "answer", mode: body.mode, text: body.text, by: "human", at: now() });
    void runStage(eng, req.itemId, eng.stageIndex.get(req.itemId) ?? 0, { type: "question_answered" });
    return resolved;
  },

  recordVerdict: async (eid: EngagementId, rid: RequestId, body: { verdict: "approved" | "changes_requested"; comments: string }): Promise<Request> => {
    const eng = findEng(eid);
    const req = eng.requests.get(rid);
    if (!req || req.type !== "gate_request") throw new ApiRequestError("not_found", `No open review "${rid}".`);
    const item = findItem(eng, req.itemId);
    const resolved = resolveRequest(eng, rid, { kind: "verdict", verdict: body.verdict, comments: body.comments, by: "human", at: now() });
    emitEvent(eng, "human", { type: "GateVerdictRecorded", payload: { itemId: req.itemId, requestId: rid, verdict: body.verdict, versions: req.payload.submitted } });
    if (body.verdict === "approved") {
      const tr = applyItemEvent(item.status!, { type: "gate_approved" }, { executor: item.def.executor!, isLastGateStep: true });
      if (tr.ok) item.status = tr.to;
      if (tr.ok) emitEvent(eng, "human", { type: "ItemStatusChanged", payload: { itemId: req.itemId, from: "at_gate", to: tr.to } });
      recomputeReadiness(eng, "human");
    } else {
      void runStage(eng, req.itemId, eng.stageIndex.get(req.itemId) ?? 0, { type: "changes_requested" });
    }
    return resolved;
  },

  resolveRunIssue: async (eid: EngagementId, rid: RequestId, body: { action: "retry" | "stop" }): Promise<Request> => {
    const eng = findEng(eid);
    const req = eng.requests.get(rid);
    if (!req || req.type !== "run_issue") throw new ApiRequestError("not_found", `No open run issue "${rid}".`);
    const item = findItem(eng, req.itemId);
    const resolved = resolveRequest(eng, rid, { kind: "issue", action: body.action, by: "human", at: now() });
    if (body.action === "retry") {
      void runStage(eng, req.itemId, eng.stageIndex.get(req.itemId) ?? 0, { type: "issue_retry" });
    } else {
      const tr = applyItemEvent(item.status!, { type: "issue_stop" }, { executor: item.def.executor! });
      if (tr.ok) item.status = tr.to;
      if (tr.ok) emitEvent(eng, "human", { type: "ItemStatusChanged", payload: { itemId: req.itemId, from: "blocked", to: tr.to } });
    }
    return resolved;
  },

  openFolder: async (eid: EngagementId, itemId?: ItemId): Promise<{ path: string }> => {
    const eng = findEng(eid);
    return { path: itemId ? `workspace\\engagements\\${eng.id}\\items\\${itemId}` : `workspace\\engagements\\${eng.id}` };
  },

  addFeedback: async (eid: EngagementId, body: { note: string; view: string; itemId: ItemId | null }): Promise<{ ok: true }> => {
    const eng = findEng(eid);
    emitEvent(eng, "human", { type: "FeedbackNoted", payload: { note: body.note, view: body.view, itemId: body.itemId } });
    return { ok: true };
  },

  connectWs: (eid: EngagementId, onMessage: (msg: WsServerMessage) => void, onStatus: (status: WsStatus) => void): (() => void) => {
    onStatus("connecting");
    let closed = false;
    const t = setTimeout(() => {
      if (closed) return;
      const eng = engagements.get(eid);
      onStatus("open");
      onMessage({ type: "hello", engagementId: eid, lastSeq: eng?.seq ?? 0 });
      if (eng) eng.subs.add(onMessage);
    }, 30);
    return () => {
      closed = true;
      clearTimeout(t);
      engagements.get(eid)?.subs.delete(onMessage);
    };
  },
};

/** Test-only: clears all mock engagement state between Vitest cases. */
export function __resetMockBackend(): void {
  engagements.clear();
}
