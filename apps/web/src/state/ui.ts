// UI-only state (never server state — that lives in React Query): the
// Feedback modal, which activity items have their raw detail expanded, and
// the Settings drawer. Stage tabs live in shell/tabs.ts, and the proposal
// preview is the Plan's `?preview=` param.

import { create } from "zustand";

interface UiState {
  feedbackOpen: boolean;
  openFeedback: () => void;
  closeFeedback: () => void;

  expandedActivity: Record<string, boolean>;
  toggleActivityDetail: (key: string) => void;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  feedbackOpen: false,
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),

  expandedActivity: {},
  toggleActivityDetail: (key) =>
    set((s) => ({ expandedActivity: { ...s.expandedActivity, [key]: !s.expandedActivity[key] } })),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
