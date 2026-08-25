"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PERIODS } from "./periods";

/**
 * Filter state lives in the URL, not component state, so a particular view —
 * Bray over the last quarter, say — can be bookmarked, shared with a manager,
 * or reloaded without resetting to defaults.
 */

export function Filters({
  locations,
  location,
  period,
}: {
  locations: { id: number; name: string }[];
  location: string;
  period: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string, clearIfDefault: string) {
    const next = new URLSearchParams(params.toString());
    if (value === clearIfDefault) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Row label="Period">
        {PERIODS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            active={period === p.key}
            onClick={() => set("period", p.key, "28")}
          />
        ))}
      </Row>

      {locations.length > 1 && (
        <Row label="Location">
          <Chip
            label="All"
            active={location === "all"}
            onClick={() => set("location", "all", "all")}
          />
          {locations.map((l) => (
            <Chip
              key={l.id}
              label={l.name.replace(/^balance\s*-\s*/i, "")}
              active={location === String(l.id)}
              onClick={() => set("location", String(l.id), "all")}
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

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
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
