"use client";
import { useRef, useState } from "react";
import { ImagePlus, Trash2, Wand2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { imageUrl, removeProductImage, uploadProductImage } from "@/lib/images";
import { useToast } from "@/components/toast";
import type { Product } from "@/lib/types";

const genCode = () =>
  "2" + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 100)).padStart(2, "0");

export default function ProductForm({
  product,
  initialBarcode,
  onSaved,
  onCancel,
}: {
  product?: Product | null;
  initialBarcode?: string;
  onSaved: (p: Product) => void;
  onCancel: () => void;
}) {
  const editing = !!product;
  const toast = useToast();
  const [barcode, setBarcode] = useState(product?.barcode ?? initialBarcode ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [cost, setCost] = useState(product?.cost ? String(product.cost) : "");
  const [stock, setStock] = useState("");
  const [low, setLow] = useState(String(product?.low_stock_threshold ?? 5));
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);

  // optional picture
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(imageUrl(product?.image_path));
  const [removed, setRemoved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast("That photo is too big (max 10 MB)", "err");
    setFile(f);
    setRemoved(false);
    setPreview(URL.createObjectURL(f));
  };

  const clearImage = () => {
    setFile(null);
    setPreview(null);
    setRemoved(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast("Product name is required", "err");
    const p = Number(price);
    if (price === "" || !isFinite(p) || p < 0) return toast("Enter a valid price in Rs", "err");
    const s = Number(stock || 0);
    if (!editing && (!Number.isInteger(s) || s < 0)) return toast("Stock must be a whole number", "err");

    setBusy(true);

    let path: string | null = removed ? null : product?.image_path ?? null;
    if (file) {
      try {
        path = await uploadProductImage(file);
      } catch (err: any) {
        setBusy(false);
        return toast(err?.message ?? "Picture upload failed", "err");
      }
    }

    const { data, error } = await supabaseBrowser().rpc("save_product", {
      p_id: product?.id ?? null,
      p_barcode: barcode.trim() || null,
      p_name: name.trim(),
      p_price: p,
      p_cost: Number(cost || 0),
      p_low: Number(low || 0),
      p_active: active,
      p_image_path: path,
      p_stock: editing ? 0 : s,
    });
    setBusy(false);

    if (error) {
      if (file && path) removeProductImage(path); // don't leave an orphaned upload behind
      toast(error.message, "err");
      return;
    }
    if ((file || removed) && product?.image_path && product.image_path !== path) {
      removeProductImage(product.image_path);
    }
    toast(editing ? "Product updated" : "Product added");
    onSaved(data as Product);
  };

  return (
    <form onSubmit={save} className="space-y-3">
      {/* picture */}
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-slate-300">
              <ImagePlus size={28} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Product picture <span className="font-normal text-slate-400">(optional)</span></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> {preview ? "Change" : "Add picture"}
            </button>
            {preview && (
              <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs text-rose-600" onClick={clearImage}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>

      <div>
        <label className="label">Barcode — scan it here or type it</label>
        <div className="flex gap-2">
          <input
            className="input font-mono"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // scanners end with Enter: move on instead of submitting
                nameRef.current?.focus();
              }
            }}
            placeholder="Scan barcode…"
            autoFocus={!editing && !initialBarcode}
            inputMode="numeric"
          />
          <button type="button" className="btn btn-ghost shrink-0" onClick={() => setBarcode(genCode())} title="Make up a code for items with no barcode">
            <Wand2 size={16} /> Generate
          </button>
        </div>
      </div>

      <div>
        <label className="label">Name</label>
        <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mini notebook" autoFocus={!!initialBarcode} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Selling price (Rs)</label>
          <input className="input" type="number" step="0.01" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">Cost price (Rs) — optional</label>
          <input className="input" type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
        </div>
        {!editing && (
          <div>
            <label className="label">Starting stock</label>
            <input className="input" type="number" min="0" step="1" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
          </div>
        )}
        <div>
          <label className="label">Low-stock alert at</label>
          <input className="input" type="number" min="0" step="1" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} />
        </div>
      </div>

      {editing && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          Active (untick to hide from checkout without deleting history)
        </label>
      )}
      {editing && <p className="text-xs text-slate-500">To change the quantity in stock, use the Stock page. It keeps a history.</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add product"}
        </button>
      </div>
    </form>
  );
}
