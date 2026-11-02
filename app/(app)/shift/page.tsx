"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Landmark, Loader2, Lock, LockOpen } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, money } from "@/lib/format";
import { useToast } from "@/components/toast";
import { useAdmin } from "@/components/providers";
import { UnlockForm } from "@/components/admin-gate";
import type { CurrentShift, ShiftRow } from "@/lib/types";

type Closed = { expected: number; counted: number; difference: number };

export default function ShiftPage() {
  const toast = useToast();
  const { unlocked } = useAdmin();
  const [shift, setShift] = useState<CurrentShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<ShiftRow[]>([]);
  const [closed, setClosed] = useState<Closed | null>(null);

  // open
  const [float, setFloat] = useState("");
  // cash in / out
  const [kind, setKind] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // close
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [needNote, setNeedNote] = useState<null | { expected: number; difference: number }>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data, error } = await sb.rpc("current_shift");
    if (error) toast(error.message, "err");
    setShift((data as CurrentShift | null) ?? null);
    setLoading(false);
  }, [toast]);

  const loadHistory = useCallback(async () => {
    const { data } = await supabaseBrowser().from("shifts").select("*").order("opened_at", { ascending: false }).limit(20);
    setHistory((data ?? []) as ShiftRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load, unlocked]); // reload when owner mode changes (owner also sees the expected cash)

  useEffect(() => {
    if (unlocked) loadHistory();
    else setHistory([]);
  }, [unlocked, loadHistory, closed]);

  const run = async (fn: () => PromiseLike<{ data: any; error: any }>, ok: (d: any) => void) => {
    setBusy(true);
    const { data, error } = await fn();
    setBusy(false);
    if (error) return toast(error.message, "err");
    ok(data);
  };

  const openShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (float.trim() === "" || Number(float) < 0) return toast("Enter the cash you are starting with (0 if none)", "err");
    run(() => supabaseBrowser().rpc("open_shift", { p_float: Number(float) }), async () => {
      setFloat("");
      setClosed(null);
      toast("Shift opened");
      await load();
    });
  };

  const addMove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(Number(amount) > 0)) return toast("Enter an amount", "err");
    if (!reason.trim()) return toast("Write a reason", "err");
    run(() => supabaseBrowser().rpc("add_cash_movement", { p_kind: kind, p_amount: Number(amount), p_reason: reason }), async () => {
      setAmount("");
      setReason("");
      toast(kind === "in" ? "Cash added to the drawer" : "Cash taken out of the drawer");
      await load();
    });
  };

  const closeShift = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (counted.trim() === "" || Number(counted) < 0) return toast("Count the drawer and enter the total", "err");
    run(() => supabaseBrowser().rpc("close_shift", { p_counted: Number(counted), p_note: note.trim() || null }), async (d) => {
      if (d?.need_note) {
        setNeedNote({ expected: Number(d.expected), difference: Number(d.difference) });
        return;
      }
      setClosed({ expected: Number(d.expected), counted: Number(d.counted), difference: Number(d.difference) });
      setNeedNote(null);
      setCounted("");
      setNote("");
      await load();
    });
  };

  if (loading) return <div className="mx-auto max-w-3xl"><div className="skeleton h-64" /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/25">
          <Landmark size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Cash drawer</h1>
          <p className="text-sm text-slate-500">Open your shift, record cash in/out, count the drawer at the end.</p>
        </div>
      </div>

      {closed && !shift && (
        <div className="pop card p-6 text-center">
          <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
          <h2 className="mt-2 text-xl font-extrabold">Shift closed</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Expected</div><div className="font-extrabold">{money(closed.expected)}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Counted</div><div className="font-extrabold">{money(closed.counted)}</div></div>
            <div className={`rounded-xl p-3 ${closed.difference === 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              <div className="text-xs">{closed.difference === 0 ? "Difference" : closed.difference > 0 ? "Over" : "Short"}</div>
              <div className="font-extrabold">{closed.difference === 0 ? "Balanced ✓" : money(Math.abs(closed.difference))}</div>
            </div>
          </div>
        </div>
      )}

      {!shift ? (
        <form onSubmit={openShift} className="card space-y-3 p-5">
          <h2 className="font-extrabold">Start a shift</h2>
          <p className="text-sm text-slate-500">Count the cash already in the drawer (your opening float) and type it in. Sales can be made without a shift, but they will not be counted in the drawer.</p>
          <div>
            <label className="label">Opening float (Rs)</label>
            <input className="input" type="number" min="0" step="1" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="e.g. 5000" autoFocus />
          </div>
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LockOpen size={16} />} Open shift
          </button>
        </form>
      ) : (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Shift open</div>
                <div className="text-sm text-slate-500">Since {fmtDateTime(shift.opened_at)}{shift.opened_by ? ` · ${shift.opened_by.split("@")[0]}` : ""}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">{shift.sales_count} sale{shift.sales_count === 1 ? "" : "s"}</div>
                <div className="text-xl font-extrabold">{money(shift.sales_total)}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label="Opening float" value={money(shift.opening_float)} />
              {unlocked && shift.expected_cash !== undefined ? (
                <>
                  <Stat label="Cash sales" value={money(shift.cash_sales)} />
                  <Stat label="Cash refunds" value={`− ${money(shift.cash_refunds)}`} />
                  <Stat label="Cash in" value={money(shift.cash_in)} />
                  <Stat label="Cash out" value={`− ${money(shift.cash_out)}`} />
                  <Stat label="Should be in drawer" value={money(shift.expected_cash)} strong />
                </>
              ) : (
                <div className="col-span-full rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  The expected total stays hidden so the count is honest. The owner can unlock it below.
                </div>
              )}
            </div>
          </div>

          <form onSubmit={addMove} className="card space-y-3 p-5">
            <h2 className="font-extrabold">Cash in / out</h2>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["out", "Take out", ArrowUpCircle],
                ["in", "Put in", ArrowDownCircle],
              ] as const).map(([k, label, Icon]) => (
                <button type="button" key={k} onClick={() => setKind(k)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${kind === k ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <input className="input" type="number" min="0" step="1" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="input" placeholder={kind === "out" ? "Reason (tea, supplier, bank deposit…)" : "Reason (extra change, owner top-up…)"} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button className="btn btn-primary w-full" disabled={busy}>Save</button>

            {shift.movements.length > 0 && (
              <ul className="divide-y divide-slate-100 pt-1 text-sm">
                {shift.movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{m.reason}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(m.at)}{m.by ? ` · ${m.by.split("@")[0]}` : ""}</div>
                    </div>
                    <div className={`font-extrabold ${m.kind === "in" ? "text-emerald-600" : "text-rose-600"}`}>{m.kind === "in" ? "+" : "−"} {money(m.amount)}</div>
                  </li>
                ))}
              </ul>
            )}
          </form>

          <form onSubmit={closeShift} className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-extrabold"><Lock size={16} /> Close shift</h2>
            <p className="text-sm text-slate-500">Count every note and coin in the drawer and type the total. The system compares it with what it expects.</p>
            <input className="input" type="number" min="0" step="1" inputMode="decimal" placeholder="Cash counted (Rs)" value={counted} onChange={(e) => { setCounted(e.target.value); setNeedNote(null); }} />

            {needNote && (
              <div className="pop space-y-2 rounded-xl bg-rose-50 p-3">
                <div className="text-sm font-bold text-rose-700">
                  {needNote.difference < 0 ? "Short" : "Over"} by {money(Math.abs(needNote.difference))} (expected {money(needNote.expected)})
                </div>
                <input className="input" placeholder="Why is it different? (required)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </div>
            )}

            <button className="btn btn-primary w-full" disabled={busy || (!!needNote && !note.trim())}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} {needNote ? "Close with this note" : "Close shift"}
            </button>
          </form>
        </>
      )}

      {/* owner only */}
      {!unlocked ? (
        <div className="card p-5">
          {showUnlock ? (
            <UnlockForm onDone={() => setShowUnlock(false)} />
          ) : (
            <button className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800" onClick={() => setShowUnlock(true)}>
              <Lock size={14} /> Owner: unlock to see expected cash and past shifts
            </button>
          )}
        </div>
      ) : (
        history.length > 0 && (
          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3 font-extrabold">Past shifts</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Opened</th>
                    <th className="px-4 py-2">Expected</th>
                    <th className="px-4 py-2">Counted</th>
                    <th className="px-4 py-2">Difference</th>
                    <th className="px-4 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-2">{fmtDateTime(h.opened_at)}<div className="text-xs text-slate-500">{h.opened_by_email?.split("@")[0]}</div></td>
                      <td className="px-4 py-2">{h.closed_at ? money(h.expected_cash) : <span className="text-emerald-600">open</span>}</td>
                      <td className="px-4 py-2">{h.closed_at ? money(h.counted_cash) : "—"}</td>
                      <td className={`px-4 py-2 font-bold ${!h.closed_at ? "" : Number(h.difference) === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {!h.closed_at ? "—" : Number(h.difference) === 0 ? "Balanced" : `${Number(h.difference) > 0 ? "+" : "−"} ${money(Math.abs(Number(h.difference)))}`}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{h.close_note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${strong ? "bg-emerald-50 text-emerald-800" : "bg-slate-50"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-extrabold">{value}</div>
    </div>
  );
}
