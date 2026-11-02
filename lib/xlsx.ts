/**
 * Small, dependency-free .xlsx writer (real Excel files: colours, filters, frozen header,
 * number formats, totals that follow the filter). Also opens in Google Sheets / LibreOffice.
 */
const enc = new TextEncoder();

/* ------------------------------- zip (stored) ------------------------------ */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const len = f.data.length;
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, len, true);
    v.setUint32(22, len, true);
    v.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, f.data);

    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, len, true);
    c.setUint32(24, len, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + len;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

/* --------------------------------- styles ---------------------------------- */
const FONTS = [
  '<font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>', // 0 normal
  '<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>', // 1 bold
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>', // 2 header
  '<font><b/><sz val="18"/><color rgb="FF047857"/><name val="Calibri"/><family val="2"/></font>', // 3 title
  '<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>', // 4 subtitle
  '<font><b/><sz val="11"/><color rgb="FFBE123C"/><name val="Calibri"/><family val="2"/></font>', // 5 red
  '<font><b/><sz val="11"/><color rgb="FF047857"/><name val="Calibri"/><family val="2"/></font>', // 6 green
  '<font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>', // 7 section
];
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FF059669"/><bgColor indexed="64"/></patternFill></fill>', // 2 emerald
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>', // 3 band
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/><bgColor indexed="64"/></patternFill></fill>', // 4 light green
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>', // 5 light red
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>', // 6 section
];
const BORDERS = [
  "<border><left/><right/><top/><bottom/><diagonal/></border>",
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>',
];
const NUMFMTS: [number, string][] = [
  [164, '"Rs "#,##0.00'],
  [165, "yyyy\\-mm\\-dd"],
  [166, "#,##0"],
];
type Xf = { f?: number; fl?: number; b?: number; n?: number; h?: string; wrap?: boolean; i?: number };
const XF: Record<string, Xf> = {
  def: {},
  header: { f: 2, fl: 2, h: "center", wrap: true },
  title: { f: 3 },
  sub: { f: 4 },
  section: { f: 7, fl: 6 },
  text: { b: 1, i: 1 },
  textAlt: { b: 1, fl: 3, i: 1 },
  wrap: { b: 1, wrap: true, i: 1 },
  wrapAlt: { b: 1, fl: 3, wrap: true, i: 1 },
  int: { b: 1, n: 166 },
  intAlt: { b: 1, fl: 3, n: 166 },
  money: { b: 1, n: 164 },
  moneyAlt: { b: 1, fl: 3, n: 164 },
  date: { b: 1, n: 165, h: "left" },
  dateAlt: { b: 1, fl: 3, n: 165, h: "left" },
  bold: { f: 1, b: 1, i: 1 },
  boldAlt: { f: 1, b: 1, fl: 3, i: 1 },
  bad: { f: 5, b: 1, i: 1 },
  badAlt: { f: 5, b: 1, fl: 3, i: 1 },
  good: { f: 6, b: 1, i: 1 },
  goodAlt: { f: 6, b: 1, fl: 3, i: 1 },
  totalLabel: { f: 1, fl: 4, b: 1, i: 1 },
  totalInt: { f: 1, fl: 4, b: 1, n: 166 },
  totalMoney: { f: 1, fl: 4, b: 1, n: 164 },
  boldMoney: { f: 1, b: 1, n: 164 },
  boldInt: { f: 1, b: 1, n: 166 },
};
const XF_NAMES = Object.keys(XF);
const xfIndex = (s?: string) => Math.max(0, XF_NAMES.indexOf(s ?? "def"));

