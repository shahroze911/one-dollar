"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Camera,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchPosProducts } from "@/lib/products";
import { fromCents, money, receiptNo, toCents } from "@/lib/format";
import { beep } from "@/lib/beep";
import { useGlobalScanner } from "@/hooks/useGlobalScanner";
import { useToast } from "@/components/toast";
import { useAdmin, useReceipt } from "@/components/providers";
import { UnlockForm } from "@/components/admin-gate";
import Modal from "@/components/modal";
import ProductForm from "@/components/product-form";
import ProductImage from "@/components/product-image";
import CameraScanner from "@/components/camera-scanner";
import type { Product, ReceiptData } from "@/lib/types";

type Line = { p: Product; qty: number };
type Done = { receipt: ReceiptData; change: number };
const GRID_LIMIT = 60;

export default function PosPage() {
  const toast = useToast();
  const { unlocked } = useAdmin();
  const { print } = useReceipt();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<"cash" | "card">("cash");
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<Line[]>([]);

  const commitCart = (next: Line[]) => {
    cartRef.current = next;
    setCart(next);
  };

  // remember the "auto-print" choice on this device
  useEffect(() => {
    try {
      const v = localStorage.getItem("autoPrint");
      if (v !== null) setAutoPrint(v === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleAutoPrint = () => {
    const next = !autoPrint;
    setAutoPrint(next);
    try {
      localStorage.setItem("autoPrint", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // ---- load the catalogue once; everything after is instant, in memory ----
  const reload = useCallback(async () => {
    try {
      setProducts(await fetchPosProducts());
    } catch (e: any) {
      toast(e.message ?? "Could not load products", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
    inputRef.current?.focus();
  }, [reload]);

  const byBarcode = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => p.barcode && m.set(p.barcode, p));
    return m;
  }, [products]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s));
  }, [products, q]);

  // ---- cart -------------------------------------------------------------
  const add = useCallback(
    (p: Product, qty = 1) => {
      const cur = cartRef.current;
      const i = cur.findIndex((l) => l.p.id === p.id);
      const have = i >= 0 ? cur[i].qty : 0;
      if (have + qty > p.stock) {
        toast(p.stock <= 0 ? `"${p.name}" is out of stock` : `Only ${p.stock} of "${p.name}" in stock`, "err");
        beep("err");
        return;
      }
      beep("ok");
      let next: Line[];
      if (i >= 0) {
        next = [...cur];
        next[i] = { ...next[i], qty: have + qty };
      } else {
        next = [{ p, qty }, ...cur];
      }
      commitCart(next);
      setDone(null);
    },
    [toast]
  );

  const setQty = (id: string, qty: number) => {
    const cur = cartRef.current;
    const line = cur.find((l) => l.p.id === id);
    if (!line) return;
    if (qty <= 0) return commitCart(cur.filter((l) => l.p.id !== id));
    if (qty > line.p.stock) {
      toast(`Only ${line.p.stock} in stock`, "err");
      beep("err");
      return;
    }
    commitCart(cur.map((l) => (l.p.id === id ? { ...l, qty } : l)));
  };

  const totalCents = cart.reduce((s, l) => s + toCents(l.p.price) * l.qty, 0);
  const total = fromCents(totalCents);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const receivedCents = cash === "" ? totalCents : toCents(Number(cash) || 0);
  const changeCents = receivedCents - totalCents;

  // ---- scanning ---------------------------------------------------------
  const handleCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const hit = byBarcode.get(code);
      if (hit) {
        add(hit);
        setQ("");
        return;
      }
      if (/^\d{6,}$/.test(code)) {
        beep("err");
        setNewCode(code); // unknown barcode → offer to add it
      } else {
        toast(`No product matches "${code}"`, "err");
        beep("err");
      }
    },
    [byBarcode, add, toast]
  );

  useGlobalScanner(handleCode, !newCode && !camera);

  const onEnter = () => {
    const code = q.trim();
    if (!code) return;
    const exact = byBarcode.get(code);
    if (exact) {
      add(exact);
      setQ("");
    } else if (results.length === 1) {
      add(results[0]);
      setQ("");
    } else if (/^\d{6,}$/.test(code)) {
      beep("err");
      setNewCode(code);
    } else {
      toast(results.length ? "Several matches. Tap the one you want." : `No product matches "${code}"`, results.length ? "info" : "err");
    }
  };

  // ---- checkout ---------------------------------------------------------
  const checkout = useCallback(async () => {
    const lines = cartRef.current;
    if (!lines.length || busy) return;
    const tc = lines.reduce((s, l) => s + toCents(l.p.price) * l.qty, 0);
    const rc = pay === "cash" ? (cash === "" ? tc : toCents(Number(cash) || 0)) : null;
    if (rc !== null && rc < tc) {
      toast("Cash received is less than the total", "err");
      beep("err");
      return;
    }
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("checkout", {
      p_items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })),
      p_payment: pay,
      p_cash_received: rc === null ? null : fromCents(rc),
    });
    setBusy(false);

    if (error) {
      toast(error.message, "err");
      beep("err");
      reload(); // stock may have changed on another till
      return;
    }

    setProducts((prev) =>
      prev.map((p) => {
        const l = lines.find((x) => x.p.id === p.id);
        return l ? { ...p, stock: p.stock - l.qty } : p;
      })
    );

    const receipt: ReceiptData = {
      id: data.sale_id,
      created_at: data.created_at,
      payment_method: pay,
      cashier: data.cashier,
      items: lines.map((l) => ({ name: l.p.name, qty: l.qty, unit_price: l.p.price })),
      total: Number(data.total),
      cash_received: rc === null ? null : fromCents(rc),
      change_given: rc === null ? null : fromCents(rc - tc),
    };
    setDone({ receipt, change: rc === null ? 0 : fromCents(rc - tc) });
    commitCart([]);
    setCash("");
    beep("ok");
    if (autoPrint) print(receipt);
  }, [busy, pay, cash, toast, reload, autoPrint, print]);

  const closeDone = useCallback(() => {
    setDone(null);
    inputRef.current?.focus();
  }, []);

  // keyboard: F2 focus scan box · F9 / Ctrl+Enter charge · Esc / Enter closes the "sale complete" card
  const checkoutRef = useRef(checkout);
  checkoutRef.current = checkout;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        checkoutRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (!done) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") closeDone();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [done, closeDone]);

  // Pakistani notes the customer is most likely to hand over
  const quickCash = useMemo(
    () => [50, 100, 500, 1000, 5000].filter((n) => toCents(n) >= totalCents).slice(0, 4),
    [totalCents]
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_400px]">
      {/* ------------------------- LEFT: scan + items ------------------------- */}
      <section className="min-w-0 space-y-4">
        <div className="card p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-600" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onEnter();
                  }
                }}
                className="input h-12 pl-11 text-base"
                placeholder="Scan barcode, type the number, or search by name…"
                autoComplete="off"
                inputMode="search"
              />
              {q && (
                <button onClick={() => { setQ(""); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Clear">
                  <X size={16} />
                </button>
              )}
            </div>
            <button className="btn btn-ghost h-12 px-4" onClick={() => setCamera((c) => !c)} title="Scan with camera">
              <Camera size={18} /> <span className="hidden sm:inline">Camera</span>
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <span>
              Scanner ready, just scan. <kbd className="rounded bg-slate-100 px-1">F2</kbd> focus · <kbd className="rounded bg-slate-100 px-1">F9</kbd> charge
            </span>
            <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-600">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={autoPrint} onChange={toggleAutoPrint} />
              <Printer size={14} /> Print receipt automatically
            </label>
          </div>
        </div>

        {camera && <CameraScanner onDetect={(code) => handleCode(code)} onClose={() => setCamera(false)} />}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-44" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            <p className="font-semibold text-slate-700">No products yet</p>
            <p className="mt-1 text-sm">Scan any barcode to add it on the spot, or go to Products (owner password).</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {results.slice(0, GRID_LIMIT).map((p) => {
                const out = p.stock <= 0;
                const low = !out && p.stock <= p.low_stock_threshold;
                return (
                  <button
                    key={p.id}
                    onClick={() => { add(p); inputRef.current?.focus(); }}
                    disabled={out}
                    className={`card slide-up group overflow-hidden text-left transition duration-200 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg active:scale-[.97] ${out ? "opacity-55 grayscale" : ""}`}
                  >
                    <div className="relative overflow-hidden">
                      <ProductImage
                        name={p.name}
                        path={p.image_path}
                        className="aspect-[4/3] w-full text-3xl transition duration-300 group-hover:scale-105"
                      />
                      <span className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2 py-0.5 text-sm font-extrabold text-emerald-700 shadow">
                        {money(p.price)}
                      </span>
                      <span
                        className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow ${
                          out ? "bg-rose-600 text-white" : low ? "bg-amber-400 text-amber-950" : "bg-black/55 text-white"
                        }`}
                      >
                        {out ? "Out" : `${p.stock} left`}
                      </span>
                    </div>
                    <div className="line-clamp-2 min-h-[2.9rem] p-2.5 text-sm font-semibold leading-snug">{p.name}</div>
                  </button>
                );
              })}
            </div>
            {results.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No match. Press Enter on a barcode number to add it as a new product.</p>}
            {results.length > GRID_LIMIT && <p className="text-center text-xs text-slate-400">Showing {GRID_LIMIT} of {results.length}. Search to narrow down.</p>}
          </>
        )}
      </section>

      {/* ----------------------------- RIGHT: cart ---------------------------- */}
      <aside id="cart" className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
        <div className="card flex h-full flex-col overflow-hidden">
          <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2 font-bold">
              <ShoppingCart size={18} /> Cart
              {itemCount > 0 && (
                <span key={itemCount} className="bump rounded-full bg-white/25 px-2 py-0.5 text-xs">
                  {itemCount}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button onClick={() => commitCart([])} className="text-xs font-semibold text-white/80 hover:text-white">
                Clear
              </button>
            )}
          </div>

          <div className="min-h-[8rem] flex-1 space-y-2 overflow-y-auto p-3">
            {cart.length === 0 && (
              <div className="grid h-full place-items-center py-10 text-center text-sm text-slate-400">
                <div>
                  <ScanBarcode size={40} className="float mx-auto mb-2 opacity-40" />
                  Scan an item to begin
                </div>
              </div>
            )}

            {cart.map((l) => (
              <div key={l.p.id} className="pop flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2">
                <ProductImage name={l.p.name} path={l.p.image_path} className="h-11 w-11 shrink-0 rounded-lg text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{l.p.name}</div>
                  <div className="text-xs text-slate-500">{money(l.p.price)} each</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(l.p.id, l.qty - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100" aria-label="Less"><Minus size={14} /></button>
                  <input
                    value={l.qty}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n)) setQty(l.p.id, n);
                    }}
                    inputMode="numeric"
                    className="h-8 w-9 rounded-lg border border-slate-200 bg-white text-center text-sm font-bold outline-none focus:border-emerald-500"
                  />
                  <button onClick={() => setQty(l.p.id, l.qty + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100" aria-label="More"><Plus size={14} /></button>
                </div>
                <div className="w-16 text-right text-sm font-bold">{money(l.p.price * l.qty)}</div>
                <button onClick={() => setQty(l.p.id, 0)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-slate-100 bg-white p-4">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
              <span key={totalCents} className="bump text-3xl font-extrabold tracking-tight">{money(total)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(["cash", "card"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPay(m)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    pay === m ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-inner" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />} {m === "cash" ? "Cash" : "Card"}
                </button>
              ))}
            </div>

            {pay === "cash" && cart.length > 0 && (
              <div className="space-y-2">
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  inputMode="decimal"
                  placeholder={`Cash received (blank = ${money(total)})`}
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setCash("")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Exact</button>
                  {quickCash.map((n) => (
                    <button key={n} onClick={() => setCash(String(n))} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-50 hover:border-emerald-300">
                      {money(n)}
                    </button>
                  ))}
                </div>
                {cash !== "" && (
                  <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${changeCents >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    {changeCents >= 0 ? `Change due: ${money(fromCents(changeCents))}` : `Short by ${money(fromCents(-changeCents))}`}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={checkout}
              disabled={!cart.length || busy || (pay === "cash" && changeCents < 0)}
              className="btn btn-primary h-12 w-full text-base"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              {busy ? "Processing…" : `Charge ${money(total)}`}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile floating total bar */}
      {cart.length > 0 && (
        <a href="#cart" className="fixed inset-x-4 bottom-20 z-20 flex items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 font-semibold text-white shadow-xl lg:hidden">
          <span>{itemCount} item{itemCount === 1 ? "" : "s"} · View cart</span>
          <span className="text-lg font-extrabold">{money(total)}</span>
        </a>
      )}

      {/* Sale complete */}
      {done && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && closeDone()}
        >
          <div className="pop w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <svg viewBox="0 0 52 52" className="mx-auto h-20 w-20" aria-hidden>
              <circle className="check-circle" cx="26" cy="26" r="24" fill="none" stroke="#10b981" strokeWidth="3" />
              <path className="check-path" fill="none" stroke="#10b981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" d="M14 27l8 8 16-17" />
            </svg>
            <h2 className="mt-3 text-xl font-extrabold">Sale complete</h2>
            <p className="text-sm text-slate-500">Receipt #{receiptNo(done.receipt.id)} · {money(done.receipt.total)}</p>

            {done.receipt.payment_method === "cash" && (
              <div className="mt-4 rounded-2xl bg-emerald-50 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Give change</div>
                <div className="text-4xl font-extrabold text-emerald-700">{money(done.change)}</div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={() => print(done.receipt)}>
                <Printer size={16} /> Print again
              </button>
              <button className="btn btn-primary" autoFocus onClick={closeDone}>
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {newCode && (
        <Modal title="Barcode not in catalogue" onClose={() => { setNewCode(null); inputRef.current?.focus(); }}>
          <p className="mb-3 text-sm text-slate-600">
            <span className="font-mono font-semibold">{newCode}</span> isn&apos;t in your catalogue yet.
          </p>
          {unlocked ? (
            <ProductForm
              initialBarcode={newCode}
              onCancel={() => { setNewCode(null); setQ(""); inputRef.current?.focus(); }}
              onSaved={(p) => {
                setProducts((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)));
                setNewCode(null);
                setQ("");
                if (p.active && p.stock > 0) add(p);
                else toast("Added, but it has no stock yet. Receive stock first.", "info");
                inputRef.current?.focus();
              }}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">Adding products needs the owner password.</p>
              <UnlockForm />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
