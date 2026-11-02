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
  discount: number; // total Rs off this line
  unit_cost?: number | null; // cost at the time of sale (owner view only)
};

export type PaymentRow = { method: string; amount: number };

export type RefundItem = {
  id: number;
  refund_id: number;
  sale_item_id: number;
  product_id: string;
  name: string;
  qty: number;
  amount: number;
};

export type Refund = {
  id: number;
  sale_id: number;
  amount: number;
  method: string;
  reason: string;
  note: string | null;
  restock: boolean;
  cashier: string | null;
  created_at: string;
  refund_items: RefundItem[];
};

export type Sale = {
  id: number;
  total: number;
  subtotal: number;
  discount: number; // whole-sale discount
  items_count: number;
  payment_method: string; // cash | card | wallet | split
  payments: PaymentRow[];
  cash_received: number | null;
  change_given: number | null;
  voided: boolean;
  offline?: boolean;
  needs_review?: boolean;
  review_note?: string | null;
  cashier: string | null;
  created_at: string;
  sale_items: SaleItem[];
  refunds: Refund[];
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
  logo_path: string | null;
  whatsapp: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  website: string;
  max_discount_pct: number;
  hidden_pages: string[]; // sidebar pages the owner chose to hide
};

export type ReceiptData = {
  id: number;
  created_at: string;
  payment_method: string;
  payments?: PaymentRow[];
  cashier?: string | null;
  items: { name: string; qty: number; unit_price: number; discount?: number }[];
  subtotal?: number;
  discount?: number; // whole-sale discount
  total: number;
  cash_received?: number | null;
  change_given?: number | null;
  voided?: boolean;
  duplicate?: boolean;
  // refund receipts
  kind?: "sale" | "refund";
  ref_sale?: number;
  reason?: string;
  // sales made while offline
  temp_no?: string;
  offline?: boolean;
};

export type ShiftMovement = { id: number; kind: "in" | "out"; amount: number; reason: string; at: string; by: string | null };

export type CurrentShift = {
  id: number;
  opened_at: string;
  opened_by: string | null;
  opening_float: number;
  sales_count: number;
  sales_total: number;
  movements: ShiftMovement[];
  // only present while the owner is unlocked
  expected_cash?: number;
  cash_sales?: number;
  cash_refunds?: number;
  cash_in?: number;
  cash_out?: number;
};

export type ShiftRow = {
  id: number;
  opened_by_email: string | null;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
  closed_by_email: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  close_note: string | null;
};
