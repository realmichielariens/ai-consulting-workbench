// EXHIBIT §7.4: the tracker table. Caps header over a 2px ink rule, sunken
// group rows, hover in accent-weak. Rows can be plain data rows or group
// (phase) header rows.

import type { ReactNode } from "react";
import "./primitives.css";

export interface TrackerColumn {
  key: string;
  header: string;
  align?: "left" | "right";
}

export interface TrackerGroupRow {
  kind: "group";
  key: string;
  label: ReactNode;
}

export interface TrackerDataRow {
  kind: "row";
  key: string;
  testId?: string;
  cells: Record<string, ReactNode>;
  onClick?: () => void;
}

export type TrackerRow = TrackerGroupRow | TrackerDataRow;

export function Tracker({ columns, rows, testId }: { columns: TrackerColumn[]; rows: TrackerRow[]; testId?: string }) {
  return (
    <table className="tracker" data-testid={testId}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.align === "right" ? "tracker-r" : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          row.kind === "group" ? (
            <tr key={row.key} className="tracker-group">
              <td colSpan={columns.length}>{row.label}</td>
            </tr>
          ) : (
            <tr key={row.key} data-testid={row.testId} onClick={row.onClick} className={row.onClick ? "tracker-clickable" : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "tracker-r" : undefined}>
                  {row.cells[c.key]}
                </td>
              ))}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
