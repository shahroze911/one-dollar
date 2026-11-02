"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, FilePlus2, Landmark, Loader2, Minus, Pause, Plus, Printer, ScanBarcode, Search, Tag, Trash2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAdminProducts } from "@/lib/products";
import { money, receiptNo, toCents } from "@/lib/format";
import { beep } from "@/lib/beep";
import { discountAmount, r2, type DMode } from "@/lib/discount";
import { emptyPay, evalPay, methodLabel, type PayState } from "@/lib/payments";
import { isNetworkError, newId } from "@/lib/offline";
import { useGlobalScanner } from "@/hooks/useGlobalScanner";
import { useToast } from "@/components/toast";
import { useReceipt, useSettings } from "@/components/providers";
import Modal from "@/components/modal";
import ProductForm from "@/components/product-form";
import ProductImage from "@/components/product-image";
import CameraScanner from "@/components/camera-scanner";
import DiscountBox from "@/components/discount-box";
import PaymentPanel from "@/components/payment-panel";
import type { CurrentShift, Product, ReceiptData } from "@/lib/types";

// price is kept as text while typing; dm/dv = this line's discount entry
type Line = { p: Product; qty: number; price: string; dm: DMode; dv: string };
type Done = { receipt: ReceiptData; change: number };
type Held = {
  id: number;
  n: number;
  at: number;
  count: number;
  total: number;
  lines: { id: string; qty: number; price: string; dm: DMode; dv: string }[];
  sdm: DMode;
  sdv: string;
};
const HELD_KEY = "heldCustomSales";

/* The last few prices used for a product on THIS device, offered as one-tap chips (e.g. 250 / 300). */
const lastKey = (id: string) => `lastPrices:${id}`;
function readLast(id: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(lastKey(id)) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}
function rememberPrice(id: string, price: number) {
  try {
    const cur = readLast(id).filter((n) => n !== price);
    localStorage.setItem(lastKey(id), JSON.stringify([price, ...cur].slice(0, 4)));
  } catch {
    /* storage unavailable */
  }
}

const numPrice = (s: string) => (s.trim() === "" ? NaN : Number(s));
const unit = (l: Line) => (isFinite(numPrice(l.price)) ? numPrice(l.price) : 0);

/** Money maths for the bill: per-line gross/discount/net, whole-sale discount, total. */
function calc(lines: Line[], sdm: DMode, sdv: string) {
  let gross = 0;
  let lineDisc = 0;
  const per = lines.map((l) => {
    const g = r2(unit(l) * l.qty);
    const d = discountAmount(g, l.dm, l.dv);
    gross += g;
    lineDisc += d;
    return { g, d, net: r2(g - d) };
  });
  const subtotal = r2(gross - lineDisc);
  const saleDisc = discountAmount(subtotal, sdm, sdv);
  const total = r2(subtotal - saleDisc);
  return { per, gross: r2(gross), lineDisc: r2(lineDisc), subtotal, saleDisc, total };
}

