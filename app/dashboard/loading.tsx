/** Shown the moment Reporting is opened, while the numbers load. */
export default function Loading() {
  const block = "animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]";
  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12" aria-busy="true" aria-label="Loading reporting">
      <div className="mb-8 h-6 w-32 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-2 h-8 w-56 animate-pulse rounded bg-[var(--chip)]" />
      <div className="mb-8 h-4 w-72 animate-pulse rounded bg-[var(--chip)]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-[6.5rem]`} />
        ))}
      </div>
      <div className={`${block} mt-4 h-72`} />
      <div className={`${block} mt-4 h-56`} />
    </main>
  );
}
