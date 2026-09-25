// UX1 brief B §Build 2 "Your work": inputs to read, one drop zone per
// output slot, and Mark done. Ported from components/Inbox.tsx's
// HumanItemCard (read-only reference), now driven by ItemDetailView instead
// of the InboxEntry shape.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, ItemDetailView, ItemId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc } from "../../shell/nav.js";
import { Button, SourceChip, Version } from "../../ui/index.js";
import "./ItemPage.css";

export function YourWork({ eid, itemId, detail }: { eid: EngagementId; itemId: ItemId; detail: ItemDetailView }) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.item(eid, itemId) });
    void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
  };
  const upload = useMutation({
    mutationFn: (vars: { slot: string; file: File }) => api.uploadOutput(eid, itemId, vars.slot, vars.file),
    onSuccess: invalidate,
  });
  const markDone = useMutation({ mutationFn: () => api.markDone(eid, itemId), onSuccess: invalidate });

  const { inputs, outputs, actions } = detail;

  return (
    <section className="your-work" data-testid="your-work">
      <h3>Your work</h3>

      {inputs.length > 0 && (
        <div className="your-work-inputs">
          <span className="label">Read first</span>
          <div className="row-wrap">
            {inputs.map((inp) =>
              inp.available ? (
                <SourceChip key={inp.slot} onClick={() => openDoc(eid, inp.slot, inp.available!.version)}>
                  {`${inp.slot} v${inp.available.version}`}
                </SourceChip>
              ) : (
                <span key={inp.slot} className="muted">
                  {inp.slot} — not yet available
                </span>
              ),
            )}
          </div>
        </div>
      )}

      <div className="your-work-outputs">
        <span className="label">Outputs</span>
        {outputs.map((out) => {
          const latest = out.versions.at(-1) ?? null;
          const uploadPending = upload.isPending && upload.variables?.slot === out.slot;
          return (
            <div key={out.slot} className="your-work-output" data-testid={`upload-slot-${out.slot}`}>
              <span className="your-work-output-name">
                {out.slot}
                {latest ? (
                  <Version version={latest.version} kind={latest.kind} />
                ) : (
                  <span className="muted">{out.required ? "required" : "optional"}</span>
                )}
              </span>
              <input
                type="file"
                accept=".md"
                aria-label={`Upload ${out.slot}`}
                data-testid={`upload-input-${out.slot}`}
                disabled={uploadPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate({ slot: out.slot, file });
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
        {upload.isError && (
          <p role="alert" className="error">
            {(upload.error as Error).message}
          </p>
        )}
      </div>

      <div className="your-work-actions">
        <Button variant="primary" data-testid="mark-done" disabled={!actions.markDone.allowed || markDone.isPending} onClick={() => markDone.mutate()}>
          Mark done
        </Button>
        {!actions.markDone.allowed && actions.markDone.reason && <span className="helper-text">{actions.markDone.reason}</span>}
      </div>
    </section>
  );
}
