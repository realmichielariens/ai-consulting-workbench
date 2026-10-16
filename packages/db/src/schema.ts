// Engagement DB schema, I1 subset of ARCHITECTURE.md §6.2. Owned by the main
// session; W3 generates the migrations and writes the repositories.
//
// Conventions: timestamps are epoch ms (INTEGER), JSON columns are TEXT holding
// JSON validated by the Zod schemas in @workbench/core, booleans are INTEGER 0/1.
// I2 adds proposals, threads, chat_messages, notifications and a minimal
// agenda_items (bottom of this file). Decisions and FTS arrive in later iterations.

import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Key/value metadata: plan_version, next_run_seq, next_request_seq, … */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Index of item.md definitions plus authoritative status. The definition columns can
 * always be rebuilt from the files (reconciliation at startup); `status` cannot.
 */
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    parent: text("parent"),
    ord: integer("ord").notNull().default(0),
    kind: text("kind").notNull(), // engagement | composite | task
    executor: text("executor"), // agent | human | null
    title: text("title").notNull(),
    /** null for composites and ENG. */
    status: text("status"),
    autostart: integer("autostart", { mode: "boolean" }).notNull().default(true),
    /** JSON GateStep[] */
    gate: text("gate").notNull().default("[]"),
    /** JSON string[] */
    skills: text("skills").notNull().default("[]"),
    /** Hash of the parsed item.md; reconciliation compares it with the file. */
    defHash: text("def_hash").notNull(),
    /** Session to resume for resume-answer / changes-requested / resume. */
    lastSessionId: text("last_session_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("items_parent").on(t.parent)],
);

export const itemInputs = sqliteTable(
  "item_inputs",
  {
    itemId: text("item_id").notNull(),
    slotRef: text("slot_ref").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    pin: text("pin"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.slotRef] }), index("item_inputs_slot").on(t.slotRef)],
);

export const itemOutputs = sqliteTable(
  "item_outputs",
  {
    itemId: text("item_id").notNull(),
    slot: text("slot").notNull(),
    slotRef: text("slot_ref").notNull().unique(),
    format: text("format").notNull(),
    scope: text("scope").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    description: text("description").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.slot] })],
);

export const itemSequencing = sqliteTable(
  "item_sequencing",
  {
    itemId: text("item_id").notNull(),
    afterItemId: text("after_item_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.afterItemId] })],
);

/** Version registry. Content lives in the immutable file at `path`. */
export const assetVersions = sqliteTable(
  "asset_versions",
  {
    slotRef: text("slot_ref").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    kind: text("kind").notNull(), // minor | material
    author: text("author").notNull(),
    at: integer("at").notNull(),
    note: text("note").notNull().default(""),
    runId: text("run_id"),
    /** Engagement-relative, forward slashes. */
    path: text("path").notNull(),
    format: text("format").notNull(),
  },
  (t) => [primaryKey({ columns: [t.slotRef, t.major, t.minor] })],
);

/** Pins (declared, at run start) and implicit reads (PostToolUse). Staleness uses this from I4. */
export const consumptions = sqliteTable(
  "consumptions",
  {
    runId: text("run_id").notNull(),
    slotRef: text("slot_ref").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    mode: text("mode").notNull(), // declared | implicit | library
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.slotRef, t.major, t.minor, t.mode] })],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(), // R-0001
    itemId: text("item_id").notNull(),
    sessionId: text("session_id"),
    reason: text("reason").notNull(),
    outcome: text("outcome"), // null while active
    runtime: text("runtime").notNull(), // real | fake
    model: text("model").notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    promptHash: text("prompt_hash"),
    nudged: integer("nudged", { mode: "boolean" }).notNull().default(false),
    denials: integer("denials").notNull().default(0),
    error: text("error"),
    /** JSON CompletionReport, when the run submitted. */
    report: text("report"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (t) => [index("runs_item").on(t.itemId)],
);

