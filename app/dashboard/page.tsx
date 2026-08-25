import { userClient } from "@/lib/db";
import { FreshnessStrip } from "./freshness-strip";

export const dynamic = "force-dynamic";

/**
 * Studio overview.
 *
 * Reads go through the user-scoped client, so row level security decides
 * which studio's numbers appear. No studio id is taken from the URL — a
 * tenant boundary enforced in the query string is not a tenant boundary.
 */

type DailyRow = {
  day: string;
  bookings_made: number;
  classes_run: number;
  attended: number;
  no_shows: number;
  fill_rate_pct: number | null;
  revenue: number;
  new_members: number;
  memberships_cancelled: number;
};

function sum(rows: DailyRow[], key: keyof DailyRow) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export default async function DashboardPage() {
  const db = await userClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return <Empty title="Sign in to continue" body="Your studio's numbers are behind a login." />;
  }

  const since = new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: daily }, { data: freshness }, { data: studio }] = await Promise.all([
    db.from("kpi_daily").select("*").gte("day", since).order("day", { ascending: true }),
    db.from("kpi_data_freshness").select("*").maybeSingle(),
    db.from("studios").select("name, currency").maybeSingle(),
  ]);

  const rows = (daily ?? []) as DailyRow[];

  if (rows.length === 0) {
    return (
      <Empty
        title="No data yet"
        body="Once webhooks are registered in Momence, bookings appear here within a minute."
      />
    );
  }

  const last28 = rows.slice(-28);
  const prev28 = rows.slice(-56, -28);

  const money = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: studio?.currency ?? "EUR",
    maximumFractionDigits: 0,
  });

  const attended = sum(last28, "attended");
  const capacityRows = last28.filter((r) => r.fill_rate_pct !== null);
  const avgFill =
    capacityRows.length > 0
      ? Math.round(
          capacityRows.reduce((t, r) => t + (r.fill_rate_pct ?? 0), 0) / capacityRows.length,
        )
      : null;

  const metrics = [
    {
      label: "Revenue",
      value: money.format(sum(last28, "revenue")),
      change: pctChange(sum(last28, "revenue"), sum(prev28, "revenue")),
    },
    {
      label: "Classes attended",
      value: attended.toLocaleString(),
      change: pctChange(attended, sum(prev28, "attended")),
    },
    {
      label: "Average fill",
      value: avgFill === null ? "—" : `${avgFill}%`,
      change: null,
    },
    {
      label: "New members",
      value: sum(last28, "new_members").toLocaleString(),
      change: pctChange(sum(last28, "new_members"), sum(prev28, "new_members")),
    },
    {
      label: "Memberships cancelled",
      value: sum(last28, "memberships_cancelled").toLocaleString(),
      change: pctChange(
        sum(last28, "memberships_cancelled"),
        sum(prev28, "memberships_cancelled"),
      ),
      inverted: true,
    },
    {
      label: "No-shows",
      value: sum(last28, "no_shows").toLocaleString(),
      change: pctChange(sum(last28, "no_shows"), sum(prev28, "no_shows")),
      inverted: true,
    },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{studio?.name ?? "Studio"}</h1>
        <p className="mt-1 text-sm text-neutral-500">Last 28 days, against the 28 before.</p>
      </header>

      {freshness && <FreshnessStrip freshness={freshness} />}

      <section className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white p-5">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{m.label}</div>
            <div className="mt-2 font-mono text-2xl tabular-nums">{m.value}</div>
            {m.change !== null && (
              <div
                className={
                  "mt-1 text-xs tabular-nums " +
                  ((m.change > 0) !== Boolean(m.inverted)
                    ? "text-emerald-600"
                    : "text-rose-600")
                }
              >
                {m.change > 0 ? "+" : ""}
                {m.change}% vs previous 28 days
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">{body}</p>
    </main>
  );
}
