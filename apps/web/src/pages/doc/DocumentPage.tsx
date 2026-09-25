// UX1 brief B §Build 3: the Document page — the reading room. Header meta,
// a toolbar (Read/Source; Changes arrives in I4), the rendered body at the
// reading measure, a version rail + Used by + Built from side column, and
// the review bar. Replaces components/AssetViewer.tsx (pre-UX1 reference).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EngagementId, InboxView, ItemId, SlotName, Version as VersionT } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc, openItem } from "../../shell/nav.js";
import { Button, ExecGlyph, Segmented, SourceChip, Status, Tag } from "../../ui/index.js";
import { findReviewEntry, type ReviewEntry } from "./reviewEntry.js";
import { ReviewBar } from "./ReviewBar.js";
import "./DocumentPage.css";
import { focusComposer } from "../../shell/rail.js";

type Mode = "read" | "source";

export function DocumentPage({ eid, itemId, slot, version }: { eid: EngagementId; itemId: ItemId; slot: SlotName; version: VersionT | null }) {
  const [mode, setMode] = useState<Mode>("read");
  const slotRef = `${itemId}/${slot}`;

  const versions = useQuery({ queryKey: qk.assetVersions(eid, itemId, slot), queryFn: () => api.getAssetVersions(eid, itemId, slot) });
  const resolvedVersion = version ?? versions.data?.versions[0]?.version ?? null;
  const content = useQuery({
    queryKey: qk.assetVersion(eid, itemId, slot, resolvedVersion ?? ""),
    queryFn: () => api.getAssetVersion(eid, itemId, slot, resolvedVersion!),
    enabled: resolvedVersion != null,
  });
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const inbox = useQuery<InboxView>({ queryKey: qk.inbox(eid), queryFn: () => api.getInbox(eid) });

  if (versions.status === "pending") return <p>Loading document…</p>;
  if (versions.status === "error") return <p role="alert">Could not load versions: {(versions.error as Error).message}</p>;

  const slotNode = plan.data?.slots.find((s) => s.ref === slotRef);
  const ownerNode = plan.data?.items.find((i) => i.id === versions.data.owner);
  const phase = plan.data?.items.find((i) => i.id === ownerNode?.parent);
  const reviewEntry: ReviewEntry | null = findReviewEntry(inbox.data, slotRef);

  return (
    <div className="doc-page" data-testid="asset-viewer" data-slot={slotRef}>
      <div className="doc-main">
        <div className="doc-meta">
          <span className="mono">{phase ? `${phase.id} › ${versions.data.owner}` : versions.data.owner}</span>
          {ownerNode && (
            <>
              <span>·</span>
              <ExecGlyph executor={ownerNode.executor ?? "agent"} />
              <span>{ownerNode.title}</span>
            </>
          )}
          <span>·</span>
          <Tag>{versions.data.scope}</Tag>
          {ownerNode?.status && <Status status={ownerNode.status} />}
        </div>

        <div className="doc-toolbar">
          <Segmented value={mode} onChange={setMode} options={[{ value: "read", label: "Read" }, { value: "source", label: "Source" }]} aria-label="Document mode" />
          <span className="pv-spacer" />
          {resolvedVersion && (
            <a className="btn btn-ghost btn-sm" href={api.getAssetRawUrl(eid, itemId, slot, resolvedVersion)} download data-testid="asset-download">
              Download
            </a>
          )}
          <Button variant="ghost" size="sm" data-testid="doc-ask" onClick={focusComposer}>
            Ask about this
          </Button>
        </div>

        <article className="doc reading">
          {content.status === "pending" && <p>Loading version…</p>}
          {content.status === "error" && <p role="alert">Could not load this version: {(content.error as Error).message}</p>}
          {content.status === "success" &&
            (content.data.text != null ? (
              mode === "source" ? (
                <pre className="doc-source">{content.data.text}</pre>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.data.text}</ReactMarkdown>
              )
            ) : (
              <p>
                Binary file —{" "}
                <a href={api.getAssetRawUrl(eid, itemId, slot, content.data.version.version)} download>
                  download
                </a>
              </p>
            ))}
        </article>
      </div>

      <aside className="doc-side">
        <div className="block">
          <h5 className="label">Versions</h5>
          <ul className="vlist" data-testid="asset-version-list">
            {versions.data.versions.map((v) => (
              <li key={v.version} className={`${v.version === resolvedVersion ? "cur " : ""}${v.kind === "material" ? "mat" : ""}`}>
                <button type="button" className="link" data-testid={`asset-version-${v.version}`} onClick={() => openDoc(eid, slotRef, v.version)}>
                  <b>{v.version}</b> <span className="muted">{v.kind}</span>
                </button>
                <p>
                  {new Date(v.at).toLocaleString()} {v.note && `— ${v.note}`}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {slotNode && slotNode.consumers.length > 0 && (
          <div className="block">
            <h5 className="label">Used by</h5>
            <div className="doc-side-list">
              {slotNode.consumers.map((cid) => {
                const consumer = plan.data?.items.find((i) => i.id === cid);
                return (
                  <button key={cid} type="button" className="link doc-side-consumer" onClick={() => openItem(eid, cid)}>
                    <span className="mono">{cid}</span>
                    {consumer?.status && <Status status={consumer.status} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {ownerNode && ownerNode.inputs.length > 0 && (
          <div className="block">
            <h5 className="label">Built from</h5>
            <div className="row-wrap">
              {ownerNode.inputs.map((ir) => {
                const producerSlot = plan.data?.slots.find((s) => s.ref === ir.slot);
                const v = ir.pin ?? producerSlot?.latest?.version;
                return (
                  <SourceChip key={ir.slot} onClick={() => openDoc(eid, ir.slot, v ?? null)}>
                    {`${ir.slot}${v ? ` @${v}` : ""}`}
                  </SourceChip>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {reviewEntry && <ReviewBar eid={eid} slotRef={slotRef} entry={reviewEntry} />}
    </div>
  );
}
