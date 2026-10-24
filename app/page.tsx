import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { insuranceFor } from "@/lib/instructors";
import { TopBar } from "./instructors/ui";

export const dynamic = "force-dynamic";

/**
 * The front door: reporting on one side, instructor documents on the other.
 *
 * Each card follows the person's role. Someone without reporting access
 * sees that card blanked out rather than missing, so it is clear the
 * section exists and is simply not theirs — the data behind it is refused
 * by the database regardless.
 */
export default async function Home() {
  const { db, user, canReport, canManageDocs, ownerStudioId } = await getAccess();
  if (!user) redirect("/login");

  let expired = 0;
  let expiring = 0;
  let missing = 0;
  if (canManageDocs) {
    const [{ data: people }, { data: docs }] = await Promise.all([
      db.from("instructors").select("id").eq("active", true),
      db.from("instructor_documents").select("instructor_id, doc_type, valid_until").eq("doc_type", "insurance"),
    ]);
    for (const p of people ?? []) {
      const state = insuranceFor((docs ?? []).filter((d) => d.instructor_id === p.id)).state;
      if (state === "expired") expired++;
      else if (state === "expiring") expiring++;
      else if (state === "missing") missing++;
    }
  }

  const warnings = [
    expired && `${expired} expired`,
    expiring && `${expiring} expiring within a month`,
  ].filter(Boolean);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} />

      <h1 className="text-[1.6rem] font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Choose where you&apos;d like to go.</p>

      {!canReport && !canManageDocs ? (
        <p className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text-muted)]">
          Your account hasn&apos;t been given access to anything yet. Ask the studio owner to add you.
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Section
            href={canReport ? "/dashboard" : null}
            eyebrow="Reporting"
            title="Studio reporting"
            body="Classes, fill, revenue and members across every studio."
            locked="Not available on your account."
          />
          <Section
            href={canManageDocs ? "/instructors" : null}
            eyebrow="Admin"
            title="Instructor documents"
            body="Upload instructors' insurance, qualifications and contracts, and track when insurance runs out."
            locked="Not available on your account."
            alert={warnings.length ? `Insurance: ${warnings.join(", ")}` : undefined}
            note={missing ? `${missing} instructor${missing === 1 ? "" : "s"} with no insurance on file` : undefined}
          />
          <Section
            href="https://educationbalance.vercel.app/login"
            external
            eyebrow="Education"
            title="balance Education admin"
            body="Sign in to the training course admin. Opens in a new tab with its own login."
            locked=""
          />
          {ownerStudioId && (
            <Section
              href="/team"
              eyebrow="Owner"
              title="Staff logins"
              body="Add logins, choose what each person can open, and set or reset passwords."
              locked=""
            />
          )}
        </div>
      )}
    </main>
  );
}

function Section(props: {
  href: string | null;
  eyebrow: string;
  title: string;
  body: string;
  locked: string;
  alert?: string;
  note?: string;
  /** Another site: opens in a new tab, and isn't prefetched. */
  external?: boolean;
}) {
  const inner = (
    <>
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        {props.eyebrow}
      </span>
      <h2 className="mt-2 font-serif text-xl tracking-tight">
        {props.title}
        {props.external && <span className="ml-1.5 font-sans text-base text-[var(--text-muted)]">↗</span>}
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{props.href ? props.body : props.locked}</p>
      {props.href && props.alert && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {props.alert}
        </p>
      )}
      {props.href && props.note && <p className="mt-2 text-xs text-[var(--text-muted)]">{props.note}</p>}
    </>
  );

  if (!props.href) {
    return (
      <div aria-disabled className="select-none rounded-xl border border-dashed border-[var(--border)] p-5 opacity-50">
        {inner}
      </div>
    );
  }

  if (props.external) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]"
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={props.href}
      // Fetch the whole section while this page sits open, so the click
      // lands on a page that's already loaded (and warms the report cache).
      prefetch
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]"
    >
      {inner}
    </Link>
  );
}
