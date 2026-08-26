"use client";

import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "currentColor", opacity: 0.55 };
const TIP = {
  contentStyle: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 8, fontSize: 12, color: "var(--text)",
  },
  labelStyle: { color: "var(--text)", fontWeight: 600, marginBottom: 4 },
};

export interface RevenuePoint { day: string; revenue: number }

export function RevenueTrend({ data, currency }: { data: RevenuePoint[]; currency: string }) {
  const fmt = new Intl.NumberFormat("en-IE", {
    style: "currency", currency, maximumFractionDigits: 0,
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="currentColor" opacity={0.12} vertical={false} />
        <XAxis
          dataKey="day" tick={AXIS} tickLine={false} axisLine={false} minTickGap={30}
          tickFormatter={(d: string) =>
            new Date(d).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
        />
        <YAxis
          tick={AXIS} tickLine={false} axisLine={false} width={56}
          tickFormatter={(v: number) => fmt.format(v)}
        />
        <Tooltip {...TIP} formatter={(v: number) => [fmt.format(v), "Revenue"]} />
        <Area type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
