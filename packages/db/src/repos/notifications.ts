// FYI notifications (I2, domain.ts Notification, schema.ts `notifications`):
// notify_human and answers the Approach Agent gave (J2.3). Dismissible.

import { desc, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Notification, type Actor, type IsoTime, type ItemId, type NotificationId, type RequestId } from "@workbench/core";
import type { Db } from "../client.js";
import { notifications } from "../schema.js";
import { toEpochMs, toIsoTime } from "../mappers.js";

function mapRow(row: typeof notifications.$inferSelect): Notification {
  return Notification.parse({
    id: row.id,
    from: row.fromActor,
    text: row.text,
    itemId: row.itemId,
    requestId: row.requestId,
    createdAt: toIsoTime(row.createdAt),
    dismissedAt: row.dismissedAt == null ? null : toIsoTime(row.dismissedAt),
  });
}

export interface CreateNotificationInput {
  id: NotificationId;
  from: Actor;
  text: string;
  itemId: ItemId | null;
  requestId: RequestId | null;
  createdAt: IsoTime;
}

export function createNotification(ctx: Db, input: CreateNotificationInput): Notification {
  ctx.db
    .insert(notifications)
    .values({
      id: input.id,
      fromActor: input.from,
      text: input.text,
      itemId: input.itemId,
      requestId: input.requestId,
      createdAt: toEpochMs(input.createdAt),
      dismissedAt: null,
    })
    .run();
  const row = getNotification(ctx, input.id);
  if (!row) throw new Error(`createNotification: row for ${input.id} vanished after insert`);
  return row;
}

export function getNotification(ctx: Db, id: NotificationId): Notification | null {
  const row = ctx.db.select().from(notifications).where(eq(notifications.id, id)).get();
  return row ? mapRow(row) : null;
}

/** Newest first. */
export function listNotifications(ctx: Db): Notification[] {
  return ctx.db.select().from(notifications).orderBy(desc(notifications.createdAt)).all().map(mapRow);
}

export function listUndismissed(ctx: Db): Notification[] {
  return ctx.db.select().from(notifications).where(isNull(notifications.dismissedAt)).orderBy(desc(notifications.createdAt)).all().map(mapRow);
}

export function dismiss(ctx: Db, id: NotificationId, dismissedAt: IsoTime): Notification {
  ctx.db.update(notifications).set({ dismissedAt: toEpochMs(dismissedAt) }).where(eq(notifications.id, id)).run();
  const row = getNotification(ctx, id);
  if (!row) throw new Error(`dismiss: no such notification ${id}`);
  return row;
}
