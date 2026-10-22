import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import {
  DOC_TYPES,
  formatBytes,
  formatDate,
  insuranceFor,
  isDocType,
  isUuid,
  todayInDublin,
  WARN_DAYS,
} from "@/lib/instructors";
import { InsuranceBadge, NoAccess, TopBar, card } from "../ui";
import { EditInstructorForm } from "./edit-form";
import { UploadForm } from "./upload-form";
import { ArchiveButton, DeleteDocumentButton } from "./buttons";

export const dynamic = "force-dynamic";

type Doc = {
  id: string;
  doc_type: string;
  title: string | null;
  file_name: string;
  file_size: number | null;
  valid_until: string | null;
  uploaded_at: string;
};

/**
 * One instructor's profile: every document they have, grouped by kind,
 * and the form to add more. An empty kind links straight to the form with
 * that kind already chosen.
 */
export default async function InstructorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { db, user, canManageDocs, docStudioId } = await getAccess();
  if (!user) redirect("/login");
  if (!canManageDocs || !docStudioId) return <NoAccess />;
  if (!isUuid(id)) notFound();

  const [{ data: person }, { data: docRows }] = await Promise.all([
    db.from("instructors").select("id, full_name, email, phone, notes, active").eq("id", id).maybeSingle(),
    db
      .from("instructor_documents")
      .select("id, doc_type, title, file_name, file_size, valid_until, uploaded_at")
      .eq("instructor_id", id)
      .order("uploaded_at", { ascending: false }),
  ]);
  if (!person) notFound();

  const docs = (docRows ?? []) as Doc[];
  const insurance = insuranceFor(docs);
  const today = todayInDublin();
  const preselect = sp.type && isDocType(sp.type) ? sp.type : "insurance";

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/instructors", label: "All instructors" }} />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.8rem] font-semibold tracking-tight">
            {person.full_name}
            {!person.active && (
              <span className="ml-2 align-middle font-sans text-sm font-normal text-[var(--text-muted)]">archived</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact details yet"}
            {" · "}
            {docs.length} document{docs.length === 1 ? "" : "s"}
          </p>
        </div>
        <InsuranceBadge insurance={insurance} />
      </header>

      <section id="upload" className={`${card} scroll-mt-6`}>
        <h2 className="text-sm font-semibold">Add a document</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          PDF, photo or Word file, up to 15 MB. For insurance, enter the date the policy is valid until — a
          warning appears {WARN_DAYS} days before it.
        </p>
        <UploadForm key={preselect} studioId={docStudioId} instructorId={person.id as string} defaultType={preselect} />
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="text-sm font-semibold">All documents ({docs.length})</h2>
        <div className="mt-2 divide-y divide-[var(--border)]">
          {DOC_TYPES.map((t) => {
            const group = docs.filter((d) => d.doc_type === t.key);
            return (
              <div key={t.key} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {t.label}
                    {group.length > 0 && ` (${group.length})`}
                  </h3>
                  {group.length === 0 && (
                    <Link
                      href={`/instructors/${person.id}?type=${t.key}#upload`}
                      className="text-xs text-[var(--accent)] underline underline-offset-2"
                    >
                      None yet — add one
                    </Link>
                  )}
                </div>
                {group.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {group.map((d) => {
                      const expired = d.valid_until !== null && d.valid_until < today;
                      return (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[var(--chip)] px-3 py-2.5"
                        >
                          <div className="min-w-[12rem] flex-1">
                            <div className="text-sm font-medium">{d.title || d.file_name}</div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {[d.title ? d.file_name : null, formatBytes(d.file_size), `added ${formatDate(d.uploaded_at)}`]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          {d.valid_until && (
                            <span className={`text-xs tabular-nums ${expired ? "font-semibold text-rose-600" : "text-[var(--text-muted)]"}`}>
                              {expired ? "Expired" : "Valid until"} {formatDate(d.valid_until)}
                            </span>
                          )}
                          <Link
                            href={`/instructors/documents/${d.id}`}
                            target="_blank"
                            rel="noopener"
                            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold transition hover:border-[var(--accent-soft)] hover:bg-[var(--accent-soft)]"
                          >
                            Open
                          </Link>
                          <DeleteDocumentButton id={d.id} name={d.title || d.file_name} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <details className={`${card} mt-4`}>
        <summary className="cursor-pointer text-sm font-semibold">Edit details</summary>
        <div className="mt-4">
          <EditInstructorForm
            id={person.id as string}
            fullName={person.full_name as string}
            email={(person.email as string) ?? ""}
            phone={(person.phone as string) ?? ""}
            notes={(person.notes as string) ?? ""}
          />
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <ArchiveButton id={person.id as string} active={person.active as boolean} />
          </div>
        </div>
      </details>
    </main>
  );
}
