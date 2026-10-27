export type Product = {
  id: string;
  barcode: string | null;
  name: string;
  price: number;
  cost?: number; // only loaded in owner mode
  stock: number;
  low_stock_threshold: number;
  active: boolean;
  image_path: string | null;
  created_at: string;
};

export type SaleItem = {
  id: number;
  sale_id: number;
  product_id: string;
  name: string;
  barcode: string | null;
  qty: number;
  unit_price: number;
};

export type Sale = {
  id: number;
  total: number;
  items_count: number;
  payment_method: "cash" | "card";
  cash_received: number | null;
  change_given: number | null;
  voided: boolean;
  cashier: string | null;
  created_at: string;
  sale_items: SaleItem[];
};

export type StockMovement = {
  id: number;
  product_id: string;
  change: number;
  reason: string;
  note: string | null;
  stock_after: number | null;
  created_at: string;
  products: { name: string; barcode: string | null } | null;
};

export type ShopSettings = {
  shop_name: string;
  address: string;
  phone: string;
  footer: string;
  paper_width: 58 | 80;
};

export type ReceiptData = {
  id: number;
  created_at: string;
  payment_method: "cash" | "card";
  cashier?: string | null;
  items: { name: string; qty: number; unit_price: number }[];
  total: number;
  cash_received?: number | null;
  change_given?: number | null;
  voided?: boolean;
  duplicate?: boolean;
};
