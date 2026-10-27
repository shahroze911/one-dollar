"use client";
import { useEffect, useState } from "react";
import { KeyRound, Loader2, Printer, Save } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { useAdmin, useReceipt, useSettings } from "@/components/providers";
import { ReceiptView } from "@/components/receipt";
import type { ReceiptData, ShopSettings } from "@/lib/types";

const sampleReceipt = (): ReceiptData => ({
  id: 123,
  created_at: new Date().toISOString(),
  payment_method: "cash",
  cashier: "cashier@shop.com",
  items: [
    { name: "Mini notebook", qty: 2, unit_price: 150 },
    { name: "Gel pen (blue)", qty: 3, unit_price: 50 },
    { name: "Plastic bottle 500ml", qty: 1, unit_price: 99.5 },
  ],
  total: 549.5,
  cash_received: 600,
  change_given: 50.5,
});

export default function SettingsPage() {
  const toast = useToast();
  const { settings, reload } = useSettings();
  const { print } = useReceipt();
  const { setPassword } = useAdmin();

  const [form, setForm] = useState<ShopSettings>(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings), [settings]);

  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [nw2, setNw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("save_settings", {
      p_name: form.shop_name,
      p_address: form.address,
      p_phone: form.phone,
      p_footer: form.footer,
      p_paper: form.paper_width,
    });
    setSaving(false);
    if (error) return toast(error.message, "err");
    await reload();
    toast("Shop details saved");
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nw.length < 6) return toast("Use at least 6 characters", "err");
    if (nw !== nw2) return toast("The new passwords don't match", "err");
    setPwBusy(true);
    const r = await setPassword(nw, cur);
    setPwBusy(false);
    if (r.ok) {
      setCur("");
      setNw("");
      setNw2("");
      toast("Owner password changed");
    } else if (r.error === "wrong") toast("Current password is wrong", "err");
    else toast(r.error ?? "Could not change the password", "err");
  };

  const set = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Settings</h1>
        <p className="text-sm text-slate-500">Receipt details and your owner password.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <form onSubmit={save} className="card space-y-3 p-5">
            <h2 className="font-extrabold">Shop & receipt</h2>
            <div>
              <label className="label">Shop name (printed at the top)</label>
              <input className="input" value={form.shop_name} onChange={(e) => set("shop_name", e.target.value)} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Shop #12, Main Market, Lahore" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0300 1234567" />
            </div>
            <div>
              <label className="label">Message at the bottom</label>
              <input className="input" value={form.footer} onChange={(e) => set("footer", e.target.value)} />
            </div>
            <div>
              <label className="label">Paper roll width</label>
              <div className="grid grid-cols-2 gap-2">
                {([80, 58] as const).map((w) => (
                  <button
                    type="button"
                    key={w}
                    onClick={() => set("paper_width", w)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${form.paper_width === w ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  >
                    {w} mm {w === 80 ? "(most common)" : "(small)"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={() => print({ ...sampleReceipt() })}>
                <Printer size={16} /> Test print
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
            </div>
            <p className="text-xs text-slate-500">Test print uses the <em>saved</em> details. Save first, then print.</p>
          </form>

          <form onSubmit={changePassword} className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-extrabold"><KeyRound size={16} /> Change owner password</h2>
            <input className="input" type="password" autoComplete="off" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" type="password" autoComplete="new-password" placeholder="New password (6+ characters)" value={nw} onChange={(e) => setNw(e.target.value)} />
              <input className="input" type="password" autoComplete="new-password" placeholder="Type it again" value={nw2} onChange={(e) => setNw2(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={pwBusy || !cur || !nw}>
                {pwBusy ? "Changing…" : "Change password"}
              </button>
            </div>
            <p className="text-xs text-slate-500">Changing it signs out owner mode on every other device.</p>
          </form>
        </div>

        {/* live receipt preview */}
        <div className="card h-fit p-4 lg:sticky lg:top-6">
          <div className="mb-2 text-sm font-extrabold">Live preview</div>
          <div className="overflow-auto rounded-xl bg-slate-100 p-3">
            <div className="mx-auto w-fit bg-white shadow-md">
              <ReceiptView data={sampleReceipt()} settings={form} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
