"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Lock, LogOut, Settings, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAdmin, useSettings } from "@/components/providers";
import { NAV } from "@/lib/nav";
import { loadQueue } from "@/lib/offline";
import OfflineBanner from "@/components/offline-banner";

export default function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { unlocked, minutesLeft, lock } = useAdmin();
  const { settings } = useSettings();

  // pages the owner hid in Settings (Settings itself can never be hidden)
  const nav = NAV.filter((n) => !settings.hidden_pages.includes(n.href));
  const mobileNav = nav.filter((n) => n.href !== "/settings"); // Settings lives in the top bar

  // someone opened a hidden page (old bookmark, typed address): send them to the first visible one
  useEffect(() => {
    const hidden = NAV.some((n) => settings.hidden_pages.includes(n.href) && path.startsWith(n.href));
    if (hidden) router.replace(nav[0]?.href ?? "/settings");
  }, [path, settings.hidden_pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // remember who is signed in, so receipts made offline can still show the cashier
  useEffect(() => {
    try {
      if (email) localStorage.setItem("posEmail", email);
    } catch {
      /* ignore */
    }
  }, [email]);

  const signOut = async () => {
    const waiting = loadQueue().length;
    if (waiting > 0 && !confirm(`${waiting} sale${waiting === 1 ? " is" : "s are"} still saved on this device and not sent yet. If you sign out now they stay here until someone signs in on this device with internet. Sign out anyway?`)) return;
    await lock();
    try {
      // saved pages belong to the signed-in user: forget them (the waiting sales are kept)
      if ("caches" in window) (await caches.keys()).forEach((k) => caches.delete(k));
    } catch {
      /* ignore */
    }
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const lockNow = async () => {
    await lock();
    if (NAV.some((n) => n.owner && path.startsWith(n.href))) router.replace(nav.find((n) => !n.owner)?.href ?? "/pos");
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950 p-4 text-slate-200 lg:flex">
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/30">Rs</div>
          <div className="min-w-0 leading-tight">
            <div className="truncate font-extrabold text-white">{settings.shop_name}</div>
            <div className="text-xs text-slate-400">Point of sale</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map(({ href, label, icon: Icon, owner }) => {
            const active = path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  active ? "bg-white/10 text-white shadow-inner" : "text-slate-400 hover:translate-x-0.5 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={18} className={active ? "text-emerald-400" : ""} />
                <span className="flex-1">{label}</span>
                {owner && !unlocked && <Lock size={13} className="opacity-50" />}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-white/10 pt-3">
          {unlocked ? (
            <button
              onClick={lockNow}
              className="flex w-full items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
            >
              <ShieldCheck size={16} /> Owner unlocked
              <span className="ml-auto text-xs font-medium text-emerald-200/80">{minutesLeft} min · Lock</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-slate-400">
              <Lock size={15} /> Owner area locked
            </div>
          )}
          <div className="truncate px-2 text-xs text-slate-500">{email}</div>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white">
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between bg-gradient-to-r from-slate-900 to-emerald-900 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-white lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-xs font-extrabold">Rs</div>
          <span className="truncate font-extrabold">{settings.shop_name}</span>
        </div>
        <div className="flex items-center gap-1">
          {unlocked ? (
            <button onClick={lockNow} className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-300" aria-label="Lock owner area">
              <ShieldCheck size={14} /> Lock
            </button>
          ) : (
            <span className="flex items-center gap-1 px-2 text-xs text-slate-300">
              <Lock size={13} /> Locked
            </span>
          )}
          <Link href="/settings" className={`rounded-lg p-2 ${path.startsWith("/settings") ? "bg-white/15" : "hover:bg-white/10"}`} aria-label="Settings">
            <Settings size={18} />
          </Link>
          <button onClick={signOut} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <OfflineBanner />

      <main className="px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 lg:ml-64 lg:px-8 lg:pb-8 lg:pt-6">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t pb-[env(safe-area-inset-bottom)] border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        {mobileNav.map(({ href, label, icon: Icon, owner }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} className={`relative flex min-w-[4.5rem] flex-1 shrink-0 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition ${active ? "text-emerald-600" : "text-slate-500"}`}>
              {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-emerald-500" />}
              <Icon size={20} />
              {label}
              {owner && !unlocked && <Lock size={9} className="absolute right-3 top-1.5 opacity-40" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
