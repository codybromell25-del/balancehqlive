import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { insuranceFor, urgency, describeInsurance, type Insurance } from "@/lib/instructors";
import { InsuranceBadge, NoAccess, TopBar, card } from "./ui";
import { AddInstructorForm } from "./add-instructor-form";

export const dynamic = "force-dynamic";

/**
 * Every instructor and where their insurance stands. Problems come first:
 * the page exists so nobody teaches on a policy that lapsed last week.
 */
export default async function InstructorsPage() {
  const { db, user, canManageDocs } = await getAccess();
  if (!user) redirect("/login");
  if (!canManageDocs) return <NoAccess />;

  const [{ data: people, error }, { data: docs }] = await Promise.all([
    db.from("instructors").select("id, full_name, email, phone, active").order("full_name"),
    db.from("instructor_documents").select("instructor_id, doc_type, valid_until"),
  ]);

  const byInstructor = new Map<string, { doc_type: string; valid_until: string | null }[]>();
  for (const d of docs ?? []) {
    const list = byInstructor.get(d.instructor_id as string) ?? [];
    list.push(d as { doc_type: string; valid_until: string | null });
    byInstructor.set(d.instructor_id as string, list);
  }

  const rows = (people ?? []).map((p) => {
    const own = byInstructor.get(p.id as string) ?? [];
    return {
      id: p.id as string,
      name: p.full_name as string,
      contact: [p.email, p.phone].filter(Boolean).join(" · "),
      active: p.active as boolean,
      documents: own.length,
      insurance: insuranceFor(own),
    };
  });

  const active = rows.filter((r) => r.active);
  const archived = rows.filter((r) => !r.active);
  const attention = active
    .filter((r) => r.insurance.state === "expired" || r.insurance.state === "expiring")
    .sort((a, b) => urgency(a.insurance) - urgency(b.insurance));
  const missing = active.filter((r) => r.insurance.state === "missing");

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/", label: "balanceHQ" }} />

      <header className="mb-6">
        <h1 className="text-[1.6rem] font-semibold tracking-tight">Instructor documents</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Insurance, qualifications and contracts for every instructor. Insurance shows a warning a
          month before it runs out.
        </p>
      </header>

      {error && (
        <p className={`${card} mb-4 text-sm text-rose-600 dark:text-rose-400`}>
          Couldn&apos;t load instructors: {error.message}
        </p>
      )}

      {attention.length > 0 && (
        <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Insurance to renew ({attention.length})
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {attention.map((r) => (
              <li key={r.id}>
                <Link href={`/instructors/${r.id}`} className="font-medium underline underline-offset-2">
                  {r.name}
                </Link>{" "}
                <span className="text-amber-900/80 dark:text-amber-200/80">— {describeInsurance(r.insurance)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          {missing.length} instructor{missing.length === 1 ? " has" : "s have"} no insurance on file yet.
        </p>
      )}

      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Instructors ({active.length})</h2>
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No instructors yet. Add the first one below.</p>
        ) : (
          <InstructorTable rows={active} />
        )}

        <div className="mt-6 border-t border-[var(--border)] pt-5">
          <h3 className="mb-3 text-sm font-semibold">Add an instructor</h3>
          <AddInstructorForm />
        </div>
      </section>

      {archived.length > 0 && (
        <details className={`${card} mt-4`}>
          <summary className="cursor-pointer text-sm font-semibold">Archived instructors ({archived.length})</summary>
          <div className="mt-4">
            <InstructorTable rows={archived} />
          </div>
        </details>
      )}
    </main>
  );
}

function InstructorTable({
  rows,
}: {
  rows: { id: string; name: string; contact: string; documents: number; insurance: Insurance }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
            <th className="py-2 pr-4 font-medium">Instructor</th>
            <th className="py-2 pr-4 font-medium">Insurance</th>
            <th className="py-2 text-right font-medium">Documents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
              <td className="py-2.5 pr-4">
                <Link href={`/instructors/${r.id}`} className="font-medium hover:underline hover:underline-offset-2">
                  {r.name}
                </Link>
                {r.contact && <div className="text-xs text-[var(--text-muted)]">{r.contact}</div>}
              </td>
              <td className="py-2.5 pr-4">
                <InsuranceBadge insurance={r.insurance} />
              </td>
              <td className="py-2.5 text-right tabular-nums">{r.documents}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
