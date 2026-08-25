import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** The shape @supabase/ssr hands to setAll. */
type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Two clients, deliberately separated.
 *
 * serviceClient() bypasses row level security and is for ingestion only —
 * webhook handlers, crons, projectors. It must never be reachable from a
 * request that a browser controls.
 *
 * userClient() carries the signed-in user's session, so RLS decides what
 * they can see. Every dashboard read goes through this one.
 */

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function userClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items: CookieToSet[]) => {
          try {
            items.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    },
  );
}
