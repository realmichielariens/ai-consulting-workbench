import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { createNotification, dismiss, getNotification, listNotifications, listUndismissed } from "./notifications.js";

const now = () => new Date().toISOString();

describe("notifications repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates and reads a notification", () => {
    t = openTestDb();
    const n = createNotification(t.ctx, { id: "N-0001", from: "approach:sess-1", text: "Answered RQ-0001", itemId: "WI-002", requestId: "RQ-0001", createdAt: now() });
    expect(n.dismissedAt).toBeNull();
    expect(getNotification(t.ctx, "N-0001")).toEqual(n);
  });

  it("listUndismissed excludes dismissed ones", () => {
    t = openTestDb();
    createNotification(t.ctx, { id: "N-0001", from: "system", text: "a", itemId: null, requestId: null, createdAt: now() });
    createNotification(t.ctx, { id: "N-0002", from: "system", text: "b", itemId: null, requestId: null, createdAt: now() });
    dismiss(t.ctx, "N-0001", now());
    expect(listUndismissed(t.ctx).map((n) => n.id)).toEqual(["N-0002"]);
    expect(listNotifications(t.ctx)).toHaveLength(2);
  });
});
