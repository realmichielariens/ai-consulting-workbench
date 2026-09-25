// EXHIBIT §7.2/P5: a citation. Mono, 1px rule outline, accent on hover.
// onClick opens the asset (the caller decides what "open" means, e.g. shell/nav openDoc).

import "./primitives.css";

export function SourceChip({ children, onClick, implicit = false }: { children: string; onClick?: () => void; implicit?: boolean }) {
  return (
    <button type="button" className={`tag tag-src${implicit ? " tag-src-implicit" : ""}`} onClick={onClick} title={implicit ? "Implicit read: beyond the declared inputs" : undefined}>
      {children}
    </button>
  );
}
