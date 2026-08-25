"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "currentColor", opacity: 0.55 };
const TIP = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text)", fontWeight: 600, marginBottom: 4 },
};

export interface MonthPoint {
  month: string;
  active: number;
  new_members: number;
  returning_members: number;
}

/**
 * Active members per month, split new versus returning.
 *
 * The split is the point: a flat total can hide a studio replacing churned
 * regulars with new faces every month, which costs far more than keeping them.
 */
export function MembershipTrend({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="currentColor" opacity={0.12} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
        <Tooltip {...TIP} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Bar dataKey="returning_members" name="Returning" stackId="a" fill="var(--accent)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="new_members" name="New" stackId="a" fill="var(--muted-bar)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface CohortCell {
  cohort: string;
  month_offset: number;
  retained: number;
  cohort_size: number;
  pct: number;
}

/**
 * Classic cohort grid. Reading down a column shows whether retention is
 * improving for newer joiners; reading across a row shows how one intake decayed.
 */
export function Cohorts({ data }: { data: CohortCell[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Not enough history yet.</p>;
  }

  const cohorts = [...new Set(data.map((d) => d.cohort))].sort();
  const offsets = [...new Set(data.map((d) => d.month_offset))].sort((a, b) => a - b);
  const cells = new Map(data.map((d) => [`${d.cohort}:${d.month_offset}`, d]));
  const size = new Map(data.map((d) => [d.cohort, d.cohort_size]));

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr>
            <th className="pr-1 text-right font-medium text-[var(--text-muted)]">Joined</th>
            <th className="pr-2 text-right font-medium text-[var(--text-muted)]">Size</th>
            {offsets.map((o) => (
              <th key={o} className="w-11 pb-1 font-medium text-[var(--text-muted)]">
                {o === 0 ? "M0" : `+${o}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c}>
              <td className="pr-1 text-right tabular-nums text-[var(--text-muted)]">{c}</td>
              <td className="pr-2 text-right tabular-nums text-[var(--text-muted)]">{size.get(c)}</td>
              {offsets.map((o) => {
                const cell = cells.get(`${c}:${o}`);
                return (
                  <td key={o}>
                    <div
                      className="flex h-7 items-center justify-center rounded-[4px] tabular-nums"
                      style={
                        cell
                          ? {
                              background: "var(--accent)",
                              opacity: 0.12 + (cell.pct / 100) * 0.88,
                              color: cell.pct > 55 ? "#fff" : "var(--text)",
                            }
                          : { background: "transparent" }
                      }
                      title={cell ? `${cell.retained} of ${cell.cohort_size} still booking` : undefined}
                    >
                      {cell ? `${Math.round(cell.pct)}` : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Percentage of each intake still booking, months after they joined.
        Read down a column to see whether newer intakes stick better.
      </p>
    </div>
  );
}