function stylesXml(): string {
  const xfs = XF_NAMES.map((k) => {
    const x = XF[k];
    const h = x.h ?? (x.i ? "left" : "");
    const align = `<alignment${h ? ` horizontal="${h}"` : ""} vertical="center"${x.wrap ? ' wrapText="1"' : ""}${x.i ? ` indent="${x.i}"` : ""}/>`;
    return `<xf numFmtId="${x.n ?? 0}" fontId="${x.f ?? 0}" fillId="${x.fl ?? 0}" borderId="${x.b ?? 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  }).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${NUMFMTS.length}">${NUMFMTS.map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join("")}</numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.join("")}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.join("")}</fills>` +
    `<borders count="${BORDERS.length}">${BORDERS.join("")}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${XF_NAMES.length}">${xfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

/* ---------------------------------- sheets --------------------------------- */
type XObj = { v?: string | number | null; s?: string; f?: string };
export type XCell = string | number | null | undefined | XObj;
const norm = (c: XCell): XObj => (typeof c === "object" && c !== null ? c : { v: c as string | number | null | undefined });
export type XSheet = {
  name: string;
  tab?: string; // tab colour, e.g. "FF059669"
  widths: number[];
  rows: XCell[][];
  freeze?: number; // rows to keep visible when scrolling
  filter?: { row: number; cols: number; last: number }; // 1-based header row, column count, last row
  merges?: string[];
  heights?: Record<number, number>; // 1-based row -> points
  landscape?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const safeName = (n: string) => n.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";

function sheetXml(sh: XSheet): string {
  const ncols = Math.max(sh.widths.length, ...sh.rows.map((r) => r.length), 1);
  const rowsXml = sh.rows
    .map((row, ri) => {
      const r = ri + 1;
      const ht = sh.heights?.[r];
      const cells = row
        .map((raw, ci) => {
          const ref = `${colName(ci)}${r}`;
          const o = norm(raw);
          const s = xfIndex(o.s);
          if (o.f !== undefined) return `<c r="${ref}" s="${s}"><f>${esc(o.f)}</f>${typeof o.v === "number" ? `<v>${o.v}</v>` : ""}</c>`;
          if (o.v === null || o.v === undefined || o.v === "") return `<c r="${ref}" s="${s}"/>`;
          if (typeof o.v === "number") return Number.isFinite(o.v) ? `<c r="${ref}" s="${s}"><v>${o.v}</v></c>` : `<c r="${ref}" s="${s}"/>`;
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");

  const pane = sh.freeze
    ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>`
    : "";
  const cols = sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetPr>${sh.tab ? `<tabColor rgb="${sh.tab}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${colName(ncols - 1)}${Math.max(sh.rows.length, 1)}"/>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    (sh.filter ? `<autoFilter ref="A${sh.filter.row}:${colName(sh.filter.cols - 1)}${Math.max(sh.filter.last, sh.filter.row)}"/>` : "") +
    (sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "") +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup paperSize="9" orientation="${sh.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
    "</worksheet>"
  );
}

export function buildXlsx(sheets: XSheet[]): Uint8Array {
  const names = sheets.map((s) => safeName(s.name));
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, xml: string) => files.push({ name, data: enc.encode(xml) });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  add(
    "[Content_Types].xml",
    X +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>"
  );
  add(
    "_rels/.rels",
    X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  const defined = sheets
    .map((s, i) =>
      s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$${s.filter.row}:$${colName(s.filter.cols - 1)}$${Math.max(s.filter.last, s.filter.row)}</definedName>` : ""
    )
    .join("");
  add(
    "xl/workbook.xml",
    X +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (defined ? `<definedNames>${defined}</definedNames>` : "") +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      "</workbook>"
  );
  add(
    "xl/_rels/workbook.xml.rels",
    X +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>"
  );
  add("xl/styles.xml", stylesXml());
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip(files);
}

/* ------------------------- a ready-made "table" sheet ---------------------- */
export type Col = { h: string; w: number; t: "text" | "int" | "money" | "date" | "wrap" };

/** "2026-11-02" -> Excel date number (so sorting and filtering by date work). */
export const excelDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
};

/**
 * Title, subtitle, coloured header with filter buttons, zebra rows, and an optional
 * totals row (SUBTOTAL, so it recalculates for whatever rows are filtered).
 */
export function tableSheet(o: {
  name: string;
  tab?: string;
  title: string;
  subtitle: string;
  cols: Col[];
  rows: XCell[][];
  totals?: number[]; // column indexes to total
  landscape?: boolean;
}): XSheet {
  const HEAD = 4;
  const n = o.cols.length;
  const out: XCell[][] = [[{ v: o.title, s: "title" }], [{ v: o.subtitle, s: "sub" }], [], o.cols.map((c) => ({ v: c.h, s: "header" }))];

  o.rows.forEach((row, ri) => {
    const alt = ri % 2 === 1;
    out.push(
      o.cols.map((c, ci) => {
        const obj = norm(row[ci]);
        let v = obj.v;
        if (c.t === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = excelDate(v);
        const base = obj.s ?? (c.t === "date" && typeof v === "string" ? "text" : c.t);
        const s = alt && XF[base + "Alt"] ? base + "Alt" : base;
        return { v, s };
      })
    );
  });

  const first = HEAD + 1;
  const last = HEAD + o.rows.length;
  if (o.totals?.length && o.rows.length) {
    out.push(
      o.cols.map((c, ci) => {
        if (ci === 0) return { v: "Total (shown rows)", s: "totalLabel" };
        if (!o.totals!.includes(ci)) return { v: null, s: "totalLabel" };
        const sum = o.rows.reduce((t, r) => {
          const v = norm(r[ci]).v;
          return t + (typeof v === "number" ? v : 0);
        }, 0);
        return { f: `SUBTOTAL(109,${colName(ci)}${first}:${colName(ci)}${last})`, v: Math.round(sum * 100) / 100, s: c.t === "int" ? "totalInt" : "totalMoney" };
      })
    );
  }

  return {
    name: o.name,
    tab: o.tab,
    widths: o.cols.map((c) => c.w),
    rows: out,
    freeze: HEAD,
    filter: o.rows.length ? { row: HEAD, cols: n, last } : undefined,
    merges: [`A1:${colName(Math.max(n - 1, 1))}1`, `A2:${colName(Math.max(n - 1, 1))}2`],
    heights: { 1: 30, [HEAD]: 24 },
    landscape: o.landscape ?? n > 7,
  };
}
