"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { fetchAdminProducts } from "@/lib/products";
import { money } from "@/lib/format";
import { useToast } from "@/components/toast";
import Modal from "@/components/modal";
import ProductForm from "@/components/product-form";
import ProductImage from "@/components/product-image";
import StockBadge from "@/components/stock-badge";
import type { Product } from "@/lib/types";

export default function ProductsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // barcode prefill ("" = blank form)
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAdminProducts());
    } catch (e: any) {
      toast(e.message ?? "Could not load products", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(
      (p) => (showInactive || p.active) && (!s || p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s))
    );
  }, [items, q, showInactive]);

  const onSearchEnter = () => {
    const code = q.trim();
    if (!code) return;
    const exact = items.find((p) => p.barcode === code);
    if (exact) {
      setEditing(exact);
      setQ("");
    } else if (/^\d{6,}$/.test(code)) {
      setCreating(code);
      setQ("");
    }
  };

  const upsert = (p: Product) =>
    setItems((prev) => {
      const next = prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Products</h1>
          <p className="text-sm text-slate-500">{items.filter((p) => p.active).length} active · scan a barcode here to find or add an item</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating("")}>
          <Plus size={16} /> Add product
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="input pl-10"
            placeholder="Search or scan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSearchEnter())}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            {items.length === 0 ? "No products yet. Add your first one." : "Nothing matches your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Barcode</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="hidden px-4 py-3 text-right md:table-cell">Cost</th>
                  <th className="px-4 py-3 text-center">Stock</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className={`transition hover:bg-emerald-50/40 ${p.active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <ProductImage name={p.name} path={p.image_path} className="h-11 w-11 shrink-0 rounded-xl text-xs" />
                        <span className="font-semibold">
                          {p.name}
                          {!p.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">inactive</span>}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 sm:table-cell">{p.barcode ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-bold">{money(p.price)}</td>
                    <td className="hidden px-4 py-2.5 text-right text-slate-500 md:table-cell">{p.cost ? money(p.cost) : "—"}</td>
                    <td className="px-4 py-2.5 text-center"><StockBadge p={p} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(editing || creating !== null) && (
        <Modal title={editing ? "Edit product" : "Add product"} onClose={() => { setEditing(null); setCreating(null); }}>
          <ProductForm
            product={editing}
            initialBarcode={creating ?? undefined}
            onCancel={() => { setEditing(null); setCreating(null); }}
            onSaved={(p) => {
              upsert(p);
              setEditing(null);
              setCreating(null);
              searchRef.current?.focus();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
