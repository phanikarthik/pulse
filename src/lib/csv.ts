type Cell = string | number | null | undefined;

const quote = (c: Cell) => {
  const s = c == null ? "" : String(c);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Saves rows as a .csv the browser downloads. The BOM makes Excel read it as UTF-8. */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const text = "﻿" + rows.map((r) => r.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
