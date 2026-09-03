/** Server component — a warning, not a widget. */

export interface Verification {
  ran_at: string;
  passed: boolean;
  failed_count: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

/**
 * Says when the dashboard no longer agrees with Momence.
 *
 * Deliberately prominent and deliberately worded as a reason to stop trusting
 * the figures below it. The failure this guards against is not a page that
 * breaks — it is a page that looks perfectly normal while being wrong.
 */
export function VerificationBanner({ data }: { data: Verification | null }) {
  // Never verified, or the check itself stopped running: both are worth
  // saying, because silence is what a broken monitor looks like.
  if (!data) {
    return (
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
        These figures have not been checked against Momence yet.
      </div>
    );
  }

  const hoursAgo = (Date.now() - new Date(data.ran_at).getTime()) / 3_600_000;
  const stale = hoursAgo > 36;

  if (data.passed && !stale) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        Checked against Momence {hoursAgo < 1 ? "just now" : `${Math.round(hoursAgo)}h ago`} — everything agrees.
      </div>
    );
  }

  const failures = data.checks.filter((c) => !c.ok);

  return (
    <div className="mb-4 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        {stale && data.passed
          ? "These figures have not been checked recently"
          : "These figures may not be correct"}
      </div>

      <p className="mt-1 text-xs leading-relaxed">
        {stale && data.passed ? (
          <>
            The last check against Momence was {Math.round(hoursAgo / 24)} days ago. It
            passed, but the daily check has stopped running — so nothing is
            confirming the numbers below are still right.
          </>
        ) : (
          <>
            The daily check found {failures.length} thing
            {failures.length === 1 ? "" : "s"} that no longer{" "}
            {failures.length === 1 ? "matches" : "match"} Momence. Treat the figures below
            as unreliable until this is resolved.
          </>
        )}
      </p>

      {failures.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {failures.map((c) => (
            <li key={c.name} className="tabular-nums">
              • {c.name.replace(/^[^:]+:\s*/, "")} — {c.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
