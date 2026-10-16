// EXHIBIT §5.2: minor outlined ("1.1"), material ink-filled ("2.0").

import type { VersionKind } from "@workbench/core";
import "./primitives.css";

export function Version({ version, kind }: { version: string; kind: VersionKind }) {
  return <span className={`ver${kind === "material" ? " ver-material" : ""}`}>{version}</span>;
}
