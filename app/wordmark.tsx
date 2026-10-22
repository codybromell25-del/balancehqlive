/** "balance." in the studio's italic serif, with its sage full stop, then HQ. */
export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`font-serif italic tracking-tight ${big ? "text-[2.6rem] leading-none" : "text-[1.35rem] leading-none"}`}>
        balance<span className="text-[var(--accent-soft)]">.</span>
      </span>
      <span
        className={`font-sans font-medium uppercase text-[var(--text-muted)] ${big ? "text-xs tracking-[0.3em]" : "text-[0.62rem] tracking-[0.28em]"}`}
      >
        HQ
      </span>
    </span>
  );
}
