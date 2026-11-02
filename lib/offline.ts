import { supabaseBrowser } from "./supabase/client";
import type { Product, ReceiptData } from "./types";

/**
 * Offline selling. Sales made while the internet is down are kept on this device and
 * sent to the database later. Each sale carries a unique id (client_id), so sending
 * it twice can never create two sales.
 */

export type QueuedSale = {
  client_id: string;
  at: string; // when the sale really happened
  temp_no: string; // number printed on the offline receipt
  items: { product_id: string; name: string; qty: number; price: number; discount: number }[];
  payments: { method: string; amount: number }[]; // amounts TENDERED, as checkout() expects
  discount: number;
  receipt: ReceiptData;
  error?: string; // set when the server refused it (needs the owner's attention)
};

const QUEUE_KEY = "offlineQueue";
const CATALOG_KEY = "posCatalog";
const SEQ_KEY = "offlineSeq";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadQueue = (): QueuedSale[] => read<QueuedSale[]>(QUEUE_KEY, []);
export const saveQueue = (q: QueuedSale[]) => write(QUEUE_KEY, q);

/** Returns false if the device could not store it (then the sale must NOT be treated as saved). */
export function enqueue(sale: QueuedSale): boolean {
  return saveQueue([...loadQueue(), sale]);
}

export function nextTempNo(): string {
  const n = read<number>(SEQ_KEY, 0) + 1;
  write(SEQ_KEY, n);
  return `OFF-${String(n).padStart(3, "0")}`;
}

export function newId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && "randomUUID" in c) return c.randomUUID();
  const b = new Uint8Array(16);
  (c ?? ({ getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) } as any)).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---- product list kept on the device (the server's numbers, before pending sales) ---- */
export const saveCatalog = (p: Product[]) => write(CATALOG_KEY, p);
export const loadCatalog = (): Product[] | null => {
  const v = read<Product[] | null>(CATALOG_KEY, null);
  return Array.isArray(v) && v.length ? v : null;
};

/** Takes sales that are waiting to sync off the stock, since the server has not seen them yet. */
export function applyPending(products: Product[]): Product[] {
  const taken = new Map<string, number>();
  for (const s of loadQueue()) {
    if (s.error) continue;
    for (const i of s.items) taken.set(i.product_id, (taken.get(i.product_id) ?? 0) + i.qty);
  }
  if (!taken.size) return products;
  return products.map((p) => (taken.has(p.id) ? { ...p, stock: Math.max(0, p.stock - (taken.get(p.id) ?? 0)) } : p));
}

/** True for "could not reach the server" (as opposed to the server saying no). */
export function isNetworkError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; status?: number } | null;
  if (!e) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = (e.message ?? "").toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|err_internet|err_network/.test(m) || e.status === 0;
}

const isAuthError = (msg: string) => /jwt|not authenticated|invalid.*token|refresh token/i.test(msg);

let running = false;

/** Sends waiting sales to the database, oldest first. Safe to call any time, any number of times. */
export async function syncQueue(): Promise<{ synced: number; failed: number; stopped: "network" | "auth" | null }> {
  if (running) return { synced: 0, failed: 0, stopped: null };
  running = true;
  let synced = 0;
  let failed = 0;
  let stopped: "network" | "auth" | null = null;
  try {
    const sb = supabaseBrowser();
    for (const sale of loadQueue()) {
      if (sale.error) continue;
      const { error } = await sb.rpc("checkout", {
        p_items: sale.items.map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.price, discount: i.discount })),
        p_payments: sale.payments,
        p_discount: sale.discount,
        p_client_id: sale.client_id,
        p_at: sale.at,
        p_offline: true,
      });
      if (error) {
        if (isNetworkError(error)) {
          stopped = "network";
          break;
        }
        if (isAuthError(error.message)) {
          stopped = "auth";
          break;
        }
        // the server refused it for a real reason: keep it, show it, don't retry forever
        saveQueue(loadQueue().map((q) => (q.client_id === sale.client_id ? { ...q, error: error.message } : q)));
        failed++;
        continue;
      }
      saveQueue(loadQueue().filter((q) => q.client_id !== sale.client_id));
      synced++;
    }
  } finally {
    running = false;
  }
  return { synced, failed, stopped };
}

export const retryFailed = () => saveQueue(loadQueue().map(({ error, ...rest }) => rest as QueuedSale));
export const removeQueued = (id: string) => saveQueue(loadQueue().filter((q) => q.client_id !== id));
