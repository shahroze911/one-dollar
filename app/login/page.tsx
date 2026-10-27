"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail, ScanBarcode, ShieldCheck, Printer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      setBusy(false);
      return;
    }
    router.replace("/pos");
    router.refresh();
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-slate-900 via-emerald-950 to-teal-900 p-4">
      {/* decorative blobs */}
      <div className="floaty pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-emerald-500/25 blur-3xl" />
      <div className="floaty pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" style={{ animationDelay: "-3s" }} />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl shadow-2xl md:grid-cols-2">
        {/* left: pitch */}
        <div className="hidden flex-col justify-between bg-white/5 p-9 text-white backdrop-blur md:flex">
          <div>
            <div className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-lg font-extrabold shadow-lg shadow-emerald-500/40">Rs</div>
            <h2 className="text-3xl font-extrabold leading-tight">
              Sell faster.
              <br />
              Stock smarter.
            </h2>
            <p className="mt-3 text-sm text-emerald-100/70">Scan, charge, print. Everything about your shop in one place.</p>
          </div>
          <ul className="space-y-3 text-sm text-emerald-50/90">
            {[
              [ScanBarcode, "Scan barcodes in a blink"],
              [Printer, "Thermal receipts, saved forever"],
              [ShieldCheck, "Owner-password protected records"],
            ].map(([Icon, t]: any) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><Icon size={16} /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* right: form */}
        <form onSubmit={submit} className="space-y-4 bg-white p-8 sm:p-10">
          <div>
            <h1 className="text-2xl font-extrabold">Welcome back 👋</h1>
            <p className="text-sm text-slate-500">Sign in to open the till</p>
          </div>

          <div>
            <label className="label">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-12 pl-10" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.com" />
            </div>
          </div>

          <div>
            <label className="label">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-12 pl-10 pr-10" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="pop rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div>}

          <button className="btn btn-primary h-12 w-full text-base" disabled={busy}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
