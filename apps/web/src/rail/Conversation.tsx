// UX1 brief C §Build 4: the Approach rail's conversation, as memos (EXHIBIT
// §7.4) instead of bubbles. Used by RailContent (the collapsed rail and the
// /conversation stage tab) and KickoffPage (the Frame mode, full stage).
// Ports components/chat/ChatPanel.tsx: same D5 queueing (J2.6/J2.7) and
// activity streaming, now with the C2 stage-context chip.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, EngagementId, StageContext } from "@workbench/core";
import { api, qk, ApiRequestError } from "../api/index.js";
import { openDoc, useStageContext } from "../shell/nav.js";
import { useShortcut } from "../shell/shortcuts.js";
import { Button } from "../ui/index.js";
import { ActivityStream } from "../components/item/ActivityStream.js";
import { ProposalCard } from "../components/decisions/ProposalCard.js";
import "./Conversation.css";

export function Conversation({ eid }: { eid: EngagementId }) {
  const threads = useQuery({ queryKey: qk.threads(eid), queryFn: () => api.listThreads(eid) });
  const tid = threads.data?.[0]?.id ?? null;

  if (threads.status === "pending") return <p className="muted">Loading conversation…</p>;
  if (threads.status === "error") return <p role="alert">Could not load the conversation: {(threads.error as Error).message}</p>;
  if (!tid) return <p className="muted">No conversation yet.</p>;

  return <ThreadChat eid={eid} tid={tid} />;
}

function ThreadChat({ eid, tid }: { eid: EngagementId; tid: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.thread(eid, tid), queryFn: () => api.getThread(eid, tid) });
  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<{ text: string; context?: StageContext } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasRunning = useRef(false);

  const stageContext = useStageContext();
  const [contextClearedFor, setContextClearedFor] = useState<string | null>(null);
  const contextRef = stageContext ? `${stageContext.kind}:${stageContext.ref}:${stageContext.version ?? ""}` : null;
  const activeContext = stageContext && contextClearedFor !== contextRef ? stageContext : null;
  // What actually goes over the wire (C2's StageContext) — strips the display-only `label`.
  const sendableContext: StageContext | null = activeContext ? { kind: activeContext.kind, ref: activeContext.ref, version: activeContext.version } : null;

  useShortcut("/", () => textareaRef.current?.focus());

  const post = useMutation({
    mutationFn: (vars: { text: string; context?: StageContext }) => api.postMessage(eid, tid, vars),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.thread(eid, tid) }),
  });

  const thread = q.data?.thread;
  const activeRunId = thread?.activeRunId ?? null;

  // The turn just ended: flush anything queued while it was running (D5).
  useEffect(() => {
    if (wasRunning.current && !activeRunId && queued != null) {
      const vars = queued;
      setQueued(null);
      post.mutate(vars, {
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === "conflict") setQueued(vars);
        },
      });
    }
    wasRunning.current = activeRunId != null;
    // post is a stable mutation object from useMutation; including it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, queued]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [q.data?.messages.length, activeRunId]);

  if (q.status === "pending") return <p className="muted">Loading conversation…</p>;
  if (q.status === "error") return <p role="alert">Could not load the conversation: {(q.error as Error).message}</p>;

  const send = () => {
    const text = input.trim();
    if (text.length === 0) return;
    setInput("");
    const vars: { text: string; context?: StageContext } = sendableContext ? { text, context: sendableContext } : { text };
    setContextClearedFor(null); // a chip that was cleared applies to one message only
    if (activeRunId) {
      setQueued(vars);
      return;
    }
    post.mutate(vars, {
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === "conflict") setQueued(vars);
      },
    });
  };

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="chat-messages">
        {q.data.messages.length === 0 && !q.data.activeRun && (
          <p className="chat-empty">
            Nothing said yet. To start, describe the engagement: the client, what they asked for, who is involved and when it is due. Later,
            ask about the plan or the document you have open. The Approach Agent answers here, with its sources.
          </p>
        )}
        {q.data.messages.map((m) => (
          <Memo key={m.id} eid={eid} msg={m} />
        ))}

        {q.data.activeRun && (
          <div className="chat-activity" data-testid="chat-activity">
            <ActivityStream eid={eid} runId={q.data.activeRun.id} />
          </div>
        )}

        {queued != null && (
          <p className="chat-queued muted" data-testid="chat-queued">
            Queued — will send once this turn ends: "{queued.text}"
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-foot">
        {activeContext && (
          <div className="context-chip" data-testid="context-chip">
            <span>
              Viewing <b>{activeContext.label}</b> · the agent sees this
            </span>
            <button type="button" data-testid="context-chip-clear" aria-label="Stop sharing this context" onClick={() => setContextClearedFor(contextRef)}>
              ✕
            </button>
          </div>
        )}
        <div className="composer">
          <textarea
            ref={textareaRef}
            className="composer-input"
            data-testid="chat-input"
            rows={2}
            value={input}
            placeholder="Ask, instruct, or message the Approach Agent…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-row">
            <span className="spacer" />
            <Button variant="primary" size="sm" kbd="⌘↵" data-testid="chat-send" disabled={input.trim().length === 0} onClick={send}>
              Send
            </Button>
          </div>
        </div>
        {post.isError && !(post.error instanceof ApiRequestError && post.error.code === "conflict") && (
          <p role="alert" className="error">
            {(post.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}

function Memo({ eid, msg }: { eid: EngagementId; msg: ChatMessage }) {
  const isHuman = msg.role === "human";
  return (
    <div className={`msg${isHuman ? " msg-human" : ""}`} data-testid="chat-message" data-role={msg.role}>
      <div className="msg-head">
        <span className={`avatar ${isHuman ? "avatar-hu" : "avatar-aa"}`}>{isHuman ? "Y" : "A"}</span>
        <b>{isHuman ? "You" : msg.role === "approach" ? "Approach Agent" : "System"}</b>
      </div>
      <div className="msg-body">
        {msg.role === "approach" ? (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.body}</ReactMarkdown>
          </div>
        ) : (
          <p>{msg.body}</p>
        )}
      </div>
      {msg.asset && (
        <button
          type="button"
          className="tag tag-src"
          data-testid="chat-asset-link"
          onClick={() => openDoc(eid, msg.asset!.slot, msg.asset!.version)}
        >
          {msg.asset.slot} v{msg.asset.version}
        </button>
      )}
      {msg.proposalId && <InlineProposal eid={eid} pid={msg.proposalId} />}
    </div>
  );
}

function InlineProposal({ eid, pid }: { eid: EngagementId; pid: string }) {
  const q = useQuery({ queryKey: qk.proposal(eid, pid), queryFn: () => api.getProposal(eid, pid) });
  if (q.status !== "success") return null;
  return (
    <div className="inline-prop">
      <ProposalCard eid={eid} view={q.data} />
    </div>
  );
}
