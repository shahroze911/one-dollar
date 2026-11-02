"use client";
import { Banknote, CreditCard, Smartphone, Split } from "lucide-react";
import { fromCents, money, toCents } from "@/lib/format";
import { METHODS, evalPay, type Method, type PayState } from "@/lib/payments";

const ICON: Record<Method, typeof Banknote> = { cash: Banknote, card: CreditCard, wallet: Smartphone };
const NOTES = [50, 100, 500, 1000, 5000];

/**
 * Payment entry shared by Checkout and Custom Bill.
 * One method, or "Split payment" to take part cash + part card/wallet.
 */
export default function PaymentPanel({
  state,
  onChange,
  dueCents,
}: {
  state: PayState;
  onChange: (s: PayState) => void;
  dueCents: number;
}) {
  const ev = evalPay(state, dueCents);
  const set = (patch: Partial<PayState>) => onChange({ ...state, ...patch });
  const setAmount = (m: Method, v: string) => onChange({ ...state, amounts: { ...state.amounts, [m]: v } });

  const quick = NOTES.filter((n) => toCents(n) >= dueCents).slice(0, 4);

  // how much is still unpaid if I fill this method in (used by the "rest" buttons)
  const restFor = (m: Method) => {
    const others = (["cash", "card", "wallet"] as Method[])
      .filter((x) => x !== m)
      .reduce((s, x) => s + toCents(Number(state.amounts[x]) || 0), 0);
    return Math.max(0, dueCents - others);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment</span>
        <button
          type="button"
          onClick={() => set({ split: !state.split })}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition ${
            state.split ? "bg-emerald-600 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <Split size={12} /> Split payment
        </button>
      </div>

      {!state.split ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(({ id, label }) => {
              const Icon = ICON[id];
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => set({ method: id })}
                  className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-sm font-semibold transition ${
                    state.method === id ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-inner" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon size={16} /> {label}
                </button>
              );
            })}
          </div>

          {state.method === "wallet" && <p className="text-xs text-slate-500">JazzCash / Easypaisa: confirm the money arrived before you charge.</p>}

          {state.method === "cash" && dueCents > 0 && (
            <div className="space-y-2">
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder={`Cash received (blank = ${money(fromCents(dueCents))})`}
                value={state.amounts.cash}
                onChange={(e) => setAmount("cash", e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAmount("cash", "")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">
                  Exact
                </button>
                {quick.map((n) => (
                  <button type="button" key={n} onClick={() => setAmount("cash", String(n))} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:border-emerald-300 hover:bg-emerald-50">
                    {money(n)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {METHODS.map(({ id, label, hint }) => {
            const Icon = ICON[id];
            return (
              <div key={id} className="flex items-center gap-2">
                <div className="flex w-24 shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-700" title={hint}>
                  <Icon size={15} /> {label}
                </div>
                <input
                  className="input h-9 py-0"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  placeholder="0"
                  value={state.amounts[id]}
                  onChange={(e) => setAmount(id, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setAmount(id, restFor(id) > 0 ? String(fromCents(restFor(id))) : "")}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                  title="Put the unpaid rest of the bill here"
                >
                  Rest
                </button>
              </div>
            );
          })}
        </div>
      )}

      {dueCents > 0 && (state.split || state.amounts.cash !== "" || ev.shortCents > 0) && (
        <div
          className={`rounded-xl px-3 py-2 text-sm font-bold ${
            ev.overCents > 0 || ev.shortCents > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {ev.overCents > 0
            ? `Card / wallet is ${money(fromCents(ev.overCents))} more than the bill`
            : ev.shortCents > 0
            ? `Still to pay: ${money(fromCents(ev.shortCents))}`
            : ev.changeCents > 0
            ? `Change due: ${money(fromCents(ev.changeCents))}`
            : "Paid in full"}
        </div>
      )}
    </div>
  );
}
