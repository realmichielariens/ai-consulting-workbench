// Conversation threads with the Approach Agent and their chat messages (I2,
// domain.ts Thread/ChatMessage, schema.ts `threads`/`chat_messages`). I2 has
// exactly one thread, T-0001, created lazily on an I1 engagement's first turn.

import { asc, eq } from "drizzle-orm";
import { ChatMessage, Thread, type ChatRole, type IsoTime, type MessageId, type ProposalId, type RunId, type ThreadId, type Version, type SlotRef } from "@workbench/core";
import type { Db } from "../client.js";
import { chatMessages, threads } from "../schema.js";
import { toEpochMs, toIsoTime } from "../mappers.js";

function mapThreadRow(row: typeof threads.$inferSelect): Thread {
  return Thread.parse({
    id: row.id,
    subject: row.subject,
    createdAt: toIsoTime(row.createdAt),
    sessionId: row.sessionId,
    lastSeenSeq: row.lastSeenSeq,
  });
}

export interface CreateThreadInput {
  id: ThreadId;
  subject: string;
  createdAt: IsoTime;
}

export function createThread(ctx: Db, input: CreateThreadInput): Thread {
  ctx.db.insert(threads).values({ id: input.id, subject: input.subject, sessionId: null, lastSeenSeq: 0, createdAt: toEpochMs(input.createdAt) }).run();
  const row = getThread(ctx, input.id);
  if (!row) throw new Error(`createThread: row for ${input.id} vanished after insert`);
  return row;
}

export function getThread(ctx: Db, id: ThreadId): Thread | null {
  const row = ctx.db.select().from(threads).where(eq(threads.id, id)).get();
  return row ? mapThreadRow(row) : null;
}

export function listThreads(ctx: Db): Thread[] {
  return ctx.db.select().from(threads).all().map(mapThreadRow);
}

export function setSessionId(ctx: Db, id: ThreadId, sessionId: string): void {
  ctx.db.update(threads).set({ sessionId }).where(eq(threads.id, id)).run();
}

/** Called at the end of a turn: the next turn's "Since your last turn:" starts after this seq. */
export function setLastSeenSeq(ctx: Db, id: ThreadId, seq: number): void {
  ctx.db.update(threads).set({ lastSeenSeq: seq }).where(eq(threads.id, id)).run();
}

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------

function mapMessageRow(row: typeof chatMessages.$inferSelect): ChatMessage {
  const asset = row.asset == null ? null : (JSON.parse(row.asset) as { slot: SlotRef; version: Version });
  return ChatMessage.parse({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    body: row.body,
    at: toIsoTime(row.at),
    runId: row.runId,
    proposalId: row.proposalId,
    asset,
  });
}

export interface CreateChatMessageInput {
  id: MessageId;
  threadId: ThreadId;
  role: ChatRole;
  body: string;
  at: IsoTime;
  runId?: RunId | null;
  proposalId?: ProposalId | null;
  asset?: { slot: SlotRef; version: Version } | null;
}

export function insertChatMessage(ctx: Db, input: CreateChatMessageInput): ChatMessage {
  ctx.db
    .insert(chatMessages)
    .values({
      id: input.id,
      threadId: input.threadId,
      role: input.role,
      body: input.body,
      runId: input.runId ?? null,
      proposalId: input.proposalId ?? null,
      asset: input.asset ? JSON.stringify(input.asset) : null,
      at: toEpochMs(input.at),
    })
    .run();
  const row = ctx.db.select().from(chatMessages).where(eq(chatMessages.id, input.id)).get();
  if (!row) throw new Error(`insertChatMessage: row for ${input.id} vanished after insert`);
  return mapMessageRow(row);
}

/** Oldest first (ThreadView.messages). */
export function listMessages(ctx: Db, threadId: ThreadId): ChatMessage[] {
  return ctx.db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.at)).all().map(mapMessageRow);
}

export function countMessages(ctx: Db, threadId: ThreadId): number {
  const row = ctx.db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all();
  return row.length;
}
