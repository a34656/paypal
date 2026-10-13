/**
 * CSV formula-injection guard. Spreadsheet apps execute cells beginning with
 * = + - @ (and tab / carriage return). Prefix such cells with a single quote.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return DANGEROUS.test(s) ? `'${s}` : s;
}

/** RFC 4180 quoting on top of injection escaping (used for server-side CSV). */
export function toCsvField(value: unknown): string {
  const s = escapeCsvCell(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(toCsvField).join(",")];
  for (const r of rows) lines.push(columns.map((c) => toCsvField(r[c])).join(","));
  return lines.join("\r\n");
}
