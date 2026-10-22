import { userClient } from "@/lib/db";

/**
 * What the signed-in person may open.
 *
 * Roles live in studio_users and row level security enforces them (see
 * migration 0018). This only decides what to show: hiding a link is not a
 * permission, because the database refuses the data either way, but it
 * spares an instructor admin from landing on a dashboard of empty panels.
 *
 *   owner, admin       reports and instructor documents
 *   viewer             reports only — the shared desk login
 *   instructor_admin   instructor documents only
 */
export type Role = "owner" | "admin" | "viewer" | "instructor_admin";

const REPORTING: Role[] = ["owner", "admin", "viewer"];
const DOCUMENTS: Role[] = ["owner", "admin", "instructor_admin"];

export async function getAccess() {
  const db = await userClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return { db, user: null, canReport: false, canManageDocs: false, docStudioId: null as string | null };
  }

  // The studio_users policy only returns the caller's own rows.
  const { data } = await db.from("studio_users").select("studio_id, role");
  const rows = (data ?? []) as { studio_id: string; role: Role }[];
  const docRow = rows.find((r) => DOCUMENTS.includes(r.role));

  return {
    db,
    user,
    canReport: rows.some((r) => REPORTING.includes(r.role)),
    canManageDocs: Boolean(docRow),
    docStudioId: docRow?.studio_id ?? null,
  };
}
