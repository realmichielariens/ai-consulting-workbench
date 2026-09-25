// D4: the Approach Agent's own journal (ENG/work/approach-journal.md),
// read-only. Refetched on JournalAppended (useEngagementSocket.ts).

import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EngagementId } from "@workbench/core";
import { api, qk } from "../api/index.js";

export function ApproachTab({ eid }: { eid: EngagementId }) {
  const q = useQuery({ queryKey: qk.journal(eid), queryFn: () => api.getJournal(eid) });

  if (q.status === "pending") return <p>Loading journal…</p>;
  if (q.status === "error") return <p role="alert">Could not load the journal: {(q.error as Error).message}</p>;

  return (
    <div className="markdown approach-journal" data-testid="approach-journal">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.data.markdown || "_Nothing written yet._"}</ReactMarkdown>
    </div>
  );
}
