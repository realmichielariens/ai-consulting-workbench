// Live activity rendering: a readable summary per item, raw detail/tool
// input collapsed by default, denials visually highlighted (R4).

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActivityItem } from "@workbench/core";
import { ActivityRow } from "./ActivityStream.js";

afterEach(cleanup);

describe("ActivityRow", () => {
  test("renders the summary and time, kind as a data attribute", () => {
    const item: ActivityItem = { idx: 0, at: "2026-09-23T10:00:00.000Z", kind: "publish", summary: "Published interview-guide v1.0 (material)" };
    render(<ActivityRow item={item} />);
    expect(screen.getByText(item.summary)).toBeTruthy();
    expect(screen.getByTestId("activity-item").dataset.kind).toBe("publish");
  });

  test("raw detail is collapsed by default and can be expanded", () => {
    const item: ActivityItem = { idx: 1, at: "2026-09-23T10:00:01.000Z", kind: "tool", summary: "Wrote work/draft-guide.md", tool: { name: "Write", input: { path: "work/draft-guide.md" } } };
    render(<ActivityRow item={item} />);
    expect(screen.queryByText(/draft-guide\.md/, { selector: "pre" })).toBeNull();
    fireEvent.click(screen.getByTestId("activity-raw-toggle"));
    expect(screen.getByText(/work\/draft-guide\.md/, { selector: "pre" })).toBeTruthy();
  });

  test("a denial is visually distinguished via its kind class", () => {
    const item: ActivityItem = { idx: 2, at: "2026-09-23T10:00:02.000Z", kind: "denial", summary: "Denied: write outside this item's locus" };
    render(<ActivityRow item={item} />);
    expect(screen.getByTestId("activity-item").className).toContain("activity-denial");
  });

  test("no raw-detail toggle when there is nothing raw to show", () => {
    const item: ActivityItem = { idx: 3, at: "2026-09-23T10:00:03.000Z", kind: "text", summary: "Drafting the guide." };
    render(<ActivityRow item={item} />);
    expect(screen.queryByTestId("activity-raw-toggle")).toBeNull();
  });
});
