"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { imageUrl } from "@/lib/images";
import { loadQueue, syncQueue, type QueuedSale } from "@/lib/offline";
import type { ReceiptData, ShopSettings } from "@/lib/types";
import { ReceiptView } from "@/components/receipt";
import Modal from "@/components/modal";

/* ------------------------------- settings -------------------------------- */

const DEFAULT_SETTINGS: ShopSettings = {
  shop_name: "My Shop",
  address: "",
  phone: "",
  footer: "Thank you for shopping with us!",
  paper_width: 80,
  logo_path: null,
  whatsapp: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  website: "",
  max_discount_pct: 10,
  hidden_pages: [],
};

type SettingsCtx = { settings: ShopSettings; reload: () => Promise<void> };
const SettingsContext = createContext<SettingsCtx>({ settings: DEFAULT_SETTINGS, reload: async () => {} });
export const useSettings = () => useContext(SettingsContext);

function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SETTINGS);

  const reload = useCallback(async () => {
    const { data } = await supabaseBrowser().from("shop_settings").select("*").eq("id", 1).maybeSingle();
    if (data) {
      setSettings({
        shop_name: data.shop_name,
        address: data.address,
        phone: data.phone,
        footer: data.footer,
        paper_width: data.paper_width === 58 ? 58 : 80,
        logo_path: data.logo_path ?? null,
        whatsapp: data.whatsapp ?? "",
        instagram: data.instagram ?? "",
        facebook: data.facebook ?? "",
        tiktok: data.tiktok ?? "",
        website: data.website ?? "",
        max_discount_pct: Number(data.max_discount_pct ?? 10),
        hidden_pages: String(data.hidden_pages ?? "").split(",").map((x: string) => x.trim()).filter(Boolean),
      });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <SettingsContext.Provider value={{ settings, reload }}>{children}</SettingsContext.Provider>;
}

/* ------------------------------ owner mode ------------------------------- */

export type AdminResult = { ok: boolean; error?: string; wait?: number; left?: number };

type AdminCtx = {
  loading: boolean;
  hasPassword: boolean;
  unlocked: boolean;
  minutesLeft: number;
  unlock: (password: string) => Promise<AdminResult>;
  setPassword: (next: string, current?: string) => Promise<AdminResult>;
  lock: () => Promise<void>;
};

const AdminContext = createContext<AdminCtx>({
  loading: true,
  hasPassword: true,
  unlocked: false,
  minutesLeft: 0,
  unlock: async () => ({ ok: false }),
  setPassword: async () => ({ ok: false }),
  lock: async () => {},
});
export const useAdmin = () => useContext(AdminContext);

function AdminProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("admin_status");
    if (!error && data) {
      setHasPassword(!!data.has_password);
      setExpiresAt(data.unlocked ? Date.now() + Number(data.seconds_left) * 1000 : 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const unlock = useCallback(
    async (password: string): Promise<AdminResult> => {
      const { data, error } = await supabaseBrowser().rpc("unlock_admin", { p_password: password });
      if (error) return { ok: false, error: error.message };
      if (data?.ok) await refresh();
      return data as AdminResult;
    },
    [refresh]
  );

  const setPassword = useCallback(
    async (next: string, current?: string): Promise<AdminResult> => {
      const { data, error } = await supabaseBrowser().rpc("set_admin_password", {
        p_new: next,
        p_current: current ?? null,
      });
      if (error) return { ok: false, error: error.message };
      if (data?.ok) await refresh();
      return data as AdminResult;
    },
    [refresh]
  );

  const lock = useCallback(async () => {
    await supabaseBrowser().rpc("lock_admin");
    setExpiresAt(0);
  }, []);

  const unlocked = expiresAt > now;
  const minutesLeft = unlocked ? Math.max(1, Math.ceil((expiresAt - now) / 60000)) : 0;

  const value = useMemo(
    () => ({ loading, hasPassword, unlocked, minutesLeft, unlock, setPassword, lock }),
    [loading, hasPassword, unlocked, minutesLeft, unlock, setPassword, lock]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/* ------------------------------ offline mode ------------------------------ */

type OfflineCtx = {
  online: boolean;
  queue: QueuedSale[];
  pending: number; // waiting to sync
  failed: number; // refused by the server, need attention
  syncing: boolean;
  authProblem: boolean;
  syncNow: () => Promise<void>;
  markOffline: () => void;
  refresh: () => void;
};
const OfflineContext = createContext<OfflineCtx>({
  online: true,
  queue: [],
  pending: 0,
  failed: 0,
  syncing: false,
  authProblem: false,
  syncNow: async () => {},
  markOffline: () => {},
  refresh: () => {},
});
export const useOffline = () => useContext(OfflineContext);

function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [authProblem, setAuthProblem] = useState(false);

  const refresh = useCallback(() => setQueue(loadQueue()), []);

  // Make the app work with no internet: a small service worker keeps the app files and the checkout page.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          // visit the pages once while online so they are saved for later
          ["/pos", "/shift"].forEach((u) => fetch(u, { credentials: "same-origin" }).catch(() => {}));
        })
        .catch(() => {});
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    const r = await syncQueue();
    setSyncing(false);
    refresh();
    setAuthProblem(r.stopped === "auth");
    if (r.stopped === "network") setOnline(false);
    if (r.synced > 0) window.dispatchEvent(new CustomEvent("pos:synced", { detail: r.synced }));
  }, [syncing, refresh]);

  // is the internet really there? (the browser's own flag is true on Wi-Fi that has no internet)
  useEffect(() => {
    refresh();
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) return alive && setOnline(false);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(`/icon.svg?hb=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
        clearTimeout(t);
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    check();
    const iv = setInterval(check, 15000);
    const on = () => check();
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

  const waiting = queue.filter((q) => !q.error).length;
  const failed = queue.filter((q) => q.error).length;

  // back online with sales waiting: send them (and keep trying while any are waiting)
  useEffect(() => {
    if (!online || waiting === 0) return;
    syncNow();
    const iv = setInterval(syncNow, 30000);
    return () => clearInterval(iv);
  }, [online, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(
    () => ({ online, queue, pending: waiting, failed, syncing, authProblem, syncNow, markOffline: () => setOnline(false), refresh }),
    [online, queue, waiting, failed, syncing, authProblem, syncNow, refresh]
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/* ------------------------------- receipts -------------------------------- */

type ReceiptCtx = {
  print: (r: ReceiptData) => void;
  preview: (r: ReceiptData) => void;
};
const ReceiptContext = createContext<ReceiptCtx>({ print: () => {}, preview: () => {} });
export const useReceipt = () => useContext(ReceiptContext);

function ReceiptProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [previewData, setPreviewData] = useState<ReceiptData | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const logoPath = settings.logo_path;
  const print = useCallback(
    (r: ReceiptData) => {
      setPrintData(r);
      // let React paint the hidden print area (and the logo load), then open the print dialog
      const go = () => setTimeout(() => window.print(), 150);
      const url = imageUrl(logoPath);
      if (!url) return go();
      let fired = false;
      const once = () => {
        if (!fired) {
          fired = true;
          go();
        }
      };
      const img = new Image();
      img.onload = once;
      img.onerror = once;
      img.src = url;
      setTimeout(once, 2000);
    },
    [logoPath]
  );

  const value = useMemo(() => ({ print, preview: setPreviewData }), [print]);

  return (
    <ReceiptContext.Provider value={value}>
      {children}

      {/* Hidden on screen; the ONLY thing visible when printing (see globals.css) */}
      {mounted &&
        printData &&
        createPortal(
          <div id="receipt-root">
            <ReceiptView data={printData} settings={settings} />
          </div>,
          document.body
        )}

      {previewData && (
        <Modal title={`Receipt ${previewData.temp_no ?? "#" + String(previewData.id).padStart(6, "0")}`} onClose={() => setPreviewData(null)}>
          <div className="mb-4 flex justify-center overflow-auto rounded-2xl bg-slate-100 p-4">
            <div className="bg-white shadow-md">
              <ReceiptView data={previewData} settings={settings} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setPreviewData(null)}>
              Close
            </button>
            <button className="btn btn-primary" onClick={() => print(previewData)}>
              <Printer size={16} /> Print
            </button>
          </div>
        </Modal>
      )}
    </ReceiptContext.Provider>
  );
}

/* -------------------------------- bundle --------------------------------- */

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AdminProvider>
        <OfflineProvider>
          <ReceiptProvider>{children}</ReceiptProvider>
        </OfflineProvider>
      </AdminProvider>
    </SettingsProvider>
  );
}
