"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Boxes, LayoutDashboard, Lock, LogOut, Package, Receipt, ScanBarcode, Settings, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAdmin, useSettings } from "@/components/providers";

const nav = [
  { href: "/pos", label: "Checkout", icon: ScanBarcode, owner: false },
  { href: "/products", label: "Products", icon: Package, owner: true },
  { href: "/stock", label: "Stock", icon: Boxes, owner: true },
  { href: "/sales", label: "Sales", icon: Receipt, owner: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, owner: true },
  { href: "/settings", label: "Settings", icon: Settings, owner: true },
];
const mobileNav = nav.slice(0, 5);

export default function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { unlocked, minutesLeft, lock } = useAdmin();
  const { settings } = useSettings();

  const signOut = async () => {
    await lock();
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const lockNow = async () => {
    await lock();
    if (nav.some((n) => n.owner && path.startsWith(n.href))) router.replace("/pos");
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950 p-4 text-slate-200 lg:flex">
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
      <header className="sticky top-0 z-30 flex items-center justify-between bg-gradient-to-r from-slate-900 to-emerald-900 px-4 py-2.5 text-white lg:hidden">
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

      <main className="px-4 pb-28 pt-4 lg:ml-64 lg:px-8 lg:pb-8 lg:pt-6">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        {mobileNav.map(({ href, label, icon: Icon, owner }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${active ? "text-emerald-600" : "text-slate-500"}`}>
              {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-emerald-500" />}
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
