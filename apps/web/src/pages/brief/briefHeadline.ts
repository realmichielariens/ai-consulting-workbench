// REDESIGN-PLAN §6.3 / UX1-PLAN §4.6, plan §Build 2: the Brief's action
// title and standfirst, computed by templates — never by an LLM, so they
// cost nothing and are unit-testable.

import type { InboxEntry, ItemNode, PlanView } from "@workbench/core";

/** EXHIBIT §8 "Time": the Brief header, e.g. "Thu 25 Sep". */
export function formatBriefDate(date: Date): string {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${day} ${month}`;
}

export interface BriefHeadline {
  title: string;
  standfirst: string;
}

/** Walks up .parent to the nearest composite (a "phase"), falling back to the item itself. */
function phaseTitleOf(plan: Pick<PlanView, "items">, itemId: string): string {
  const byId = new Map(plan.items.map((i) => [i.id, i]));
  let cur: ItemNode | undefined = byId.get(itemId);
  const start = cur;
  while (cur?.parent) {
    const parent = byId.get(cur.parent);
    if (!parent) break;
    if (parent.kind === "composite") return parent.title;
    cur = parent;
  }
  return start?.title ?? itemId;
}

export function briefHeadline(entries: InboxEntry[], plan: Pick<PlanView, "items">): BriefHeadline {
  const decisions = entries.filter((e) => e.kind !== "fyi");
  const inFlight = plan.items.filter((i) => i.activeRunId != null).length;
  // "Done" means every leaf task is done or cancelled (vacuously true for an empty plan);
  // composites/ENG carry no status of their own, so they're excluded.
  const allDone = plan.items.filter((i) => i.kind === "task").every((i) => i.status === "done" || i.status === "cancelled");

  if (decisions.length === 0) {
    if (allDone) return { title: "All work is done.", standfirst: "The deliverable is ready to export." };
    if (inFlight === 0) return { title: "Nothing needs you.", standfirst: "Nothing is running right now." };
    return { title: "Nothing needs you.", standfirst: `Agents are working on ${inFlight} item${inFlight === 1 ? "" : "s"}.` };
  }

  const n = decisions.length;
  let title = `${n} decision${n === 1 ? "" : "s"} ${n === 1 ? "needs" : "need"} you.`;
  const top = decisions[0]!;
  if (top.kind === "review") {
    title += ` ${phaseTitleOf(plan, top.item.id)} is waiting on your review.`;
  }

  const standfirst = inFlight > 0 ? `${inFlight} item${inFlight === 1 ? "" : "s"} in flight.` : "Nothing else is running right now.";
  return { title, standfirst };
}
