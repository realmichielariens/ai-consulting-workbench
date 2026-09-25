// UX1 §4.3/§Build 4: the stage tab strip's object tabs (item/doc/journal/
// conversation). Home and Plan are pinned and never stored here — the shell
// renders them unconditionally. Persisted per engagement in localStorage,
// every read and write wrapped in try/catch (private windows, quota, SSR).

import { create } from "zustand";

export type TabKind = "item" | "doc" | "journal" | "conversation";

export interface TabEntry {
  /** "item-<id>" | "doc-<slotRef>" | "journal" | "conversation" (plan §4.6 stage-tab-<key>). */
  key: string;
  kind: TabKind;
  label: string;
  lastUsed: number;
}

const MAX_TABS = 8;
const storageKey = (eid: string) => `workbench:tabs:${eid}`;

// A monotonic counter rather than Date.now(): two opens in the same
// millisecond (routine in tests, and possible in real fast navigation) must
// still have a strict recency order for LRU eviction to be deterministic.
let recencyCounter = 0;
function nextRecency(): number {
  recencyCounter += 1;
  return recencyCounter;
}

function loadTabs(eid: string): TabEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(eid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TabEntry[]) : [];
  } catch {
    return [];
  }
}

function saveTabs(eid: string, tabs: TabEntry[]): void {
  try {
    localStorage.setItem(storageKey(eid), JSON.stringify(tabs));
  } catch {
    // private mode / quota — the tab strip still works for this session
  }
}

// A stable, shared reference for "no tabs yet" so a selector like
// `useTabsStore((s) => s.tabsFor(eid))` never returns a fresh array on every
// call — useSyncExternalStore (which zustand's hook is built on) requires a
// cached snapshot, or every render looks like a change and React loops.
const EMPTY_TABS: readonly TabEntry[] = [];

interface TabsState {
  byEngagement: Record<string, TabEntry[]>;
  /** Primes byEngagement[eid] from localStorage exactly once; a no-op once loaded. */
  hydrate: (eid: string) => void;
  tabsFor: (eid: string) => TabEntry[];
  /** Opens (or focuses + relabels) an object tab. Evicts the least-recently-used tab past MAX_TABS. */
  openTab: (eid: string, entry: { key: string; kind: TabKind; label: string }) => void;
  /** Returns the tabs remaining after the close, so the caller can pick the left neighbour. */
  closeTab: (eid: string, key: string) => TabEntry[];
}

export const useTabsStore = create<TabsState>((set, get) => ({
  byEngagement: {},

  hydrate: (eid) => {
    if (get().byEngagement[eid]) return;
    set((s) => ({ byEngagement: { ...s.byEngagement, [eid]: loadTabs(eid) } }));
  },

  tabsFor: (eid) => get().byEngagement[eid] ?? (EMPTY_TABS as TabEntry[]),

  openTab: (eid, entry) => {
    set((s) => {
      const existing = s.byEngagement[eid] ?? loadTabs(eid);
      const now = nextRecency();
      const idx = existing.findIndex((t) => t.key === entry.key);
      let next: TabEntry[];
      if (idx >= 0) {
        next = existing.slice();
        next[idx] = { ...next[idx]!, label: entry.label, lastUsed: now };
      } else {
        next = [...existing, { key: entry.key, kind: entry.kind, label: entry.label, lastUsed: now }];
        if (next.length > MAX_TABS) {
          const lru = next.reduce((min, t) => (t.lastUsed < min.lastUsed ? t : min), next[0]!);
          next = next.filter((t) => t.key !== lru.key);
        }
      }
      saveTabs(eid, next);
      return { byEngagement: { ...s.byEngagement, [eid]: next } };
    });
  },

  closeTab: (eid, key) => {
    let remaining: TabEntry[] = [];
    set((s) => {
      const existing = s.byEngagement[eid] ?? loadTabs(eid);
      remaining = existing.filter((t) => t.key !== key);
      saveTabs(eid, remaining);
      return { byEngagement: { ...s.byEngagement, [eid]: remaining } };
    });
    return remaining;
  },
}));
