"use client";

import { useState } from "react";

export interface HeatCell {
  weekday: number; // 1 = Monday, per ISO
  hour: number;
  classes: number;
  capacity: number;
  booked: number;
  attended: number;
  fill: number | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Fill rate by weekday and hour.
 *
 * Colour is keyed to the studio's own average rather than an absolute scale:
 * 65% is excellent for one studio and poor for another, and what an owner
 * needs to see is which of *their* slots are underperforming the rest.
 */
export function Heatmap({ data }: { data: HeatCell[] }) {
  const [hover, setHover] = useState<HeatCell | null>(null);

  if (data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No classes in this period.</p>;
  }

  const hours = [...new Set(data.map((d) => d.hour))].sort((a, b) => a - b);
  const cells = new Map(data.map((d) => [`${d.weekday}:${d.hour}`, d]));

  const totalCap = data.reduce((t, d) => t + d.capacity, 0);
  const totalBooked = data.reduce((t, d) => t + d.booked, 0);
  const avg = totalCap > 0 ? (totalBooked / totalCap) * 100 : 0;

  // Deviation from the studio average, clamped to ±25 points, drives opacity.
  function style(cell: HeatCell | undefined) {
    if (!cell || cell.fill === null) {
      return { background: "var(--chip)", opacity: 0.4 };
    }
    const delta = Math.max(-25, Math.min(25, cell.fill - avg));
    const strength = Math.abs(delta) / 25;
    return {
      background: delta >= 0 ? "var(--accent)" : "var(--warn)",
      opacity: 0.15 + strength * 0.85,
    };
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-[11px]">
          <thead>
            <tr>
              <th className="w-11" />
              {DAYS.map((d) => (
                <th key={d} className="pb-1 font-medium text-[var(--text-muted)]">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h}>
                <td className="pr-1 text-right tabular-nums text-[var(--text-muted)]">
                  {String(h).padStart(2, "0")}:00
                </td>
                {DAYS.map((_, i) => {
                  const cell = cells.get(`${i + 1}:${h}`);
                  return (
                    <td key={i}>
                      <div
                        onMouseEnter={() => cell && setHover(cell)}
                        onMouseLeave={() => setHover(null)}
                        style={style(cell)}
                        className="h-7 rounded-[4px] transition-opacity"
                        title={
                          cell
                            ? `${DAYS[i]} ${h}:00 — ${cell.fill}% fill, ${cell.classes} classes`
                            : undefined
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--warn)" }} />
          below average
          <span className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: "var(--accent)" }} />
          above average
          <span className="ml-2 tabular-nums">(average {Math.round(avg)}%)</span>
        </span>

        <span className="tabular-nums">
          {hover
            ? `${DAYS[hover.weekday - 1]} ${String(hover.hour).padStart(2, "0")}:00 — ${hover.fill}% fill · ${hover.classes} classes · ${hover.booked}/${hover.capacity} seats`
            : "Hover a cell for detail"}
        </span>
      </div>
    </div>
  );
}
