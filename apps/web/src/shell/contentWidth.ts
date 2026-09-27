// How wide rendered content (documents, the journal) may grow in the stage.
// Prose reads best at the measure, but tables and CSVs need the room, so the
// reader chooses. One preference for every page, persisted (localStorage,
// try/catch) like the rail width.

import { create } from "zustand";
import type { SegmentedOption } from "../ui/index.js";

export type ContentWidth = "reading" | "wide" | "full";

export const CONTENT_WIDTH_OPTIONS: SegmentedOption<ContentWidth>[] = [
  { value: "reading", label: "Narrow" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const KEY = "workbench:content-width";
const DEFAULT: ContentWidth = "reading";

function load(): ContentWidth {
  try {
    const raw = localStorage.getItem(KEY);
    return CONTENT_WIDTH_OPTIONS.some((o) => o.value === raw) ? (raw as ContentWidth) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

interface ContentWidthState {
  width: ContentWidth;
  setWidth: (width: ContentWidth) => void;
}

export const useContentWidth = create<ContentWidthState>((set) => ({
  width: load(),
  setWidth: (width) => {
    try {
      localStorage.setItem(KEY, width);
    } catch {
      // ignore
    }
    set({ width });
  },
}));
