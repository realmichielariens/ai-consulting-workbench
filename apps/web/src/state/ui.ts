// UI-only state (never server state — that lives in React Query): the
// Feedback modal, and which activity items have their raw detail expanded.

import { create } from "zustand";

interface UiState {
  feedbackOpen: boolean;
  openFeedback: () => void;
  closeFeedback: () => void;

  expandedActivity: Record<string, boolean>;
  toggleActivityDetail: (key: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  feedbackOpen: false,
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),

  expandedActivity: {},
  toggleActivityDetail: (key) =>
    set((s) => ({ expandedActivity: { ...s.expandedActivity, [key]: !s.expandedActivity[key] } })),
}));
