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

  const print = useCallback((r: ReceiptData) => {
    setPrintData(r);
    // let React paint the hidden print area, then open the print dialog
    setTimeout(() => window.print(), 150);
  }, []);

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
        <Modal title={`Receipt #${String(previewData.id).padStart(6, "0")}`} onClose={() => setPreviewData(null)}>
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
        <ReceiptProvider>{children}</ReceiptProvider>
      </AdminProvider>
    </SettingsProvider>
  );
}
