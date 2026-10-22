import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The dashboard's reads, cached for five minutes and shared between
 * everyone who would see the same numbers.
 *
 * Row level security decides those numbers from the report scope alone
 * (see getAccess): the studios and whether the viewer is an owner. That
 * scope is the cache key, so a cached result only ever reaches someone who
 * would have got exactly the same answer. The queries still run as the
 * signed-in user, through their own access token, so RLS stays the
 * boundary — the cache never sees more than they could.
 *
 * Once a result is older than five minutes it is still served while a
 * fresh one is fetched in the background, so after the first load nobody
 * waits on the database. The freshness and verification strips are read
 * live by the page and are not cached here.
 */

const TTL_SECONDS = 300;

export type DashboardParams = {
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  yearAgo: string;
  location: number | null;
};

function asUser(accessToken: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function load(db: SupabaseClient, p: DashboardParams) {
  // dashboard_revenue keys off the location name Momence records on the
  // sale, not our numeric id — sales and sessions arrive from different
  // endpoints with no shared location key.
  const siteName =
    p.location === null
      ? null
      : ((await db.from("locations").select("name").eq("momence_location_id", p.location).maybeSingle()).data
          ?.name ?? null);

  // Aggregation happens in Postgres. Fetching daily rows and summing them
  // here hit PostgREST's 1000-row cap, which silently truncated a 12-month
  // window across seven locations and reported totals that were simply wrong.
  const results = await Promise.all([
    db.rpc("dashboard_summary", { p_from: p.from, p_to: p.to, p_location: p.location }),
    db.rpc("dashboard_summary", { p_from: p.priorFrom, p_to: p.priorTo, p_location: p.location }),
    db.rpc("dashboard_heatmap", { p_from: p.from, p_to: p.to, p_location: p.location }),
    db.rpc("dashboard_performance", { p_from: p.from, p_to: p.to, p_location: p.location }),
    db.rpc("dashboard_at_risk", {}),
    db.rpc("dashboard_membership_trend", { p_months: 12 }),
    db.rpc("dashboard_cohorts", { p_months: 9 }),
    db.rpc("dashboard_lifecycle", {}),
    db.rpc("dashboard_cancellations", { p_from: p.from, p_to: p.to, p_location: p.location }),
    db.rpc("dashboard_cancelled_classes", { p_from: p.from, p_to: p.to, p_location: p.location }),
    db.rpc("dashboard_first_class", { p_from: p.yearAgo, p_to: p.to }),
    db.rpc("dashboard_revenue", { p_from: p.from, p_to: p.to, p_location: siteName }),
    db.rpc("dashboard_revenue_mix", { p_from: p.from, p_to: p.to }),
    db.rpc("dashboard_intro_offers", { p_from: p.yearAgo, p_to: p.to, p_mature_days: 60 }),
    db.from("studios").select("name, currency").limit(1).maybeSingle(),
    db.from("locations").select("momence_location_id, name").order("name"),
  ]);

  const [
    current, previous, heat, performance, atRisk, membership, cohorts, lifecycle,
    cancellations, cancelledClasses, firstClass, revenue, revMix, intro, studio, locations,
  ] = results.map((r) => r.data as unknown);

  return {
    data: {
      current, previous, heat, performance, atRisk, membership, cohorts, lifecycle,
      cancellations, cancelledClasses, firstClass, revenue, revMix, intro,
      studio: studio as { name: string; currency: string | null } | null,
      locations: (locations ?? []) as { momence_location_id: number; name: string | null }[],
    },
    failed: results.find((r) => r.error)?.error ?? null,
  };
}

export async function dashboardData(
  db: SupabaseClient,
  accessToken: string | null,
  scope: string,
  params: DashboardParams,
) {
  if (!accessToken) return (await load(db, params)).data;

  const cached = unstable_cache(
    async (_scope: string, p: DashboardParams) => {
      const { data, failed } = await load(asUser(accessToken), p);
      // Throwing keeps a half-failed load out of the cache.
      if (failed) throw new Error(failed.message);
      return data;
    },
    ["dashboard", "v1"],
    { revalidate: TTL_SECONDS, tags: ["dashboard"] },
  );

  try {
    return await cached(scope, params);
  } catch {
    // Serve what can be read rather than nothing; it just isn't cached.
    return (await load(db, params)).data;
  }
}
