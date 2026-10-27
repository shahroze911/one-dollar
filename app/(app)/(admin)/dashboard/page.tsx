"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, PackageCheck, Receipt, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { useCountUp } from "@/hooks/useCountUp";
import { useToast } from "@/components/toast";

type Stats = {
  today_total: number;
  yesterday_total: number;
  today_count: number;
  today_items: number;
  today_profit: number;
  week: { day: string; total: number }[];
  top_products: { name: string; qty: number; revenue: number }[];
  low_stock: { id: string; name: string; barcode: string | null; stock: number; low_stock_threshold: number }[];
  low_stock_count: number;
  out_of_stock_count: number;
  stock_cost_value: number;
  stock_retail_value: number;
};

function Stat({
  label,
  value,
  currency,
  icon: Icon,
  grad,
  note,
}: {
  label: string;
  value: number;
  currency?: boolean;
  icon: LucideIcon;
  grad: string;
  note?: React.ReactNode;
}) {
  const v = useCountUp(value);
  const shown = v === value ? value : Math.round(v);
  return (
    <div className={`slide-up rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl ${grad}`}>
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-white/20"><Icon size={18} /></div>
      <div className="truncate text-2xl font-extrabold tracking-tight">{currency ? money(shown) : shown}</div>
      <div className="text-xs font-medium text-white/80">{label}</div>
      {note && <div className="mt-1.5 text-xs font-semibold">{note}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    supabaseBrowser()
      .rpc("dashboard_stats", { p_tz: tz })
      .then(({ data, error }) => {
        if (error) toast(error.message, "err");
        else setS(data as Stats);
      });
  }, [toast]);

  if (!s) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-32" />)}
        </div>
        <div className="skeleton h-60" />
      </div>
    );
  }

  const max = Math.max(1, ...s.week.map((d) => Number(d.total)));
  const weekTotal = s.week.reduce((a, d) => a + Number(d.total), 0);
  const dow = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });

  const y = Number(s.yesterday_total);
  const t = Number(s.today_total);
  const pct = y > 0 ? Math.round(((t - y) / y) * 100) : null;
  const delta =
    pct === null ? (
      <span className="text-white/80">vs yesterday: {money(y)}</span>
    ) : (
      <span className="inline-flex items-center gap-1">
        {pct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {Math.abs(pct)}% vs yesterday
      </span>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <p className="text-sm text-slate-500">How the shop is doing right now.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales today" value={t} currency icon={Wallet} grad="from-emerald-500 to-teal-600" note={delta} />
        <Stat label="Receipts today" value={s.today_count} icon={Receipt} grad="from-sky-500 to-indigo-600" />
        <Stat label="Items sold today" value={s.today_items} icon={ShoppingBag} grad="from-violet-500 to-purple-600" />
        <Stat label="Profit today (needs cost prices)" value={Number(s.today_profit)} currency icon={TrendingUp} grad="from-amber-400 to-orange-500" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-extrabold">Last 7 days</h2>
            <span className="text-sm text-slate-500">{money(weekTotal)} total</span>
          </div>
          <div className="flex h-48 items-end gap-2">
            {s.week.map((d, i) => {
              const h = (Number(d.total) / max) * 100;
              const today = i === s.week.length - 1;
              return (
                <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="text-[11px] font-bold text-slate-600 opacity-0 transition group-hover:opacity-100">{money(d.total)}</span>
                  <div
                    className={`grow-up w-full rounded-t-xl transition-colors ${today ? "bg-gradient-to-t from-emerald-600 to-teal-400" : "bg-emerald-200 group-hover:bg-emerald-400"}`}
                    style={{ height: `${Math.max(h, Number(d.total) > 0 ? 4 : 1)}%`, animationDelay: `${i * 60}ms` }}
                  />
                  <span className={`text-xs ${today ? "font-extrabold text-emerald-700" : "text-slate-500"}`}>{dow(d.day)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-extrabold">Top sellers (7 days)</h2>
          {s.top_products.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No sales yet.</p>
          ) : (
            <ol className="space-y-3">
              {s.top_products.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 text-sm">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${i === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-slate-500">{p.qty} sold</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-extrabold">
              <AlertTriangle size={16} className="text-amber-500" /> Needs restocking
            </h2>
            <Link href="/stock" className="text-sm font-semibold text-emerald-700 hover:underline">Manage stock →</Link>
          </div>
          {s.low_stock.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Everything is well stocked 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.low_stock.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-semibold">{p.name}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${p.stock <= 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.stock <= 0 ? "Out of stock" : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(s.low_stock_count > 0 || s.out_of_stock_count > 0) && (
            <p className="mt-3 text-xs text-slate-500">{s.out_of_stock_count} out of stock · {s.low_stock_count} running low</p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-extrabold"><PackageCheck size={16} className="text-emerald-600" /> Inventory value</h2>
          <div className="space-y-3">
            <div>
              <div className="text-2xl font-extrabold">{money(s.stock_retail_value)}</div>
              <div className="text-xs text-slate-500">at selling price</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-700">{money(s.stock_cost_value)}</div>
              <div className="text-xs text-slate-500">at cost price</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
