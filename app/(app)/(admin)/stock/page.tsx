"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PackagePlus, ScanBarcode, SlidersHorizontal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAdminProducts } from "@/lib/products";
import { fmtDateTime } from "@/lib/format";
import { beep } from "@/lib/beep";
import { useToast } from "@/components/toast";
import Modal from "@/components/modal";
import ProductForm from "@/components/product-form";
import ProductImage from "@/components/product-image";
import StockBadge from "@/components/stock-badge";
import type { Product, StockMovement } from "@/lib/types";

type Filter = "all" | "low" | "out";
const REASONS = [
  { v: "restock", l: "Restock (new delivery)" },
  { v: "return", l: "Customer return" },
  { v: "damaged", l: "Damaged / expired" },
  { v: "lost", l: "Lost / stolen" },
  { v: "stocktake", l: "Stock count" },
  { v: "correction", l: "Correction" },
];

export default function StockPage() {
  const toast = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"levels" | "history">("levels");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [adjusting, setAdjusting] = useState<{ p: Product; preset?: string } | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAdminProducts());
    } catch (e: any) {
      toast(e.message ?? "Could not load stock", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    scanRef.current?.focus();
  }, [load]);

  const counts = useMemo(() => {
    const act = items.filter((p) => p.active);
    return {
      all: act.length,
      low: act.filter((p) => p.stock > 0 && p.stock <= p.low_stock_threshold).length,
      out: act.filter((p) => p.stock <= 0).length,
    };
  }, [items]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((p) => {
      if (!p.active) return false;
      if (filter === "low" && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
      if (filter === "out" && p.stock > 0) return false;
      return !s || p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s);
    });
  }, [items, filter, q]);

  const onScan = () => {
    const code = scan.trim();
    if (!code) return;
    const p = items.find((x) => x.barcode === code);
    if (p) {
      beep("ok");
      setAdjusting({ p, preset: "restock" });
      setScan("");
    } else if (/^\d{6,}$/.test(code)) {
      beep("err");
      setNewCode(code);
      setScan("");
    } else {
      const byName = items.filter((x) => x.active && x.name.toLowerCase().includes(code.toLowerCase()));
      if (byName.length === 1) {
        setAdjusting({ p: byName[0], preset: "restock" });
        setScan("");
      } else toast(byName.length ? "Several matches. Pick from the list below." : "No product found", byName.length ? "info" : "err");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Stock</h1>
        <p className="text-sm text-slate-500">Receive deliveries, fix counts, and see every change.</p>
      </div>

      {/* Receive stock: scan, type qty, done */}
      <div className="card flex flex-wrap items-center gap-3 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white"><PackagePlus size={20} /></div>
        <div className="relative min-w-[14rem] flex-1">
          <ScanBarcode size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={scanRef}
            className="input pl-10"
            placeholder="Receive stock: scan a barcode…"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onScan())}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["levels", "Stock levels"],
          ["history", "History"],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === k ? "bg-slate-900 text-white shadow" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "levels" ? (
        <>
          <div className="card flex flex-wrap items-center gap-3 p-3">
            <input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex gap-1.5">
              {([
                ["all", `All (${counts.all})`],
                ["low", `Low (${counts.low})`],
                ["out", `Out (${counts.out})`],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === k
                      ? k === "out" ? "bg-rose-600 text-white" : k === "low" ? "bg-amber-500 text-white" : "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-12" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">Nothing here{filter !== "all" ? ". Nice, no problems!" : "."}</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Barcode</th>
                    <th className="hidden px-4 py-3 text-center md:table-cell">Alert at</th>
                    <th className="px-4 py-3 text-center">In stock</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((p) => (
                    <tr key={p.id} className="transition hover:bg-emerald-50/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <ProductImage name={p.name} path={p.image_path} className="h-10 w-10 shrink-0 rounded-xl text-xs" />
                          <span className="font-semibold">{p.name}</span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 sm:table-cell">{p.barcode ?? "—"}</td>
                      <td className="hidden px-4 py-2.5 text-center text-slate-500 md:table-cell">{p.low_stock_threshold}</td>
                      <td className="px-4 py-2.5 text-center"><StockBadge p={p} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setAdjusting({ p })}>
                          <SlidersHorizontal size={14} /> Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <History />
      )}

      {adjusting && (
        <AdjustModal
          product={adjusting.p}
          preset={adjusting.preset}
          onClose={() => { setAdjusting(null); scanRef.current?.focus(); }}
          onDone={(id, stock) => {
            setItems((prev) => prev.map((x) => (x.id === id ? { ...x, stock } : x)));
            setAdjusting(null);
            scanRef.current?.focus();
          }}
        />
      )}

      {newCode && (
        <Modal title="New barcode: add this product?" onClose={() => setNewCode(null)}>
          <p className="mb-3 text-sm text-slate-600">
            <span className="font-mono font-semibold">{newCode}</span> isn&apos;t in your catalogue. Add it with its starting stock:
          </p>
          <ProductForm
            initialBarcode={newCode}
            onCancel={() => setNewCode(null)}
            onSaved={() => { setNewCode(null); load(); scanRef.current?.focus(); }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------- adjust dialog ------------------------------ */

function AdjustModal({
  product,
  preset,
  onClose,
  onDone,
}: {
  product: Product;
  preset?: string;
  onClose: () => void;
  onDone: (id: string, stock: number) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(preset ?? "restock");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    qtyRef.current?.focus();
  }, []);

  const n = parseInt(qty, 10);
  const valid = Number.isInteger(n) && n >= 0 && (mode === "set" || n > 0);
  const delta = !valid ? 0 : mode === "add" ? n : mode === "remove" ? -n : n - product.stock;
  const after = product.stock + delta;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return toast("Enter a whole number", "err");
    if (delta === 0) return toast("That's already the current stock", "info");
    if (after < 0) return toast("Stock can't go below zero", "err");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("adjust_stock", {
      p_product_id: product.id,
      p_change: delta,
      p_reason: mode === "set" && reason === "restock" ? "stocktake" : reason,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast(error.message, "err");
    toast(`${product.name}: now ${data} in stock`);
    onDone(product.id, Number(data));
  };

  return (
    <Modal title={product.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-600">Currently in stock</span>
          <span className="text-2xl font-extrabold">{product.stock}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            ["add", "Add (+)"],
            ["remove", "Remove (−)"],
            ["set", "Set count"],
          ] as const).map(([k, l]) => (
            <button
              type="button"
              key={k}
              onClick={() => setMode(k)}
              className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${mode === k ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div>
          <label className="label">{mode === "set" ? "Counted quantity" : "Quantity"}</label>
          <input ref={qtyRef} className="input h-12 text-lg" type="number" min="0" step="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </div>

        <div>
          <label className="label">Reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier invoice #204" />
        </div>

        {valid && delta !== 0 && (
          <div className={`rounded-xl px-3.5 py-2.5 text-sm font-semibold ${after < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {product.stock} → {after} ({delta > 0 ? "+" : ""}{delta})
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !valid || delta === 0 || after < 0}>
            {busy ? "Saving…" : "Update stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- history tab ------------------------------ */

const PAGE = 50;

function History() {
  const toast = useToast();
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      const { data, error } = await supabaseBrowser()
        .from("stock_movements")
        .select("id, product_id, change, reason, note, stock_after, created_at, products(name, barcode)")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) toast(error.message, "err");
      const list = (data ?? []) as unknown as StockMovement[];
      setRows((prev) => (offset === 0 ? list : [...prev, ...list]));
      setMore(list.length === PAGE);
      setLoading(false);
    },
    [toast]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  if (loading) {
    return (
      <div className="card space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-10" />)}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">No stock changes yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">After</th>
                <th className="hidden px-4 py-3 sm:table-cell">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDateTime(m.created_at)}</td>
                  <td className="px-4 py-2.5 font-medium">{m.products?.name ?? "—"}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${m.change > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {m.change > 0 ? "+" : ""}{m.change}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{m.stock_after ?? "—"}</td>
                  <td className="hidden px-4 py-2.5 capitalize text-slate-500 sm:table-cell">
                    {m.reason}{m.note ? <span className="text-slate-400"> · {m.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <div className="border-t border-slate-100 p-3 text-center">
          <button className="btn btn-ghost" onClick={() => load(rows.length)}>Load more</button>
        </div>
      )}
    </div>
  );
}
