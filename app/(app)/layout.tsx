import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AppProviders from "@/components/providers";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    data: { user },
  } = await supabaseServer().auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppProviders>
      <AppShell email={user.email ?? ""}>{children}</AppShell>
    </AppProviders>
  );
}
