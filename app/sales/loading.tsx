/** Shown the moment the sales dashboard is opened. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12" aria-busy="true" aria-label="Loading the sales dashboard">
      <div className="mb-8 h-6 w-32 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-2 h-8 w-64 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-6 h-4 w-96 max-w-full animate-pulse rounded bg-[var(--chip)]" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[5.25rem] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="mt-5 h-10 w-full max-w-2xl animate-pulse rounded-lg bg-[var(--chip)]" />
      <div className="mt-4 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="mb-3 h-9 rounded-lg bg-[var(--chip)]" />
        ))}
      </div>
    </main>
  );
}
