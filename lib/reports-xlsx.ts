import { buildXlsx, tableSheet, type Col, type XCell, type XSheet } from "./xlsx";
import { dayKey, timeKey, type RangeData, type Summary } from "./reports";
import type { Refund, Sale, ShiftRow } from "./types";

const GREEN = "FF059669";
const n2 = (n: number) => Math.round(n * 100) / 100;
const no = (id: number) => String(id).padStart(6, "0");
const pay = (s: Sale, m: string) => (s.payments ?? []).filter((p) => p.method === m).reduce((t, p) => t + Number(p.amount), 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stamp = () => new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const sub = (label: string) => `${label}  ·  made ${stamp()}`;

/* -------------------------------- one sheet each ------------------------------- */
export function salesSheet(sales: Sale[], shop: string, label: string): XSheet {
  const cols: Col[] = [
    { h: "Receipt no", w: 12, t: "text" }, { h: "Date", w: 12, t: "date" }, { h: "Time", w: 8, t: "text" }, { h: "Cashier", w: 14, t: "text" },
    { h: "Items", w: 8, t: "int" }, { h: "Subtotal", w: 14, t: "money" }, { h: "Sale discount", w: 14, t: "money" }, { h: "Total", w: 14, t: "money" },
    { h: "Payment", w: 11, t: "text" }, { h: "Cash", w: 13, t: "money" }, { h: "Card", w: 13, t: "money" }, { h: "Wallet", w: 13, t: "money" },
    { h: "Status", w: 12, t: "text" }, { h: "Refunded", w: 13, t: "money" }, { h: "Offline sale", w: 11, t: "text" }, { h: "Needs review", w: 12, t: "text" }, { h: "Review note", w: 44, t: "wrap" },
  ];
  const rows: XCell[][] = sales.map((s) => [
    no(s.id), dayKey(s.created_at), timeKey(s.created_at), (s.cashier ?? "").split("@")[0], s.items_count, Number(s.subtotal), Number(s.discount), Number(s.total),
    cap(s.payment_method), n2(pay(s, "cash")), n2(pay(s, "card")), n2(pay(s, "wallet")),
    s.voided ? { v: "Voided", s: "bad" } : "Completed",
    n2((s.refunds ?? []).reduce((t, r) => t + Number(r.amount), 0)),
    s.offline ? "Yes" : "No", s.needs_review ? { v: "Yes", s: "bad" } : "No", s.review_note ?? "",
  ]);
  return tableSheet({ name: "Sales", tab: GREEN, title: `${shop}: all sales`, subtitle: `${sub(label)}  ·  tip: use the filter arrows; totals follow the filter. Filter Status = Completed to leave out voided sales.`, cols, rows, totals: [4, 5, 6, 7, 9, 10, 11, 13] });
}

export function itemsSheet(sales: Sale[], shop: string, label: string): XSheet {
  const cols: Col[] = [
    { h: "Receipt no", w: 12, t: "text" }, { h: "Date", w: 12, t: "date" }, { h: "Time", w: 8, t: "text" }, { h: "Status", w: 12, t: "text" },
    { h: "Product", w: 34, t: "text" }, { h: "Barcode", w: 18, t: "text" }, { h: "Qty", w: 8, t: "int" }, { h: "Unit price", w: 13, t: "money" },
    { h: "Line discount", w: 14, t: "money" }, { h: "Line total", w: 14, t: "money" }, { h: "Unit cost", w: 13, t: "money" }, { h: "Line profit", w: 14, t: "money" },
  ];
  const rows: XCell[][] = sales.flatMap((s) =>
    s.sale_items.map((i): XCell[] => {
      const lt = n2(Number(i.unit_price) * i.qty - Number(i.discount ?? 0));
      const uc = i.unit_cost == null ? null : Number(i.unit_cost);
      return [no(s.id), dayKey(s.created_at), timeKey(s.created_at), s.voided ? { v: "Voided", s: "bad" } : "Completed", i.name, i.barcode ?? "", i.qty, Number(i.unit_price), Number(i.discount ?? 0), lt, uc, uc == null ? null : n2(lt - uc * i.qty)];
    })
  );
  return tableSheet({ name: "Sold items", tab: "FF0EA5E9", title: `${shop}: items sold`, subtitle: `${sub(label)}  ·  one row per item on each receipt`, cols, rows, totals: [6, 8, 9, 11] });
}

export function refundsSheet(refunds: Refund[], shop: string, label: string): XSheet {
  const cols: Col[] = [
    { h: "Refund no", w: 12, t: "text" }, { h: "Date", w: 12, t: "date" }, { h: "Time", w: 8, t: "text" }, { h: "Original receipt", w: 16, t: "text" },
    { h: "Items returned", w: 40, t: "wrap" }, { h: "Amount", w: 14, t: "money" }, { h: "Paid back by", w: 13, t: "text" }, { h: "Reason", w: 24, t: "text" },
    { h: "Note", w: 30, t: "wrap" }, { h: "Back in stock", w: 13, t: "text" }, { h: "Cashier", w: 14, t: "text" },
  ];
  const rows: XCell[][] = refunds.map((r) => [
    no(r.id), dayKey(r.created_at), timeKey(r.created_at), no(r.sale_id), r.refund_items.map((i) => `${i.qty}x ${i.name}`).join("; "), Number(r.amount), cap(r.method), r.reason, r.note ?? "", r.restock ? "Yes" : "No", (r.cashier ?? "").split("@")[0],
  ]);
  return tableSheet({ name: "Refunds", tab: "FFF43F5E", title: `${shop}: refunds`, subtitle: sub(label), cols, rows, totals: [5] });
}

export function shiftsSheet(shifts: ShiftRow[], shop: string, label: string): XSheet {
  const cols: Col[] = [
    { h: "Shift", w: 8, t: "int" }, { h: "Opened", w: 18, t: "text" }, { h: "Opened by", w: 14, t: "text" }, { h: "Opening float", w: 14, t: "money" },
    { h: "Closed", w: 18, t: "text" }, { h: "Closed by", w: 14, t: "text" }, { h: "Expected cash", w: 14, t: "money" }, { h: "Counted cash", w: 14, t: "money" },
    { h: "Difference", w: 13, t: "money" }, { h: "Note", w: 36, t: "wrap" },
  ];
  const stampOf = (iso: string) => `${dayKey(iso)} ${timeKey(iso)}`;
  const rows: XCell[][] = shifts.map((h) => {
    const d = h.difference == null ? null : Number(h.difference);
    return [h.id, stampOf(h.opened_at), (h.opened_by_email ?? "").split("@")[0], Number(h.opening_float), h.closed_at ? stampOf(h.closed_at) : "still open", (h.closed_by_email ?? "").split("@")[0],
      h.expected_cash == null ? null : Number(h.expected_cash), h.counted_cash == null ? null : Number(h.counted_cash), d === null ? null : { v: d, s: d === 0 ? "good" : "bad" }, h.close_note ?? ""];
  });
  return tableSheet({ name: "Cash drawer", tab: "FFF59E0B", title: `${shop}: cash drawer shifts`, subtitle: `${sub(label)}  ·  green = balanced, red = difference`, cols, rows, totals: [8] });
}

/* ----------------------------------- summary ---------------------------------- */
function summarySheet(s: Summary, shop: string, label: string): XSheet {
  const rows: XCell[][] = [];
  const heights: Record<number, number> = { 1: 32 };
  const section = (t: string) => rows.push([{ v: t, s: "section" }, { v: null, s: "section" }, { v: null, s: "section" }]);
  const head = (a: string, b: string, c: string) => rows.push([{ v: a, s: "header" }, { v: b, s: "header" }, { v: c, s: "header" }]);
  const kv = (k: string, v: number, style: string, note = "") => rows.push([{ v: k, s: "bold" }, { v, s: style }, { v: note, s: "sub" }]);

  rows.push([{ v: `${shop}: sales report`, s: "title" }]);
  rows.push([{ v: `Period: ${label}  ·  made ${stamp()}`, s: "sub" }]);
  rows.push([]);
  section("Key figures");
  kv("Receipts", s.count, "boldInt", s.voided ? `${s.voided} voided sale(s) not counted` : "");
  kv("Items sold", s.items, "boldInt");
  kv("Gross sales (before discounts)", s.gross, "boldMoney");
  kv("Discounts given", s.discounts, "boldMoney");
  kv("Net sales (total charged)", s.total, "totalMoney");
  kv("Refunds", s.refunded, "boldMoney");
  kv("Sales after refunds", s.net, "totalMoney");
  kv("Average sale", s.avgSale, "boldMoney");
  kv("Cost of goods sold", s.cost, "boldMoney", s.costKnown ? "" : "Some items have no cost price");
  kv("Profit before refunds", s.profit, "totalMoney", s.costKnown ? "" : "Overstated: some items have no cost price");
  kv("Sold while offline", s.offline, "boldInt");
  kv("Flagged for review", s.review, "boldInt", s.review ? "See the Sales sheet, column Needs review" : "");
  rows.push([]);
  section("Paid by");
  head("Method", "Sales", "Refunds");
  s.byMethod.forEach((m, i) => rows.push([{ v: cap(m.method), s: i % 2 ? "textAlt" : "text" }, { v: m.sales, s: i % 2 ? "moneyAlt" : "money" }, { v: m.refunds, s: i % 2 ? "moneyAlt" : "money" }]));
  rows.push([]);
  if (s.cashiers.length) {
    section("Cashiers");
    head("Cashier", "Receipts", "Total");
    s.cashiers.forEach((c, i) => rows.push([{ v: c.cashier.split("@")[0], s: i % 2 ? "textAlt" : "text" }, { v: c.count, s: i % 2 ? "intAlt" : "int" }, { v: c.total, s: i % 2 ? "moneyAlt" : "money" }]));
    rows.push([]);
  }
  if (s.reasons.length) {
    section("Refund reasons");
    head("Reason", "Refunds", "Amount");
    s.reasons.forEach((r, i) => rows.push([{ v: r.reason, s: i % 2 ? "textAlt" : "text" }, { v: r.count, s: i % 2 ? "intAlt" : "int" }, { v: n2(r.amount), s: i % 2 ? "moneyAlt" : "money" }]));
  }
  return { name: "Summary", tab: GREEN, widths: [36, 20, 44], rows, merges: ["A1:C1", "A2:C2"], heights, landscape: false };
}

function daysSheet(s: Summary, shop: string, label: string): XSheet {
  const cols: Col[] = [
    { h: "Date", w: 14, t: "date" }, { h: "Receipts", w: 11, t: "int" }, { h: "Total", w: 15, t: "money" }, { h: "Discounts", w: 15, t: "money" }, { h: "Refunds", w: 15, t: "money" }, { h: "After refunds", w: 16, t: "money" },
  ];
  const rows: XCell[][] = s.days.map((d) => [d.day, d.count, d.total, d.discount, d.refunds, n2(d.total - d.refunds)]);
  return tableSheet({ name: "Day by day", tab: "FF6366F1", title: `${shop}: day by day`, subtitle: sub(label), cols, rows, totals: [1, 2, 3, 4, 5] });
}

function productsSheet(s: Summary, shop: string, label: string): XSheet {
  const cols: Col[] = [{ h: "Product", w: 40, t: "text" }, { h: "Sold", w: 10, t: "int" }, { h: "Revenue", w: 15, t: "money" }, { h: "Profit", w: 15, t: "money" }];
  const rows: XCell[][] = s.products.map((p) => [p.name, p.qty, p.revenue, p.profit]);
  return tableSheet({ name: "Best sellers", tab: "FFA855F7", title: `${shop}: best sellers`, subtitle: `${sub(label)}  ·  biggest revenue first`, cols, rows, totals: [1, 2, 3] });
}

/* --------------------------------- workbooks ---------------------------------- */
export function reportWorkbook(d: RangeData, s: Summary, shop: string, label: string): Uint8Array {
  return buildXlsx([
    summarySheet(s, shop, label),
    daysSheet(s, shop, label),
    productsSheet(s, shop, label),
    salesSheet(d.sales, shop, label),
    itemsSheet(d.sales, shop, label),
    refundsSheet(d.refunds, shop, label),
    shiftsSheet(d.shifts, shop, label),
  ]);
}

export const salesWorkbook = (sales: Sale[], shop: string, label: string) => buildXlsx([salesSheet(sales, shop, label), itemsSheet(sales, shop, label)]);
