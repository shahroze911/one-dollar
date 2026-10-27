import type { Product } from "@/lib/types";

export default function StockBadge({ p }: { p: Pick<Product, "stock" | "low_stock_threshold"> }) {
  const cls =
    p.stock <= 0
      ? "bg-rose-100 text-rose-700"
      : p.stock <= p.low_stock_threshold
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`inline-block min-w-[2.5rem] rounded-full px-2.5 py-0.5 text-center text-xs font-bold ${cls}`}>
      {p.stock}
    </span>
  );
}
