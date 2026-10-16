// EXHIBIT §5: the closed signal vocabulary. Ported verbatim from the
// playground's GLYPH/EXEC/GATE/DOC/harvey (ux/playground/index.html §07) so
// the drawings stay the reference. Colour is never the only signal: Status
// always renders the glyph plus the word.

import type { ReactNode } from "react";
import type { ItemStatus } from "@workbench/core";
import "./glyphs.css";

const STATUS_META: Record<ItemStatus, { label: string; note: string }> = {
  draft: { label: "Draft", note: "Proposed, not approved" },
  waiting: { label: "Waiting", note: "Its inputs don't exist yet" },
  ready: { label: "Ready", note: "Can start" },
  in_progress: { label: "In progress", note: "An agent, or you, is working" },
  blocked: { label: "Blocked", note: "Needs an answer" },
  at_gate: { label: "At gate", note: "Waiting for a review or endorsement" },
  done: { label: "Done", note: "Outputs accepted" },
  stale: { label: "Stale", note: "An input changed materially" },
  cancelled: { label: "Cancelled", note: "Dropped from the plan" },
};

/** playground GLYPH: 14px SVGs, one per ItemStatus (EXHIBIT §5.1). */
function statusPath(status: ItemStatus): ReactNode {
  switch (status) {
    case "draft":
      return <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />;
    case "waiting":
      return <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.4" />;
    case "ready":
      return <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2.4" />;
    case "in_progress":
      return (
        <>
          <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.4" />
          <path className="glyph-spin" d="M7 1.8A5.2 5.2 0 0 1 7 12.2Z" fill="currentColor" />
        </>
      );
    case "blocked":
      return (
        <>
          <rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor" />
          <path d="M4.5 7h5" stroke="var(--surface)" strokeWidth="1.6" />
        </>
      );
    case "at_gate":
      return (
        <>
          <path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 4.3 9.7 7 7 9.7 4.3 7Z" fill="currentColor" />
        </>
      );
    case "done":
      return (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.2 7.2 6.1 9 9.8 5.2" stroke="var(--surface)" strokeWidth="1.6" fill="none" />
        </>
      );
    case "stale":
      return (
        <>
          <path d="M7 1.5 13 12.3H1Z" fill="currentColor" />
          <path d="M7 5.3v3.2M7 10v.4" stroke="var(--surface)" strokeWidth="1.5" />
        </>
      );
    case "cancelled":
      return (
        <>
          <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.3 10.7 10.7 3.3" stroke="currentColor" strokeWidth="1.4" />
        </>
      );
  }
}

/** The bare 14px glyph. Always pair with a label (StatusGlyph is bare only for compact uses; prefer Status). */
export function StatusGlyph({ status, title }: { status: ItemStatus; title?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      {statusPath(status)}
    </svg>
  );
}

/** Glyph + label, coloured by --status-<ItemStatus>. The hover title carries the meaning (EXHIBIT §5.1 "shown on hover"). */
export function Status({ status, bare = false }: { status: ItemStatus; bare?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status s-${status}${status === "cancelled" ? " status-struck" : ""}`} title={meta.note}>
      <StatusGlyph status={status} />
      {!bare && <span className="status-t">{meta.label}</span>}
    </span>
  );
}

const CRITERION: Record<"yes" | "partial" | "no", { status: ItemStatus; label: string }> = {
  yes: { status: "done", label: "Met" },
  partial: { status: "stale", label: "Partially met" },
  no: { status: "blocked", label: "Not met" },
};

/**
 * An acceptance criterion's self-check, as a glyph in the status colours. It is
 * glyph-only next to the criterion text, so it carries its own label (EXHIBIT §9).
 */
export function CriterionGlyph({ met }: { met: "yes" | "partial" | "no" }) {
  const c = CRITERION[met];
  return (
    <span className={`status s-${c.status}`} title={c.label}>
      <StatusGlyph status={c.status} title={c.label} />
    </span>
  );
}

/** playground EXEC: outline robot (agent) / person (human). No emoji anywhere (EXHIBIT §5.2). */
export function ExecGlyph({ executor }: { executor: "agent" | "human" }) {
  if (executor === "agent") {
    return (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="1.5" y="3" width="11" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7 3V1M4.8 7h.01M9.2 7h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="4.5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 13c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** playground GATE: outline diamond (review) / filled diamond (endorsement). */
export function GateGlyph({ kind }: { kind: "review" | "endorse" }) {
  if (kind === "endorse") {
    return (
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** playground DOC: filled when the slot is published, dashed when empty. */
export function DocGlyph({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
        <path d="M1 1h6.5L11 4.5V13H1Z" fill="var(--sunken)" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.5 1v3.5H11" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
      <path d="M1 1h6.5L11 4.5V13H1Z" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" />
    </svg>
  );
}

/** playground harvey(): a 14px circle, filled 0/25/50/75/100%. */
export function HarveyBall({ quarters, label }: { quarters: 0 | 1 | 2 | 3 | 4; label?: string }) {
  const r = 6;
  const c = 7;
  let fill: ReactNode = null;
  if (quarters >= 4) {
    fill = <circle cx={c} cy={c} r={r} fill="currentColor" />;
  } else if (quarters > 0) {
    const a = (quarters / 4) * 2 * Math.PI;
    const x = c + r * Math.sin(a);
    const y = c - r * Math.cos(a);
    fill = <path d={`M${c} ${c}V${c - r}A${r} ${r} 0 ${quarters > 2 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`} fill="currentColor" />;
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" role="img" aria-label={label ?? `${quarters * 25}% complete`} className="harvey-ball">
      <circle cx={c} cy={c} r={r} stroke="currentColor" strokeWidth="1.2" />
      {fill}
    </svg>
  );
}

/** done/total (leaf tasks, cancelled excluded — U0 C6) into the nearest quarter. */
export function harveyFromRatio(done: number, total: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  const q = Math.round((done / total) * 4);
  return Math.min(4, Math.max(0, q)) as 0 | 1 | 2 | 3 | 4;
}
