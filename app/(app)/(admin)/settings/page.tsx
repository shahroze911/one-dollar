"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ImagePlus, KeyRound, Loader2, Printer, Save, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { useAdmin, useReceipt, useSettings } from "@/components/providers";
import { ReceiptView } from "@/components/receipt";
import { NAV } from "@/lib/nav";
import { imageUrl, removeProductImage, uploadLogo } from "@/lib/images";
import type { ReceiptData, ShopSettings } from "@/lib/types";

const sampleReceipt = (): ReceiptData => ({
  id: 123,
  created_at: new Date().toISOString(),
  payment_method: "cash",
  cashier: "cashier@shop.com",
  items: [
    { name: "Mini notebook", qty: 2, unit_price: 150, discount: 20 },
    { name: "Gel pen (blue)", qty: 3, unit_price: 50 },
    { name: "Plastic bottle 500ml", qty: 1, unit_price: 99.5 },
  ],
  subtotal: 549.5,
  discount: 0,
  total: 529.5,
  payments: [{ method: "cash", amount: 600 }],
  cash_received: 600,
  change_given: 70.5,
});

export default function SettingsPage() {
  const toast = useToast();
  const { settings, reload } = useSettings();
  const { print } = useReceipt();
  const { setPassword } = useAdmin();

  const [form, setForm] = useState<ShopSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setForm(settings), [settings]);

  const pickLogo = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("Choose an image file", "err");
    setLogoBusy(true);
    try {
      const path = await uploadLogo(f);
      setForm((x) => ({ ...x, logo_path: path }));
      toast("Logo ready. Press Save to use it.");
    } catch (e: any) {
      toast(e.message ?? "Could not upload the logo", "err");
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // which sidebar pages are hidden (saved on its own button)
  const [hidden, setHidden] = useState<string[]>(settings.hidden_pages);
  const [menuBusy, setMenuBusy] = useState(false);
  useEffect(() => setHidden(settings.hidden_pages), [settings.hidden_pages]);
  const menuChanged = [...hidden].sort().join() !== [...settings.hidden_pages].sort().join();
  const toggleHidden = (href: string) => setHidden((h) => (h.includes(href) ? h.filter((x) => x !== href) : [...h, href]));
  const saveMenu = async () => {
    setMenuBusy(true);
    const { error } = await supabaseBrowser().rpc("save_hidden_pages", { p_hidden: hidden.join(",") });
    setMenuBusy(false);
    if (error) return toast(error.message, "err");
    await reload();
    toast("Menu saved");
  };

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
      p_logo: form.logo_path || null,
      p_whatsapp: form.whatsapp,
      p_instagram: form.instagram,
      p_facebook: form.facebook,
      p_tiktok: form.tiktok,
      p_website: form.website,
      p_max_discount: Number(form.max_discount_pct) || 0,
    });
    setSaving(false);
    if (error) return toast(error.message, "err");
    if (settings.logo_path && settings.logo_path !== form.logo_path) removeProductImage(settings.logo_path); // tidy up the old logo
    await reload();
    toast("Settings saved");
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
        <p className="text-sm text-slate-500">Receipt look, social links, discount limit and your owner password.</p>
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
              <label className="label">Logo (printed at the top of the receipt)</label>
              <div className="flex items-center gap-3">
                <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
                  {form.logo_path ? <img src={imageUrl(form.logo_path) ?? ""} alt="Logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus size={22} className="text-slate-400" />}
                </div>
                <div className="space-y-1.5">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
                      {logoBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {form.logo_path ? "Change logo" : "Upload logo"}
                    </button>
                    {form.logo_path && (
                      <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs text-rose-600" onClick={() => set("logo_path", null)}>
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">It is turned into black &amp; white automatically so it prints sharply on thermal paper. Simple, dark logos work best.</p>
                </div>
              </div>
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

            <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
              <div>
                <div className="text-sm font-bold">Social links <span className="font-normal text-slate-500">(all optional)</span></div>
                <p className="text-xs text-slate-500">Whatever you fill in is printed under the receipt. Leave a box empty to skip it.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="WhatsApp: 0300 1234567" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
                <input className="input" placeholder="Instagram: @myshop" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
                <input className="input" placeholder="Facebook: /myshop" value={form.facebook} onChange={(e) => set("facebook", e.target.value)} />
                <input className="input" placeholder="TikTok: @myshop" value={form.tiktok} onChange={(e) => set("tiktok", e.target.value)} />
                <input className="input sm:col-span-2" placeholder="Website: www.myshop.pk" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Biggest discount a cashier can give on their own (%)</label>
              <input className="input" type="number" min="0" max="100" step="1" value={form.max_discount_pct} onChange={(e) => set("max_discount_pct", Number(e.target.value))} />
              <p className="mt-1 text-xs text-slate-500">Anything above this needs the owner password at the till. Set 0 so every discount needs approval.</p>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={() => print({ ...sampleReceipt() })}>
                <Printer size={16} /> Test print
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
            </div>
            <p className="text-xs text-slate-500">Test print uses the <em>saved</em> details. Save first, then print. The preview on the right updates as you type.</p>
          </form>

          <div className="card space-y-3 p-5">
            <div>
              <h2 className="font-extrabold">Menu: choose what to show</h2>
              <p className="text-xs text-slate-500">Hide the pages you don&apos;t use. This tidies the menu for every device; it is not a security lock (the owner password is what protects Products, Stock, Sales and the Dashboard). Settings always stays visible.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {NAV.map(({ href, label, icon: Icon, hideable }) => {
                const shown = !hidden.includes(href);
                return (
                  <button
                    type="button"
                    key={href}
                    disabled={!hideable}
                    onClick={() => toggleHidden(href)}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition disabled:cursor-not-allowed ${
                      shown ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={17} />
                    <span className="flex-1">{label}</span>
                    {!hideable ? <span className="text-[10px] font-bold uppercase text-slate-400">always</span> : shown ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn btn-primary" disabled={!menuChanged || menuBusy} onClick={saveMenu}>
                {menuBusy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save menu
              </button>
            </div>
          </div>

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
