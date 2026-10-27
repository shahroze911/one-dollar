"use client";
import { useState, type ReactNode } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useAdmin } from "@/components/providers";

/** Password box used by the full-page lock screen and by inline "unlock to continue" prompts. */
export function UnlockForm({ onDone }: { onDone?: () => void }) {
  const { hasPassword, unlock, setPassword } = useAdmin();
  const creating = !hasPassword;
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (creating) {
      if (pw.length < 6) return setErr("Use at least 6 characters.");
      if (pw !== pw2) return setErr("The two passwords don't match.");
    }
    setBusy(true);
    const r = creating ? await setPassword(pw) : await unlock(pw);
    setBusy(false);
    if (r.ok) {
      setPw("");
      setPw2("");
      onDone?.();
      return;
    }
    if (r.error === "wrong") {
      setErr(r.left ? `Wrong password. ${r.left} ${r.left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Locked for 5 minutes.");
    } else if (r.error === "locked") {
      setErr(`Too many wrong tries. Try again in ${Math.max(1, Math.ceil((r.wait ?? 60) / 60))} min.`);
    } else if (r.error === "short") setErr("Use at least 6 characters.");
    else setErr(r.error ?? "Something went wrong.");
    setPw("");
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="relative">
        <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10 pr-10"
          type={show ? "text" : "password"}
          autoFocus
          autoComplete="off"
          placeholder={creating ? "Choose an owner password" : "Owner password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Show or hide password">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {creating && (
        <input
          className="input"
          type={show ? "text" : "password"}
          autoComplete="off"
          placeholder="Type it again"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      )}
      {err && <div className="pop rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{err}</div>}
      <button className="btn btn-primary w-full" disabled={busy || !pw}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        {creating ? "Create password & unlock" : "Unlock"}
      </button>
    </form>
  );
}

/** Wraps every owner-only page. Nothing inside renders until the owner password is entered. */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { loading, unlocked, hasPassword } = useAdmin();

  if (loading) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-20">
        <div className="skeleton h-14 w-14 rounded-2xl" />
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-11 w-full" />
      </div>
    );
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="card pop w-full max-w-sm p-7">
        <div className="mb-5 text-center">
          <div className="float mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
            <ShieldCheck size={30} />
          </div>
          <h1 className="text-xl font-extrabold">{hasPassword ? "Owner area" : "Set your owner password"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {hasPassword
              ? "Products, stock, sales and the dashboard are protected. Enter the owner password to continue."
              : "This password protects products, stock, sales records and the dashboard. Keep it to yourself."}
          </p>
        </div>
        <UnlockForm />
      </div>
    </div>
  );
}
