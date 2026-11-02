"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ChevronDown, CreditCard, Download, Eye, Loader2, Printer, RotateCcw, Search, Smartphone, Split, Undo2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, money, receiptNo } from "@/lib/format";
import { methodLabel } from "@/lib/payments";
import { downloadFile, slug, XLSX_TYPE } from "@/lib/csv";
import { salesWorkbook } from "@/lib/reports-xlsx";
import { fetchRange, inputDate } from "@/lib/reports";
import { refundToReceipt, saleToReceipt } from "@/lib/receipt";
import { useToast } from "@/components/toast";
import { useReceipt, useSettings } from "@/components/providers";
import Modal from "@/components/modal";
import type { Refund, Sale } from "@/lib/types";

type Range = "today" | "7d" | "30d" | "all";
const PAGE = 50;

const REASONS = ["Damaged / defective", "Wrong item", "Customer changed mind", "Price dispute", "Other"];

function startOf(range: Range): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d.toISOString();
  if (range === "7d") d.setDate(d.getDate() - 6);
  else if (range === "30d") d.setDate(d.getDate() - 29);
  else return null;
  return d.toISOString();
}

const MethodIcon = ({ m, size = 17 }: { m: string; size?: number }) =>
  m === "cash" ? <Banknote size={size} /> : m === "card" ? <CreditCard size={size} /> : m === "wallet" ? <Smartphone size={size} /> : <Split size={size} />;

const refundedTotal = (s: Sale) => (s.refunds ?? []).reduce((t, r) => t + Number(r.amount), 0);
const returnedQty = (s: Sale, itemId: number) =>
  (s.refunds ?? []).reduce((t, r) => t + r.refund_items.filter((i) => i.sale_item_id === itemId).reduce((a, i) => a + i.qty, 0), 0);

/** Same formula as refund_sale() on the server (this is only the on-screen estimate). */
const unitRefund = (s: Sale, itemId: number) => {
  const it = s.sale_items.find((x) => x.id === itemId);
  if (!it || it.qty <= 0) return 0;
  const sub = Number(s.subtotal);
  const ratio = sub > 0 ? (sub - Number(s.discount)) / sub : 1;
  return ((it.qty * Number(it.unit_price) - Number(it.discount ?? 0)) / it.qty) * ratio;
};

