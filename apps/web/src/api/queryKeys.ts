// One place for React Query keys, so the WS cache-patching logic (useEngagementSocket.ts)
// and the components that fetch data agree on the same shapes.

import type { EngagementId, ItemId, ProposalId, RunId, SlotName, SourceId, ThreadId } from "@workbench/core";

export const qk = {
  seeds: () => ["seeds"] as const,
  health: () => ["health"] as const,
  engagements: () => ["engagements"] as const,
  engagement: (eid: EngagementId) => ["engagement", eid] as const,
  plan: (eid: EngagementId) => ["plan", eid] as const,
  item: (eid: EngagementId, itemId: ItemId) => ["item", eid, itemId] as const,
  worklog: (eid: EngagementId, itemId: ItemId) => ["worklog", eid, itemId] as const,
  runActivity: (eid: EngagementId, runId: RunId) => ["runActivity", eid, runId] as const,
  inbox: (eid: EngagementId) => ["inbox", eid] as const,
  assetVersions: (eid: EngagementId, itemId: ItemId, slot: SlotName) => ["assetVersions", eid, itemId, slot] as const,
  assetVersion: (eid: EngagementId, itemId: ItemId, slot: SlotName, version: string) =>
    ["assetVersion", eid, itemId, slot, version] as const,

  // I2
  threads: (eid: EngagementId) => ["threads", eid] as const,
  thread: (eid: EngagementId, tid: ThreadId) => ["thread", eid, tid] as const,
  proposals: (eid: EngagementId) => ["proposals", eid] as const,
  proposal: (eid: EngagementId, pid: ProposalId) => ["proposal", eid, pid] as const,
  proposalPreview: (eid: EngagementId, pid: ProposalId) => ["proposalPreview", eid, pid] as const,
  notifications: (eid: EngagementId) => ["notifications", eid] as const,
  profile: () => ["profile"] as const,
  journal: (eid: EngagementId) => ["journal", eid] as const,
  sources: (eid: EngagementId) => ["sources", eid] as const,
  /** Prefix of every engagement's catalog: user listings are workspace-wide, so a mutation invalidates them all. */
  allSources: () => ["sources"] as const,
  source: (sid: SourceId) => ["source", sid] as const,
};