/** Requests between actors (ARCHITECTURE.md §9). I1: question, gate_request, run_issue. */
export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(), // RQ-0001
    type: text("type").notNull(),
    fromActor: text("from_actor").notNull(),
    toActor: text("to_actor").notNull(),
    itemId: text("item_id").notNull(),
    runId: text("run_id"),
    status: text("status").notNull(),
    blocking: integer("blocking", { mode: "boolean" }).notNull(),
    /** JSON, validated by the payload schema for `type`. */
    payload: text("payload").notNull(),
    /** JSON RequestResponse */
    response: text("response"),
    agendaId: text("agenda_id"),
    threadId: text("thread_id"),
    /** I2: where the request was first routed (approach | human); `to_actor` is the current addressee. */
    routedTo: text("routed_to").notNull().default("human"),
    /** I2: JSON Escalation, set when the Approach Agent escalated a question. */
    escalation: text("escalation"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("requests_item").on(t.itemId), index("requests_open").on(t.status, t.toActor)],
);

/**
 * Gate chain state per submission round. A changes-requested verdict closes the round;
 * the next submit opens round + 1. I1 chains have one step (seq 0).
 */
export const gateSteps = sqliteTable(
  "gate_steps",
  {
    itemId: text("item_id").notNull(),
    round: integer("round").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(), // pending | open | passed | changes_requested
    requestId: text("request_id"),
    /** JSON SlotVersionRef[]: the versions under review. */
    assetVersions: text("asset_versions").notNull(),
    verdict: text("verdict"),
    by: text("by"),
    decisionId: text("decision_id"),
    at: integer("at"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.round, t.seq] })],
);

/**
 * Session leases (ARCHITECTURE.md §8.4). Keyed by scope_key rather than session id,
 * because the lease is taken before a new session has an id. Acquire with
 * BEGIN IMMEDIATE + conditional upsert (lease_until < now), as validated in M0 S8.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    scopeKey: text("scope_key").primaryKey(), // work:WI-004
    role: text("role").notNull(), // work (aa-* from I2)
    holder: text("holder"), // run id holding the lease
    sessionId: text("session_id"),
    leaseUntil: integer("lease_until"),
    /** Claude Code child PID, for the orphan cleanup at startup (R2). */
    pid: integer("pid"),
    status: text("status").notNull().default("idle"), // idle | active | interrupted
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_holder").on(t.holder)],
);

/** Append-only event log (events.ts). */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    /** JSON event payload */
    payload: text("payload").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("events_type").on(t.type)],
);

// ---------------------------------------------------------------------------
// I2: proposals, the conversation, notifications, a minimal agenda
// ---------------------------------------------------------------------------

/** Plan-change proposals (domain.ts Proposal). Optimistic concurrency via base_plan_version (A§7.4). */
export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(), // P-0001
    origin: text("origin").notNull(), // conversation | suggestion
    suggestedBy: text("suggested_by"),
    requestId: text("request_id"),
    threadId: text("thread_id"),
    author: text("author").notNull(),
    status: text("status").notNull(), // pending | approved | rejected | superseded
    basePlanVersion: integer("base_plan_version").notNull(),
    rationale: text("rationale").notNull(),
    /** JSON PlanOp[] */
    ops: text("ops").notNull(),
    appliedPlanVersion: integer("applied_plan_version"),
    rejectReason: text("reject_reason"),
    supersededBy: text("superseded_by"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("proposals_status").on(t.status)],
);

/** Conversation threads with the Approach Agent. I2 has one, T-0001. */
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(), // T-0001
  subject: text("subject").notNull(),
  sessionId: text("session_id"),
  /** Event seq at the end of the last turn ("Since your last turn:"). */
  lastSeenSeq: integer("last_seen_seq").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(), // M-0001
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(), // human | approach | system
    body: text("body").notNull(),
    runId: text("run_id"),
    proposalId: text("proposal_id"),
    /** JSON {slot, version} */
    asset: text("asset"),
    at: integer("at").notNull(),
  },
  (t) => [index("chat_messages_thread").on(t.threadId, t.at)],
);

/** FYI entries in the Inbox (notify_human, answers given by the Approach Agent). */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(), // N-0001
    fromActor: text("from_actor").notNull(),
    text: text("text").notNull(),
    itemId: text("item_id"),
    requestId: text("request_id"),
    createdAt: integer("created_at").notNull(),
    dismissedAt: integer("dismissed_at"),
  },
  (t) => [index("notifications_open").on(t.dismissedAt)],
);

/** Minimal agenda (I2): a routed question gets a row; behaviour and the board arrive in I5. */
export const agendaItems = sqliteTable("agenda_items", {
  id: text("id").primaryKey(), // A-0001
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  /** JSON {items, requests, proposals} */
  links: text("links").notNull(),
  resolution: text("resolution"),
  createdAt: integer("created_at").notNull(),
});
