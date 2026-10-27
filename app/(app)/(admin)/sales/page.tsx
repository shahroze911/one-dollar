"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ChevronDown, CreditCard, Eye, Loader2, Printer, Search, Undo2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, money, receiptNo } from "@/lib/format";
import { saleToReceipt } from "@/lib/receipt";
import { useToast } from "@/components/toast";
import { useReceipt } from "@/components/providers";
import type { Sale } from "@/lib/types";

type Range = "today" | "7d" | "30d" | "all";
const PAGE = 50;

function startOf(range: Range): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d.toISOString();
  if (range === "7d") d.setDate(d.getDate() - 6);
  else if (range === "30d") d.setDate(d.getDate() - 29);
  else return null;
  return d.toISOString();
}

export default function SalesPage() {
  const toast = useToast();
  const { print, preview } = useReceipt();
  const [range, setRange] = useState<Range>("today");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState(""); // debounced search
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (offset: number, r: Range, t: string) => {
      let query = supabaseBrowser().from("sales").select("*, sale_items(*)");
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
    return {
      count: valid.length,
      total: valid.reduce((s, x) => s + Number(x.total), 0),
      cash: valid.filter((s) => s.payment_method === "cash").reduce((s, x) => s + Number(x.total), 0),
      card: valid.filter((s) => s.payment_method === "card").reduce((s, x) => s + Number(x.total), 0),
    };
  }, [sales]);

  const voidSale = async (s: Sale) => {
    if (!confirm(`Void sale #${receiptNo(s.id)} (${money(s.total)})? The items go back into stock.`)) return;
    setVoiding(s.id);
    const { error } = await supabaseBrowser().rpc("void_sale", { p_sale_id: s.id });
    setVoiding(null);
    if (error) return toast(error.message, "err");
    toast(`Sale #${receiptNo(s.id)} voided and stock restored`);
    setSales((prev) => prev.map((x) => (x.id === s.id ? { ...x, voided: true } : x)));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Sales records</h1>
          <p className="text-sm text-slate-500">Every receipt is saved. Open one to reprint it.</p>
        </div>
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
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales", String(summary.count) + (more ? "+" : ""), "from-sky-500 to-indigo-500"],
          ["Total", money(summary.total), "from-emerald-500 to-teal-600"],
          ["Cash", money(summary.cash), "from-amber-400 to-orange-500"],
          ["Card", money(summary.card), "from-fuchsia-500 to-pink-500"],
        ].map(([label, value, grad]) => (
          <div key={label} className={`slide-up rounded-2xl bg-gradient-to-br p-4 text-white shadow-md ${grad}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-white/80">{label}</div>
            <div className="mt-1 truncate text-xl font-extrabold">{value}</div>
          </div>
        ))}
      </div>

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
          {sales.map((s) => (
            <div key={s.id} className={`card overflow-hidden transition ${s.voided ? "opacity-60" : "hover:shadow-md"}`}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  {s.payment_method === "cash" ? <Banknote size={17} /> : <CreditCard size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    Receipt #{receiptNo(s.id)}
                    {s.voided && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">voided</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(s.created_at)} · {s.items_count} item{s.items_count === 1 ? "" : "s"}
                    {s.cashier ? ` · ${s.cashier.split("@")[0]}` : ""}
                  </div>
                </div>
                <div className={`text-lg font-extrabold ${s.voided ? "line-through" : ""}`}>{money(s.total)}</div>
                <ChevronDown size={16} className={`text-slate-400 transition ${open === s.id ? "rotate-180" : ""}`} />
              </button>

              {open === s.id && (
                <div className="pop border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                  <ul className="space-y-1 text-sm">
                    {s.sale_items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <span>{i.qty} × {i.name}</span>
                        <span className="font-medium">{money(i.unit_price * i.qty)}</span>
                      </li>
                    ))}
                  </ul>
                  {s.payment_method === "cash" && s.cash_received != null && (
                    <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                      Cash {money(s.cash_received)} · change {money(s.change_given)}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => preview(saleToReceipt(s))}>
                      <Eye size={14} /> View receipt
                    </button>
                    <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => print(saleToReceipt(s))}>
                      <Printer size={14} /> Print
                    </button>
                    {!s.voided && (
                      <button className="btn btn-ghost px-3 py-1.5 text-xs text-rose-600" onClick={() => voidSale(s)} disabled={voiding === s.id}>
                        {voiding === s.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Void sale
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {more && (
            <div className="pt-2 text-center">
              <button className="btn btn-ghost" onClick={() => load(sales.length, range, term)}>Load more</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
