const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeCsvFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeCsvValue(value: unknown): string {
  const text = value === null || value === undefined
    ? ""
    : value instanceof Date
      ? value.toISOString()
      : String(value);
  const safeText = neutralizeCsvFormula(text).replace(/"/g, '""');
  return `"${safeText}"`;
}

export function createCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
