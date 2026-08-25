/**
 * Server components — plain tables, no interactivity, so no client bundle.
 */

export interface AtRiskMember {
  member_id: number;
  name: string;
  email: string | null;
  visits: number;
  last_visit: string;
  days_quiet: number;
  visits_per_month: number;
}

export function AtRisk({ members }: { members: AtRiskMember[] }) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nobody matches — every regular has been in recently. That is the result you want.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
            <th className="pb-2 font-medium">Member</th>
            <th className="pb-2 pl-3 font-medium">Was coming</th>
            <th className="pb-2 pl-3 text-right font-medium">Visits</th>
            <th className="pb-2 pl-3 text-right font-medium">Quiet for</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.member_id} className="border-t border-[var(--border)]">
              <td className="py-2 pr-3">
                <div className="font-medium">{m.name || `Member ${m.member_id}`}</div>
                {m.email && (
                  <a
                    href={`mailto:${m.email}`}
                    className="text-xs text-[var(--text-muted)] underline underline-offset-2"
                  >
                    {m.email}
                  </a>
                )}
              </td>
              <td className="py-2 pl-3 text-[var(--text-muted)] tabular-nums">
                {m.visits_per_month}× / month
              </td>
              <td className="py-2 pl-3 text-right tabular-nums">{m.visits}</td>
              <td className="py-2 pl-3 text-right tabular-nums">
                <span className={m.days_quiet > 60 ? "text-rose-600 dark:text-rose-400" : ""}>
                  {m.days_quiet}d
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PerfRow {
  name: string;
  classes: number;
  attended: number;
  no_shows: number;
  fill: number | null;
}

export function PerformanceTable({
  rows,
  label,
}: {
  rows: PerfRow[];
  label: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Not enough data in this period.</p>;
  }

  const best = Math.max(...rows.map((r) => r.fill ?? 0));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
            <th className="pb-2 font-medium">{label}</th>
            <th className="pb-2 pl-3 text-right font-medium">Classes</th>
            <th className="pb-2 pl-3 text-right font-medium">No-shows</th>
            <th className="pb-2 pl-3 font-medium">Fill</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[var(--border)]">
              <td className="py-2 pr-3 font-medium">{r.name}</td>
              <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-muted)]">
                {r.classes.toLocaleString()}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-muted)]">
                {/* Rate, not count: a teacher with more classes will always
                    have more no-shows, which says nothing. */}
                {r.attended + r.no_shows > 0
                  ? `${Math.round((r.no_shows / (r.attended + r.no_shows)) * 100)}%`
                  : "—"}
              </td>
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--chip)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${((r.fill ?? 0) / Math.max(best, 1)) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="tabular-nums">{r.fill ?? "—"}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
