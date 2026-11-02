import type { ReceiptData, Refund, Sale } from "./types";

/** Turns a saved sale (from the Sales page) into receipt data for reprinting. */
export function saleToReceipt(s: Sale): ReceiptData {
  return {
    id: s.id,
    created_at: s.created_at,
    payment_method: s.payment_method,
    payments: (s.payments ?? []).map((p) => ({ method: p.method, amount: Number(p.amount) })),
    cashier: s.cashier,
    items: s.sale_items.map((i) => ({
      name: i.name,
      qty: i.qty,
      unit_price: Number(i.unit_price),
      discount: Number(i.discount ?? 0),
    })),
    subtotal: Number(s.subtotal ?? 0) || undefined,
    discount: Number(s.discount ?? 0),
    total: Number(s.total),
    cash_received: s.cash_received == null ? null : Number(s.cash_received),
    change_given: s.change_given == null ? null : Number(s.change_given),
    voided: s.voided,
    duplicate: true,
  };
}

/** Receipt handed to the customer when money is returned. */
export function refundToReceipt(r: Refund): ReceiptData {
  return {
    kind: "refund",
    id: r.id,
    ref_sale: r.sale_id,
    created_at: r.created_at,
    payment_method: r.method,
    cashier: r.cashier,
    reason: r.reason,
    items: r.refund_items.map((i) => ({
      name: i.name,
      qty: i.qty,
      unit_price: i.qty > 0 ? Number(i.amount) / i.qty : 0,
    })),
    total: Number(r.amount),
  };
}
