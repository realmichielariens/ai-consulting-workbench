// J2.1, J2.6, J2.7: the conversation with the Approach Agent (thread T-0001,
// created with the engagement). D5: while a turn is running, sending a
// message queues it locally and posts it automatically once the turn ends
// (a 409 from the server — a turn started between render and submit — is
// handled the same way).

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseSlotRef, type ChatMessage, type EngagementId } from "@workbench/core";
import { api, qk, ApiRequestError } from "../../api/index.js";
import { selectAsset } from "../../state/url.js";
import { ActivityStream } from "../item/ActivityStream.js";
import { ProposalCard } from "../ProposalCard.js";

export function ChatPanel({ eid }: { eid: EngagementId }) {
  const threads = useQuery({ queryKey: qk.threads(eid), queryFn: () => api.listThreads(eid) });
  const tid = threads.data?.[0]?.id ?? null;

  if (threads.status === "pending") return <p>Loading conversation…</p>;
  if (threads.status === "error") return <p role="alert">Could not load the conversation: {(threads.error as Error).message}</p>;
  if (!tid) return <p className="muted">No conversation yet.</p>;

  return <ThreadChat eid={eid} tid={tid} />;
}

function ThreadChat({ eid, tid }: { eid: EngagementId; tid: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.thread(eid, tid), queryFn: () => api.getThread(eid, tid) });
  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);

  const post = useMutation({
    mutationFn: (text: string) => api.postMessage(eid, tid, { text }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.thread(eid, tid) }),
  });

  const thread = q.data?.thread;
  const activeRunId = thread?.activeRunId ?? null;

  // The turn just ended: flush anything queued while it was running (D5).
  useEffect(() => {
    if (wasRunning.current && !activeRunId && queued != null) {
      const text = queued;
      setQueued(null);
      post.mutate(text, {
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === "conflict") setQueued(text);
        },
      });
    }
    wasRunning.current = activeRunId != null;
    // post is a stable mutation object from useMutation; including it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, queued]);

  useEffect(() => {
    // scrollIntoView is unimplemented in jsdom (unit tests render this component); guard it.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [q.data?.messages.length, activeRunId]);

  if (q.status === "pending") return <p>Loading conversation…</p>;
  if (q.status === "error") return <p role="alert">Could not load the conversation: {(q.error as Error).message}</p>;

  const send = () => {
    const text = input.trim();
    if (text.length === 0) return;
    setInput("");
    if (activeRunId) {
      setQueued(text);
      return;
    }
    post.mutate(text, {
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === "conflict") setQueued(text);
      },
    });
  };

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="chat-messages">
        {q.data.messages.map((m) => (
          <ChatMessageRow key={m.id} eid={eid} msg={m} />
        ))}

        {q.data.activeRun && (
          <div className="chat-activity" data-testid="chat-activity">
            <ActivityStream eid={eid} runId={q.data.activeRun.id} />
            <p className="muted chat-thinking">Thinking…</p>
          </div>
        )}

        {queued != null && (
          <p className="chat-queued muted" data-testid="chat-queued">
            Queued — will send once this turn ends: “{queued}”
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-send-box">
        <textarea
          data-testid="chat-input"
          rows={2}
          value={input}
          placeholder="Message the Approach Agent…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" data-testid="chat-send" disabled={input.trim().length === 0} onClick={send}>
          Send
        </button>
      </div>
      {post.isError && !(post.error instanceof ApiRequestError && post.error.code === "conflict") && (
        <p role="alert" className="error">
          {(post.error as Error).message}
        </p>
      )}
    </div>
  );
}

function ChatMessageRow({ eid, msg }: { eid: EngagementId; msg: ChatMessage }) {
  return (
    <div className={`chat-message chat-role-${msg.role}`} data-testid="chat-message" data-role={msg.role}>
      <div className="chat-message-author">{msg.role === "human" ? "You" : msg.role === "approach" ? "Approach Agent" : "System"}</div>
      {msg.role === "approach" ? (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.body}</ReactMarkdown>
        </div>
      ) : (
        <p>{msg.body}</p>
      )}
      {msg.asset && (
        <button
          type="button"
          className="link"
          data-testid="chat-asset-link"
          onClick={() => {
            const { itemId, slot } = parseSlotRef(msg.asset!.slot);
            selectAsset(itemId, slot, msg.asset!.version);
          }}
        >
          View {msg.asset.slot} v{msg.asset.version}
        </button>
      )}
      {msg.proposalId && <InlineProposal eid={eid} pid={msg.proposalId} />}
    </div>
  );
}

function InlineProposal({ eid, pid }: { eid: EngagementId; pid: string }) {
  const q = useQuery({ queryKey: qk.proposal(eid, pid), queryFn: () => api.getProposal(eid, pid) });
  if (q.status !== "success") return null;
  return <ProposalCard eid={eid} view={q.data} />;
}
