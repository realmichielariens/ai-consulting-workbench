// The one I2 conversation thread (T-0001). Split out from approachRunner.ts
// so approachPort.ts (which needs a thread to post proposal/publish system
// messages to, even from a task session with no thread of its own) can use
// it without an import cycle with approachRunner.ts (which creates ports).

import type { Thread } from "@workbench/core";
import { nextThreadId, threadsRepo } from "@workbench/db";
import type { EngagementContext } from "./engagementContext.js";

const HOME_SUBJECT = "Engagement conversation";

/** Every engagement gets T-0001. I1 engagements (created before I2) get it lazily, on first access. */
export function ensureThread(ctx: EngagementContext): Thread {
  const existing = threadsRepo.getThread(ctx.dbCtx, "T-0001");
  if (existing) return existing;
  return threadsRepo.createThread(ctx.dbCtx, { id: nextThreadId(ctx.dbCtx), subject: HOME_SUBJECT, createdAt: new Date().toISOString() });
}
