import { Suspense } from "react";
import { userClient } from "@/lib/db";
import { FreshnessStrip } from "./freshness-strip";
import { Filters } from "./filters";
import { PERIODS, DEFAULT_PERIOD } from "./periods";
import { AttendanceTrend, LocationComparison, type TrendPoint } from "./charts";

export const dynamic = "force-dynamic";

/**
 * Studio overview.
 *
 * Reads go through the user-scoped client, so row level security decides
 * which studio's numbers appear. No studio id is taken from the URL — a
 * tenant boundary enforced in the query string is not a tenant boundary.
 *
 * The location filter is different: it selects among sites the viewer can
 * already see, so it is a view preference rather than a permission, and
 * belongs in the URL where it can be shared.
 */

interface Summary {
  classes_run?: number;
  capacity_offered?: number;
  spots_taken?: number;
  attended?: number;
  no_shows?: number;
  bookings_made?: number;
  fill_rate_pct?: number | null;
  revenue?: number;
  new_members?: number;
  memberships_cancelled?: number;
  trend?: { day: string; attended: number; capacity: number }[];
  locations?: { id: number | null; name: string; classes: number; attended: number; fill: number }[];
}

const num = (v: unknown) => Number(v) || 0;

function pctChange(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; period?: string }>;
}) {
  const { location, period } = await searchParams;
  const selected = location ?? "all";
  const periodKey = PERIODS.some((p) => p.key === period) ? period! : DEFAULT_PERIOD;
  const WINDOW = PERIODS.find((p) => p.key === periodKey)!.days;
  const db = await userClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return <Empty title="Sign in to continue" body="Your studio's numbers are behind a login." />;
  }

  const to = new Date();
  const from = new Date(to.getTime() - (WINDOW - 1) * 86_400_000);
  const priorTo = new Date(from.getTime() - 86_400_000);
  const priorFrom = new Date(priorTo.getTime() - (WINDOW - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const locationId = selected === "all" ? null : Number(selected);

  // Aggregation happens in Postgres. Fetching daily rows and summing them
  // here hit PostgREST's 1000-row cap, which silently truncated a 12-month
  // window across seven locations and reported totals that were simply wrong.
  const [{ data: current }, { data: previous }, { data: freshness }, { data: studio }, { data: locations }] =
    await Promise.all([
      db.rpc("dashboard_summary", { p_from: iso(from), p_to: iso(to), p_location: locationId }),
      db.rpc("dashboard_summary", { p_from: iso(priorFrom), p_to: iso(priorTo), p_location: locationId }),
      db.from("kpi_data_freshness").select("*").limit(1).maybeSingle(),
      db.from("studios").select("name, currency").limit(1).maybeSingle(),
      db.from("locations").select("momence_location_id, name").order("name"),
    ]);

  const now = (current ?? {}) as Summary;
  const before = (previous ?? {}) as Summary;

  if (!current) {
    return (
      <Empty
        title="No data yet"
        body="Once webhooks are registered in Momence, bookings appear here within a minute."
      />
    );
  }

  const sites = (locations ?? []).map((l) => ({
    id: l.momence_location_id as number,
    name: (l.name as string) ?? `Location ${l.momence_location_id}`,
  }));

  const haveLocationGrain = (now.locations ?? []).length > 0;
  const filtering = selected !== "all";
  const siteName = sites.find((s) => String(s.id) === selected)?.name;

  const money = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: studio?.currency ?? "EUR",
    maximumFractionDigits: 0,
  });

  const metrics = [
    {
      label: "Revenue",
      value: money.format(num(now.revenue)),
      change: pctChange(num(now.revenue), num(before.revenue)),
      note: filtering ? "all locations" : undefined,
    },
    {
      label: "Attended",
      value: num(now.attended).toLocaleString(),
      change: pctChange(num(now.attended), num(before.attended)),
    },
    {
      label: "Average fill",
      value: now.fill_rate_pct === null || now.fill_rate_pct === undefined
        ? "—"
        : `${Math.round(num(now.fill_rate_pct))}%`,
      change:
        now.fill_rate_pct != null && before.fill_rate_pct != null
          ? Math.round(num(now.fill_rate_pct) - num(before.fill_rate_pct))
          : null,
      unit: "pt",
    },
    {
      label: "Classes run",
      value: num(now.classes_run).toLocaleString(),
      change: pctChange(num(now.classes_run), num(before.classes_run)),
    },
    {
      label: "No-shows",
      value: num(now.no_shows).toLocaleString(),
      change: pctChange(num(now.no_shows), num(before.no_shows)),
      inverted: true,
    },
    {
      label: "New members",
      value: num(now.new_members).toLocaleString(),
      change: pctChange(num(now.new_members), num(before.new_members)),
      note: filtering ? "all locations" : undefined,
    },
  ];

  const trend: TrendPoint[] = (now.trend ?? []).map((r) => ({
    day: r.day,
    label: new Date(r.day).toLocaleDateString("en-IE", { day: "numeric", month: "short" }),
    attended: num(r.attended),
    capacity: num(r.capacity),
    fill: null,
  }));

  const perSite = (now.locations ?? []).map((l) => ({
    name: (l.name ?? "Unassigned").replace(/^balance\s*-\s*/i, ""),
    fill: num(l.fill),
    classes: num(l.classes),
    attended: num(l.attended),
  }));

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-tight">
            {studio?.name ?? "Studio"}
            {siteName && (
              <span className="text-[var(--text-muted)] font-normal">
                {" · "}{siteName.replace(/^balance\s*-\s*/i, "")}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {PERIODS.find((p) => p.key === periodKey)!.label}, compared with the{" "}
            {WINDOW} days before.
          </p>
        </div>
      </header>

      <div className="mb-6">
        <Suspense fallback={<div className="h-16" />}>
        <Filters
          locations={haveLocationGrain ? sites : []}
          location={selected}
          period={periodKey}
        />
        </Suspense>
      </div>

      {freshness && <FreshnessStrip freshness={freshness} />}

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.7rem] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {m.label}
              </span>
              {m.note && (
                <span className="text-[0.62rem] text-[var(--text-muted)] opacity-70">{m.note}</span>
              )}
            </div>
            <div className="mt-2 font-mono text-[1.7rem] leading-none tabular-nums">{m.value}</div>
            <div className="mt-2 h-4 text-xs tabular-nums">
              {m.change !== null && m.change !== undefined && (
                <span
                  className={
                    (m.change > 0) !== Boolean(m.inverted)
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }
                >
                  {m.change > 0 ? "▲" : "▼"} {Math.abs(m.change)}
                  {m.unit ?? "%"}
                </span>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">Attendance against capacity</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          Solid is attendance; the dashed line is the seats you offered.
        </p>
        <AttendanceTrend data={trend} />
      </section>

      {haveLocationGrain && !filtering && perSite.length > 1 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Fill rate by location</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Highlighted sites are at or above the average across your locations.
          </p>
          <LocationComparison data={perSite} />
        </section>
      )}
    </main>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
    </main>
  );
}