export default function CustomBillPage() {
  const toast = useToast();
  const { print } = useReceipt();
  const { settings } = useSettings();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<PayState>(emptyPay());
  const [sdm, setSdm] = useState<DMode>("rs");
  const [sdv, setSdv] = useState("");
  const [saleDiscOpen, setSaleDiscOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [shift, setShift] = useState<CurrentShift | null | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const linesRef = useRef<Line[]>([]);
  const saleKey = useRef<{ id: string; sig: string } | null>(null);

  const commit = (next: Line[]) => {
    linesRef.current = next;
    setLines(next);
  };

  useEffect(() => {
    try {
      const v = localStorage.getItem("autoPrint");
      if (v !== null) setAutoPrint(v === "1");
    } catch {
      /* ignore */
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

  useEffect(() => {
    supabaseBrowser()
      .rpc("current_shift")
      .then(({ data, error }) => {
        if (!error) setShift((data as CurrentShift | null) ?? null);
      });
  }, []);

  const load = useCallback(async () => {
    try {
      setProducts((await fetchAdminProducts()).filter((p) => p.active));
    } catch (e: any) {
      toast(e.message ?? "Could not load stock", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    searchRef.current?.focus();
  }, [load]);

  const byBarcode = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => p.barcode && m.set(p.barcode, p));
    return m;
  }, [products]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? products.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s)) : products;
    return list.slice(0, 30);
  }, [products, q]);

  // ---- bill lines --------------------------------------------------------
  const addProduct = useCallback(
    (p: Product) => {
      const cur = linesRef.current;
      const i = cur.findIndex((l) => l.p.id === p.id);
      const have = i >= 0 ? cur[i].qty : 0;
      if (have + 1 > p.stock) {
        toast(p.stock <= 0 ? `"${p.name}" is out of stock` : `Only ${p.stock} of "${p.name}" in stock`, "err");
        beep("err");
        return;
      }
      beep("ok");
      if (i >= 0) {
        const next = [...cur];
        next[i] = { ...next[i], qty: have + 1 };
        commit(next);
      } else {
        commit([{ p, qty: 1, price: String(p.price), dm: "rs", dv: "" }, ...cur]);
      }
      setDone(null);
      setQ("");
    },
    [toast]
  );

  const patch = (id: string, change: Partial<Pick<Line, "qty" | "price" | "dm" | "dv">>) =>
    commit(linesRef.current.map((l) => (l.p.id === id ? { ...l, ...change } : l)));

  const setQty = (l: Line, qty: number) => {
    if (qty <= 0) return commit(linesRef.current.filter((x) => x.p.id !== l.p.id));
    if (qty > l.p.stock) {
      toast(`Only ${l.p.stock} in stock`, "err");
      beep("err");
      return;
    }
    patch(l.p.id, { qty });
  };

  const resetExtras = () => {
    setPay(emptyPay());
    setSdv("");
    setSdm("rs");
    setSaleDiscOpen(false);
    setDiscOpen({});
  };

  const handleCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const hit = byBarcode.get(code);
      if (hit) addProduct(hit);
      else if (/^\d{6,}$/.test(code)) {
        beep("err");
        setNewCode(code);
      } else {
        toast(`No stock item with barcode "${code}"`, "err");
        beep("err");
      }
    },
    [byBarcode, addProduct, toast]
  );
  useGlobalScanner(handleCode, !newCode && !camera);

  const onEnter = () => {
    const code = q.trim();
    if (!code) return;
    const exact = byBarcode.get(code);
    if (exact) addProduct(exact);
    else if (results.length === 1) addProduct(results[0]);
    else if (/^\d{6,}$/.test(code)) {
      beep("err");
      setNewCode(code);
    } else toast(results.length ? "Several matches. Tap the one you want." : "Nothing found", results.length ? "info" : "err");
  };

  // ---- totals ------------------------------------------------------------
  const c = useMemo(() => calc(lines, sdm, sdv), [lines, sdm, sdv]);
  const priceBad = lines.some((l) => !isFinite(numPrice(l.price)) || numPrice(l.price) < 0);
  const dueCents = toCents(c.total);
  const ev = evalPay(pay, dueCents);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const totalDiscount = r2(c.lineDisc + c.saleDisc);

  // ---- create the bill ---------------------------------------------------
  const createBill = useCallback(async () => {
    const cur = linesRef.current;
    if (!cur.length || busy) return;
    if (cur.some((l) => !isFinite(numPrice(l.price)) || numPrice(l.price) < 0)) {
      toast("Enter a price for every item", "err");
      return;
    }
    const cc = calc(cur, sdm, sdv);
    const e = evalPay(pay, toCents(cc.total));
    if (!e.ok) {
      toast(e.overCents > 0 ? "Card / wallet is more than the bill" : "Payment does not cover the total", "err");
      beep("err");
      return;
    }
    const items = cur.map((l, i) => ({ product_id: l.p.id, qty: l.qty, price: numPrice(l.price), discount: cc.per[i].d }));
    const sig = JSON.stringify([items, e.payments, cc.saleDisc]);
    if (!saleKey.current || saleKey.current.sig !== sig) saleKey.current = { id: newId(), sig }; // same bill => same id, so no double sale
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("checkout", {
      p_items: items,
      p_payments: e.payments,
      p_discount: cc.saleDisc,
      p_client_id: saleKey.current.id,
    });
    setBusy(false);

    if (error) {
      if (isNetworkError(error)) {
        toast("No internet. Custom Bill needs internet, so nothing was saved. Use Checkout for offline sales, or try again when it is back.", "err");
        beep("err");
        return;
      }
      toast(error.message, "err");
      beep("err");
      load(); // stock may have changed
      return;
    }

    saleKey.current = null;
    cur.forEach((l) => rememberPrice(l.p.id, numPrice(l.price)));
    setProducts((prev) =>
      prev.map((p) => {
        const l = cur.find((x) => x.p.id === p.id);
        return l ? { ...p, stock: p.stock - l.qty } : p;
      })
    );

    const receipt: ReceiptData = {
      id: data.sale_id,
      created_at: data.created_at,
      payment_method: data.payment_method,
      payments: (data.payments ?? []).map((p: any) => ({ method: p.method, amount: Number(p.amount) })),
      cashier: data.cashier,
      items: cur.map((l, i) => ({ name: l.p.name, qty: l.qty, unit_price: numPrice(l.price), discount: cc.per[i].d })),
      subtotal: Number(data.subtotal),
      discount: Number(data.discount),
      total: Number(data.total),
      cash_received: data.cash_received == null ? null : Number(data.cash_received),
      change_given: data.change_given == null ? null : Number(data.change_given),
    };
    setDone({ receipt, change: Number(data.change_given ?? 0) });
    commit([]);
    resetExtras();
    beep("ok");
    if (autoPrint) print(receipt);
  }, [busy, pay, sdm, sdv, toast, load, autoPrint, print]);

  const closeDone = useCallback(() => {
    setDone(null);
    searchRef.current?.focus();
  }, []);

  // ---- hold / resume (kept separately from the Checkout page's held sales) ----
  const [held, setHeld] = useState<Held[]>([]);
  const heldRef = useRef<Held[]>([]);
  const saveHeld = (next: Held[]) => {
    heldRef.current = next;
    setHeld(next);
    try {
      localStorage.setItem(HELD_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]");
      if (Array.isArray(v)) {
        heldRef.current = v;
        setHeld(v);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const makeHeld = (ls: Line[], list: Held[], m: DMode, v: string): Held => ({
    id: Date.now() + Math.floor(Math.random() * 1000),
    n: list.reduce((mx, h) => Math.max(mx, h.n), 0) + 1,
    at: Date.now(),
    count: ls.reduce((s, l) => s + l.qty, 0),
    total: calc(ls, m, v).total,
    lines: ls.map((l) => ({ id: l.p.id, qty: l.qty, price: l.price, dm: l.dm, dv: l.dv })),
    sdm: m,
    sdv: v,
  });

  const holdBill = useCallback(() => {
    const cur = linesRef.current;
    if (!cur.length) return;
    const entry = makeHeld(cur, heldRef.current, sdm, sdv);
    saveHeld([...heldRef.current, entry]);
    commit([]);
    resetExtras();
    setDone(null);
    toast(`Bill put on hold as Customer ${entry.n}`, "info");
    searchRef.current?.focus();
  }, [toast, sdm, sdv]);

  const resumeHeld = (h: Held) => {
    const rebuilt: Line[] = [];
    let changed = 0;
    for (const it of h.lines) {
      const p = products.find((x) => x.id === it.id);
      if (!p || p.stock <= 0) {
        changed++;
        continue;
      }
      const qty = Math.min(it.qty, p.stock);
      if (qty < it.qty) changed++;
      rebuilt.push({ p, qty, price: it.price, dm: it.dm, dv: it.dv });
    }
    let next = heldRef.current.filter((x) => x.id !== h.id);
    if (!rebuilt.length) {
      saveHeld(next);
      toast("Nothing from that bill is available any more", "err");
      return;
    }
    const cur = linesRef.current;
    if (cur.length) next = [...next, makeHeld(cur, next, sdm, sdv)]; // never lose what is on screen
    saveHeld(next);
    commit(rebuilt);
    setPay(emptyPay());
    setSdm(h.sdm);
    setSdv(h.sdv);
    setSaleDiscOpen(!!h.sdv);
    setDiscOpen({});
    setDone(null);
    if (changed) toast(`${changed} item${changed === 1 ? "" : "s"} changed or ran out of stock since this bill was held`, "info");
    searchRef.current?.focus();
  };

  const discardHeld = (h: Held) => {
    if (!confirm(`Discard Customer ${h.n}'s held bill (${h.count} item${h.count === 1 ? "" : "s"})? Nothing was taken from stock.`)) return;
    saveHeld(heldRef.current.filter((x) => x.id !== h.id));
  };

  // ---- keyboard: F2 focus · F4 hold · F9 / Ctrl+Enter create bill · Esc / Enter closes "bill created"
  const createRef = useRef(createBill);
  createRef.current = createBill;
  const holdRef = useRef(holdBill);
  holdRef.current = holdBill;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        holdRef.current();
      }
      if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        createRef.current();
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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/25">
          <FilePlus2 size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Custom Bill</h1>
          <p className="text-sm text-slate-500">Pick items from stock, set your own price for this sale, and print the bill.</p>
        </div>
      </div>

      {shift === null && !settings.hidden_pages.includes("/shift") && (
        <Link href="/shift" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100">
          <Landmark size={18} className="shrink-0" />
          <span><b>No cash drawer shift is open,</b> so cash is not being tracked. Tap to open one.</span>
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_430px]">
        {/* ---------------------------- pick from stock ---------------------------- */}
        <section className="min-w-0 space-y-3">
          <div className="card p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-600" />
                <input
                  ref={searchRef}
                  className="input h-12 pl-11 text-base"
                  placeholder="Search your stock or scan a barcode…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onEnter())}
                  autoComplete="off"
                />
                {q && (
                  <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Clear">
                    <X size={16} />
                  </button>
                )}
              </div>
              <button className="btn btn-ghost h-12 px-4" onClick={() => setCamera((v) => !v)} title="Scan with camera">
                <Camera size={18} /> <span className="hidden sm:inline">Camera</span>
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
              <span>
                Scanner ready. <kbd className="rounded bg-slate-100 px-1">F2</kbd> focus · <kbd className="rounded bg-slate-100 px-1">F9</kbd> create bill · <kbd className="rounded bg-slate-100 px-1">F4</kbd> hold
              </span>
              <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={autoPrint} onChange={toggleAutoPrint} />
                <Printer size={14} /> Print automatically
              </label>
            </div>
          </div>

          {camera && <CameraScanner onDetect={(code) => handleCode(code)} onClose={() => setCamera(false)} />}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
            </div>
          ) : products.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-500">No products in stock yet. Add them under Products.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {results.map((p) => {
                const out = p.stock <= 0;
                const inBill = lines.find((l) => l.p.id === p.id)?.qty ?? 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => { addProduct(p); searchRef.current?.focus(); }}
                    disabled={out}
                    className={`card slide-up flex items-center gap-3 p-2.5 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md active:scale-[.98] ${out ? "opacity-50 grayscale" : ""}`}
                  >
                    <ProductImage name={p.name} path={p.image_path} className="h-14 w-14 shrink-0 rounded-xl text-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        List price {money(p.price)} ·{" "}
                        <span className={out ? "font-semibold text-rose-600" : p.stock <= p.low_stock_threshold ? "font-semibold text-amber-600" : ""}>
                          {out ? "Out of stock" : `${p.stock} in stock`}
                        </span>
                      </div>
                    </div>
                    {inBill > 0 ? (
                      <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">{inBill} added</span>
                    ) : (
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Plus size={16} /></span>
                    )}
                  </button>
                );
              })}
              {results.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-500">No match in your stock.</p>}
            </div>
          )}
        </section>

        {/* -------------------------------- the bill -------------------------------- */}
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-7.5rem)]">
          <div className="card flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white">
              <div className="flex items-center gap-2 font-bold">
                <ScanBarcode size={18} /> Bill
                {itemCount > 0 && <span key={itemCount} className="bump rounded-full bg-white/25 px-2 py-0.5 text-xs">{itemCount}</span>}
              </div>
              {lines.length > 0 && (
                <div className="flex items-center gap-3">
                  <button onClick={holdBill} className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-white/30 active:scale-95" title="Put this bill on hold (F4)">
                    <Pause size={13} /> Hold
                  </button>
                  <button onClick={() => { commit([]); resetExtras(); }} className="text-xs font-semibold text-white/80 hover:text-white">Clear</button>
                </div>
              )}
            </div>

            {held.length > 0 && (
              <div className="border-b border-amber-100 bg-amber-50/70 px-3 py-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-800">
                  <Pause size={12} /> On hold ({held.length}) · tap one to continue it
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {held.map((h) => (
                    <div key={h.id} className="pop flex shrink-0 items-stretch overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
                      <button onClick={() => resumeHeld(h)} className="px-3 py-1.5 text-left transition hover:bg-amber-50">
                        <div className="text-xs font-bold">Customer {h.n}</div>
                        <div className="text-[11px] text-slate-500">
                          {h.count} item{h.count === 1 ? "" : "s"} · {money(h.total)} · {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </div>
                      </button>
                      <button onClick={() => discardHeld(h)} className="border-l border-amber-100 px-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Discard Customer ${h.n}`}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="min-h-[8rem] flex-1 space-y-2.5 overflow-y-auto p-3">
              {lines.length === 0 && (
                <div className="grid h-full place-items-center py-10 text-center text-sm text-slate-400">
                  <div>
                    <FilePlus2 size={40} className="float mx-auto mb-2 opacity-40" />
                    Tap or scan an item to add it to the bill
                  </div>
                </div>
              )}

              {lines.map((l, i) => {
                const pr = numPrice(l.price);
                const row = c.per[i];
                const chips = Array.from(new Set([l.p.price, ...readLast(l.p.id)])).slice(0, 4);
                const discShown = !!discOpen[l.p.id] || l.dv !== "";
                return (
                  <div key={l.p.id} className="pop rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
                    <div className="flex items-center gap-2">
                      <ProductImage name={l.p.name} path={l.p.image_path} className="h-10 w-10 shrink-0 rounded-lg text-xs" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{l.p.name}</div>
                        <div className="text-xs text-slate-500">{l.p.stock} in stock · {l.p.stock - l.qty} left after this sale</div>
                      </div>
                      <button onClick={() => setQty(l, 0)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove"><Trash2 size={15} /></button>
                    </div>

                    <div className="mt-2.5 grid grid-cols-[auto_1fr] items-end gap-3">
                      <div>
                        <div className="label">Quantity</div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setQty(l, l.qty - 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100" aria-label="Less"><Minus size={14} /></button>
                          <input
                            value={l.qty}
                            onChange={(e) => {
                              const n = parseInt(e.target.value, 10);
                              if (!isNaN(n)) setQty(l, n);
                            }}
                            inputMode="numeric"
                            className="h-9 w-12 rounded-lg border border-slate-200 bg-white text-center text-sm font-bold outline-none focus:border-emerald-500"
                          />
                          <button onClick={() => setQty(l, l.qty + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100" aria-label="More"><Plus size={14} /></button>
                        </div>
                      </div>
                      <div>
                        <div className="label">Price per item (Rs)</div>
                        <input
                          className={`input h-9 py-0 font-bold ${l.price !== "" && !isFinite(pr) ? "border-rose-400" : ""}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          value={l.price}
                          onChange={(e) => patch(l.p.id, { price: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((ch) => (
                          <button
                            key={ch}
                            onClick={() => patch(l.p.id, { price: String(ch) })}
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold transition ${pr === ch ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}
                          >
                            {money(ch)}
                          </button>
                        ))}
                      </div>
                      <div className="text-right text-sm font-extrabold">
                        {l.qty} × {isFinite(pr) ? money(pr) : "—"} = {isFinite(pr) ? money(row.net) : "—"}
                        {row.d > 0 && <div className="text-[11px] font-medium text-slate-400 line-through">{money(row.g)}</div>}
                      </div>
                    </div>

                    <div className="mt-1.5">
                      {discShown ? (
                        <DiscountBox base={row.g} mode={l.dm} value={l.dv} onChange={(m, v) => patch(l.p.id, { dm: m, dv: v })} autoFocus={!l.dv} />
                      ) : (
                        <button onClick={() => setDiscOpen((d) => ({ ...d, [l.p.id]: true }))} className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                          <Tag size={12} /> Add discount
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 border-t border-slate-100 bg-white p-4">
              {lines.length > 0 && (
                <div className="space-y-1.5 text-sm">
                  {totalDiscount > 0 && (
                    <>
                      <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(c.gross)}</span></div>
                      <div className="flex justify-between font-semibold text-emerald-700"><span>Discount</span><span>−{money(totalDiscount)}</span></div>
                    </>
                  )}
                  {saleDiscOpen || sdv !== "" ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Discount on whole bill</span>
                      <DiscountBox base={c.subtotal} mode={sdm} value={sdv} onChange={(m, v) => { setSdm(m); setSdv(v); }} autoFocus={!sdv} />
                    </div>
                  ) : (
                    <button onClick={() => setSaleDiscOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                      <Tag size={12} /> Discount on whole bill
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-end justify-between">
                <span className="text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
                <span key={dueCents} className="bump text-3xl font-extrabold tracking-tight">{money(c.total)}</span>
              </div>

              {lines.length > 0 && <PaymentPanel state={pay} onChange={setPay} dueCents={dueCents} />}

              <button onClick={createBill} disabled={!lines.length || busy || priceBad || !ev.ok} className="btn btn-primary h-12 w-full text-base">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Printer size={18} />}
                {busy ? "Creating bill…" : `Create bill · ${money(c.total)}`}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {done && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && closeDone()}>
          <div className="pop w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <svg viewBox="0 0 52 52" className="mx-auto h-20 w-20" aria-hidden>
              <circle className="check-circle" cx="26" cy="26" r="24" fill="none" stroke="#10b981" strokeWidth="3" />
              <path className="check-path" fill="none" stroke="#10b981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" d="M14 27l8 8 16-17" />
            </svg>
            <h2 className="mt-3 text-xl font-extrabold">Bill created</h2>
            <p className="text-sm text-slate-500">Receipt #{receiptNo(done.receipt.id)} · {money(done.receipt.total)}</p>
            {(done.receipt.payments?.length ?? 0) > 1 && (
              <div className="mt-3 space-y-0.5 text-xs text-slate-500">
                {done.receipt.payments!.map((p, i) => (
                  <div key={i} className="flex justify-between"><span>{methodLabel(p.method)}</span><span>{money(p.amount)}</span></div>
                ))}
              </div>
            )}
            {done.change > 0 && (
              <div className="mt-4 rounded-2xl bg-emerald-50 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Give change</div>
                <div className="text-4xl font-extrabold text-emerald-700">{money(done.change)}</div>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={() => print(done.receipt)}><Printer size={16} /> Print again</button>
              <button className="btn btn-primary" autoFocus onClick={closeDone}>New bill</button>
            </div>
          </div>
        </div>
      )}

      {newCode && (
        <Modal title="Barcode not in stock" onClose={() => { setNewCode(null); searchRef.current?.focus(); }}>
          <p className="mb-3 text-sm text-slate-600">
            <span className="font-mono font-semibold">{newCode}</span> isn&apos;t in your catalogue yet. Add it now:
          </p>
          <ProductForm
            initialBarcode={newCode}
            onCancel={() => { setNewCode(null); setQ(""); searchRef.current?.focus(); }}
            onSaved={(p) => {
              setProducts((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)));
              setNewCode(null);
              setQ("");
              if (p.active && p.stock > 0) addProduct(p);
              else toast("Added, but it has no stock yet. Receive stock first.", "info");
              searchRef.current?.focus();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
