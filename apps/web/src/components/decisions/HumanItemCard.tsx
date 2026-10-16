// EXHIBIT §7.3 "Human item": inputs available and outputs expected, then
// "Open" -> the Item page's *Your work* layout (B), which now owns the
// upload UI. Keeps data-item-id on the card root (plan §4.6).

import type { InboxEntry } from "@workbench/core";
import { openItem } from "../../shell/nav.js";
import { Button } from "../../ui/index.js";
import "./DecisionCard.css";

export function HumanItemCard({ eid, entry }: { eid: string; entry: Extract<InboxEntry, { kind: "human_item" }> }) {
  return (
    <div className="card" data-testid="inbox-card-human-item" data-item-id={entry.item.id}>
      <div className="card-kicker">
        <span className="kind">Human item</span>
        <span className="id">{entry.item.id}</span>
        <span>· {entry.status.replace(/_/g, " ")}</span>
        <span>· {entry.consequence.reason}</span>
      </div>
      <h4 className="card-title">{entry.item.title}</h4>
      <div className="card-evidence">
        <div className="io-list">
          {entry.inputs.length > 0 && (
            <>
              <span className="label">Inputs</span>
              {entry.inputs.map((inp) => (
                <span key={inp.slot}>{inp.available ? `${inp.slot} v${inp.available.version}` : `${inp.slot} — not yet available`}</span>
              ))}
            </>
          )}
          <span className="label">Outputs</span>
          {entry.outputs.map((out) => (
            <span key={out.slot}>
              {out.slot}
              {out.latest ? ` — v${out.latest.version}` : out.required ? " — required" : " — optional"}
            </span>
          ))}
        </div>
      </div>
      <div className="card-actions">
        <Button variant="primary" size="sm" data-testid="human-item-open" onClick={() => openItem(eid, entry.item.id)}>
          Open
        </Button>
      </div>
    </div>
  );
}
