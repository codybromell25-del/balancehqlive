import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { serviceClient } from "@/lib/db";
import { formatDate } from "@/lib/instructors";
import { TopBar, card } from "../instructors/ui";
import { roleLabel } from "./roles";
import { AddLoginForm, PasswordForm, RemoveButton, RoleForm } from "./forms";

export const dynamic = "force-dynamic";

/**
 * Who can sign in to balanceHQ and what each person opens. Owner only:
 * the page reads every login's email through the service role, which no
 * other role should be able to reach.
 */
export default async function TeamPage() {
  const { user, ownerStudioId } = await getAccess();
  if (!user) redirect("/login");
  if (!ownerStudioId) redirect("/");

  const db = serviceClient();
  const [{ data: rows }, { data: list }] = await Promise.all([
    db.from("studio_users").select("user_id, role").eq("studio_id", ownerStudioId),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const byId = new Map((list?.users ?? []).map((u) => [u.id, u]));
  // Rows whose login was deleted in Supabase have no user left to show.
  const staff = (rows ?? [])
    .filter((r) => byId.has(r.user_id as string))
    .map((r) => {
      const u = byId.get(r.user_id as string)!;
      return {
        id: u.id,
        email: u.email ?? "(no email)",
        role: r.role as string,
        lastSignIn: u.last_sign_in_at ?? null,
        me: u.id === user.id,
      };
    })
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.email.localeCompare(b.email));

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/", label: "balanceHQ" }} />

      <header className="mb-6">
        <h1 className="text-[1.6rem] font-semibold tracking-tight">Staff logins</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Who can sign in, what they can open, and their passwords. Only you, as the owner, can see this page.
        </p>
      </header>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold">Logins ({staff.length})</h2>
        <ul className="divide-y divide-[var(--border)]">
          {staff.map((s) => (
            <li key={s.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {s.email}
                    {s.me && <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">you</span>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {roleLabel(s.role)} ·{" "}
                    {s.lastSignIn ? `last signed in ${formatDate(s.lastSignIn)}` : "hasn't signed in yet"}
                  </div>
                </div>
                {!s.me && s.role !== "owner" && <RemoveButton userId={s.id} email={s.email} />}
              </div>
              {!s.me && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {s.role !== "owner" && <RoleForm userId={s.id} role={s.role} />}
                  <PasswordForm userId={s.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="text-sm font-semibold">Add a login</h2>
        <p className="mb-4 mt-0.5 text-xs text-[var(--text-muted)]">
          They sign in at this site with their email and the password you set here.
        </p>
        <AddLoginForm />
      </section>
    </main>
  );
}
