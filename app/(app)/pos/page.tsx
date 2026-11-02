"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  Landmark,
  Loader2,
  Minus,
  Pause,
  Plus,
  Printer,
  ScanBarcode,
  ShoppingCart,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchPosProducts } from "@/lib/products";
import { money, receiptNo, toCents } from "@/lib/format";
import { beep } from "@/lib/beep";
import { discountAmount, r2, type DMode } from "@/lib/discount";
import { applyPayments, emptyPay, evalPay, methodLabel, type PayState } from "@/lib/payments";
import { applyPending, enqueue, isNetworkError, loadCatalog, newId, nextTempNo, saveCatalog } from "@/lib/offline";
import { useGlobalScanner } from "@/hooks/useGlobalScanner";
import { useToast } from "@/components/toast";
import { useAdmin, useOffline, useReceipt, useSettings } from "@/components/providers";
import { UnlockForm } from "@/components/admin-gate";
import Modal from "@/components/modal";
import ProductForm from "@/components/product-form";
import ProductImage from "@/components/product-image";
import CameraScanner from "@/components/camera-scanner";
import DiscountBox from "@/components/discount-box";
import PaymentPanel from "@/components/payment-panel";
import type { CurrentShift, Product, ReceiptData } from "@/lib/types";

type Line = { p: Product; qty: number; dm: DMode; dv: string }; // dm/dv = this line's discount entry
type Done = { receipt: ReceiptData; change: number };
// A sale parked while another customer is served. Stock is NOT reserved; it is re-checked on resume.
type Held = {
  id: number;
  n: number;
  at: number;
  count: number;
  total: number;
  lines: { id: string; qty: number; dm: DMode; dv: string }[];
  sdm: DMode;
  sdv: string;
};
const GRID_LIMIT = 60;

/** Money maths for a cart: per-line gross/discount/net, whole-sale discount, total, discount %. */
function calc(lines: Line[], sdm: DMode, sdv: string) {
  let gross = 0;
  let lineDisc = 0;
  const per = lines.map((l) => {
    const g = r2(l.p.price * l.qty);
    const d = discountAmount(g, l.dm, l.dv);
    gross += g;
    lineDisc += d;
    return { g, d, net: r2(g - d) };
  });
  const subtotal = r2(gross - lineDisc);
  const saleDisc = discountAmount(subtotal, sdm, sdv);
  const total = r2(subtotal - saleDisc);
  const pct = gross > 0 ? ((lineDisc + saleDisc) / gross) * 100 : 0;
  return { per, gross: r2(gross), lineDisc: r2(lineDisc), subtotal, saleDisc, total, pct };
}

