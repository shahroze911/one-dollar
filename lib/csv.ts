/** CSV that opens correctly in Excel and Google Sheets (UTF-8 with BOM, quoted cells, Urdu/emoji safe). */
export type Cell = string | number | boolean | null | undefined;

function esc(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  // a text cell that starts with = + - @ would be run as a formula by Excel: make it plain text
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: Cell[][]) => "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadFile(filename: string, content: string | Uint8Array, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shop";
