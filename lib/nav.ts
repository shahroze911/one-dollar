import { BarChart3, Boxes, FilePlus2, Landmark, LayoutDashboard, Package, Receipt, ScanBarcode, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; owner: boolean; hideable: boolean };

export const NAV: NavItem[] = [
  { href: "/pos", label: "Checkout", icon: ScanBarcode, owner: false, hideable: true },
  { href: "/shift", label: "Cash Drawer", icon: Landmark, owner: false, hideable: true },
  { href: "/custom-sale", label: "Custom Bill", icon: FilePlus2, owner: true, hideable: true },
  { href: "/products", label: "Products", icon: Package, owner: true, hideable: true },
  { href: "/stock", label: "Stock", icon: Boxes, owner: true, hideable: true },
  { href: "/sales", label: "Sales", icon: Receipt, owner: true, hideable: true },
  { href: "/reports", label: "Reports", icon: BarChart3, owner: true, hideable: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, owner: true, hideable: true },
  { href: "/settings", label: "Settings", icon: Settings, owner: true, hideable: false }, // always available, or you could lock yourself out
];
