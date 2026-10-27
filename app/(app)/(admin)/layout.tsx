import AdminGate from "@/components/admin-gate";

// Everything inside this folder (products, stock, sales, dashboard, settings)
// is hidden behind the owner password.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
