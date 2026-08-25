"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * The selected location lives in the URL, not in component state, so a
 * filtered view can be bookmarked, shared, or reloaded without resetting.
 */
export function LocationFilter({
  locations,
  selected,
}: {
  locations: { id: number; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function choose(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("location");
    else next.set("location", value);
    router.push(`/dashboard?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip label="All locations" active={selected === "all"} onClick={() => choose("all")} />
      {locations.map((l) => (
        <Chip
          key={l.id}
          label={l.name.replace(/^balance\s*-\s*/i, "")}
          active={selected === String(l.id)}
          onClick={() => choose(String(l.id))}
        />
      ))}
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
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-3 py-1.5 text-xs font-medium transition " +
        (active
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--chip)] text-[var(--text-muted)] hover:text-[var(--text)]")
      }
    >
      {label}
    </button>
  );
}