export default function SalesPage() {
  const toast = useToast();
  const { print, preview } = useReceipt();
  const { settings } = useSettings();
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<Range>("today");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState(""); // debounced search
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (offset: number, r: Range, t: string) => {
      let query = supabaseBrowser().from("sales").select("*, sale_items(*), refunds(*, refund_items(*))");
      const num = parseInt(t.replace(/\D/g, ""), 10);
      if (t && !isNaN(num)) {
        query = query.eq("id", num); // searching by receipt number ignores the date range
      } else {
        const from = startOf(r);
        if (from) query = query.gte("created_at", from);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) toast(error.message, "err");
      const list = (data ?? []) as unknown as Sale[];
      setSales((prev) => (offset === 0 ? list : [...prev, ...list]));
      setMore(list.length === PAGE);
      setLoading(false);
    },
    [toast]
  );

  useEffect(() => {
    setLoading(true);
    load(0, range, term);
  }, [range, term, load]);

  const summary = useMemo(() => {
    const valid = sales.filter((s) => !s.voided);
    const sum = (f: (s: Sale) => number) => valid.reduce((t, s) => t + f(s), 0);
    const byMethod = (m: string) =>
      valid.reduce((t, s) => t + (s.payments ?? []).filter((p) => p.method === m).reduce((a, p) => a + Number(p.amount), 0), 0);
    const total = sum((s) => Number(s.total));
    const refunded = sum(refundedTotal);
    return { count: valid.length, total, refunded, net: total - refunded, cash: byMethod("cash"), card: byMethod("card"), wallet: byMethod("wallet") };
  }, [sales]);

  // download every sale in the chosen period (not just the 50 on screen)
  const exportSales = async () => {
    setExporting(true);
    try {
      const from = startOf(range);
      const d = await fetchRange(from, null);
      const label = range === "all" ? "All sales" : `${range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days"}, up to ${inputDate(new Date())}`;
      const name = `${slug(settings.shop_name)}-sales-${range === "all" ? "all" : `${range}-to-${inputDate(new Date())}`}`;
      downloadFile(`${name}.xlsx`, salesWorkbook(d.sales, settings.shop_name, label), XLSX_TYPE);
      toast(`Downloaded ${d.sales.length} sales${d.truncated ? " (very large period: first part only)" : ""}`);
    } catch (e: any) {
      toast(e.message ?? "Could not download", "err");
    } finally {
      setExporting(false);
    }
  };

  const voidSale = async (s: Sale) => {
    if (!confirm(`Void sale #${receiptNo(s.id)} (${money(s.total)})? The items go back into stock.`)) return;
    setVoiding(s.id);
    const { error } = await supabaseBrowser().rpc("void_sale", { p_sale_id: s.id });
    setVoiding(null);
    if (error) return toast(error.message, "err");
    toast(`Sale #${receiptNo(s.id)} voided and stock restored`);
    setSales((prev) => prev.map((x) => (x.id === s.id ? { ...x, voided: true } : x)));
  };

  const onRefunded = (saleId: number) => {
    setRefunding(null);
    load(0, range, term); // reload so the new refund shows up everywhere
    setOpen(saleId);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Sales records</h1>
          <p className="text-sm text-slate-500">Every receipt is saved. Open one to reprint it or refund items.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {([
            ["today", "Today"],
            ["7d", "7 days"],
            ["30d", "30 days"],
            ["all", "All"],
          ] as const).map(([k, l]) => (
            <button key={k} onClick={() => setRange(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${range === k ? "bg-emerald-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"}`}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={exportSales} disabled={exporting} title="Download these sales as an Excel file">
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download
        </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales", String(summary.count) + (more ? "+" : ""), "from-sky-500 to-indigo-500"],
          ["Total", money(summary.total), "from-emerald-500 to-teal-600"],
          ["Refunded", summary.refunded > 0 ? `− ${money(summary.refunded)}` : money(0), "from-rose-500 to-orange-500"],
          ["Net", money(summary.net), "from-violet-500 to-fuchsia-500"],
        ].map(([label, value, grad]) => (
          <div key={label} className={`slide-up rounded-2xl bg-gradient-to-br p-4 text-white shadow-md ${grad}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-white/80">{label}</div>
            <div className="mt-1 truncate text-xl font-extrabold">{value}</div>
          </div>
        ))}
      </div>
      <p className="-mt-2 px-1 text-xs text-slate-500">
        Paid by: Cash {money(summary.cash)} · Card {money(summary.card)} · Wallet {money(summary.wallet)}
        <span className="text-slate-400"> (cash is before change is handed back; refunds are not subtracted here)</span>
      </p>

      <div className="card p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Find a receipt by number, e.g. 123" value={search} onChange={(e) => setSearch(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
        </div>
      ) : sales.length === 0 ? (
        <div className="card py-16 text-center text-sm text-slate-500">No sales found.</div>
      ) : (
        <div className="space-y-2">
          {sales.map((s) => {
            const refunded = refundedTotal(s);
            const fully = !s.voided && s.sale_items.every((i) => returnedQty(s, i.id) >= i.qty);
            return (
              <div key={s.id} className={`card overflow-hidden transition ${s.voided ? "opacity-60" : "hover:shadow-md"}`}>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <MethodIcon m={s.payment_method} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                      Receipt #{receiptNo(s.id)}
                      {s.voided && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">voided</span>}
                      {!s.voided && refunded > 0 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">{fully ? "fully refunded" : "part refunded"}</span>
                      )}
                      {s.offline && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">offline sale</span>}
                      {s.needs_review && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">check</span>}
                      {Number(s.discount) > 0 || s.sale_items.some((i) => Number(i.discount) > 0) ? (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">discount</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(s.created_at)} · {s.items_count} item{s.items_count === 1 ? "" : "s"} · {methodLabel(s.payment_method)}
                      {s.cashier ? ` · ${s.cashier.split("@")[0]}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-extrabold ${s.voided ? "line-through" : ""}`}>{money(s.total)}</div>
                    {!s.voided && refunded > 0 && <div className="text-xs font-bold text-amber-700">− {money(refunded)}</div>}
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition ${open === s.id ? "rotate-180" : ""}`} />
                </button>

                {open === s.id && (
                  <div className="pop border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    <ul className="space-y-1 text-sm">
                      {s.sale_items.map((i) => {
                        const back = returnedQty(s, i.id);
                        return (
                          <li key={i.id} className="flex justify-between gap-3">
                            <span>
                              {i.qty} × {i.name}
                              {back > 0 && <span className="ml-1.5 text-xs font-semibold text-amber-700">({back} returned)</span>}
                              {Number(i.discount) > 0 && <span className="ml-1.5 text-xs text-sky-700">(− {money(i.discount)})</span>}
                            </span>
                            <span className="font-medium">{money(Number(i.unit_price) * i.qty - Number(i.discount ?? 0))}</span>
                          </li>
                        );
                      })}
                    </ul>

                    {s.needs_review && s.review_note && (
                      <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                        Please check this sale: {s.review_note}
                      </div>
                    )}

                    <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-500">
                      {Number(s.discount) > 0 && <div>Sale discount: − {money(s.discount)}</div>}
                      <div>
                        Paid: {(s.payments ?? []).length > 0 ? (s.payments).map((p) => `${methodLabel(p.method)} ${money(p.amount)}`).join(" + ") : methodLabel(s.payment_method)}
                        {s.cash_received != null && Number(s.change_given) > 0 ? ` · change ${money(s.change_given)}` : ""}
                      </div>
                    </div>

                    {(s.refunds ?? []).length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {s.refunds
                          .slice()
                          .sort((a, b) => b.id - a.id)
                          .map((r: Refund) => (
                            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs">
                              <div className="min-w-0">
                                <div className="font-bold text-amber-800">
                                  Refund #{receiptNo(r.id)} · {money(r.amount)} to {methodLabel(r.method)}
                                </div>
                                <div className="text-amber-700">
                                  {fmtDateTime(r.created_at)} · {r.refund_items.map((i) => `${i.qty}× ${i.name}`).join(", ")} · “{r.reason}”
                                  {r.note ? ` – ${r.note}` : ""}
                                  {r.restock ? "" : " · not restocked"}
                                </div>
                              </div>
                              <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => print(refundToReceipt(r))}>
                                <Printer size={13} /> Print
                              </button>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => preview(saleToReceipt(s))}>
                        <Eye size={14} /> View receipt
                      </button>
                      <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => print(saleToReceipt(s))}>
                        <Printer size={14} /> Print
                      </button>
                      {!s.voided && !fully && (
                        <button className="btn btn-ghost px-3 py-1.5 text-xs text-amber-700" onClick={() => setRefunding(s)}>
                          <RotateCcw size={14} /> Refund items
                        </button>
                      )}
                      {!s.voided && (
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs text-rose-600"
                          onClick={() => voidSale(s)}
                          disabled={voiding === s.id || (s.refunds ?? []).length > 0}
                          title={(s.refunds ?? []).length > 0 ? "A sale with refunds can't be voided" : undefined}
                        >
                          {voiding === s.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Void sale
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {more && (
            <div className="pt-2 text-center">
              <button className="btn btn-ghost" onClick={() => load(sales.length, range, term)}>Load more</button>
            </div>
          )}
        </div>
      )}

      {refunding && <RefundModal sale={refunding} onClose={() => setRefunding(null)} onDone={onRefunded} />}
    </div>
  );
}

/* --------------------------------- refund --------------------------------- */

function RefundModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (saleId: number) => void }) {
  const toast = useToast();
  const { preview } = useReceipt();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  const rows = sale.sale_items.map((i) => ({ item: i, left: i.qty - returnedQty(sale, i.id) })).filter((r) => r.left > 0);
  const estimate = rows.reduce((t, r) => t + unitRefund(sale, r.item.id) * (qty[r.item.id] ?? 0), 0);
  const chosen = rows.filter((r) => (qty[r.item.id] ?? 0) > 0);

  const submit = async () => {
    if (!chosen.length || busy) return;
    const why = reason === "Other" ? note.trim() : reason;
    if (!why) return toast("Please write the reason", "err");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("refund_sale", {
      p_sale_id: sale.id,
      p_items: chosen.map((r) => ({ sale_item_id: r.item.id, qty: qty[r.item.id] })),
      p_reason: why,
      p_note: reason === "Other" ? null : note.trim() || null,
      p_method: method,
      p_restock: restock,
    });
    setBusy(false);
    if (error) return toast(error.message, "err");

    toast(`Refunded ${money(Number(data.amount))}. Give it back to the customer.`);
    const refund: Refund = {
      id: data.refund_id,
      sale_id: sale.id,
      amount: Number(data.amount),
      method,
      reason: why,
      note: null,
      restock,
      cashier: null,
      created_at: data.created_at,
      refund_items: chosen.map((r) => ({
        id: 0,
        refund_id: data.refund_id,
        sale_item_id: r.item.id,
        product_id: r.item.product_id,
        name: r.item.name,
        qty: qty[r.item.id],
        amount: Math.round(unitRefund(sale, r.item.id) * qty[r.item.id] * 100) / 100,
      })),
    };
    onDone(sale.id);
    preview(refundToReceipt(refund));
  };

  return (
    <Modal title={`Refund · Receipt #${receiptNo(sale.id)}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <div className="label">What is the customer returning?</div>
          <div className="space-y-2">
            {rows.map(({ item, left }) => {
              const q = qty[item.id] ?? 0;
              return (
                <div key={item.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${q > 0 ? "border-amber-300 bg-amber-50/60" : "border-slate-200"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{item.name}</div>
                    <div className="text-xs text-slate-500">
                      {left} of {item.qty} can be returned · about {money(unitRefund(sale, item.id))} each
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white font-bold hover:bg-slate-100" onClick={() => setQty({ ...qty, [item.id]: Math.max(0, q - 1) })}>−</button>
                    <span className="w-8 text-center text-sm font-extrabold">{q}</span>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white font-bold hover:bg-slate-100" onClick={() => setQty({ ...qty, [item.id]: Math.min(left, q + 1) })}>+</button>
                    <button type="button" className="ml-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100" onClick={() => setQty({ ...qty, [item.id]: left })}>All</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Reason</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Money goes back by</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash (comes out of the drawer)</option>
              <option value="card">Card</option>
              <option value="wallet">Wallet (JazzCash / Easypaisa)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">{reason === "Other" ? "Write the reason" : "Note (optional)"}</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "Other" ? "Why is it being returned?" : "Anything worth remembering"} />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          <span>
            <span className="font-semibold">Put the items back in stock</span>
            <span className="block text-xs text-slate-500">Untick for damaged goods you can't sell again.</span>
          </span>
        </label>

        <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3">
          <span className="text-sm font-semibold text-amber-800">Refund amount</span>
          <span className="text-2xl font-extrabold text-amber-800">{money(Math.round(estimate * 100) / 100)}</span>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen.length || busy} onClick={submit}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Refund
          </button>
        </div>
        <p className="text-xs text-slate-500">The final amount is worked out on the server from what the customer actually paid, so it can differ by a few paisa from the estimate.</p>
      </div>
    </Modal>
  );
}
