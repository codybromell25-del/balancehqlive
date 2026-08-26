import { Suspense } from "react";
import { userClient } from "@/lib/db";
import { FreshnessStrip } from "./freshness-strip";
import { Filters } from "./filters";
import { PERIODS, DEFAULT_PERIOD } from "./periods";
import { AttendanceTrend, LocationComparison, type TrendPoint } from "./charts";
import { Heatmap, type HeatCell } from "./heatmap";
import { AtRisk, PerformanceTable, type AtRiskMember, type PerfRow } from "./tables";
import { MembershipTrend, Cohorts, type MonthPoint, type CohortCell } from "./membership";
import { LifecycleBar, CancellationBreakdown, type Lifecycle, type Cancellations } from "./lifecycle";
import { RevenueTrend, type RevenuePoint } from "./revenue";
import { MixBar, IntroFunnel, type RevenueMix, type IntroOffers } from "./revenue-panels";

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
  // First-class conversion always looks at a full year: a 7-day window would
  // contain too few first-timers to mean anything.
  const yearAgo = new Date(to.getTime() - 365 * 86_400_000);

  const locationId = selected === "all" ? null : Number(selected);

  // Aggregation happens in Postgres. Fetching daily rows and summing them
  // here hit PostgREST's 1000-row cap, which silently truncated a 12-month
  // window across seven locations and reported totals that were simply wrong.
  // dashboard_revenue keys off the location name Momence records on the sale,
  // not our numeric id — sales and sessions arrive from different endpoints
  // with no shared location key.
  const siteNameFilter =
    selected === "all"
      ? null
      : ((await db.from("locations").select("name")
            .eq("momence_location_id", Number(selected)).maybeSingle()).data?.name ?? null);

  const [
    { data: current },
    { data: previous },
    { data: heat },
    { data: performance },
    { data: atRisk },
    { data: membership },
    { data: cohorts },
    { data: lifecycle },
    { data: cancellations },
    { data: firstClass },
    { data: revenue },
    { data: revMix },
    { data: intro },
    { data: freshness },
    { data: studio },
    { data: locations },
  ] =
    await Promise.all([
      db.rpc("dashboard_summary", { p_from: iso(from), p_to: iso(to), p_location: locationId }),
      db.rpc("dashboard_summary", { p_from: iso(priorFrom), p_to: iso(priorTo), p_location: locationId }),
      db.rpc("dashboard_heatmap", { p_from: iso(from), p_to: iso(to), p_location: locationId }),
      db.rpc("dashboard_performance", { p_from: iso(from), p_to: iso(to), p_location: locationId }),
      db.rpc("dashboard_at_risk", {}),
      db.rpc("dashboard_membership_trend", { p_months: 12 }),
      db.rpc("dashboard_cohorts", { p_months: 9 }),
      db.rpc("dashboard_lifecycle", {}),
      db.rpc("dashboard_cancellations", { p_from: iso(from), p_to: iso(to), p_location: locationId }),
      db.rpc("dashboard_first_class", { p_from: iso(yearAgo), p_to: iso(to) }),
      db.rpc("dashboard_revenue", { p_from: iso(from), p_to: iso(to), p_location: siteNameFilter }),
      db.rpc("dashboard_revenue_mix", { p_from: iso(from), p_to: iso(to) }),
      db.rpc("dashboard_intro_offers", { p_from: iso(yearAgo), p_to: iso(to), p_mature_days: 60 }),
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

  const atRiskRows = (atRisk ?? []) as AtRiskMember[];
  const rev = revenue as { revenue?: number; trend?: RevenuePoint[]; by_location?: { name: string; revenue: number; sales: number }[]; by_item?: { name: string; revenue: number; sales: number }[] } | null;
  const mix = revMix as RevenueMix | null;
  const intros = intro as IntroOffers | null;
  const ccy = studio?.currency ?? "EUR";
  const monthRows = (membership ?? []) as MonthPoint[];
  const cohortRows = (cohorts ?? []) as CohortCell[];
  const stages = lifecycle as Lifecycle | null;
  const cancels = cancellations as Cancellations | null;
  const fc = (firstClass ?? {}) as {
    total_first_timers?: number;
    returned?: number;
    by_class?: { name: string; first_timers: number; returned: number; conversion: number }[];
    by_teacher?: { name: string; first_timers: number; returned: number; conversion: number }[];
  };
  const perf = (performance ?? {}) as { teachers?: PerfRow[]; formats?: PerfRow[] };
  const teacherRows = perf.teachers ?? [];
  const formatRows = perf.formats ?? [];

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

      {rev && Number(rev.revenue) > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Revenue</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Money taken, net of refunds. Credit spent on classes is excluded — it
            was counted when the credit was bought.
          </p>
          <RevenueTrend data={rev.trend ?? []} currency={ccy} />
          {(rev.by_item ?? []).length > 0 && (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <RevenueList title="By location" rows={rev.by_location ?? []} currency={ccy} />
              <RevenueList title="Top sellers" rows={(rev.by_item ?? []).slice(0, 8)} currency={ccy} />
            </div>
          )}
        </section>
      )}

      {mix && Number(mix.total) > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">What the money is made of</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            The membership share is how much of next month you can already count on.
          </p>
          <MixBar data={mix} currency={ccy} />
        </section>
      )}

      {intros && intros.intros > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Intro offers, and who stayed</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Everyone who bought an intro offer in the last year, and whether they
            bought anything afterwards.
          </p>
          <IntroFunnel data={intros} currency={ccy} />
        </section>
      )}

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">Attendance against capacity</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          Solid is attendance; the dashed line is the seats you offered.
        </p>
        <AttendanceTrend data={trend} />
      </section>

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">When your classes fill</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          Every slot you run, shaded against your own average. Red slots are the
          ones to move, merge or drop.
        </p>
        <Heatmap data={(heat ?? []) as HeatCell[]} />
      </section>

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">Active members, month by month</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          Anyone who booked at least once. Split by whether they were new that
          month or returning — a flat total can hide churn being papered over
          with new faces.
        </p>
        <MembershipTrend data={monthRows} />
      </section>

      {stages && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Where your members stand</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Everyone who has ever booked, by how recently and how often.
          </p>
          <LifecycleBar data={stages} />
        </section>
      )}

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">Do new joiners stick?</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          Each row is everyone who joined that month. The numbers are the
          percentage still booking, that many months later.
        </p>
        <Cohorts data={cohortRows} />
      </section>

      {(fc.by_class?.length || fc.by_teacher?.length) && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">First class, and whether they came back</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            {fc.returned?.toLocaleString()} of {fc.total_first_timers?.toLocaleString()} first-timers
            in the last year booked again. Below is where that went well and where it did not.
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            <ConversionTable rows={fc.by_class ?? []} label="Class" />
            <ConversionTable rows={fc.by_teacher ?? []} label="First taught by" />
          </div>
        </section>
      )}

      {cancels && cancels.total > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Cancellations and empty seats</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            How much warning you get, and how many seats went unsold.
          </p>
          <CancellationBreakdown data={cancels} />
        </section>
      )}

      {atRiskRows.length > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">Regulars who have gone quiet</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Members with five or more visits who have not booked in three weeks
            or more. Still recoverable — past 60 days they usually are not.
          </p>
          <AtRisk members={atRiskRows} />
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">By teacher</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Ten classes or more in this period.
          </p>
          <PerformanceTable rows={teacherRows} label="Teacher" />
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">By class</h2>
          <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
            Ten classes or more in this period.
          </p>
          <PerformanceTable rows={formatRows} label="Class" />
        </section>
      </div>

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

function RevenueList({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: { name: string; revenue: number; sales: number }[];
  currency: string;
}) {
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  const top = Math.max(...rows.map((r) => Number(r.revenue)), 1);
  return (
    <div>
      <h3 className="mb-2 text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[var(--border)] first:border-0">
              <td className="py-1.5 pr-3">{r.name.replace(/^balance\s*-\s*/i, "")}</td>
              <td className="w-24 py-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--chip)]">
                  <div className="h-full rounded-full"
                    style={{ width: `${(Number(r.revenue) / top) * 100}%`, background: "var(--accent)" }} />
                </div>
              </td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{fmt(Number(r.revenue))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConversionTable({
  rows,
  label,
}: {
  rows: { name: string; first_timers: number; returned: number; conversion: number }[];
  label: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Not enough first-timers to compare.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
          <th className="pb-2 font-medium">{label}</th>
          <th className="pb-2 pl-3 text-right font-medium">Tried it</th>
          <th className="pb-2 pl-3 text-right font-medium">Came back</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-[var(--border)]">
            <td className="py-2 pr-3">{r.name}</td>
            <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-muted)]">
              {r.first_timers}
            </td>
            <td className="py-2 pl-3 text-right tabular-nums">
              <span className={r.conversion < 65 ? "text-rose-600 dark:text-rose-400" : ""}>
                {r.conversion}%
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
