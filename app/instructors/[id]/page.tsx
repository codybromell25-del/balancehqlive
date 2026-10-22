import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import {
  docTypeLabel,
  formatBytes,
  formatDate,
  insuranceFor,
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

export default async function InstructorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/instructors", label: "Instructor documents" }} />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-tight">
            {person.full_name}
            {!person.active && (
              <span className="ml-2 align-middle text-sm font-normal text-[var(--text-muted)]">archived</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact details yet"}
          </p>
        </div>
        <InsuranceBadge insurance={insurance} />
      </header>

      <section className={card}>
        <h2 className="text-sm font-semibold">Upload a document</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          PDF, photo or Word file, up to 15 MB. For insurance, enter the date the policy is valid until —
          a warning appears {WARN_DAYS} days before it.
        </p>
        <UploadForm studioId={docStudioId} instructorId={person.id as string} />
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="mb-4 text-sm font-semibold">Documents ({docs.length})</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Document</th>
                  <th className="py-2 pr-4 font-medium">Valid until</th>
                  <th className="py-2 pr-4 font-medium">Uploaded</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const expired = d.valid_until !== null && d.valid_until < today;
                  return (
                    <tr key={d.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{docTypeLabel(d.doc_type)}</td>
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/instructors/documents/${d.id}`}
                          target="_blank"
                          rel="noopener"
                          className="font-medium hover:underline hover:underline-offset-2"
                        >
                          {d.title || d.file_name}
                        </Link>
                        <div className="text-xs text-[var(--text-muted)]">
                          {[d.title ? d.file_name : null, formatBytes(d.file_size)].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className={`py-2.5 pr-4 whitespace-nowrap tabular-nums ${expired ? "text-rose-600 dark:text-rose-400" : ""}`}>
                        {d.valid_until ? formatDate(d.valid_until) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums text-[var(--text-muted)]">
                        {formatDate(d.uploaded_at)}
                      </td>
                      <td className="py-2.5 text-right">
                        <DeleteDocumentButton id={d.id} name={d.title || d.file_name} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
