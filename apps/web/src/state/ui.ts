// UI-only state (never server state — that lives in React Query): the
// Feedback modal, which activity items have their raw detail expanded, the
// left-panel tab per engagement (I2), the Settings panel, and the process
// view's "preview this proposal" toggle (I2, J2.2).

import { create } from "zustand";
import type { EngagementId, ProposalId } from "@workbench/core";

export type EngagementTab = "chat" | "inbox" | "approach";

interface UiState {
  feedbackOpen: boolean;
  openFeedback: () => void;
  closeFeedback: () => void;

  expandedActivity: Record<string, boolean>;
  toggleActivityDetail: (key: string) => void;

  /** Remembered per engagement (brief C §3); unset until a default is picked once the plan loads. */
  tabs: Record<EngagementId, EngagementTab>;
  setTab: (eid: EngagementId, tab: EngagementTab) => void;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  /** The proposal currently swapped into the process view (J2.2 "Preview in process view"), if any. */
  previewProposalId: ProposalId | null;
  setPreviewProposal: (id: ProposalId) => void;
  exitPreview: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  feedbackOpen: false,
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),

  expandedActivity: {},
  toggleActivityDetail: (key) =>
    set((s) => ({ expandedActivity: { ...s.expandedActivity, [key]: !s.expandedActivity[key] } })),

  tabs: {},
  setTab: (eid, tab) => set((s) => ({ tabs: { ...s.tabs, [eid]: tab } })),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  previewProposalId: null,
  setPreviewProposal: (id) => set({ previewProposalId: id }),
  exitPreview: () => set({ previewProposalId: null }),
}));
