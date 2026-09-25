// REDESIGN-PLAN §6.2 (the Frame mode): home while the plan only has ENG
// (D1). The conversation takes the stage; the right column shows the
// engagement's own assets (context.md, stakeholders.md, …) as the Approach
// Agent writes them.

import { useQuery } from "@tanstack/react-query";
import type { EngagementId, SlotNode } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc } from "../../shell/nav.js";
import { Version } from "../../ui/index.js";
import { Conversation } from "../../rail/Conversation.js";
import "./KickoffPage.css";

export function KickoffPage({ eid }: { eid: EngagementId }) {
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const engSlots = (plan.data?.slots ?? []).filter((s): s is SlotNode & { latest: NonNullable<SlotNode["latest"]> } => s.owner === "ENG" && s.latest != null);

  return (
    <div className="kickoff-page" data-testid="kickoff-page">
      <div className="kickoff-main">
        <Conversation eid={eid} />
      </div>
      <aside className="kickoff-shape">
        <h2 className="kickoff-shape-title">Taking shape</h2>
        {engSlots.length === 0 && <p className="muted">Nothing published yet.</p>}
        {engSlots.map((slot) => (
          <KickoffAsset key={slot.ref} eid={eid} slot={slot} />
        ))}
      </aside>
    </div>
  );
}

function KickoffAsset({ eid, slot }: { eid: EngagementId; slot: SlotNode & { latest: NonNullable<SlotNode["latest"]> } }) {
  const content = useQuery({
    queryKey: qk.assetVersion(eid, slot.owner, slot.name, slot.latest.version),
    queryFn: () => api.getAssetVersion(eid, slot.owner, slot.name, slot.latest.version),
  });
  const firstLines = (content.data?.text ?? "").split("\n").filter((l) => l.trim().length > 0).slice(0, 3).join("\n");

  return (
    <button type="button" className="kickoff-asset" data-testid={`kickoff-asset-${slot.ref}`} onClick={() => openDoc(eid, slot.ref)}>
      <div className="kickoff-asset-head">
        <span>
          {slot.name}.{slot.format}
        </span>
        <Version version={slot.latest.version} kind={slot.latest.kind} />
      </div>
      {firstLines && <p className="kickoff-asset-preview">{firstLines}</p>}
    </button>
  );
}
