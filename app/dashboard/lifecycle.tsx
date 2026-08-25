/** Server components — static presentation, no client bundle. */

export interface Lifecycle {
  new: number;
  regular: number;
  occasional: number;
  lapsing: number;
  lost: number;
}

/**
 * Lifecycle stages as a proportional bar.
 *
 * Shown as one bar rather than five tiles because the proportions are the
 * story: "lost" being the largest segment reads very differently from a
 * number in isolation.
 */
export function LifecycleBar({ data }: { data: Lifecycle }) {
  const stages = [
    { key: "new", label: "New", value: data.new, colour: "var(--accent)", hint: "first booked in the last 30 days" },
    { key: "regular", label: "Regular", value: data.regular, colour: "var(--accent)", hint: "5+ visits, booked in the last 30 days" },
    { key: "occasional", label: "Occasional", value: data.occasional, colour: "var(--muted-bar)", hint: "under 5 visits, booked in the last 30 days" },
    { key: "lapsing", label: "Lapsing", value: data.lapsing, colour: "var(--warn)", hint: "last booked 1 to 3 months ago" },
    { key: "lost", label: "Lost", value: data.lost, colour: "var(--warn)", hint: "nothing booked in over 3 months" },
  ];

  const total = stages.reduce((t, s) => t + s.value, 0) || 1;

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {stages.map((s, i) => (
          <div
            key={s.key}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.colour,
              opacity: s.key === "regular" ? 1 : s.key === "new" ? 0.55 : s.key === "lost" ? 0.45 : 0.8,
            }}
            title={`${s.label}: ${s.value.toLocaleString()}`}
          />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {stages.map((s) => (
          <div key={s.key}>
            <dt className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
              {s.label}
            </dt>
            <dd className="mt-0.5 font-mono text-lg tabular-nums">{s.value.toLocaleString()}</dd>
            <dd className="mt-0.5 text-[0.65rem] leading-tight text-[var(--text-muted)]">{s.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface Cancellations {
  total: number;
  under_2h: number;
  under_12h: number;
  under_24h: number;
  over_24h: number;
  median_hours: number | null;
  capacity: number;
  taken: number;
  empty_seats: number;
}

export function CancellationBreakdown({ data }: { data: Cancellations }) {
  const bands = [
    { label: "Under 2 hours", value: data.under_2h, late: true },
    { label: "2 to 12 hours", value: data.under_12h, late: true },
    { label: "12 to 24 hours", value: data.under_24h, late: false },
    { label: "More than a day", value: data.over_24h, late: false },
  ];
  const max = Math.max(...bands.map((b) => b.value), 1);
  const shortNotice = data.under_2h + data.under_12h;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cancellations" value={data.total.toLocaleString()} />
        <Stat
          label="At short notice"
          value={data.total ? `${Math.round((shortNotice / data.total) * 100)}%` : "—"}
          note="under 12 hours"
        />
        <Stat label="Empty seats" value={data.empty_seats.toLocaleString()} note="unsold capacity" />
      </div>

      <div className="mt-5 space-y-2">
        {bands.map((b) => (
          <div key={b.label} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 text-[var(--text-muted)]">{b.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-[var(--chip)]">
              <div
                className="h-full rounded"
                style={{
                  width: `${(b.value / max) * 100}%`,
                  background: b.late ? "var(--warn)" : "var(--accent)",
                  opacity: b.late ? 0.9 : 0.6,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right tabular-nums">{b.value.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {data.median_hours !== null && (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          Typical cancellation comes {formatHours(data.median_hours)} before the class.
          Anything under a couple of hours is a seat you cannot resell.
        </p>
      )}
    </div>
  );
}

function formatHours(h: number) {
  if (h < 48) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums">{value}</div>
      {note && <div className="mt-0.5 text-[0.65rem] text-[var(--text-muted)]">{note}</div>}
    </div>
  );
}
