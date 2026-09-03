/** Server component — static table, no client bundle. */

export interface CancelledClasses {
  total: number;
  empty: number;
  low: number;
  other: number;
  members_affected: number;
  by_location: { name: string; cancelled: number; members_affected: number; against_policy: number }[];
  against_policy: {
    class_date: string;
    class_name: string | null;
    teacher_name: string | null;
    location_name: string;
    capacity: number | null;
    were_booked: number;
  }[];
}

/**
 * Classes the studio pulled.
 *
 * Split three ways because the studio's own rule is "two or fewer": empty and
 * low are the policy working, three-or-more is something else — illness, a
 * room problem — and is the group worth actually looking at.
 */
export function Cancelled({ data }: { data: CancelledClasses }) {
  if (data.total === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No classes cancelled in this period.</p>;
  }

  const bands = [
    { label: "Nobody booked", value: data.empty, tone: "muted" as const },
    { label: "One or two booked", value: data.low, tone: "accent" as const },
    { label: "Three or more", value: data.other, tone: "warn" as const },
  ];
  const total = data.total || 1;

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--chip)]">
        {bands.map((b) => (
          <div
            key={b.label}
            title={`${b.label}: ${b.value}`}
            style={{
              width: `${(b.value / total) * 100}%`,
              background: b.tone === "warn" ? "var(--warn)" : "var(--accent)",
              opacity: b.tone === "muted" ? 0.3 : b.tone === "accent" ? 0.75 : 1,
            }}
          />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cancelled" value={data.total.toLocaleString()} />
        <Stat label="Nobody booked" value={data.empty.toLocaleString()} note="no one turned away" />
        <Stat label="One or two" value={data.low.toLocaleString()} note="the usual reason" />
        <Stat
          label="Three or more"
          value={data.other.toLocaleString()}
          note="outside the rule"
          warn={data.other > 0}
        />
      </dl>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        {data.members_affected.toLocaleString()} member bookings were affected in total.
      </p>

      {data.by_location.length > 1 && (
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
              <th className="pb-2 font-medium">Location</th>
              <th className="pb-2 pl-3 text-right font-medium">Cancelled</th>
              <th className="pb-2 pl-3 text-right font-medium">Members</th>
              <th className="pb-2 pl-3 text-right font-medium">Outside rule</th>
            </tr>
          </thead>
          <tbody>
            {data.by_location.map((l) => (
              <tr key={l.name} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3">{l.name.replace(/^balance\s*-\s*/i, "")}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{l.cancelled}</td>
                <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-muted)]">
                  {l.members_affected}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  <span className={l.against_policy > 0 ? "text-rose-600 dark:text-rose-400" : "text-[var(--text-muted)]"}>
                    {l.against_policy}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.against_policy.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
            Cancelled with three or more booked
          </h3>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {data.against_policy.map((c, i) => (
                <tr key={i} className="border-t border-[var(--border)] first:border-0">
                  <td className="py-2 pr-3 tabular-nums text-[var(--text-muted)]">
                    {new Date(c.class_date).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
                  </td>
                  <td className="py-2 pr-3">
                    {c.class_name}
                    <span className="text-[var(--text-muted)]">
                      {" · "}{c.location_name.replace(/^balance\s*-\s*/i, "")}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap">
                    <strong>{c.were_booked}</strong>
                    <span className="text-[var(--text-muted)]">/{c.capacity ?? "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd className={"mt-0.5 font-mono text-lg tabular-nums " + (warn ? "text-rose-600 dark:text-rose-400" : "")}>
        {value}
      </dd>
      {note && <dd className="text-[0.65rem] text-[var(--text-muted)]">{note}</dd>}
    </div>
  );
}
