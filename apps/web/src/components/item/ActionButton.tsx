// EXHIBIT §9 "every decision action is reachable...disabled buttons always
// show why": the ui/Button primitive only shows disabledReason as a
// tooltip, so this wraps it with the reason as visible helper text too
// (kept from the pre-UX1 ItemDetail, whose ActionButton this replaces).

import { Button, type ButtonVariant } from "../../ui/index.js";

export function ActionButton({
  label,
  testId,
  allowed,
  pending,
  onClick,
  variant = "secondary",
  kbd,
}: {
  label: string;
  testId: string;
  allowed: { allowed: boolean; reason: string | null };
  pending: boolean;
  onClick: () => void;
  variant?: ButtonVariant;
  kbd?: string;
}) {
  return (
    <div className="action-with-reason">
      <Button variant={variant} data-testid={testId} disabled={!allowed.allowed || pending} onClick={onClick} kbd={kbd} aria-label={label}>
        {label}
      </Button>
      {!allowed.allowed && allowed.reason && <span className="helper-text">{allowed.reason}</span>}
    </div>
  );
}
