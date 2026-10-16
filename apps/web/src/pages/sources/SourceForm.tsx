// The drawer where you add or edit one of your own MCP servers
// (docs/USER-MCP-SOURCES-PLAN.md, WP-B). Curated listings never open here.
// Secrets stay out of the listing file: secret-looking env keys and headers
// must hold a ${env:NAME} reference, which the server enforces on save; its
// error is mapped back onto the offending row.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceId, SourceTestResult, UserSourceConnection, UserSourceInput, UserSourceView } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { Button, Segmented } from "../../ui/index.js";

type ConnType = "stdio" | "http";

interface Row {
  rid: number;
  key: string;
  value: string;
}

interface FormState {
  title: string;
  summary: string;
  description: string;
  usage: string;
  freshness: "live" | "snapshot";
  edition: string;
  type: ConnType;
  command: string;
  argsText: string;
  env: Row[];
  url: string;
  headers: Row[];
}

let rowSeq = 0;
const newRow = (key = "", value = ""): Row => ({ rid: ++rowSeq, key, value });
const toRows = (rec: Record<string, string> | undefined): Row[] => Object.entries(rec ?? {}).map(([k, v]) => newRow(k, v));

function fromView(view: UserSourceView | null, hosted = false): FormState {
  const c = view?.connection;
  return {
    title: view?.title ?? "",
    summary: view?.summary ?? "",
    description: view?.description ?? "",
    usage: view?.usage ?? "",
    freshness: view?.freshness ?? "live",
    edition: view?.edition ?? "",
    type: c?.type === "http" || (c === undefined && hosted) ? "http" : "stdio",
    command: c?.type === "stdio" ? c.command : "",
    argsText: c?.type === "stdio" ? c.args.join("\n") : "",
    env: c?.type === "stdio" ? toRows(c.env) : [],
    url: c?.type === "http" ? c.url : "",
    headers: c?.type === "http" ? toRows(c.headers) : [],
  };
}

