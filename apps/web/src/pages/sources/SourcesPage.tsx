// The Source Catalog: the content marketplace the Approach Agent picks from
// when it links live or external context to a task (core sources.ts).
// Attaching happens through the Approach Agent's plan proposals, which the
// human approves. Curated listings are read-only here; your own MCP servers
// (origin "user", docs/USER-MCP-SOURCES-PLAN.md) can be added, edited,
// tested and deleted.

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, SourceCatalogEntry, SourceId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openItem } from "../../shell/nav.js";
import { Button } from "../../ui/index.js";
import { SourceEditor } from "./SourceForm.js";
import "./SourcesPage.css";

const KIND_LABEL: Record<SourceCatalogEntry["kind"], string> = { web: "Web", mcp: "Data provider (MCP)", library: "Library" };

/** null: closed; "new": the add form; otherwise the id of the listing being edited. */
type EditorState = null | "new" | SourceId;

export function SourcesPage({ eid }: { eid: EngagementId }) {
  const q = useQuery({ queryKey: qk.sources(eid), queryFn: () => api.listSources(eid) });
  const [editor, setEditor] = useState<EditorState>(null);
  const closeEditor = useCallback(() => setEditor(null), []);

  if (q.status === "pending") return <p className="muted">Loading the Source Catalog…</p>;
  if (q.status === "error") return <p role="alert">Could not load the Source Catalog: {(q.error as Error).message}</p>;

  return (
    <div className="sources-page">
      <header className="sources-head">
        <div className="sources-head-text">
          <h1>Source Catalog</h1>
          <p className="muted">
            Context a task can be linked to beyond its inputs. The Approach Agent attaches sources in its plan proposals: free ones readily to
            research tasks, live ones never to analysis that must be reproducible.
          </p>
        </div>
        <Button variant="primary" data-testid="source-add" onClick={() => setEditor("new")}>
          Add MCP server
        </Button>
      </header>
      {q.data.length === 0 ? (
        <p className="muted">The catalog is empty. Add an MCP server of your own to give tasks more context.</p>
      ) : (
        <div className="sources-grid" data-testid="sources-grid">
          {q.data.map((s) => (
            <SourceCard key={s.id} eid={eid} source={s} onEdit={() => setEditor(s.id)} />
          ))}
        </div>
      )}
      {editor !== null && <SourceEditor editId={editor === "new" ? null : editor} onClose={closeEditor} />}
    </div>
  );
}

function SourceCard({ eid, source, onEdit }: { eid: EngagementId; source: SourceCatalogEntry; onEdit: () => void }) {
  const isUser = source.origin === "user";
  const [confirming, setConfirming] = useState(false);

  return (
    <article className={`card source-card${isUser ? " source-card-user" : ""}`} data-testid={`source-card-${source.id}`}>
      <div className="card-kicker">
        {isUser && (
          <span className="tag tag-accent" data-testid="source-origin-user">
            Yours
          </span>
        )}
        <span className="tag tag-outline">{KIND_LABEL[source.kind]}</span>
        {isUser && <span className="tag tag-outline mono">{source.connectionType}</span>}
        <span className={`tag ${source.freshness === "live" ? "source-live" : "source-snapshot"}`}>
          {source.freshness === "live" ? "Live" : `Edition ${source.edition ?? ""}`.trim()}
        </span>
        <span className={`tag ${source.offer.tier === "free" ? "source-free" : "source-licensed"}`}>{source.offer.label}</span>
      </div>
      <h2 className="card-title">{source.title}</h2>
      <p className="source-publisher">
        {source.publisher} <span className="id">{source.id}</span>
      </p>
      <p className="source-summary">{source.summary}</p>
      {source.description && <p className="source-description muted">{source.description}</p>}
      <div className="source-used">
        <span className="label">Used by</span>
        <UsedBy eid={eid} source={source} />
      </div>
      {isUser &&
        (confirming ? (
          <DeleteConfirm eid={eid} source={source} onCancel={() => setConfirming(false)} />
        ) : (
          <div className="card-actions">
            <Button variant="secondary" size="sm" data-testid={`source-edit-${source.id}`} onClick={onEdit}>
              Edit
            </Button>
            <Button variant="danger" size="sm" data-testid={`source-delete-${source.id}`} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </div>
        ))}
    </article>
  );
}

function UsedBy({ eid, source }: { eid: EngagementId; source: SourceCatalogEntry }) {
  if (source.usedBy.length === 0) return <span className="muted">No task in this engagement yet</span>;
  return (
    <ul>
      {source.usedBy.map((u) => (
        <li key={u.itemId}>
          <button type="button" className="link" onClick={() => openItem(eid, u.itemId)}>
            <span className="id">{u.itemId}</span> {u.title}
          </button>
          <span className="muted"> — {u.purpose}</span>
        </li>
      ))}
    </ul>
  );
}

function DeleteConfirm({ eid, source, onCancel }: { eid: EngagementId; source: SourceCatalogEntry; onCancel: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deleteSource(source.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.source(source.id) });
      void qc.invalidateQueries({ queryKey: qk.allSources() });
    },
  });
  const n = source.usedBy.length;

  return (
    <div className="source-confirm" role="group" aria-label={`Delete ${source.title}`} data-testid={`source-delete-confirm-${source.id}`}>
      <p className="source-confirm-title">Delete {source.title}?</p>
      {n === 0 ? (
        <p className="muted">No task in this engagement uses it. Other engagements may; they will see it as unknown.</p>
      ) : (
        <>
          <p>
            {n === 1 ? "1 task in this engagement uses it" : `${n} tasks in this engagement use it`}. Their runs will report it as unknown and go on
            without it.
          </p>
          <ul className="source-confirm-list">
            {source.usedBy.map((u) => (
              <li key={u.itemId}>
                <span className="id">{u.itemId}</span> {u.title}
              </li>
            ))}
          </ul>
        </>
      )}
      {del.isError && (
        <p role="alert" className="src-error">
          Could not delete: {(del.error as Error).message}
        </p>
      )}
      <div className="card-actions">
        <Button variant="danger" size="sm" data-testid={`source-delete-confirm-button-${source.id}`} disabled={del.isPending} onClick={() => del.mutate()}>
          {del.isPending ? "Deleting…" : "Delete source"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
