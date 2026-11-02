import { supabaseBrowser } from "./supabase/client";
import type { Cell } from "./csv";
import type { Refund, Sale, ShiftRow } from "./types";

export type RangeData = { sales: Sale[]; refunds: Refund[]; shifts: ShiftRow[]; truncated: boolean };

const PAGE = 500;
const MAX_ROWS = 20000;

/** All rows between `from` (inclusive) and `to` (exclusive), as ISO strings. null = no limit. Owner mode only. */
export async function fetchRange(from: string | null, to: string | null): Promise<RangeData> {
  const sb = supabaseBrowser();
  let truncated = false;

  async function all<T>(build: (a: number, b: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; ; i += PAGE) {
      const { data, error } = await build(i, i + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      if (out.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }
    return out;
  }

  const range = <Q extends { gte: any; lt: any }>(q: Q, col: string): Q => {
    let x: any = q;
    if (from) x = x.gte(col, from);
    if (to) x = x.lt(col, to);
    return x;
  };

  const [sales, refunds, shifts] = await Promise.all([
    all<Sale>((a, b) =>
      range(sb.from("sales").select("*, sale_items(*), refunds(id, amount)"), "created_at").order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b)
    ),
    all<Refund>((a, b) =>
      range(sb.from("refunds").select("*, refund_items(*)"), "created_at").order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b)
    ),
    all<ShiftRow>((a, b) => range(sb.from("shifts").select("*"), "opened_at").order("opened_at", { ascending: true }).order("id", { ascending: true }).range(a, b)),
  ]);
  return { sales, refunds, shifts, truncated };
}

/* ------------------------------- date helpers ------------------------------ */
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
export const timeKey = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const inputDate = (d: Date) => d.toLocaleDateString("en-CA");
export const parseInputDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const n2 = (n: number) => Math.round(n * 100) / 100;
const pay = (s: Sale, m: string) => (s.payments ?? []).filter((p) => p.method === m).reduce((t, p) => t + Number(p.amount), 0);
const lineGross = (i: { qty: number; unit_price: number }) => Number(i.unit_price) * i.qty;

/* --------------------------------- summary --------------------------------- */
export function summarize(d: RangeData) {
  const valid = d.sales.filter((s) => !s.voided);
  const voided = d.sales.length - valid.length;

  let gross = 0;
  let lineDisc = 0;
  let cost = 0;
  let costKnown = true;
  let items = 0;
  const products = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
  for (const s of valid) {
    for (const i of s.sale_items) {
      const g = lineGross(i);
      const net = g - Number(i.discount ?? 0);
      gross += g;
      lineDisc += Number(i.discount ?? 0);
      items += i.qty;
      const uc = i.unit_cost == null ? null : Number(i.unit_cost);
      if (uc == null || uc === 0) costKnown = false;
      const c = (uc ?? 0) * i.qty;
      cost += c;
      const p = products.get(i.product_id) ?? { name: i.name, qty: 0, revenue: 0, profit: 0 };
      p.qty += i.qty;
      p.revenue += net;
      p.profit += net - c;
      products.set(i.product_id, p);
    }
  }
  const saleDisc = valid.reduce((t, s) => t + Number(s.discount), 0);
  const total = valid.reduce((t, s) => t + Number(s.total), 0);
  const refunded = d.refunds.reduce((t, r) => t + Number(r.amount), 0);

  const byMethod = ["cash", "card", "wallet"].map((m) => ({
    method: m,
    sales: n2(valid.reduce((t, s) => t + pay(s, m), 0)),
    refunds: n2(d.refunds.filter((r) => r.method === m).reduce((t, r) => t + Number(r.amount), 0)),
  }));

  const days = new Map<string, { day: string; count: number; total: number; discount: number; refunds: number }>();
  const day = (k: string) => days.get(k) ?? days.set(k, { day: k, count: 0, total: 0, discount: 0, refunds: 0 }).get(k)!;
  for (const s of valid) {
    const e = day(dayKey(s.created_at));
    e.count++;
    e.total += Number(s.total);
    e.discount += Number(s.discount) + s.sale_items.reduce((t, i) => t + Number(i.discount ?? 0), 0);
  }
  for (const r of d.refunds) day(dayKey(r.created_at)).refunds += Number(r.amount);

  const cashiers = new Map<string, { cashier: string; count: number; total: number }>();
  for (const s of valid) {
    const k = s.cashier ?? "unknown";
    const e = cashiers.get(k) ?? { cashier: k, count: 0, total: 0 };
    e.count++;
    e.total += Number(s.total);
    cashiers.set(k, e);
  }

  const reasons = new Map<string, { reason: string; count: number; amount: number }>();
  for (const r of d.refunds) {
    const e = reasons.get(r.reason) ?? { reason: r.reason, count: 0, amount: 0 };
    e.count++;
    e.amount += Number(r.amount);
    reasons.set(r.reason, e);
  }

  return {
    count: valid.length,
    voided,
    items,
    gross: n2(gross),
    discounts: n2(lineDisc + saleDisc),
    total: n2(total),
    refunded: n2(refunded),
    net: n2(total - refunded),
    cost: n2(cost),
    costKnown,
    profit: n2(total - cost), // before refunds
    avgSale: valid.length ? n2(total / valid.length) : 0,
    offline: valid.filter((s) => s.offline).length,
    review: valid.filter((s) => s.needs_review).length,
    byMethod,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((x) => ({ ...x, total: n2(x.total), discount: n2(x.discount), refunds: n2(x.refunds) })),
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue).map((p) => ({ ...p, revenue: n2(p.revenue), profit: n2(p.profit) })),
    cashiers: [...cashiers.values()].sort((a, b) => b.total - a.total).map((c) => ({ ...c, total: n2(c.total) })),
    reasons: [...reasons.values()].sort((a, b) => b.amount - a.amount),
  };
}
export type Summary = ReturnType<typeof summarize>;