function toRecord(rows: Row[]): Record<string, string> | undefined {
  const entries = rows.filter((r) => r.key.trim() !== "").map((r) => [r.key.trim(), r.value] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toConnection(f: FormState): UserSourceConnection {
  if (f.type === "http") {
    const headers = toRecord(f.headers);
    return { type: "http", url: f.url.trim(), ...(headers ? { headers } : {}) };
  }
  const env = toRecord(f.env);
  const args = f.argsText
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter((a) => a !== "");
  return { type: "stdio", command: f.command.trim(), args, ...(env ? { env } : {}) };
}

function toInput(f: FormState): UserSourceInput {
  return {
    title: f.title.trim(),
    summary: f.summary.trim(),
    description: f.description.trim(),
    usage: f.usage.trim(),
    freshness: f.freshness,
    ...(f.freshness === "snapshot" && f.edition.trim() ? { edition: f.edition.trim() } : {}),
    connection: toConnection(f),
  };
}

/** Fields the server named as literal secrets ("env.API_KEY looks like a secret; …"). */
function flaggedFields(message: string | null): Set<string> {
  const out = new Set<string>();
  if (!message) return out;
  for (const m of message.matchAll(/\b((?:env|headers)\.[^\s;]+) looks like a secret/g)) out.add(m[1]!);
  return out;
}

function connectionMissing(f: FormState): string | null {
  if (f.type === "stdio" && f.command.trim() === "") return "Add the command that starts the server.";
  if (f.type === "http" && f.url.trim() === "") return "Add the server's URL.";
  return null;
}

function saveMissing(f: FormState): string | null {
  if (f.title.trim() === "") return "Add a title.";
  if (f.summary.trim() === "") return "Add a one-line summary.";
  return connectionMissing(f);
}

function toolListText(tools: SourceTestResult["tools"]): string {
  return ["Tools:", ...tools.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`)].join("\n");
}

// ---------------------------------------------------------------------------

/** The drawer shell: for an edit it first loads the full listing (with its connection). */
export function SourceEditor({ editId, onClose }: { editId: SourceId | null; onClose: () => void }) {
  const q = useQuery({ queryKey: qk.source(editId ?? ""), queryFn: () => api.getSource(editId!), enabled: editId !== null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="src-drawer-overlay">
      <div
        className="src-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={editId ? "Edit your MCP server" : "Add an MCP server"}
        data-testid="source-editor"
      >
        {editId === null ? (
          <SourceForm initial={null} onClose={onClose} />
        ) : q.status === "pending" ? (
          <DrawerHead title="Edit your MCP server" id={editId} onClose={onClose} body={<p className="muted">Loading the listing…</p>} />
        ) : q.status === "error" ? (
          <DrawerHead
            title="Edit your MCP server"
            id={editId}
            onClose={onClose}
            body={<p role="alert" className="src-error">Could not load {editId}: {(q.error as Error).message}</p>}
          />
        ) : (
          <SourceForm key={q.data.id} initial={q.data} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function DrawerHead({ title, id, onClose, body }: { title: string; id: string | null; onClose: () => void; body?: ReactNode }) {
  return (
    <>
      <div className="src-drawer-head">
        <div>
          <div className="card-kicker">
            <span className="label">Your MCP server</span>
            {id && <span className="id">{id}</span>}
          </div>
          <h2>{title}</h2>
        </div>
        <Button variant="ghost" size="sm" data-testid="source-editor-close" onClick={onClose}>
          Close
        </Button>
      </div>
      {body && <div className="src-drawer-body">{body}</div>}
    </>
  );
}

export function SourceForm({ initial, onClose }: { initial: UserSourceView | null; onClose: () => void }) {
  const qc = useQueryClient();
  // A hosted deploy refuses stdio (it would run commands on the server), so the form offers http only there.
  const hosted = useQuery({ queryKey: qk.health(), queryFn: () => api.getHealth(), staleTime: Infinity }).data?.hosted ?? false;
  const [f, setF] = useState<FormState>(() => fromView(initial, hosted));
  useEffect(() => {
    if (hosted && f.type === "stdio") setF((prev) => ({ ...prev, type: "http" }));
  }, [hosted, f.type]);
  const [toolsAdded, setToolsAdded] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => firstField.current?.focus(), []);

  const save = useMutation({
    mutationFn: () => (initial ? api.updateSource(initial.id, toInput(f)) : api.createSource(toInput(f))),
    onSuccess: (view) => {
      void qc.invalidateQueries({ queryKey: qk.allSources() });
      qc.setQueryData(qk.source(view.id), view);
      onClose();
    },
  });
  const test = useMutation({ mutationFn: () => api.testSource({ connection: toConnection(f) }) });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));
  /** A connection edit makes the last test result (and a stale save error) misleading. */
  const setConn = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    set(k, v);
    if (test.data || test.error) test.reset();
    if (save.error) save.reset();
  };

  const saveError = save.error ? (save.error as Error).message : null;
  const flagged = flaggedFields(saveError);
  const saveBlocked = saveMissing(f);
  const testBlocked = connectionMissing(f);

  const appendTools = (tools: SourceTestResult["tools"]) => {
    const text = toolListText(tools);
    set("usage", f.usage.trim() ? `${f.usage.trimEnd()}\n\n${text}` : text);
    setToolsAdded(true);
  };

  return (
    <>
      <DrawerHead title={initial ? `Edit ${initial.title}` : "Add an MCP server"} id={initial?.id ?? null} onClose={onClose} />
      <form
        className="src-drawer-body"
        data-testid="source-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!saveBlocked) save.mutate();
        }}
      >
        <section className="src-section">
          <h3 className="src-section-head">Listing</h3>
          <Field label="Title">
            <input ref={firstField} type="text" data-testid="source-title" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Summary" hint="One line for the catalog card and the Approach Agent's catalog.">
            <input type="text" data-testid="source-summary" value={f.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea rows={3} data-testid="source-description" value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Usage notes" hint="Read by the Work Agent: which tools to call, and how to use them well.">
            <textarea rows={4} data-testid="source-usage" value={f.usage} onChange={(e) => set("usage", e.target.value)} />
          </Field>
          <div className="src-field">
            <span className="label">Freshness</span>
            <div className="src-inline">
              <Segmented
                aria-label="Freshness"
                value={f.freshness}
                onChange={(v) => set("freshness", v)}
                options={[
                  { value: "live", label: "Live" },
                  { value: "snapshot", label: "Snapshot" },
                ]}
              />
              {f.freshness === "snapshot" && (
                <input
                  type="text"
                  className="src-edition"
                  aria-label="Edition"
                  placeholder="Edition, e.g. 2026.1"
                  data-testid="source-edition"
                  value={f.edition}
                  onChange={(e) => set("edition", e.target.value)}
                />
              )}
            </div>
            <span className="src-hint">
              {f.freshness === "live"
                ? "Content changes over time, so a re-run may see different facts."
                : "A fixed edition: a re-run sees the same facts, and the agent cites the edition."}
            </span>
          </div>
        </section>

        <section className="src-section">
          <h3 className="src-section-head">Connection</h3>
          <Segmented
            aria-label="Connection type"
            value={f.type}
            onChange={(v) => setConn("type", v)}
            options={
              hosted
                ? [{ value: "http", label: "http" }]
                : [
                    { value: "stdio", label: "stdio" },
                    { value: "http", label: "http" },
                  ]
            }
          />
          {f.type === "stdio" ? (
            <>
              <p className="src-warning" data-testid="source-stdio-warning">
                <span className="src-warning-glyph" aria-hidden="true">
                  !
                </span>
                A stdio server runs this command on your machine with your user rights.
              </p>
              <Field label="Command" hint="For example npx, uvx, node, or the full path to an .exe.">
                <input type="text" className="mono" data-testid="source-command" value={f.command} onChange={(e) => setConn("command", e.target.value)} />
              </Field>
              <Field label="Arguments" hint="One per line.">
                <textarea rows={3} className="mono" data-testid="source-args" value={f.argsText} onChange={(e) => setConn("argsText", e.target.value)} />
              </Field>
              <KeyValueRows label="Environment" what="variable" prefix="env" rows={f.env} flagged={flagged} onChange={(rows) => setConn("env", rows)} />
            </>
          ) : (
            <>
              <Field label="URL">
                <input
                  type="text"
                  className="mono"
                  placeholder="https://example.com/mcp"
                  data-testid="source-url"
                  value={f.url}
                  onChange={(e) => setConn("url", e.target.value)}
                />
              </Field>
              <KeyValueRows label="Headers" what="header" prefix="headers" rows={f.headers} flagged={flagged} onChange={(rows) => setConn("headers", rows)} />
            </>
          )}
          <p className="src-hint" data-testid="source-secret-help">
            Keep secrets out of the listing: write <code>{"${env:NAME}"}</code> as the value and set <code>NAME</code> on this machine (your
            environment, the repo's <code>.env</code>, or your Windows user variables). It is filled in when the source runs. Keys that look secret
            (KEY, TOKEN, SECRET, PASSWORD, AUTH, Authorization, *-key) must use a reference.
          </p>
        </section>

        <section className="src-section">
          <h3 className="src-section-head">Test connection</h3>
          <div className="src-inline">
            <Button
              variant="secondary"
              size="sm"
              data-testid="source-test"
              disabledReason={testBlocked}
              disabled={test.isPending}
              onClick={() => {
                setToolsAdded(false);
                test.mutate();
              }}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
            <span className="src-hint">Starts the server and lists its tools. No model call, no cost.</span>
          </div>
          {test.isError && (
            <p role="alert" className="src-error" data-testid="source-test-error">
              {(test.error as Error).message}
            </p>
          )}
          {test.data && <TestResult result={test.data} added={toolsAdded} onAppend={() => appendTools(test.data.tools)} />}
        </section>

        <div className="src-drawer-actions">
          {saveError && (
            <p role="alert" className="src-error" data-testid="source-save-error">
              {saveError}
            </p>
          )}
          <div className="src-inline">
            <Button variant="primary" type="submit" data-testid="source-save" disabledReason={saveBlocked} disabled={save.isPending}>
              {save.isPending ? "Saving…" : initial ? "Save changes" : "Add source"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {saveBlocked && <span className="src-hint">{saveBlocked}</span>}
          </div>
        </div>
      </form>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="src-field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="src-hint">{hint}</span>}
    </label>
  );
}

function KeyValueRows({
  label,
  what,
  prefix,
  rows,
  flagged,
  onChange,
}: {
  label: string;
  what: string;
  prefix: "env" | "headers";
  rows: Row[];
  flagged: Set<string>;
  onChange: (rows: Row[]) => void;
}) {
  const update = (rid: number, patch: Partial<Row>) => onChange(rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
  return (
    <div className="src-field" data-testid={`source-${prefix}`}>
      <span className="label">{label}</span>
      {rows.length === 0 && <span className="src-hint">None.</span>}
      {rows.map((r, i) => {
        const bad = flagged.has(`${prefix}.${r.key.trim()}`);
        return (
          <div key={r.rid} className={`src-kv${bad ? " src-kv-bad" : ""}`} data-testid={`source-${prefix}-row-${i}`}>
            <div className="src-kv-inputs">
              <input type="text" className="mono" aria-label={`${label} ${i + 1} name`} placeholder="NAME" value={r.key} onChange={(e) => update(r.rid, { key: e.target.value })} />
              <input
                type="text"
                className="mono"
                aria-label={`${label} ${i + 1} value`}
                placeholder="${env:NAME} or a plain value"
                aria-invalid={bad || undefined}
                value={r.value}
                onChange={(e) => update(r.rid, { value: e.target.value })}
              />
              <Button variant="ghost" size="sm" aria-label={`Remove ${what} ${r.key || i + 1}`} onClick={() => onChange(rows.filter((x) => x.rid !== r.rid))}>
                Remove
              </Button>
            </div>
            {bad && (
              <span className="src-kv-error" data-testid="source-secret-error">
                This looks like a secret. Use <code>{`\${env:${r.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")}}`}</code> and set the value on this
                machine.
              </span>
            )}
          </div>
        );
      })}
      <div>
        <Button variant="ghost" size="sm" data-testid={`source-${prefix}-add`} onClick={() => onChange([...rows, newRow()])}>
          Add {what}
        </Button>
      </div>
    </div>
  );
}

