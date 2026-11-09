/** Shown the moment the marketing calendar is opened. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12" aria-busy="true" aria-label="Loading the marketing calendar">
      <div className="mb-8 h-6 w-32 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-2 h-8 w-64 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-6 h-4 w-96 max-w-full animate-pulse rounded bg-[var(--chip)]" />
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="m-5 h-8 w-48 animate-pulse rounded bg-[var(--chip)]" />
        <div className="grid grid-cols-7 gap-px border-t border-[var(--border)] bg-[var(--border)]">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="min-h-[4rem] bg-[var(--surface)] p-2 sm:min-h-[6.75rem] lg:min-h-[8.5rem]">
              <div className="h-4 w-5 animate-pulse rounded bg-[var(--chip)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
