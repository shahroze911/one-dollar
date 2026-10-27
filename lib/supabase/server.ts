
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(
          list: {
            name: string;
            value: string;
            options?: {
              domain?: string;
              path?: string;
              expires?: Date;
              httpOnly?: boolean;
              maxAge?: number;
              sameSite?: boolean | "lax" | "strict" | "none";
              secure?: boolean;
            };
          }[]
        ) {
          try {
            list.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies.
            // Middleware handles session refresh.
          }
        },
      },
    }
  );
}
