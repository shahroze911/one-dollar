import type { ReceiptData, Sale } from "./types";

/** Turns a saved sale (from the Sales page) into receipt data for reprinting. */
export function saleToReceipt(s: Sale): ReceiptData {
  return {
    id: s.id,
    created_at: s.created_at,
    payment_method: s.payment_method,
    cashier: s.cashier,
    items: s.sale_items.map((i) => ({ name: i.name, qty: i.qty, unit_price: Number(i.unit_price) })),
    total: Number(s.total),
    cash_received: s.cash_received == null ? null : Number(s.cash_received),
    change_given: s.change_given == null ? null : Number(s.change_given),
    voided: s.voided,
    duplicate: true,
  };
}
