"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Charts are client components because Recharts measures the DOM. Everything
 * they need is computed on the server and passed in, so no data fetching
 * happens here.
 */

const AXIS = { fontSize: 11, fill: "currentColor", opacity: 0.55 };

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      fontSize: 12,
      color: "var(--text)",
    },
    labelStyle: { color: "var(--text)", fontWeight: 600, marginBottom: 4 },
  };
}

export interface TrendPoint {
  day: string;
  label: string;
  attended: number;
  capacity: number;
  fill: number | null;
}

export function AttendanceTrend({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="att" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="currentColor" opacity={0.12} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          {...tooltipStyle()}
          formatter={(v: number, n: string) => [v, n === "attended" ? "Attended" : "Capacity"]}
        />
        <Area
          type="monotone"
          dataKey="capacity"
          stroke="currentColor"
          strokeOpacity={0.25}
          fill="none"
          strokeDasharray="3 3"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="attended"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#att)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface LocationBar {
  name: string;
  fill: number;
  classes: number;
  attended: number;
}

export function LocationComparison({ data }: { data: LocationBar[] }) {
  // A studio-wide average is the line every site is judged against, so colour
  // by whether each one clears it rather than making the reader do the maths.
  const avg = data.length
    ? data.reduce((t, d) => t + d.fill, 0) / data.length
    : 0;

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="currentColor" opacity={0.12} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...AXIS, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={126}
        />
        <Tooltip
          {...tooltipStyle()}
          formatter={(v: number, _n, p: any) => [
            `${v}%  ·  ${p.payload.classes} classes  ·  ${p.payload.attended} attended`,
            "Fill rate",
          ]}
        />
        <Bar dataKey="fill" radius={[0, 5, 5, 0]} barSize={20}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill >= avg ? "var(--accent)" : "var(--muted-bar)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
