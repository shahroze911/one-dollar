export type DMode = "rs" | "pct";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rupees off, from either a Rs amount or a percentage, never more than `base`. */
export function discountAmount(base: number, mode: DMode, value: string): number {
  const v = Number(value);
  if (!value.trim() || !isFinite(v) || v <= 0) return 0;
  const d = mode === "pct" ? (base * Math.min(v, 100)) / 100 : v;
  return r2(Math.min(Math.max(d, 0), base));
}
