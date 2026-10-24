/** What each staff role opens, in the words the Staff logins page uses. */
export const STAFF_ROLES = [
  { key: "admin", label: "Full access", note: "Reports and instructor documents" },
  { key: "instructor_admin", label: "Instructor documents only", note: "No reports" },
  { key: "viewer", label: "Reports only", note: "No instructor documents" },
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number]["key"];

export const isStaffRole = (v: string): v is StaffRole => STAFF_ROLES.some((r) => r.key === v);

export const roleLabel = (key: string) =>
  key === "owner" ? "Owner" : (STAFF_ROLES.find((r) => r.key === key)?.label ?? key);
