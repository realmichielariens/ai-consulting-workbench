// A small RFC 4180 reader for the Document page's CSV view. Agents and
// humans both produce these, and Excel in a European locale writes ";"
// rather than ",", so the delimiter is sniffed instead of assumed.

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** The candidate that occurs most often on the first line, ignoring quoted text. Defaults to ",". */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of stripBom(text)) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** Rows of cells. Quoted fields may contain the delimiter, newlines and doubled quotes; blank lines are dropped. */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const NUMERIC = /^[-+(]?[$€£]?\s?\d[\d.,\s]*%?\)?$/;

/** True when every non-empty cell looks like a number, so the column can be right-aligned. */
export function isNumericColumn(cells: string[]): boolean {
  let seen = false;
  for (const c of cells) {
    const t = c.trim();
    if (!t) continue;
    if (!NUMERIC.test(t)) return false;
    seen = true;
  }
  return seen;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
