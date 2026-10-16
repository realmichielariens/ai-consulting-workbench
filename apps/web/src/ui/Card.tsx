// EXHIBIT §7.3: the decision-card anatomy (kicker, title, evidence, actions).
// This is the shared shell; each Brief card variant (B/C's work) fills the slots.

import type { ReactNode } from "react";
import "./primitives.css";

export function Card({
  kicker,
  title,
  evidence,
  actions,
  testId,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  evidence?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <article className="card" data-testid={testId}>
      {kicker && <div className="card-kicker">{kicker}</div>}
      <h4 className="card-title">{title}</h4>
      {evidence && <div className="card-evidence">{evidence}</div>}
      {actions && <div className="card-actions">{actions}</div>}
    </article>
  );
}
