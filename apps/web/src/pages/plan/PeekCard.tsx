// UX1 brief B §Build 1: the peek card — a popover anchored near the
// selected canvas node or tracker row (REDESIGN-PLAN §6.4/§7.1). One click
// selects and shows this; double-click/Enter/Open goes straight to the item.

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, ItemId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { Button, Status } from "../../ui/index.js";

function firstLine(text: string): string {
  const line = text.split(/\n+/).find((l) => l.trim().length > 0) ?? "";
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}

/** Finds the currently-selected node/row's screen position so the popover can anchor near it. */
function useAnchorRect(itemId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!itemId) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-testid="process-node-${itemId}"]`) ?? document.querySelector(`[data-testid="tracker-row-${itemId}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [itemId]);
  return rect;
}

export function PeekCard({ eid, itemId, onClose, onOpen }: { eid: EngagementId; itemId: ItemId; onClose: () => void; onOpen: (itemId: string) => void }) {
  const rect = useAnchorRect(itemId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.item(eid, itemId), queryFn: () => api.getItem(eid, itemId) });
  const start = useMutation({
    mutationFn: () => api.startItem(eid, itemId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.item(eid, itemId) });
      void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    },
  });

  if (q.status !== "success") return null;
  const { node, def, openRequests, actions } = q.data;

  const style: CSSProperties = rect
    ? { top: `${rect.bottom + 8}px`, left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px` }
    : { top: "80px", right: "24px" };

  return (
    <div className="peek-card" data-testid="peek-card" style={style} role="dialog" aria-label={`${node.id} ${node.title}`}>
      <button type="button" className="peek-close" aria-label="Close" onClick={onClose}>
        {"✕"}
      </button>
      <div className="peek-id">{node.id}</div>
      <div className="peek-title">{node.title}</div>
      <Status status={node.status ?? "waiting"} />
      {def.brief && <p className="peek-brief">{firstLine(def.brief)}</p>}
      {openRequests.length > 0 && <p className="peek-requests">{openRequests.length} open request{openRequests.length === 1 ? "" : "s"}</p>}
      <div className="peek-actions">
        {actions.start.allowed && (
          <Button variant="primary" size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            Run
          </Button>
        )}
        <Button size="sm" data-testid="peek-open" onClick={() => onOpen(itemId)}>
          Open
        </Button>
      </div>
    </div>
  );
}
