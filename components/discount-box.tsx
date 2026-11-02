"use client";
import { money } from "@/lib/format";
import { discountAmount, type DMode } from "@/lib/discount";

/** A discount entry: type Rs or %, shows the rupees it comes to. */
export default function DiscountBox({
  base,
  mode,
  value,
  onChange,
  autoFocus,
}: {
  base: number; // the amount the discount applies to (Rs)
  mode: DMode;
  value: string;
  onChange: (mode: DMode, value: string) => void;
  autoFocus?: boolean;
}) {
  const amount = discountAmount(base, mode, value);
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-bold">
        {(["rs", "pct"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m, value)}
            className={`px-2.5 py-1.5 transition ${mode === m ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {m === "rs" ? "Rs" : "%"}
          </button>
        ))}
      </div>
      <input
        className="input h-8 w-24 py-0 text-sm font-bold"
        type="number"
        min="0"
        step={mode === "pct" ? "1" : "10"}
        inputMode="decimal"
        placeholder={mode === "pct" ? "e.g. 10" : "e.g. 50"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(mode, e.target.value)}
      />
      {amount > 0 && <span className="text-xs font-bold text-emerald-700">− {money(amount)}</span>}
    </div>
  );
}
