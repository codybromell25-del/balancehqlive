"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PERIODS } from "./periods";

/**
 * Filter state lives in the URL, not component state, so a particular view —
 * Bray over last December, say — can be bookmarked, shared with a manager, or
 * reloaded without resetting to defaults.
 */
export function Filters({
  locations,
  location,
  period,
  from,
  to,
}: {
  locations: { id: number; name: string }[];
  location: string;
  period: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const custom = period === "custom";
  const [draft, setDraft] = useState({ from, to });

  function push(next: URLSearchParams) {
    const qs = next.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  }

  function choosePeriod(value: string) {
    const next = new URLSearchParams(params.toString());
    // A preset and an explicit range are mutually exclusive; leaving stale
    // dates behind would silently win over the preset the user just clicked.
    next.delete("from");
    next.delete("to");
    if (value === "28") next.delete("period");
    else next.set("period", value);
    push(next);
  }

  function applyRange() {
    if (!draft.from || !draft.to) return;
    const next = new URLSearchParams(params.toString());
    next.set("period", "custom");
    // Tolerate the dates being entered the wrong way round.
    const [a, b] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    next.set("from", a);
    next.set("to", b);
    push(next);
  }

  function setLocation(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("location");
    else next.set("location", value);
    push(next);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-2.5">
      <Row label="Period">
        {PERIODS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            active={period === p.key}
            onClick={() => choosePeriod(p.key)}
          />
        ))}
        <Chip
          label="Custom"
          active={custom}
          onClick={() => choosePeriod(custom ? "28" : "custom")}
        />
      </Row>

      {custom && (
        <div className="flex flex-wrap items-center gap-1.5 pl-[3.75rem]">
          <input
            type="date"
            value={draft.from}
            max={today}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-muted)]">to</span>
          <input
            type="date"
            value={draft.to}
            max={today}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={applyRange}
            disabled={!draft.from || !draft.to || (draft.from === from && draft.to === to)}
            className="cursor-pointer rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}

      {locations.length > 1 && (
        <Row label="Location">
          <Chip label="All" active={location === "all"} onClick={() => setLocation("all")} />
          {locations.map((l) => (
            <Chip
              key={l.id}
              label={l.name.replace(/^balance\s*-\s*/i, "")}
              active={location === String(l.id)}
              onClick={() => setLocation(String(l.id))}
            />
          ))}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-14 shrink-0 text-[0.68rem] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition " +
        (active
          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
          : "border-[var(--border)] bg-[var(--chip)] text-[var(--text-muted)] hover:text-[var(--text)]")
      }
    >
      {label}
    </button>
  );
}
