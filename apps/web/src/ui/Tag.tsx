// EXHIBIT §7.2: 22px sunken tags. Variants: outline, accent, source (mono).

import type { ReactNode } from "react";
import "./primitives.css";

export function Tag({ variant, children }: { variant?: "outline" | "accent"; children: ReactNode }) {
  return <span className={`tag${variant ? ` tag-${variant}` : ""}`}>{children}</span>;
}
