"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { money } from "@/lib/format";
import { downloadFile, slug, toCsv, XLSX_TYPE } from "@/lib/csv";
import { reportWorkbook } from "@/lib/reports-xlsx";
import { addDays, fetchRange, inputDate, itemsRows, parseInputDate, refundsRows, salesRows, shiftsRows, startOfDay, summarize, summaryRows, type RangeData } from "@/lib/reports";
import { useToast } from "@/components/toast";
import { useSettings } from "@/components/providers";

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "custom";
const PRESETS: [Preset, string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["custom", "Pick dates"],
];

/** [first day, last day] inclusive, in local time */
function presetDays(p: Preset): [Date, Date] {
  const t = startOfDay(new Date());
  switch (p) {
    case "yesterday": return [addDays(t, -1), addDays(t, -1)];
    case "7d": return [addDays(t, -6), t];
    case "30d": return [addDays(t, -29), t];
    case "month": return [new Date(t.getFullYear(), t.getMonth(), 1), t];
    case "lastmonth": return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
    default: return [t, t];
  }
}

export default function ReportsPage() {
  const toast = useToast();
  const { settings } = useSettings();
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState(() => inputDate(presetDays("7d")[0]));
  const [to, setTo] = useState(() => inputDate(presetDays("7d")[1]));
  const [data, setData] = useState<RangeData | null>(null);
  const [loading, setLoading] = useState(true);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      const [a, b] = presetDays(p);
      setFrom(inputDate(a));
      setTo(inputDate(b));
    }
  };

  const load = useCallback(async () => {
    const a = parseInputDate(from);
    const b = parseInputDate(to);
    if (b < a) {
      toast("The end date is before the start date", "err");
      return;
    }
    setLoading(true);
    try {
      setData(await fetchRange(a.toISOString(), addDays(b, 1).toISOString()));
    } catch (e: any) {
      toast(e.message ?? "Could not load the report", "err");
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const label = from === to ? from : `${from} to ${to}`;
  const s = useMemo(() => (data ? summarize(data) : null), [data]);
  const file = (kind: string) => `${slug(settings.shop_name)}-${kind}-${from}${from === to ? "" : `_to_${to}`}.csv`;

  const downloadExcel = () => {
    if (!data || !s) return;
    const name = `${slug(settings.shop_name)}-report-${from}${from === to ? "" : `_to_${to}`}.xlsx`;
    downloadFile(name, reportWorkbook(data, s, settings.shop_name, label), XLSX_TYPE);
    toast(`${name} downloaded`);
  };

  const dl = (kind: string, rows: ReturnType<typeof salesRows>) => {
    downloadFile(file(kind), toCsv(rows));
    toast(`${file(kind)} downloaded`);
  };

  const printReport = () => {
    const root = document.documentElement;
    root.classList.add("print-report");
    const done = () => {
      root.classList.remove("print-report");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 100);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/25">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">Reports</h1>
            <p className="text-sm text-slate-500">{settings.shop_name} · {label}</p>
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={printReport} disabled={!s}>
            <Printer size={16} /> Print / save as PDF
          </button>
        </div>
      </div>

      <div className="no-print card space-y-3 p-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => pick(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${preset === k ? "bg-emerald-600 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {l}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div>
              <label className="label">From</label>
              <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {data?.truncated && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          This period has a very large number of rows, so only the first part is included. Pick a shorter period for exact totals.
        </div>
      )}

      {loading || !s || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24" />)}
        </div>
      ) : (
        <div id="report" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              ["Sales", String(s.count), "from-sky-500 to-indigo-500", `${s.items} items · avg ${money(s.avgSale)}`],
              ["Net sales", money(s.total), "from-emerald-500 to-teal-600", s.discounts > 0 ? `${money(s.discounts)} discounts given` : ""],
              ["Refunds", s.refunded > 0 ? `− ${money(s.refunded)}` : money(0), "from-rose-500 to-orange-500", ""],
              ["After refunds", money(s.net), "from-violet-500 to-fuchsia-500", ""],
            ] as const).map(([l, v, g, n]) => (
              <div key={l} className={`rounded-2xl bg-gradient-to-br p-4 text-white shadow-md ${g}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-white/80">{l}</div>
                <div className="mt-1 truncate text-xl font-extrabold sm:text-2xl">{v}</div>
                {n && <div className="mt-0.5 text-xs text-white/80">{n}</div>}
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profit before refunds</div>
              <div className="mt-1 text-xl font-extrabold">{money(s.profit)}</div>
              <div className="text-xs text-slate-500">{s.costKnown ? `Cost of goods ${money(s.cost)}` : "Some items have no cost price, so this is overstated"}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Voided sales</div>
              <div className="mt-1 text-xl font-extrabold">{s.voided}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offline / to check</div>
              <div className="mt-1 text-xl font-extrabold">{s.offline} / {s.review}</div>
              <div className="text-xs text-slate-500">Sold offline / flagged on the Sales page</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="Paid by" head={["Method", "Sales", "Refunds"]} right={[1, 2]}
              rows={s.byMethod.map((m) => [m.method[0].toUpperCase() + m.method.slice(1), money(m.sales), m.refunds ? `− ${money(m.refunds)}` : "—"])} />
            <Table title="Cashiers" head={["Cashier", "Receipts", "Total"]} right={[1, 2]}
              rows={s.cashiers.map((c) => [c.cashier.split("@")[0], String(c.count), money(c.total)])} empty="No sales" />
          </div>

          {s.days.length > 1 && <DayChart days={s.days} />}

          <Table title="Day by day" head={["Date", "Receipts", "Total", "Discounts", "Refunds", "After refunds"]} right={[1, 2, 3, 4, 5]}
            rows={s.days.map((d) => [d.day, String(d.count), money(d.total), money(d.discount), d.refunds ? `− ${money(d.refunds)}` : "—", money(d.total - d.refunds)])} empty="No sales in this period" />

          <Table title={`Best sellers${s.products.length > 10 ? " (top 10; the download has all)" : ""}`} head={["Product", "Sold", "Revenue", "Profit"]} right={[1, 2, 3]}
            rows={s.products.slice(0, 10).map((p) => [p.name, String(p.qty), money(p.revenue), money(p.profit)])} empty="No sales in this period" />

          {s.reasons.length > 0 && (
            <Table title="Refund reasons" head={["Reason", "Refunds", "Amount"]} right={[1, 2]}
              rows={s.reasons.map((r) => [r.reason, String(r.count), money(r.amount)])} />
          )}

          <div className="no-print card p-4">
            <div className="mb-3 flex items-center gap-2 font-extrabold"><Download size={16} /> Download</div>
            <button
              onClick={downloadExcel}
              className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-3.5 text-left text-white shadow-md shadow-emerald-600/25 transition hover:shadow-lg active:scale-[.99]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20"><FileSpreadsheet size={22} /></span>
              <span className="min-w-0">
                <span className="block text-base font-extrabold">Download Excel report</span>
                <span className="block text-xs text-white/85">One file with 7 coloured sheets: Summary, Day by day, Best sellers, Sales, Sold items, Refunds, Cash drawer. Filters and totals included.</span>
              </span>
            </button>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Or plain CSV files (for other software)</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <DlBtn label="Summary report" note="Totals, payments, days, products" onClick={() => dl("summary", summaryRows(s, settings.shop_name, label))} />
              <DlBtn label="All sales" note={`${data.sales.length} receipts, one per row`} onClick={() => dl("sales", salesRows(data.sales))} />
              <DlBtn label="Sold items" note="One row per item sold, with profit" onClick={() => dl("items", itemsRows(data.sales, true))} />
              <DlBtn label="Refunds" note={`${data.refunds.length} refunds`} onClick={() => dl("refunds", refundsRows(data.refunds))} />
              <DlBtn label="Cash drawer shifts" note={`${data.shifts.length} shifts`} onClick={() => dl("shifts", shiftsRows(data.shifts))} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DlBtn({ label, note, onClick }: { label: string; note: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 hover:bg-emerald-50 active:scale-[.98]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><FileSpreadsheet size={17} /></span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block truncate text-xs text-slate-500">{note}</span>
      </span>
    </button>
  );
}

function Table({ title, head, rows, right = [], empty = "Nothing to show" }: { title: string; head: string[]; rows: string[][]; right?: number[]; empty?: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3 font-extrabold">{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>{head.map((h, i) => <th key={h} className={`whitespace-nowrap px-4 py-2 font-semibold ${right.includes(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, i) => <td key={i} className={`px-4 py-2 ${right.includes(i) ? "whitespace-nowrap text-right tabular-nums" : ""}`}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Bars for sales per day; hover or tap a bar for the figures. */
function DayChart({ days }: { days: { day: string; count: number; total: number; refunds: number }[] }) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.total));
  const shown = days.slice(-31);
  const e = hot !== null ? shown[hot] : null;
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-extrabold">Sales per day</h2>
        <span className="text-sm text-slate-500">
          {e ? `${e.day}: ${money(e.total)} · ${e.count} receipt${e.count === 1 ? "" : "s"}${e.refunds ? ` · ${money(e.refunds)} refunded` : ""}` : "Tap a bar for details"}
        </span>
      </div>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5" onMouseLeave={() => setHot(null)}>
        {shown.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onMouseEnter={() => setHot(i)}
            onClick={() => setHot(i)}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end"
            aria-label={`${d.day} ${money(d.total)}`}
          >
            <div
              className={`grow-up w-full rounded-t-md transition-colors ${hot === i ? "bg-emerald-600" : "bg-emerald-300 group-hover:bg-emerald-500"}`}
              style={{ height: `${Math.max((d.total / max) * 100, d.total > 0 ? 3 : 1)}%`, animationDelay: `${i * 25}ms` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        <span>{shown[0].day}</span>
        <span>{shown[shown.length - 1].day}</span>
      </div>
    </div>
  );
}