export default function PosPage() {
  const toast = useToast();
  const { unlocked } = useAdmin();
  const { print } = useReceipt();
  const { settings } = useSettings();
  const { online, markOffline, refresh: refreshQueue } = useOffline();
  const [usingSaved, setUsingSaved] = useState(false); // product list comes from this device, not the server
  const saleKey = useRef<{ id: string; sig: string } | null>(null); // same cart => same sale id (never a double sale)

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<PayState>(emptyPay());
  const [sdm, setSdm] = useState<DMode>("rs"); // whole-sale discount
  const [sdv, setSdv] = useState("");
  const [saleDiscOpen, setSaleDiscOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [approve, setApprove] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [shift, setShift] = useState<CurrentShift | null | undefined>(undefined);

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

  // is a cash-drawer shift open? (a banner nudges the cashier to open one)
  useEffect(() => {
    supabaseBrowser()
      .rpc("current_shift")
      .then(({ data, error }) => {
        if (!error) setShift((data as CurrentShift | null) ?? null);
      });
  }, []);

  // ---- load the catalogue once; everything after is instant, in memory ----
  const reload = useCallback(async () => {
    try {
      const fresh = await fetchPosProducts();
      saveCatalog(fresh); // keep a copy so Checkout still opens with no internet
      setProducts(applyPending(fresh));
      setUsingSaved(false);
    } catch (e: any) {
      const saved = loadCatalog();
      if (saved) {
        setProducts(applyPending(saved));
        setUsingSaved(true);
      } else {
        toast(e.message ?? "Could not load products", "err");
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // when saved sales finish sending (or the internet returns) pull fresh stock
  useEffect(() => {
    const h = () => reload();
    window.addEventListener("pos:synced", h);
    return () => window.removeEventListener("pos:synced", h);
  }, [reload]);
  useEffect(() => {
    if (online && usingSaved) reload();
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

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
        next = [{ p, qty, dm: "rs", dv: "" }, ...cur];
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

  const setLineDiscount = (id: string, dm: DMode, dv: string) =>
    commitCart(cartRef.current.map((l) => (l.p.id === id ? { ...l, dm, dv } : l)));

  const resetSaleExtras = () => {
    setPay(emptyPay());
    setSdv("");
    setSdm("rs");
    setSaleDiscOpen(false);
    setDiscOpen({});
  };

  const c = useMemo(() => calc(cart, sdm, sdv), [cart, sdm, sdv]);
  const dueCents = toCents(c.total);
  const ev = evalPay(pay, dueCents);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const totalDiscount = r2(c.lineDisc + c.saleDisc);
  const needsApprovalFor = (pct: number) => pct > settings.max_discount_pct + 0.0001;
  const needsApproval = needsApprovalFor(c.pct) && !unlocked;

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

  useGlobalScanner(handleCode, !newCode && !camera && !approve);

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
    const cc = calc(lines, sdm, sdv);
    const e = evalPay(pay, toCents(cc.total));
    if (!e.ok) {
      toast(e.overCents > 0 ? "Card / wallet is more than the bill" : "Payment is less than the total", "err");
      beep("err");
      return;
    }
    // one id per sale: pressing Charge twice, or retrying after a dropped connection, can never make two sales
    const items = lines.map((l, i) => ({ product_id: l.p.id, qty: l.qty, discount: cc.per[i].d }));
    const sig = JSON.stringify([items, e.payments, cc.saleDisc]);
    if (!saleKey.current || saleKey.current.sig !== sig) saleKey.current = { id: newId(), sig };
    const clientId = saleKey.current.id;

    // ---- no internet: keep the sale on this device and send it later ----
    const sellOffline = () => {
      if (needsApprovalFor(cc.pct) && !unlocked) {
        toast(`A discount above ${settings.max_discount_pct}% needs the owner password, and that needs internet. Lower the discount to continue.`, "err");
        beep("err");
        return;
      }
      const applied = applyPayments(e.payments, cc.total);
      const temp_no = nextTempNo();
      const at = new Date().toISOString();
      let email = "";
      try {
        email = localStorage.getItem("posEmail") ?? "";
      } catch {
        /* ignore */
      }
      const receipt: ReceiptData = {
        id: 0,
        temp_no,
        offline: true,
        created_at: at,
        payment_method: applied.method,
        payments: applied.payments,
        cashier: email,
        items: lines.map((l, i) => ({ name: l.p.name, qty: l.qty, unit_price: l.p.price, discount: cc.per[i].d })),
        subtotal: cc.subtotal,
        discount: cc.saleDisc,
        total: cc.total,
        cash_received: applied.cash_received,
        change_given: applied.change_given,
      };
      const saved = enqueue({
        client_id: clientId,
        at,
        temp_no,
        items: lines.map((l, i) => ({ product_id: l.p.id, name: l.p.name, qty: l.qty, price: l.p.price, discount: cc.per[i].d })),
        payments: e.payments,
        discount: cc.saleDisc,
        receipt,
      });
      if (!saved) {
        toast("This device has no space to save the sale. Free up browser storage and try again.", "err");
        beep("err");
        return;
      }
      refreshQueue();
      saleKey.current = null;
      setProducts((prev) =>
        prev.map((p) => {
          const l = lines.find((x) => x.p.id === p.id);
          return l ? { ...p, stock: Math.max(0, p.stock - l.qty) } : p;
        })
      );
      setDone({ receipt, change: Number(applied.change_given ?? 0) });
      commitCart([]);
      resetSaleExtras();
      beep("ok");
      toast(`Saved offline as ${temp_no}. It will be sent when the internet is back.`, "info");
      if (autoPrint) print(receipt);
    };

    if (!online) return sellOffline();

    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("checkout", {
      p_items: items,
      p_payments: e.payments,
      p_discount: cc.saleDisc,
      p_client_id: clientId,
    });
    setBusy(false);

    if (error) {
      if (isNetworkError(error)) {
        markOffline();
        return sellOffline(); // if the server did get it, the same id stops a double sale when it syncs
      }
      toast(error.message, "err");
      beep("err");
      reload(); // stock may have changed on another till
      return;
    }
    saleKey.current = null;

    setProducts((prev) =>
      prev.map((p) => {
        const l = lines.find((x) => x.p.id === p.id);
        return l ? { ...p, stock: p.stock - l.qty } : p;
      })
    );

    const receipt: ReceiptData = {
      id: data.sale_id,
      created_at: data.created_at,
      payment_method: data.payment_method,
      payments: data.payments,
      cashier: data.cashier,
      items: lines.map((l, i) => ({ name: l.p.name, qty: l.qty, unit_price: l.p.price, discount: cc.per[i].d })),
      subtotal: Number(data.subtotal),
      discount: Number(data.discount),
      total: Number(data.total),
      cash_received: data.cash_received == null ? null : Number(data.cash_received),
      change_given: data.change_given == null ? null : Number(data.change_given),
    };
    setDone({ receipt, change: Number(data.change_given ?? 0) });
    commitCart([]);
    resetSaleExtras();
    beep("ok");
    if (autoPrint) print(receipt);
  }, [busy, pay, sdm, sdv, toast, reload, autoPrint, print, online, markOffline, refreshQueue, unlocked, settings.max_discount_pct]);

  // Charge button: a discount above the shop's limit needs the owner password first
  const onCharge = () => {
    if (!cartRef.current.length) return;
    if (needsApproval) {
      setApprove(true);
      return;
    }
    checkout();
  };

  const closeDone = useCallback(() => {
    setDone(null);
    inputRef.current?.focus();
  }, []);

  // ---- hold / resume sales ---------------------------------------------
  // Saved in this browser, so held sales survive a refresh and closing the tab.
  const [held, setHeld] = useState<Held[]>([]);
  const heldRef = useRef<Held[]>([]);

  const saveHeld = (next: Held[]) => {
    heldRef.current = next;
    setHeld(next);
    try {
      localStorage.setItem("heldSales", JSON.stringify(next));
    } catch {
      /* storage unavailable: held sales still work until the page is closed */
    }
  };

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("heldSales") ?? "[]");
      if (Array.isArray(v)) {
        heldRef.current = v.map((h: Held) => ({ ...h, sdm: h.sdm ?? "rs", sdv: h.sdv ?? "", lines: (h.lines ?? []).map((l) => ({ ...l, dm: l.dm ?? "rs", dv: l.dv ?? "" })) }));
        setHeld(heldRef.current);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const makeHeld = (lines: Line[], list: Held[], m: DMode, v: string): Held => ({
    id: Date.now() + Math.floor(Math.random() * 1000),
    n: list.reduce((mx, h) => Math.max(mx, h.n), 0) + 1,
    at: Date.now(),
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: calc(lines, m, v).total,
    lines: lines.map((l) => ({ id: l.p.id, qty: l.qty, dm: l.dm, dv: l.dv })),
    sdm: m,
    sdv: v,
  });

  const holdCart = useCallback(() => {
    const lines = cartRef.current;
    if (!lines.length) return;
    const entry = makeHeld(lines, heldRef.current, sdm, sdv);
    saveHeld([...heldRef.current, entry]);
    commitCart([]);
    resetSaleExtras();
    setDone(null);
    toast(`Sale put on hold as Customer ${entry.n}`, "info");
    inputRef.current?.focus();
  }, [toast, sdm, sdv]);

  const resumeHeld = (h: Held) => {
    const rebuilt: Line[] = [];
    let changed = 0;
    for (const item of h.lines) {
      const p = products.find((x) => x.id === item.id);
      if (!p || p.stock <= 0) {
        changed++;
        continue;
      }
      const qty = Math.min(item.qty, p.stock);
      if (qty < item.qty) changed++;
      rebuilt.push({ p, qty, dm: item.dm, dv: item.dv });
    }
    let next = heldRef.current.filter((x) => x.id !== h.id);
    if (!rebuilt.length) {
      saveHeld(next);
      toast("Nothing from that sale is available any more", "err");
      return;
    }
    // whatever is in the cart right now goes on hold, so nothing is ever lost
    const current = cartRef.current;
    if (current.length) next = [...next, makeHeld(current, next, sdm, sdv)];
    saveHeld(next);
    commitCart(rebuilt);
    setPay(emptyPay());
    setSdm(h.sdm);
    setSdv(h.sdv);
    setSaleDiscOpen(!!h.sdv);
    setDiscOpen({});
    setDone(null);
    if (changed) toast(`${changed} item${changed === 1 ? "" : "s"} changed or ran out of stock since this sale was held`, "info");
    inputRef.current?.focus();
  };

  const discardHeld = (h: Held) => {
    if (!confirm(`Discard Customer ${h.n}'s held sale (${h.count} item${h.count === 1 ? "" : "s"})? Nothing was taken from stock, so nothing else changes.`)) return;
    saveHeld(heldRef.current.filter((x) => x.id !== h.id));
  };

  // ---- keyboard: F2 focus scan box · F4 hold · F9 / Ctrl+Enter charge · Esc / Enter closes "sale complete"
  const chargeRef = useRef(onCharge);
  chargeRef.current = onCharge;
  const holdRef = useRef(holdCart);
  holdRef.current = holdCart;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        holdRef.current();
      }
      if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        chargeRef.current();
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
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_420px]">
      {/* ------------------------- LEFT: scan + items ------------------------- */}
      <section className="min-w-0 space-y-4">
        {usingSaved && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>Using the product list saved on this device.</b> Prices and stock are as of the last time you were online.
          </div>
        )}

        {shift === null && !settings.hidden_pages.includes("/shift") && (
          <Link
            href="/shift"
            className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100"
          >
            <Landmark size={18} className="shrink-0" />
            <span>
              <b>No cash drawer shift is open,</b> so cash is not being tracked. Tap to open one.
            </span>
          </Link>
        )}

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
            <button className="btn btn-ghost h-12 px-4" onClick={() => setCamera((v) => !v)} title="Scan with camera">
              <Camera size={18} /> <span className="hidden sm:inline">Camera</span>
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <span>
              Scanner ready, just scan. <kbd className="rounded bg-slate-100 px-1">F2</kbd> focus · <kbd className="rounded bg-slate-100 px-1">F9</kbd> charge · <kbd className="rounded bg-slate-100 px-1">F4</kbd> hold
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
              <div className="flex items-center gap-3">
                <button
                  onClick={holdCart}
                  className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-white/30 active:scale-95"
                  title="Put this sale on hold and serve the next customer (F4)"
                >
                  <Pause size={13} /> Hold
                </button>
                <button onClick={() => { commitCart([]); resetSaleExtras(); }} className="text-xs font-semibold text-white/80 hover:text-white">
                  Clear
                </button>
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
                        {h.count} item{h.count === 1 ? "" : "s"} · {money(h.total)} ·{" "}
                        {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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

          <div className="min-h-[8rem] flex-1 space-y-2 overflow-y-auto p-3">
            {cart.length === 0 && (
              <div className="grid h-full place-items-center py-10 text-center text-sm text-slate-400">
                <div>
                  <ScanBarcode size={40} className="float mx-auto mb-2 opacity-40" />
                  Scan an item to begin
                </div>
              </div>
            )}

            {cart.map((l, i) => {
              const row = c.per[i];
              const open = !!discOpen[l.p.id] || l.dv !== "";
              return (
                <div key={l.p.id} className="pop rounded-xl border border-slate-100 bg-slate-50/70 p-2">
                  <div className="flex items-center gap-2">
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
                    <div className="w-16 text-right">
                      <div className="text-sm font-bold">{money(row.net)}</div>
                      {row.d > 0 && <div className="text-[11px] text-slate-400 line-through">{money(row.g)}</div>}
                    </div>
                    <button onClick={() => setQty(l.p.id, 0)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove"><Trash2 size={15} /></button>
                  </div>

                  <div className="mt-1.5 pl-1">
                    {open ? (
                      <DiscountBox
                        base={row.g}
                        mode={l.dm}
                        value={l.dv}
                        onChange={(m, v) => setLineDiscount(l.p.id, m, v)}
                        autoFocus={!l.dv}
                      />
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
            {cart.length > 0 && (
              <div className="space-y-1.5 text-sm">
                {totalDiscount > 0 && (
                  <>
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal</span>
                      <span>{money(c.gross)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-emerald-700">
                      <span>Discount ({c.pct.toFixed(c.pct % 1 === 0 ? 0 : 1)}%)</span>
                      <span>−{money(totalDiscount)}</span>
                    </div>
                  </>
                )}
                {saleDiscOpen || sdv !== "" ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-500">Discount on whole sale</span>
                    <DiscountBox base={c.subtotal} mode={sdm} value={sdv} onChange={(m, v) => { setSdm(m); setSdv(v); }} autoFocus={!sdv} />
                  </div>
                ) : (
                  <button onClick={() => setSaleDiscOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                    <Tag size={12} /> Discount on whole sale
                  </button>
                )}
                {needsApproval && (
                  <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    This discount is above your {settings.max_discount_pct}% limit. The owner password is needed to approve it.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
              <span key={dueCents} className="bump text-3xl font-extrabold tracking-tight">{money(c.total)}</span>
            </div>

            {cart.length > 0 && <PaymentPanel state={pay} onChange={setPay} dueCents={dueCents} />}

            <button
              onClick={onCharge}
              disabled={!cart.length || busy || !ev.ok}
              className="btn btn-primary h-12 w-full text-base"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              {busy ? "Processing…" : needsApproval ? `Approve & charge ${money(c.total)}` : `Charge ${money(c.total)}`}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile floating total bar */}
      {cart.length > 0 && (
        <a href="#cart" className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 font-semibold text-white shadow-xl lg:hidden">
          <span>{itemCount} item{itemCount === 1 ? "" : "s"} · View cart</span>
          <span className="text-lg font-extrabold">{money(c.total)}</span>
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
            <p className="text-sm text-slate-500">Receipt {done.receipt.temp_no ?? `#${receiptNo(done.receipt.id)}`} · {money(done.receipt.total)}</p>
            {done.receipt.offline && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Saved on this device (offline). It will be sent to your records automatically when the internet is back.
              </p>
            )}

            {done.receipt.payments && done.receipt.payments.length > 1 && (
              <div className="mt-3 space-y-0.5 text-xs text-slate-500">
                {done.receipt.payments.map((p, i) => (
                  <div key={i} className="flex justify-between"><span>{methodLabel(p.method)}</span><span>{money(p.amount)}</span></div>
                ))}
              </div>
            )}

            {done.receipt.cash_received != null && (
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

      {/* Discount above the limit → owner approval */}
      {approve && (
        <Modal title="Owner approval needed" onClose={() => setApprove(false)}>
          <p className="mb-3 text-sm text-slate-600">
            This sale has a <b>{c.pct.toFixed(1)}%</b> discount ({money(totalDiscount)}). The limit without approval is <b>{settings.max_discount_pct}%</b>. Enter the owner password to approve and charge.
          </p>
          <UnlockForm
            onDone={() => {
              setApprove(false);
              checkout();
            }}
          />
        </Modal>
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