const STATUS_WORD: Record<SourceTestResult["status"], string> = {
  connected: "Connected",
  failed: "Failed",
  timeout: "Timed out",
  "needs-auth": "Needs sign-in",
};

function TestResult({ result, added, onAppend }: { result: SourceTestResult; added: boolean; onAppend: () => void }) {
  return (
    <div className="src-test" data-testid="source-test-result">
      <div className="src-inline">
        <span className={`src-status src-status-${result.status}`} data-testid="source-test-status">
          <span className="src-status-dot" aria-hidden="true" />
          {STATUS_WORD[result.status]}
        </span>
        {result.serverInfo && (
          <span className="id">
            {result.serverInfo.name} {result.serverInfo.version}
          </span>
        )}
      </div>
      {result.error && (
        <p role="alert" className="src-error">
          {result.error}
        </p>
      )}
      {result.missingSecrets.length > 0 && (
        <p className="src-error">
          Not set on this machine: <span className="mono">{result.missingSecrets.join(", ")}</span>. Set them, then test again.
        </p>
      )}
      {result.status === "connected" && (
        <>
          <span className="label">
            {result.tools.length} {result.tools.length === 1 ? "tool" : "tools"}
          </span>
          {result.tools.length > 0 && (
            <ul className="src-tools" data-testid="source-test-tools">
              {result.tools.map((t) => (
                <li key={t.name}>
                  <span className="mono">{t.name}</span>
                  {t.description && <span className="muted"> {t.description}</span>}
                </li>
              ))}
            </ul>
          )}
          {result.tools.length > 0 && (
            <div>
              <Button variant="ghost" size="sm" data-testid="source-append-tools" disabled={added} onClick={onAppend}>
                {added ? "Added to usage notes" : "Add tool list to usage notes"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
