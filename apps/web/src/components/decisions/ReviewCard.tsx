// EXHIBIT §7.3 "Review": criteria glyphs, the version(s) under review, and
// only "Open & review" (D2 — the verdict itself is given in the document's
// review bar, not on the Brief).

import type { InboxEntry, Request } from "@workbench/core";
import { openDoc } from "../../shell/nav.js";
import { Button, CriterionGlyph, GateGlyph } from "../../ui/index.js";
import { ageLabel } from "./ids.js";
import "./DecisionCard.css";

function asGateRequest(req: Request): Extract<Request, { type: "gate_request" }> {
  if (req.type !== "gate_request") throw new Error(`expected a gate_request, got "${req.type}"`);
  return req;
}


export function ReviewCard({ eid, entry }: { eid: string; entry: Extract<InboxEntry, { kind: "review" }> }) {
  const request = asGateRequest(entry.request);
  const report = request.payload.report;
  const first = request.payload.submitted[0];

  return (
    <div className="card" data-testid="inbox-card-review" data-request-id={request.id}>
      <div className="card-kicker">
        <GateGlyph kind="review" />
        <span className="kind gate-kind">Review</span>
        <span className="id">{entry.item.id}</span>
        <span>{entry.item.title}</span>
        <span>· {ageLabel(request.createdAt)}</span>
        <span>· {entry.consequence.reason}</span>
      </div>
      <h4 className="card-title">Approve {first ? `${first.slot.split("/")[1]} ${first.version}` : entry.item.title}</h4>
      <div className="card-evidence">
        <div className="crit">
          {report.selfCheck.map((c, i) => (
            <span className="crit-item" key={i}>
              <CriterionGlyph met={c.met} />
              {c.criterion}
            </span>
          ))}
        </div>
        <div className="review-versions">
          {request.payload.submitted.map((sv) => (
            <span className="id" key={sv.slot}>
              {sv.slot} v{sv.version}
            </span>
          ))}
        </div>
        <p className="why">{report.summary}</p>
      </div>
      <div className="card-actions">
        <Button
          variant="primary"
          size="sm"
          data-testid="review-open"
          onClick={() => first && openDoc(eid, first.slot, first.version)}
        >
          Open &amp; review
        </Button>
      </div>
    </div>
  );
}
