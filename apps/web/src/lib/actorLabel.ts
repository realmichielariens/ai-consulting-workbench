// I2 (brief C §7): "Answers by approach:* are labelled 'Approach Agent'
// wherever responses are shown." Small shared formatter so every place that
// renders an Actor (a request response's `by`, a proposal's author, …)
// agrees on the same label.

import type { Actor } from "@workbench/core";

export function formatActor(actor: Actor): string {
  if (actor === "human") return "Human";
  if (actor === "system") return "System";
  if (actor.startsWith("approach:")) return "Approach Agent";
  if (actor.startsWith("agent:")) return `Agent ${actor.slice("agent:".length)}`;
  return actor;
}
