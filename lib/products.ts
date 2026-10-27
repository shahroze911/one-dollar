import { supabaseBrowser } from "./supabase/client";
import type { Product } from "./types";

// Cost price is deliberately NOT in this list: the cashier screen can't read it.
const POS_COLS =
  "id, barcode, name, price, stock, low_stock_threshold, active, image_path, created_at";

/** Active products for the checkout screen. Pages through PostgREST's 1000-row cap. */
export async function fetchPosProducts(): Promise<Product[]> {
  const sb = supabaseBrowser();
  const PAGE = 1000;
  const out: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("products")
      .select(POS_COLS)
      .eq("active", true)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Product[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Every product including inactive ones and cost price. Owner mode only. */
export async function fetchAdminProducts(): Promise<Product[]> {
  const sb = supabaseBrowser();
  const PAGE = 1000;
  const out: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.rpc("admin_products").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Product[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
