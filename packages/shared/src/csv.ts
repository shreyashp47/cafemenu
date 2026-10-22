/**
 * CSV, as spreadsheets write it and owners paste it (issue #16).
 *
 * RFC 4180 with the habits of real files: a UTF-8 byte-order mark (Excel's
 * "CSV UTF-8"), Windows or old-Mac line endings, quoted cells holding commas,
 * line breaks or doubled quotes, and a missing newline at the end. Three
 * separators, found from the first row:
 *
 *   - comma, the default;
 *   - tab, what a spreadsheet puts on the clipboard when cells are copied;
 *   - semicolon, Excel's CSV wherever a comma is the decimal mark ("3,50").
 *
 * Like the rest of this package: no dependencies, erasable syntax only.
 */

export type CsvDelimiter = "," | "\t" | ";";

export interface CsvRow {
  /** The cells as written, unquoted. Line breaks inside a cell are "\n". */
  cells: string[];
  /** 1-based, counting every row the file has, as a spreadsheet numbers them. */
  row: number;
  /** Where the row is in the text: `text.slice(start, end)` is it, unquoted or not. */
  start: number;
  end: number;
}

const DELIMITERS: CsvDelimiter[] = ["\t", ";", ","];

/**
 * The separator that splits the first row into the most cells. A tab or
 * semicolon wins a tie, since a comma can be a decimal mark or sit in a
 * description, and those two rarely appear by accident.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  let best: CsvDelimiter = ",";
  let most = 0;
  for (const delimiter of DELIMITERS) {
    // The first row with something in it: a paste can start with a blank line.
    const first = scan(text.replace(/^[\uFEFF\s]+/, ""), delimiter, 1)[0];
    const count = first?.cells.length ?? 0;
    if (count > most) {
      best = delimiter;
      most = count;
    }
  }
  return best;
}

/**
 * Every row of the text, blank ones included so the row numbers match the
 * spreadsheet's. A file's last line break does not start another row.
 */
export function parseCsv(text: string, delimiter?: CsvDelimiter): CsvRow[] {
  return scan(text, delimiter ?? detectDelimiter(text), Infinity);
}

function scan(text: string, delimiter: string, limit: number): CsvRow[] {
  const rows: CsvRow[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length && rows.length < limit) {
    const start = i;
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    let atCellStart = true;
    let end = text.length;
    let next = text.length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === "\r") {
          if (text[i + 1] !== "\n") cell += "\n";
        } else if (ch !== '"') cell += ch;
        else if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else if (ch === '"' && atCellStart) {
        quoted = true;
        atCellStart = false;
      } else if (ch === delimiter) {
        cells.push(cell);
        cell = "";
        atCellStart = true;
      } else if (ch === "\n" || ch === "\r") {
        end = i;
        next = ch === "\r" && text[i + 1] === "\n" ? i + 2 : i + 1;
        break;
      } else {
        cell += ch;
        // Spaces before an opening quote are still the cell's start: `a, "b"`.
        if (ch !== " ") atCellStart = false;
      }
    }
    cells.push(cell);
    rows.push({ cells, row: rows.length + 1, start, end });
    i = next;
  }
  return rows;
}

/** One cell, quoted only when it has to be. */
export function csvCell(value: string, delimiter: CsvDelimiter = ","): string {
  return value.includes(delimiter) || /["\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Rows of cells as CSV text, one line each, ending with a line break. */
export function toCsv(
  rows: readonly (readonly string[])[],
  delimiter: CsvDelimiter = ",",
): string {
  return rows
    .map((cells) => cells.map((c) => csvCell(c, delimiter)).join(delimiter))
    .map((line) => line + "\n")
    .join("");
}
