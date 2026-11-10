import { userClient } from "@/lib/db";

/**
 * What the signed-in person may open.
 *
 * Roles live in studio_users and row level security enforces them (see
 * migration 0018). This only decides what to show: hiding a link is not a
 * permission, because the database refuses the data either way, but it
 * spares an instructor admin from landing on a dashboard of empty panels.
 *
 *   owner, admin       reports, instructor documents and the sales dashboard
 *   viewer             reports only — the shared desk login
 *   instructor_admin   instructor documents only
 *   sales              the sales dashboard only (migration 0022)
 *
 * Every role opens the marketing calendar (migration 0021). Owners and
 * admins can also delete anyone's notes and flags there.
 */
export type Role = "owner" | "admin" | "viewer" | "instructor_admin" | "sales";

const REPORTING: Role[] = ["owner", "admin", "viewer"];
const DOCUMENTS: Role[] = ["owner", "admin", "instructor_admin"];
const SALES: Role[] = ["owner", "admin", "sales"];

export async function getAccess() {
  const db = await userClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return {
      db, user: null, canReport: false, canManageDocs: false,
      docStudioId: null as string | null, reportScope: "", ownerStudioId: null as string | null,
      canPlan: false, planStudioId: null as string | null, managesPlans: false,
      canSell: false, salesStudioId: null as string | null,
    };
  }

  // The studio_users policy only returns the caller's own rows.
  const { data } = await db.from("studio_users").select("studio_id, role");
  const rows = (data ?? []) as { studio_id: string; role: Role }[];
  const docRow = rows.find((r) => DOCUMENTS.includes(r.role));
  const salesRow = rows.find((r) => SALES.includes(r.role));

  // Everything row level security consults when it decides what a report
  // returns: which studios, and whether the person is an owner (owners also
  // get the named at-risk and teacher lists). Two people with the same scope
  // see identical numbers, which is what lets the dashboard share a cache.
  const studios = [...new Set(rows.filter((r) => REPORTING.includes(r.role)).map((r) => r.studio_id))].sort();
  const owner = rows.some((r) => r.role === "owner" || r.role === "admin");

  return {
    db,
    user,
    canReport: studios.length > 0,
    canManageDocs: Boolean(docRow),
    docStudioId: docRow?.studio_id ?? null,
    reportScope: `${studios.join(",")}|${owner ? "owner" : "viewer"}`,
    // Only an owner manages who can sign in (the Staff logins page).
    ownerStudioId: rows.find((r) => r.role === "owner")?.studio_id ?? null,
    canPlan: rows.length > 0,
    planStudioId: rows[0]?.studio_id ?? null,
    managesPlans: owner,
    canSell: Boolean(salesRow),
    salesStudioId: salesRow?.studio_id ?? null,
  };
}
