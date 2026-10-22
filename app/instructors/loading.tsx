/** Shown the moment Instructor documents is opened. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12" aria-busy="true" aria-label="Loading instructors">
      <div className="mb-8 h-6 w-32 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-2 h-8 w-64 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-8 h-4 w-96 max-w-full animate-pulse rounded bg-[var(--chip)]" />
      <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="mb-4 h-10 rounded-lg bg-[var(--chip)]" />
        ))}
      </div>
    </main>
  );
}
