import { fromCents, toCents } from "./format";

export type Method = "cash" | "card" | "wallet";

export const METHODS: { id: Method; label: string; hint?: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "wallet", label: "Wallet", hint: "JazzCash / Easypaisa" },
];

export const methodLabel = (m: string) =>
  m === "cash" ? "Cash" : m === "card" ? "Card" : m === "wallet" ? "Wallet" : m === "split" ? "Split" : m;

/** What the cashier has typed on the payment panel. */
export type PayState = {
  split: boolean;
  method: Method; // single-payment mode
  amounts: Record<Method, string>; // amounts typed (cash = cash handed over)
};

export const emptyPay = (): PayState => ({
  split: false,
  method: "cash",
  amounts: { cash: "", card: "", wallet: "" },
});

export type PayEval = {
  ok: boolean;
  shortCents: number; // still to be paid
  changeCents: number; // to give back (always from cash)
  overCents: number; // card/wallet typed above the bill
  payments: { method: Method; amount: number }[]; // amounts TENDERED, rupees (what checkout() expects)
};

/** Works out whether the typed payment covers the bill, and the change. */
export function evalPay(p: PayState, dueCents: number): PayEval {
  const c = (m: Method) => toCents(Number(p.amounts[m]) || 0);

  if (!p.split) {
    if (dueCents <= 0) return { ok: true, shortCents: 0, changeCents: 0, overCents: 0, payments: [] };
    if (p.method === "cash") {
      const tendered = p.amounts.cash === "" ? dueCents : c("cash");
      return {
        ok: tendered >= dueCents,
        shortCents: Math.max(0, dueCents - tendered),
        changeCents: Math.max(0, tendered - dueCents),
        overCents: 0,
        payments: [{ method: "cash", amount: fromCents(tendered) }],
      };
    }
    return { ok: true, shortCents: 0, changeCents: 0, overCents: 0, payments: [{ method: p.method, amount: fromCents(dueCents) }] };
  }

  const cash = c("cash");
  const card = c("card");
  const wallet = c("wallet");
  const noncash = card + wallet;
  const over = Math.max(0, noncash - dueCents);
  const tendered = cash + noncash;
  const short = Math.max(0, dueCents - tendered);
  const change = over > 0 ? 0 : Math.max(0, tendered - dueCents);

  const payments: PayEval["payments"] = [];
  if (cash > 0) payments.push({ method: "cash", amount: fromCents(cash) });
  if (card > 0) payments.push({ method: "card", amount: fromCents(card) });
  if (wallet > 0) payments.push({ method: "wallet", amount: fromCents(wallet) });

  return {
    ok: over === 0 && short === 0 && (dueCents === 0 || tendered > 0),
    shortCents: short,
    changeCents: change,
    overCents: over,
    payments,
  };
}

/**
 * Same arithmetic as checkout() on the server, for sales made while offline:
 * what part of the bill each method paid, the cash handed over, and the change.
 */
export function applyPayments(tendered: { method: string; amount: number }[], totalRs: number) {
  const sum = (m: string) => tendered.filter((p) => p.method === m).reduce((s, p) => s + toCents(Number(p.amount) || 0), 0);
  const total = toCents(totalRs);
  const cash = sum("cash");
  const card = sum("card");
  const wallet = sum("wallet");
  const cashApplied = total - card - wallet;
  const payments: { method: string; amount: number }[] = [];
  if (cashApplied > 0) payments.push({ method: "cash", amount: fromCents(cashApplied) });
  if (card > 0) payments.push({ method: "card", amount: fromCents(card) });
  if (wallet > 0) payments.push({ method: "wallet", amount: fromCents(wallet) });
  return {
    payments,
    method: payments.length > 1 ? "split" : payments[0]?.method ?? "cash",
    cash_received: cash > 0 ? fromCents(cash) : null,
    change_given: cash > 0 ? fromCents(cash + card + wallet - total) : null,
  };
}
