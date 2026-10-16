// The Read view of a .csv asset: the first row is the header, numeric
// columns are right-aligned, and very large files are cut off so the page
// stays responsive (Download has the full file).

import { useMemo } from "react";
import { isNumericColumn, parseCsv } from "./csv.js";

const MAX_ROWS = 2000;

export function CsvTable({ text }: { text: string }) {
  const { header, body, total, numeric } = useMemo(() => {
    const rows = parseCsv(text);
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const pad = (r: string[]) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r);
    const [head = [], ...rest] = rows;
    const shown = rest.slice(0, MAX_ROWS).map(pad);
    return {
      header: pad(head),
      body: shown,
      total: rest.length,
      numeric: Array.from({ length: width }, (_, c) => isNumericColumn(shown.map((r) => r[c]!))),
    };
  }, [text]);

  if (header.length === 0) return <p className="muted">This file is empty.</p>;

  return (
    <div className="csv" data-testid="csv-table">
      <div className="csv-scroll">
        <table>
          <thead>
            <tr>
              {header.map((h, c) => (
                <th key={c} className={numeric[c] ? "num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={numeric[c] ? "num" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="csv-count">
        {total > MAX_ROWS
          ? `Showing the first ${MAX_ROWS.toLocaleString()} of ${total.toLocaleString()} rows. Download for the rest.`
          : `${total.toLocaleString()} ${total === 1 ? "row" : "rows"} · ${header.length} ${header.length === 1 ? "column" : "columns"}`}
      </p>
    </div>
  );
}
