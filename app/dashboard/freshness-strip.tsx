/**
 * A dashboard that silently serves stale numbers is worse than one that
 * admits it. This strip is always visible: it shows when the event stream
 * last delivered, how much of today's report budget is spent, and whether
 * anything is stuck.
 */

interface Freshness {
  last_webhook_at: string | null;
  unprocessed_events: number;
  last_report_at: string | null;
  report_runs_today: number;
}

function ago(iso: string | null): string {
  if (!iso) return "never";

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function FreshnessStrip({ freshness }: { freshness: Freshness }) {
  const lastWebhookMinutes = freshness.last_webhook_at
    ? (Date.now() - new Date(freshness.last_webhook_at).getTime()) / 60_000
    : Infinity;

  // Studios are quiet overnight, so silence alone is not a fault. Six hours
  // without a single event during a working day usually is.
  const streamStalled = lastWebhookMinutes > 360;
  const backlogged = freshness.unprocessed_events > 50;
  const budgetTight = freshness.report_runs_today > 80;

  const problem = streamStalled || backlogged || budgetTight;

  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-2.5 text-xs " +
        (problem
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]")
      }
    >
      <span className="flex items-center gap-2">
        <span
          className={
            "inline-block h-1.5 w-1.5 rounded-full " +
            (problem ? "bg-amber-500" : "bg-emerald-500")
          }
          aria-hidden
        />
        Live data {ago(freshness.last_webhook_at)}
      </span>

      <span>Reports refreshed {ago(freshness.last_report_at)}</span>

      <span className="tabular-nums">
        {freshness.report_runs_today}/100 report runs used today
      </span>

      {backlogged && (
        <span className="font-medium">
          {freshness.unprocessed_events} events waiting to process
        </span>
      )}

      {streamStalled && <span className="font-medium">Event stream has gone quiet</span>}
    </div>
  );
}
