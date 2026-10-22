import Link from "next/link";
import { describeInsurance, type Insurance } from "@/lib/instructors";

/** Small pieces shared by the instructor pages. */

const TONE: Record<Insurance["state"], string> = {
  valid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  expiring: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  expired: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  missing: "bg-[var(--chip)] text-[var(--text-muted)]",
};

export function InsuranceBadge({ insurance }: { insurance: Insurance }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[insurance.state]}`}>
      {describeInsurance(insurance)}
    </span>
  );
}

export function TopBar({ email, back }: { email: string; back?: { href: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 text-sm">
      {back ? (
        <Link href={back.href} className="text-[var(--text-muted)] hover:text-[var(--text)]">
          ← {back.label}
        </Link>
      ) : (
        <span className="font-semibold tracking-tight">balanceHQ</span>
      )}
      <div className="flex items-center gap-3 text-[var(--text-muted)]">
        <span className="hidden sm:inline">{email}</span>
        <form action="/auth/sign-out" method="post">
          <button className="cursor-pointer underline underline-offset-2 hover:text-[var(--text)]">Sign out</button>
        </form>
      </div>
    </div>
  );
}

export function NoAccess() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-lg font-semibold tracking-tight">No access</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        Your account can&apos;t open instructor documents. Ask the studio owner if you need it.
      </p>
      <Link href="/" className="mt-4 text-sm text-[var(--accent)] underline underline-offset-2">
        Back to balanceHQ
      </Link>
    </main>
  );
}

export const card = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5";

export const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm " +
  "outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

export const button =
  "cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50";

export const label = "text-[0.7rem] font-medium uppercase tracking-wider text-[var(--text-muted)]";