/* ----------------------------------- CSVs ---------------------------------- */
const no = (id: number) => String(id).padStart(6, "0");
const status = (s: Sale) => (s.voided ? "Voided" : "Completed");

export const salesRows = (sales: Sale[]): Cell[][] => [
  ["Receipt no", "Date", "Time", "Cashier", "Items", "Subtotal (after item discounts)", "Sale discount", "Total", "Payment", "Cash", "Card", "Wallet", "Cash received", "Change given", "Status", "Refunded", "Offline sale", "Needs review", "Review note"],
  ...sales.map((s): Cell[] => [
    no(s.id), dayKey(s.created_at), timeKey(s.created_at), s.cashier ?? "", s.items_count, Number(s.subtotal), Number(s.discount), Number(s.total),
    s.payment_method, n2(pay(s, "cash")), n2(pay(s, "card")), n2(pay(s, "wallet")),
    s.cash_received == null ? "" : Number(s.cash_received), s.change_given == null ? "" : Number(s.change_given),
    status(s), n2((s.refunds ?? []).reduce((t, r) => t + Number(r.amount), 0)), s.offline ? "Yes" : "No", s.needs_review ? "Yes" : "No", s.review_note ?? "",
  ]),
];

export const itemsRows = (sales: Sale[], withCost: boolean): Cell[][] => [
  ["Receipt no", "Date", "Time", "Status", "Product", "Barcode", "Qty", "Unit price", "Line discount", "Line total", ...(withCost ? ["Unit cost", "Line profit"] : [])],
  ...sales.flatMap((s) =>
    s.sale_items.map((i): Cell[] => {
      const lt = n2(lineGross(i) - Number(i.discount ?? 0));
      const uc = i.unit_cost == null ? "" : Number(i.unit_cost);
      return [no(s.id), dayKey(s.created_at), timeKey(s.created_at), status(s), i.name, i.barcode ?? "", i.qty, Number(i.unit_price), Number(i.discount ?? 0), lt, ...(withCost ? [uc, uc === "" ? "" : n2(lt - uc * i.qty)] : [])];
    })
  ),
];

export const refundsRows = (refunds: Refund[]): Cell[][] => [
  ["Refund no", "Date", "Time", "Original receipt", "Items returned", "Amount", "Paid back by", "Reason", "Note", "Put back in stock", "Cashier"],
  ...refunds.map((r): Cell[] => [no(r.id), dayKey(r.created_at), timeKey(r.created_at), no(r.sale_id), r.refund_items.map((i) => `${i.qty}x ${i.name}`).join("; "), Number(r.amount), r.method, r.reason, r.note ?? "", r.restock ? "Yes" : "No", r.cashier ?? ""]),
];

export const shiftsRows = (shifts: ShiftRow[]): Cell[][] => [
  ["Shift", "Opened", "Opened by", "Opening float", "Closed", "Closed by", "Expected cash", "Counted cash", "Difference", "Note"],
  ...shifts.map((h): Cell[] => [
    h.id, `${dayKey(h.opened_at)} ${timeKey(h.opened_at)}`, h.opened_by_email ?? "", Number(h.opening_float),
    h.closed_at ? `${dayKey(h.closed_at)} ${timeKey(h.closed_at)}` : "still open", h.closed_by_email ?? "",
    h.expected_cash == null ? "" : Number(h.expected_cash), h.counted_cash == null ? "" : Number(h.counted_cash), h.difference == null ? "" : Number(h.difference), h.close_note ?? "",
  ]),
];

export function summaryRows(s: Summary, shop: string, label: string): Cell[][] {
  const rows: Cell[][] = [
    [`${shop}: sales report`], ["Period", label], [],
    ["Metric", "Value"],
    ["Sales (receipts)", s.count], ["Items sold", s.items], ["Gross sales (before discounts)", s.gross], ["Discounts given", s.discounts],
    ["Net sales (total charged)", s.total], ["Refunds", s.refunded], ["Sales after refunds", s.net], ["Average sale", s.avgSale],
    ["Cost of goods sold", s.costKnown ? s.cost : `${s.cost} (some cost prices missing)`], ["Profit before refunds", s.profit],
    ["Voided sales", s.voided], ["Sales made offline", s.offline], ["Sales flagged for review", s.review], [],
    ["Payment method", "Sales", "Refunds"], ...s.byMethod.map((m): Cell[] => [m.method, m.sales, m.refunds]), [],
    ["Date", "Receipts", "Total", "Discounts", "Refunds", "After refunds"], ...s.days.map((d): Cell[] => [d.day, d.count, d.total, d.discount, d.refunds, n2(d.total - d.refunds)]), [],
    ["Product", "Qty sold", "Revenue", "Profit"], ...s.products.map((p): Cell[] => [p.name, p.qty, p.revenue, p.profit]), [],
    ["Cashier", "Receipts", "Total"], ...s.cashiers.map((c): Cell[] => [c.cashier, c.count, c.total]), [],
    ["Refund reason", "Refunds", "Amount"], ...s.reasons.map((r): Cell[] => [r.reason, r.count, n2(r.amount)]),
  ];
  return rows;
}
