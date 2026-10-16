// UX1 C2: turn the rail's context chip into one line of the Approach Agent's
// situation text, so "what changed here?" needs no explanation. The line is
// never persisted; the chat body stays exactly what the human typed.

import { parseSlotRef, type ItemId, type SlotRef, type StageContext } from "@workbench/core";
import { assetVersionsRepo, itemsRepo } from "@workbench/db";
import type { EngagementContext } from "./engagementContext.js";

export function describeStageContext(ctx: EngagementContext, context: StageContext): string {
  return `The human is currently viewing: ${describeTarget(ctx, context)}.`;
}

function describeTarget(ctx: EngagementContext, context: StageContext): string {
  switch (context.kind) {
    case "item":
      return `item ${itemLabel(ctx, context.ref)}`;
    case "plan":
      return `the plan, with ${itemLabel(ctx, context.ref)} selected`;
    case "journal":
      return "the approach journal";
    case "asset": {
      const version = context.version ?? assetVersionsRepo.latestVersion(ctx.dbCtx, context.ref as SlotRef)?.version ?? null;
      const description = slotDescription(ctx, context.ref);
      return `document ${context.ref}${version ? ` v${version}` : ""}${description ? ` (${description})` : ""}`;
    }
  }
}

function itemLabel(ctx: EngagementContext, ref: string): string {
  const title = itemsRepo.getItem(ctx.dbCtx, ref as ItemId)?.title;
  return title ? `${ref} (${title})` : ref;
}

function slotDescription(ctx: EngagementContext, ref: string): string | null {
  if (!ref.includes("/")) return null;
  const { itemId, slot } = parseSlotRef(ref as SlotRef);
  const out = itemsRepo.listOutputs(ctx.dbCtx, itemId).find((o) => o.slot === slot);
  return out?.description || null;
}
