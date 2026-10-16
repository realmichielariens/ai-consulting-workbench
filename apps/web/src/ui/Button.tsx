// EXHIBIT §7.2. One primary per region; ink commits a formal record;
// disabled buttons always say why (Allowed.reason), in a tooltip.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./primitives.css";

export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** A mono shortcut hint rendered inside the button, e.g. "A". */
  kbd?: string;
  /** When set, the button is disabled and this is shown as its tooltip / accessible reason. */
  disabledReason?: string | null;
  children: ReactNode;
  /** @types/react's HTMLAttributes has no data-* index signature; declared explicitly so callers can pass test ids. */
  "data-testid"?: string;
}

export function Button({ variant = "secondary", size = "md", kbd, disabledReason, disabled, children, className, ...rest }: ButtonProps) {
  const isDisabled = disabled || !!disabledReason;
  return (
    <button
      type="button"
      className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""}${className ? ` ${className}` : ""}`}
      disabled={isDisabled}
      title={disabledReason ?? undefined}
      aria-disabled={isDisabled || undefined}
      {...rest}
    >
      {children}
      {kbd && <span className="btn-kbd">{kbd}</span>}
    </button>
  );
}
