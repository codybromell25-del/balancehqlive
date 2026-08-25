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

type StudioRow = {
  day: string;
  bookings_made: number;
  classes_run: number;
  capacity_offered: number;
  spots_taken: number;
  attended: number;
  no_shows: number;
  fill_rate_pct: number | null;
  revenue: number;
  new_members: number;
  memberships_cancelled: number;
};

type LocationRow = {
  day: string;
  momence_location_id: number | null;
  location_name: string | null;
  classes_run: number;
  capacity_offered: number;
  spots_taken: number;
  attended: number;
  no_shows: number;
  bookings_made: number;
};

const num = (v: unknown) => Number(v) || 0;
const sum = <T,>(rows: T[], key: keyof T) => rows.reduce((t, r) => t + num(r[key]), 0);

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

  const since = new Date(Date.now() - WINDOW * 2 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: studioDaily }, { data: locationDaily }, { data: freshness }, { data: studio }, { data: locations }] =
    await Promise.all([
      db.from("kpi_daily").select("*").gte("day", since).order("day", { ascending: true }),
      db.from("kpi_daily_location").select("*").gte("day", since).order("day", { ascending: true }),
      db.from("kpi_data_freshness").select("*").limit(1).maybeSingle(),
      db.from("studios").select("name, currency").limit(1).maybeSingle(),
      db.from("locations").select("momence_location_id, name").order("name"),
    ]);

  const studioRows = (studioDaily ?? []) as StudioRow[];
  const locRows = (locationDaily ?? []) as LocationRow[];

  if (studioRows.length === 0) {
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

  const filtering = selected !== "all";
  const siteName = sites.find((s) => String(s.id) === selected)?.name;

  // Class metrics come from whichever grain the filter selects. Revenue and
  // membership movement only exist studio-wide — Momence's payment records
  // carry no location — so they are read from the studio view either way.
  // If migration 0004 has not been applied yet, kpi_daily_location does not
  // exist and the query above returns nothing. Fall back to studio totals so
  // the page still reports honestly rather than showing zeros; the location
  // filter simply stays hidden until the view is there.
  const haveLocationGrain = locRows.length > 0;

  const scoped = !haveLocationGrain
    ? studioRows.map<LocationRow>((r) => ({
        day: r.day,
        momence_location_id: null,
        location_name: null,
        classes_run: r.classes_run,
        capacity_offered: r.capacity_offered,
        spots_taken: r.spots_taken,
        attended: r.attended,
        no_shows: r.no_shows,
        bookings_made: r.bookings_made,
      }))
    : filtering
      ? locRows.filter((r) => String(r.momence_location_id) === selected)
      : locRows;

  const byDay = new Map<string, LocationRow>();
  for (const r of scoped) {
    const acc = byDay.get(r.day) ?? {
      ...r, classes_run: 0, capacity_offered: 0, spots_taken: 0,
      attended: 0, no_shows: 0, bookings_made: 0,
    };
    acc.classes_run += num(r.classes_run);
    acc.capacity_offered += num(r.capacity_offered);
    acc.spots_taken += num(r.spots_taken);
    acc.attended += num(r.attended);
    acc.no_shows += num(r.no_shows);
    acc.bookings_made += num(r.bookings_made);
    byDay.set(r.day, acc);
  }

  const days = [...byDay.keys()].sort();
  const recentDays = days.slice(-WINDOW);
  const priorDays = days.slice(-WINDOW * 2, -WINDOW);
  const recent = recentDays.map((d) => byDay.get(d)!);
  const prior = priorDays.map((d) => byDay.get(d)!);

  const studioRecent = studioRows.slice(-WINDOW);
  const studioPrior = studioRows.slice(-WINDOW * 2, -WINDOW);

  const money = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: studio?.currency ?? "EUR",
    maximumFractionDigits: 0,
  });

  const fillOf = (rows: LocationRow[]) => {
    const cap = sum(rows, "capacity_offered");
    return cap > 0 ? Math.round((sum(rows, "spots_taken") / cap) * 100) : null;
  };

  const fill = fillOf(recent);
  const priorFill = fillOf(prior);

  const metrics = [
    {
      label: "Revenue",
      value: money.format(sum(studioRecent, "revenue")),
      change: pctChange(sum(studioRecent, "revenue"), sum(studioPrior, "revenue")),
      note: filtering ? "all locations" : undefined,
    },
    {
      label: "Attended",
      value: sum(recent, "attended").toLocaleString(),
      change: pctChange(sum(recent, "attended"), sum(prior, "attended")),
    },
    {
      label: "Average fill",
      value: fill === null ? "—" : `${fill}%`,
      change: fill !== null && priorFill ? fill - priorFill : null,
      unit: "pt",
    },
    {
      label: "Classes run",
      value: sum(recent, "classes_run").toLocaleString(),
      change: pctChange(sum(recent, "classes_run"), sum(prior, "classes_run")),
    },
    {
      label: "No-shows",
      value: sum(recent, "no_shows").toLocaleString(),
      change: pctChange(sum(recent, "no_shows"), sum(prior, "no_shows")),
      inverted: true,
    },
    {
      label: "New members",
      value: sum(studioRecent, "new_members").toLocaleString(),
      change: pctChange(sum(studioRecent, "new_members"), sum(studioPrior, "new_members")),
      note: filtering ? "all locations" : undefined,
    },
  ];

  const trend: TrendPoint[] = recentDays.map((d) => {
    const r = byDay.get(d)!;
    return {
      day: d,
      label: new Date(d).toLocaleDateString("en-IE", { day: "numeric", month: "short" }),
      attended: num(r.attended),
      capacity: num(r.capacity_offered),
      fill: r.capacity_offered > 0
        ? Math.round((num(r.spots_taken) / num(r.capacity_offered)) * 100)
        : null,
    };
  });

  const perSite = sites
    .map((s) => {
      const rows = locRows.filter(
        (r) => r.momence_location_id === s.id && recentDays.includes(r.day),
      );
      const cap = sum(rows, "capacity_offered");
      return {
        name: s.name.replace(/^balance\s*-\s*/i, ""),
        fill: cap > 0 ? Math.round((sum(rows, "spots_taken") / cap) * 100) : 0,
        classes: sum(rows, "classes_run"),
        attended: sum(rows, "attended"),
      };
    })
    .filter((s) => s.classes > 0)
    .sort((a, b) => b.fill - a.fill);

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
