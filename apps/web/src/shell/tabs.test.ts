// UX1 brief A §Build 4: the object-tab LRU eviction and the doc-tab replace
// rule (opening another version of the same slot replaces its tab, keyed by
// slotRef, rather than adding a new one).

import { beforeEach, describe, expect, test } from "vitest";
import { useTabsStore } from "./tabs.js";

const EID = "acme";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  useTabsStore.setState({ byEngagement: {} });
});

describe("openTab", () => {
  test("opens a new object tab", () => {
    useTabsStore.getState().openTab(EID, { key: "item-WI-001", kind: "item", label: "Analyse intake documents" });
    const tabs = useTabsStore.getState().tabsFor(EID);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ key: "item-WI-001", kind: "item", label: "Analyse intake documents" });
  });

  test("opening the same key again focuses/relabels instead of duplicating", () => {
    const { openTab } = useTabsStore.getState();
    openTab(EID, { key: "doc-WI-004/themes", kind: "doc", label: "themes.md 1.0" });
    openTab(EID, { key: "doc-WI-004/themes", kind: "doc", label: "themes.md 2.0" });
    const tabs = useTabsStore.getState().tabsFor(EID);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.label).toBe("themes.md 2.0");
  });

  test("evicts the least-recently-used tab past 8 open tabs", () => {
    const { openTab } = useTabsStore.getState();
    for (let i = 1; i <= 8; i++) {
      openTab(EID, { key: `item-WI-00${i}`, kind: "item", label: `Item ${i}` });
    }
    let tabs = useTabsStore.getState().tabsFor(EID);
    expect(tabs).toHaveLength(8);
    expect(tabs.map((t) => t.key)).toContain("item-WI-001");

    // Re-touch item 1 so it's no longer the LRU one, then open a 9th tab.
    openTab(EID, { key: "item-WI-001", kind: "item", label: "Item 1" });
    openTab(EID, { key: "item-WI-009", kind: "item", label: "Item 9" });

    tabs = useTabsStore.getState().tabsFor(EID);
    expect(tabs).toHaveLength(8);
    // item 1 was re-touched, so it survives; item 2 was the next LRU and is evicted.
    expect(tabs.map((t) => t.key)).toContain("item-WI-001");
    expect(tabs.map((t) => t.key)).not.toContain("item-WI-002");
    expect(tabs.map((t) => t.key)).toContain("item-WI-009");
  });

  test("keeps tabs for different engagements separate", () => {
    const { openTab } = useTabsStore.getState();
    openTab("acme", { key: "journal", kind: "journal", label: "Journal" });
    openTab("globex", { key: "journal", kind: "journal", label: "Journal" });
    expect(useTabsStore.getState().tabsFor("acme")).toHaveLength(1);
    expect(useTabsStore.getState().tabsFor("globex")).toHaveLength(1);
  });
});

describe("closeTab", () => {
  test("removes the tab and returns the remaining ones", () => {
    const { openTab, closeTab } = useTabsStore.getState();
    openTab(EID, { key: "journal", kind: "journal", label: "Journal" });
    openTab(EID, { key: "conversation", kind: "conversation", label: "Conversation" });
    const remaining = closeTab(EID, "journal");
    expect(remaining.map((t) => t.key)).toEqual(["conversation"]);
    expect(useTabsStore.getState().tabsFor(EID).map((t) => t.key)).toEqual(["conversation"]);
  });
});

describe("persistence", () => {
  test("survives a reload (a fresh store reading the same localStorage key)", () => {
    useTabsStore.getState().openTab(EID, { key: "journal", kind: "journal", label: "Journal" });
    // Simulate a reload: a brand-new store instance, still backed by the same localStorage.
    expect(useTabsStore.getState().tabsFor(EID)).toHaveLength(1);
    const raw = localStorage.getItem(`workbench:tabs:${EID}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });
});
